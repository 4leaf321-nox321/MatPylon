/** MatNexus API 클라이언트 — 개발계획 §5 의 계약을 그대로 부른다.
 *
 * 규약은 MatNexus 의 것이다: 성공은 리소스 그대로, 오류만
 * `{error:{code,message,request_id,details}}`, 인증은 PAT Bearer(ADR 0001·0002).
 * 여기서 결과를 sent/rejected/retry/halt 넷으로 접는다 — 원장은 HTTP 를 모른다.
 *
 * `fetch` 는 Node 내장이 아니라 undici 패키지의 것이다. 내장 fetch 는 TLS 옵션을
 * 못 받는데, 사내망 HTTPS 는 자체 서명 인증서가 흔하다. */

import { openAsBlob, readFileSync } from "node:fs";
import path from "node:path";
import { Agent, fetch as undiciFetch, type Dispatcher, type RequestInit } from "undici";
import type { SecretStore } from "./secrets";
import type { Hints } from "./hints";
import type { Delivery, DeliveryResult, Transport } from "./transport";

export interface ServerError {
  code: string;
  message: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

export interface ConnectorOut {
  id: string;
  name: string;
  hostname: string;
  workspace_id: string;
}

export interface WorkspaceOut {
  id: string;
  name: string;
  /** 계층 경로(`본부/팀`). 이름이 같은 팀이 다른 본부에 있을 수 있어 함께 보여 준다. */
  path: string;
  kind: string;
  is_active: boolean;
}

/** `POST /pipelines/resolve` — 힌트 하나의 판정. 워커와 같은 함수의 결과다. */
export interface ResolveResult {
  outcome: "unique" | "multiple" | "none";
  candidate: Candidate | null;
  candidates: Candidate[];
  reason?: string;
}

export interface Candidate {
  specimen_id: string;
  specimen_name: string;
  material_name: string;
  sample_name: string;
  reason: string;
}

/** `GET /pipelines/reference` — 이름 트리. 화면이 참조로만 본다. */
export interface ReferenceTree {
  generated_at: string;
  materials: {
    id: string;
    name: string;
    grade: string | null;
    /** 워커가 material_code 를 맞출 때 보는 집합(이름·grade·별칭). */
    aliases: string[];
    samples: {
      id: string;
      name: string;
      lot: string;
      seq_no: number;
      specimens: { id: string; name: string; short: string; orientation: string | null; seq_no: number }[];
    }[];
  }[];
}

export interface HeartbeatIn {
  app_version: string;
  sources: { key: string; pending: number; failed: number; last_sent_at: string | null }[];
  next_run_at: string | null;
}

export interface HeartbeatOut {
  server_time: string;
  upload_limit_bytes?: number;
}

export interface InboxItemOut {
  id: string;
  status: string;
}

export interface Me {
  id: string;
  display_name?: string;
  email?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ServerError | null,
  ) {
    super(error ? `${error.code} ${error.message}` : `HTTP ${status}`);
  }
}

export interface TlsOptions {
  insecure: boolean;
  caFile: string | null;
}

export interface ClientOptions {
  baseUrl: string;
  secrets: SecretStore;
  connectorId: string | null;
  tls?: TlsOptions;
  timeoutMs?: number;
}

export class MatNexusClient implements Transport {
  private readonly timeoutMs: number;
  private readonly dispatcher: Dispatcher | undefined;

  constructor(private readonly options: ClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.dispatcher = makeDispatcher(options.tls);
  }

  configured(): boolean {
    return Boolean(this.options.baseUrl && this.options.secrets.getToken() && this.options.connectorId);
  }

  // --- 요청 공통 ------------------------------------------------------------

  private url(p: string): string {
    return `${this.options.baseUrl.replace(/\/+$/, "")}/api${p}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const token = this.options.secrets.getToken();
    return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  }

  private async request<T>(
    method: string,
    p: string,
    body?: RequestInit["body"],
    json = true,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await undiciFetch(this.url(p), {
        method,
        headers: this.headers(json && body ? { "Content-Type": "application/json" } : {}),
        body,
        signal: ctrl.signal,
        dispatcher: this.dispatcher,
      });
      if (!res.ok) throw new ApiError(res.status, await parseError(res));
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- 계약 ----------------------------------------------------------------

  me(): Promise<Me> {
    return this.request("GET", "/auth/me");
  }

  /** 규칙 편집기의 「MatNexus 대조」. 힌트 ≤50개, 같은 순서로 돌아온다. */
  resolve(workspaceId: string, hints: Hints[]): Promise<ResolveResult[]> {
    return this.request<{ results: ResolveResult[] }>(
      "POST",
      "/pipelines/resolve",
      JSON.stringify({ workspace_id: workspaceId, hints: hints.slice(0, 50) }),
    ).then((r) => r.results);
  }

  reference(workspaceId: string): Promise<ReferenceTree> {
    return this.request("GET", `/pipelines/reference?workspace_id=${encodeURIComponent(workspaceId)}`);
  }

  /** PAT 주인이 속한 부서. 마법사가 부서 ID 를 손으로 베끼지 않게 목록에서 고른다. */
  listWorkspaces(): Promise<WorkspaceOut[]> {
    return this.request("GET", "/workspaces");
  }

  registerConnector(name: string, hostname: string, workspaceId: string): Promise<ConnectorOut> {
    return this.request(
      "POST",
      "/pipelines/connectors",
      JSON.stringify({ name, hostname, workspace_id: workspaceId }),
    );
  }

  listConnectors(): Promise<ConnectorOut[]> {
    return this.request("GET", "/pipelines/connectors");
  }

  heartbeat(body: HeartbeatIn): Promise<HeartbeatOut> {
    return this.request(
      "POST",
      `/pipelines/connectors/${this.options.connectorId}/heartbeat`,
      JSON.stringify(body),
    );
  }

  /** 파일 1 = 요청 1. `openAsBlob` 은 파일을 읽지 않고 Blob 을 만든다 — 본문을 보낼
   * 때 스트림으로 읽는다. 큰 파일이 메모리에 통째로 오르지 않는다. */
  async deliver(item: Delivery): Promise<DeliveryResult> {
    const form = new FormData();
    form.set("connector_id", this.options.connectorId ?? "");
    form.set("source_key", item.sourceKey);
    form.set("client_sha256", item.sha256);
    form.set("client_path", item.path);
    form.set("mtime", new Date(item.mtimeMs).toISOString());
    form.set("hints", JSON.stringify(item.hints));
    // 서버 규약: file 은 마지막 파트여야 스트리밍이 된다.
    form.set("file", await openAsBlob(item.path), path.basename(item.path));

    try {
      const out = await this.request<InboxItemOut>("POST", "/pipelines/inbox", form, false);
      return { kind: "sent", serverId: out.id };
    } catch (e) {
      return classify(e);
    }
  }
}

/** TLS 설정이 기본이면 dispatcher 를 만들지 않는다 — undici 기본을 쓴다. */
function makeDispatcher(tls: TlsOptions | undefined): Dispatcher | undefined {
  if (!tls || (!tls.insecure && !tls.caFile)) return undefined;
  return new Agent({
    connect: {
      rejectUnauthorized: !tls.insecure,
      ca: tls.caFile ? readFileSync(tls.caFile, "utf8") : undefined,
    },
  });
}

async function parseError(res: { json(): Promise<unknown> }): Promise<ServerError | null> {
  try {
    const body = (await res.json()) as { error?: ServerError };
    return body.error ?? null;
  } catch {
    return null;
  }
}

/** 해시 불일치 — 전송 중 깨진 것. 한 번은 다시 보내 본다(원장이 횟수를 센다). */
export const HASH_MISMATCH = "MNX-PIPE-0003";

/** HTTP 결과 → 원장이 아는 넷. 규칙은 개발계획 §5.3. */
export function classify(e: unknown): DeliveryResult {
  if (e instanceof ApiError) {
    const msg = e.error ? `${e.error.code}: ${e.error.message}` : `HTTP ${e.status}`;
    // 같은 내용이 이미 있다 — 서버 원장이 정본이므로 보낸 것으로 닫는다.
    if (e.status === 409 && e.error?.code === "MNX-PIPE-0004")
      return { kind: "sent", serverId: String(e.error.details?.existing_id ?? "") || null };
    if (e.status === 401) return { kind: "halt", error: "토큰이 만료됐거나 폐기됐습니다" };
    if (e.status === 429) return { kind: "retry", error: msg };
    if (e.error?.code === HASH_MISMATCH) return { kind: "retry", error: msg };
    if (e.status >= 400 && e.status < 500) return { kind: "rejected", error: msg };
    return { kind: "retry", error: msg };
  }
  const err = e as Error & { cause?: { code?: string } };
  if (err.name === "AbortError") return { kind: "retry", error: "시간 초과" };
  return { kind: "retry", error: err.cause?.code ?? err.message };
}
