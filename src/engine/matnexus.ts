/** MatNexus API 클라이언트 — 개발계획 §5 의 계약을 그대로 부른다.
 *
 * 규약은 MatNexus 의 것이다: 성공은 리소스 그대로, 오류만
 * `{error:{code,message,request_id,details}}`, 인증은 PAT Bearer(ADR 0001·0002).
 * 여기서 결과를 sent/rejected/retry/halt 넷으로 접는다 — 원장은 HTTP 를 모른다. */

import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { SecretStore } from "./secrets";
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

export interface ClientOptions {
  baseUrl: string;
  secrets: SecretStore;
  connectorId: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class MatNexusClient implements Transport {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
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

  private async request<T>(method: string, p: string, body?: RequestInit["body"], json = true): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url(p), {
        method,
        headers: this.headers(json && body ? { "Content-Type": "application/json" } : {}),
        body,
        signal: ctrl.signal,
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

  /** 파일 1 = 요청 1. 본문은 스트림 — 큰 파일을 메모리에 올리지 않는다. */
  async deliver(item: Delivery): Promise<DeliveryResult> {
    const form = new FormData();
    form.set("connector_id", this.options.connectorId ?? "");
    form.set("source_key", item.sourceKey);
    form.set("client_sha256", item.sha256);
    form.set("client_path", item.path);
    form.set("mtime", new Date(item.mtimeMs).toISOString());
    form.set("hints", JSON.stringify(item.hints));
    form.set("file", await fileBlob(item.path), path.basename(item.path));

    try {
      const out = await this.request<InboxItemOut>("POST", "/pipelines/inbox", form, false);
      return { kind: "sent", serverId: out.id };
    } catch (e) {
      return classify(e);
    }
  }
}

async function parseError(res: Response): Promise<ServerError | null> {
  try {
    const body = (await res.json()) as { error?: ServerError };
    return body.error ?? null;
  } catch {
    return null;
  }
}

/** HTTP 결과 → 원장이 아는 넷. 규칙은 개발계획 §5.3. */
export function classify(e: unknown): DeliveryResult {
  if (e instanceof ApiError) {
    const msg = e.error ? `${e.error.code}: ${e.error.message}` : `HTTP ${e.status}`;
    // 같은 내용이 이미 있다 — 서버 원장이 정본이므로 보낸 것으로 닫는다.
    if (e.status === 409 && e.error?.code === "MNX-PIPE-0004")
      return { kind: "sent", serverId: String(e.error.details?.existing_id ?? "") || null };
    if (e.status === 401) return { kind: "halt", error: "토큰이 만료됐거나 폐기됐습니다" };
    if (e.status === 429) return { kind: "retry", error: msg };
    if (e.status >= 400 && e.status < 500) return { kind: "rejected", error: msg };
    return { kind: "retry", error: msg };
  }
  const err = e as Error & { cause?: { code?: string } };
  if (err.name === "AbortError") return { kind: "retry", error: "시간 초과" };
  return { kind: "retry", error: err.cause?.code ?? err.message };
}

/** Node 의 FormData 는 Blob 을 원한다. 파일 스트림을 Blob 으로 감싸되 통째로 읽지 않는다. */
async function fileBlob(file: string): Promise<Blob> {
  const size = statSync(file).size;
  // 16MB 아래는 그냥 읽는다 — 장비 파일 대부분이 여기 든다. 그 위는 스트림.
  if (size <= 16 * 1024 * 1024) {
    const { readFile } = await import("node:fs/promises");
    return new Blob([await readFile(file)]);
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream).blob();
}
