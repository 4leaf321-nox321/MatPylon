/** 실서버 한 바퀴 — 개발계획 §8 P5.
 *
 *   npx vite-node --config vitest.config.ts scripts/e2e-live.ts <서버URL> <PAT파일> <workspace_id> <보낼파일>
 *
 * 실제 엔진(스캔·안정화·해시·원장·전송·heartbeat)을 그대로 쓴다 — 화면만 없다.
 * 끝나면 서버 수집함의 상태를 워커가 처리할 때까지 기다려 보여 준다. */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { SourceSchema, defaultConfig } from "@engine/config";
import { Engine } from "@engine/index";
import { memorySecrets } from "@engine/secrets";

const [url, patFile, workspaceId, sample] = process.argv.slice(2);
if (!url || !patFile || !workspaceId || !sample) {
  console.error("인자: <서버URL> <PAT파일> <workspace_id> <보낼파일>");
  process.exit(2);
}

const dataDir = mkdtempSync(path.join(tmpdir(), "matpylon-e2e-data-"));
const srcDir = mkdtempSync(path.join(tmpdir(), "matpylon-e2e-src-"));
const secrets = memorySecrets(readFileSync(patFile, "utf8").trim());
let now = Date.now();
const log = (m: string) => console.log("  engine:", m);

const engine = new Engine({ appVersion: "e2e", dataDir, secrets, now: () => now, log });

// 1. 연결 확인 → 커넥터 등록
const me = await engine.client(url, null).me();
console.log("1. 연결됨:", me.display_name ?? me.email ?? me.id);
const connector = await engine.client(url, null).registerConnector(`e2e-${hostname()}`, hostname(), workspaceId);
console.log("2. 커넥터:", connector.id, connector.name);

// 2. 설정 — 소스 폴더에 샘플을 두고 파일명 규칙을 건다
const config = defaultConfig();
config.server = { url, connectorId: connector.id, connectorName: connector.name, tls: { insecure: false, caFile: null } };
config.sources.push(
  SourceSchema.parse({
    key: "e2e",
    name: "e2e",
    path: srcDir,
    stableMinutes: 1,
    filenameRule: String.raw`^(?<material_code>[^_]+)_(?<lot>[^_]+)_(?<specimen>[^.]+)\.[^.]+$`,
  }),
);
engine.setConfig(config);
// 개발 DB 에 같은 내용이 이미 있으면 409 로 닫혀 워커 경로를 못 본다. 끝에 줄바꿈을
// 붙여 해시만 바꾼다 — 리더는 빈 줄을 무시한다.
const target = path.join(srcDir, `SECC_LOT-A_MD1${path.extname(sample)}`);
writeFileSync(target, Buffer.concat([readFileSync(sample), Buffer.from(`\n`.repeat(1 + (Date.now() % 7)))]));

// 3. 스캔 → 안정화 → 전송
await engine.scan();
now += 2 * 60_000;
await engine.sendNow();
const rows = engine.files();
for (const r of rows) console.log(`3. 원장: ${r.status} ${path.basename(r.path)} server_id=${r.server_id} err=${r.last_error ?? ""}`);
const sent = rows.find((r) => r.status === "sent");

// 4. 같은 파일을 한 번 더 — 409 가 sent 로 닫히는지
copyFileSync(target, path.join(srcDir, `SECC_LOT-A_MD1-copy${path.extname(sample)}`));
await engine.scan();
now += 2 * 60_000;
await engine.sendNow();
for (const r of engine.files()) if (r.path.includes("copy")) console.log(`4. 사본: ${r.status} (${r.last_error ?? "중복 판정"})`);

// 5. 워커가 처리할 때까지 서버 상태를 본다
if (sent?.server_id) {
  const client = engine.client();
  const fetchItem = async () =>
    (await (client as unknown as { request: (m: string, p: string) => Promise<Record<string, unknown>> }).request(
      "GET",
      `/pipelines/inbox/${sent.server_id}`,
    ));
  let item = await fetchItem();
  for (let i = 0; i < 30 && (item.status === "received" || item.status === "parsed"); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    item = await fetchItem();
  }
  console.log("5. 서버 수집함:", JSON.stringify({
    status: item.status,
    test_type_key: item.test_type_key,
    profile_key: item.profile_key,
    test_run_id: item.test_run_id,
    candidate_count: item.candidate_count,
    hints: item.hints,
    error: item.error,
  }, null, 2));
  if (item.status === "needs_specimen" || item.status === "failed" || item.status === "registered")
    console.log("   → 수집함 화면에서 확인:", `${url.replace(/\/+$/, "")}/settings/connectors`);
}

engine.close();
