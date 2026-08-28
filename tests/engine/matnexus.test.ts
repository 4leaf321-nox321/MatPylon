/** 목 서버로 계약을 검증한다. MatNexus 가 이 모양으로 만들면 붙는다(개발계획 §5). */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MatNexusClient, classify, ApiError } from "@engine/matnexus";
import { memorySecrets } from "@engine/secrets";

interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: string;
}

let server: Server;
let baseUrl: string;
const seen: Seen[] = [];
let scenario: (req: IncomingMessage, body: string) => { status: number; json?: unknown } = () => ({
  status: 500,
});

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await read(req);
    seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
    const r = scenario(req, body);
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(r.json === undefined ? "" : JSON.stringify(r.json));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/`; // 끝의 / 는 잘려야 한다
});
afterAll(() => server.close());

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function client(token: string | null = "mnx_pat_x", connectorId: string | null = "c-1") {
  return new MatNexusClient({ baseUrl, secrets: memorySecrets(token), connectorId, timeoutMs: 2000 });
}

function tempFile(name: string, content: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "matpylon-tx-"));
  dirs.push(dir);
  const f = path.join(dir, name);
  writeFileSync(f, content);
  return f;
}

describe("MatNexusClient", () => {
  it("configured: url·토큰·커넥터 셋 다 있어야", () => {
    expect(client().configured()).toBe(true);
    expect(client(null).configured()).toBe(false);
    expect(client("t", null).configured()).toBe(false);
  });

  it("me: Bearer 헤더로 /api/auth/me", async () => {
    scenario = () => ({ status: 200, json: { id: "u1", display_name: "장비" } });
    const me = await client().me();
    expect(me.display_name).toBe("장비");
    const last = seen.at(-1)!;
    expect(last.url).toBe("/api/auth/me");
    expect(last.auth).toBe("Bearer mnx_pat_x");
  });

  it("오류 엔벨로프를 읽는다", async () => {
    scenario = () => ({
      status: 404,
      json: { error: { code: "MNX-PIPE-0001", message: "커넥터 없음", request_id: "r1" } },
    });
    await expect(client().heartbeat({ app_version: "1", sources: [], next_run_at: null })).rejects.toThrow(
      /MNX-PIPE-0001 커넥터 없음/,
    );
  });

  it("deliver: multipart 로 필드와 파일을 보내고 202 를 sent 로", async () => {
    scenario = () => ({ status: 202, json: { id: "inbox-9", status: "received" } });
    const f = tempFile("A_1.tra", "curve-data");
    const r = await client().deliver({
      sourceKey: "zwick",
      path: f,
      sha256: "abc",
      mtimeMs: 0,
      hints: { material_code: "A", specimen: "1" },
    });
    expect(r).toEqual({ kind: "sent", serverId: "inbox-9" });
    const last = seen.at(-1)!;
    expect(last.url).toBe("/api/pipelines/inbox");
    for (const s of [
      'name="connector_id"\r\n\r\nc-1',
      'name="source_key"\r\n\r\nzwick',
      'name="client_sha256"\r\n\r\nabc',
      'name="hints"\r\n\r\n{"material_code":"A","specimen":"1"}',
      'filename="A_1.tra"',
      "curve-data",
    ])
      expect(last.body).toContain(s);
  });

  it("deliver: 409 MNX-PIPE-0004 는 sent(existing_id), 4xx 는 rejected, 5xx 는 retry, 401 은 halt", async () => {
    const f = tempFile("B.tra", "x");
    const item = { sourceKey: "z", path: f, sha256: "h", mtimeMs: 0, hints: {} };
    const c = client();

    scenario = () => ({
      status: 409,
      json: { error: { code: "MNX-PIPE-0004", message: "이미 있음", details: { existing_id: "run-3" } } },
    });
    expect(await c.deliver(item)).toEqual({ kind: "sent", serverId: "run-3" });

    scenario = () => ({ status: 413, json: { error: { code: "MNX-FILES-0001", message: "너무 큼" } } });
    expect(await c.deliver(item)).toMatchObject({ kind: "rejected", error: "MNX-FILES-0001: 너무 큼" });

    scenario = () => ({ status: 503 });
    expect(await c.deliver(item)).toMatchObject({ kind: "retry" });

    scenario = () => ({ status: 401, json: { error: { code: "MNX-AUTH-0001", message: "x" } } });
    expect(await c.deliver(item)).toMatchObject({ kind: "halt" });
  });

  it("서버가 없으면 retry", async () => {
    const dead = new MatNexusClient({
      baseUrl: "http://127.0.0.1:1",
      secrets: memorySecrets("t"),
      connectorId: "c",
      timeoutMs: 2000,
    });
    const f = tempFile("C.tra", "x");
    const r = await dead.deliver({ sourceKey: "z", path: f, sha256: "h", mtimeMs: 0, hints: {} });
    expect(r.kind).toBe("retry");
  });

  it("classify: 429 는 retry, AbortError 는 시간 초과", () => {
    expect(classify(new ApiError(429, null)).kind).toBe("retry");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classify(abort)).toEqual({ kind: "retry", error: "시간 초과" });
  });
});
