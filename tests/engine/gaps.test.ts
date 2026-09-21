/** 되짚어 보다 찾은 결함의 회귀 테스트 — 각각 실제로 틀렸던 것이다. */
import { chmodSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceSchema, defaultConfig } from "@engine/config";
import { Engine } from "@engine/index";
import { Ledger } from "@engine/ledger";
import { ApiError, HASH_MISMATCH, MatNexusClient, classify, classifyOpen } from "@engine/matnexus";
import { memorySecrets } from "@engine/secrets";
import { scanSource } from "@engine/scanner";
import type { DeliveryResult, Transport } from "@engine/transport";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
const T0 = 1_700_000_000_000;
const MIN = 60_000;
const DAY = 86_400_000;

function tmp(prefix: string) {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function write(file: string, body: string, mtime = T0) {
  writeFileSync(file, body);
  utimesSync(file, mtime / 1000, mtime / 1000);
}

describe("사라짐 판정은 200건 상한에 걸리지 않는다", () => {
  it("파일 250개 중 하나를 지우면 정확히 그것만 gone", async () => {
    const dir = tmp("matpylon-many-");
    const source = SourceSchema.parse({ key: "many", name: "m", path: dir });
    const ledger = new Ledger(":memory:");
    for (let i = 0; i < 250; i++) write(path.join(dir, `f${i}.tra`), `${i}`);
    await scanSource(source, ledger, T0);
    rmSync(path.join(dir, "f249.tra"));
    const r = await scanSource(source, ledger, T0 + MIN);
    expect(r.gone).toBe(1);
    expect(ledger.get("many", path.join(dir, "f249.tra"))?.status).toBe("gone");
  });
});

describe("읽기 전용 파일도 보낸다", () => {
  it("r+ 가 안 되면 r 로 열어 ready", async () => {
    const dir = tmp("matpylon-ro-");
    const f = path.join(dir, "ro.tra");
    write(f, "x");
    chmodSync(f, 0o444);
    const source = SourceSchema.parse({ key: "ro", name: "r", path: dir });
    const ledger = new Ledger(":memory:");
    await scanSource(source, ledger, T0);
    const r = await scanSource(source, ledger, T0 + 3 * MIN);
    chmodSync(f, 0o666); // 정리가 지울 수 있게
    expect(r.ready).toBe(1);
  });
});

describe("원장 정리", () => {
  it("보존 기간 지난 sent 만 지우고 failed 는 남긴다", () => {
    const l = new Ledger(":memory:");
    const a = l.observe("s", "a", 1, T0, T0);
    l.markReady(a.id, "h1");
    l.markSent(a.id, null, T0);
    const b = l.observe("s", "b", 1, T0, T0);
    l.markReady(b.id, "h2");
    l.claim(b.id);
    l.markFailed(b.id, "x");
    const c = l.observe("s", "c", 1, T0 + 80 * DAY, T0 + 80 * DAY);
    l.markReady(c.id, "h3");
    l.markSent(c.id, null, T0 + 80 * DAY);
    expect(l.prune(T0 + 10 * DAY)).toBe(1);
    expect(l.list().map((r) => r.path).sort()).toEqual(["b", "c"]);
  });

  it("sourceStats 는 SQL 로 센다", () => {
    const l = new Ledger(":memory:");
    const a = l.observe("s", "a", 1, T0, T0);
    l.markReady(a.id, "h1");
    const b = l.observe("s", "b", 1, T0, T0);
    l.markReady(b.id, "h2");
    l.markSent(b.id, null, T0 + 5);
    expect(l.sourceStats("s")).toEqual({ pending: 1, failed: 0, lastSentAt: T0 + 5 });
    expect(l.sourceStats("none")).toEqual({ pending: 0, failed: 0, lastSentAt: null });
  });
});

describe("해시 불일치와 서버 한도", () => {
  const mismatch = (): DeliveryResult =>
    classify(new ApiError(400, { code: HASH_MISMATCH, message: "해시가 다릅니다" }));

  it("MNX-PIPE-0003 은 rejected 가 아니라 retry", () => {
    expect(mismatch().kind).toBe("retry");
  });

  it("두 번째 불일치는 failed", async () => {
    const dataDir = tmp("matpylon-d-");
    const srcDir = tmp("matpylon-s-");
    let now = T0;
    const transport: Transport = { configured: () => true, deliver: async () => mismatch() };
    const engine = new Engine({ appVersion: "t", dataDir, transport, now: () => now });
    const config = defaultConfig();
    config.sources.push(SourceSchema.parse({ key: "zwick", name: "z", path: srcDir }));
    engine.setConfig(config);
    write(path.join(srcDir, "a.tra"), "a");
    await engine.scan();
    now += 3 * MIN;
    await engine.sendNow();
    expect(engine.files("retry")).toHaveLength(1);
    now += 2 * MIN; // 백오프 1분 지남
    await engine.sendNow();
    expect(engine.files("failed")).toHaveLength(1);
    expect(engine.files("failed")[0]?.last_error).toMatch(/재전송해도 같음/);
    engine.close();
  });
});


describe("폴더를 못 읽을 때 — 큐를 지우지 않는다", () => {
  it("드라이브가 끊기면 사라짐으로 찍지 않고 오류를 낸다", async () => {
    const dir = tmp("matpylon-drop-");
    const file = path.join(dir, "a.tra");
    const source = SourceSchema.parse({ key: "drop", name: "d", path: dir });
    const ledger = new Ledger(":memory:");
    write(file, "x");
    await scanSource(source, ledger, T0);
    expect((await scanSource(source, ledger, T0 + 3 * MIN)).ready).toBe(1);

    // 드라이브가 사라졌다 — 폴더 자체를 못 읽는다
    rmSync(dir, { recursive: true, force: true });
    const r = await scanSource(source, ledger, T0 + 4 * MIN);
    expect(r.unreadable).toBe(true);
    expect(r.gone).toBe(0);
    expect(r.errors[0]).toMatch(/폴더를 읽지 못했습니다/);
    // 큐는 그대로다. 여기서 gone 이 되면 드라이브가 돌아와도 영영 안 간다.
    expect(ledger.get("drop", file)?.status).toBe("ready");
  });

  it("사라짐으로 찍힌 파일이 그대로 다시 보이면 되살린다", async () => {
    const dir = tmp("matpylon-back-");
    const file = path.join(dir, "a.tra");
    const source = SourceSchema.parse({ key: "back", name: "b", path: dir });
    const ledger = new Ledger(":memory:");
    write(file, "x");
    await scanSource(source, ledger, T0);
    await scanSource(source, ledger, T0 + 3 * MIN);

    unlinkSync(file); // 사람이 지웠다고 본 상태
    expect((await scanSource(source, ledger, T0 + 4 * MIN)).gone).toBe(1);
    expect(ledger.get("back", file)?.status).toBe("gone");

    write(file, "x"); // 같은 내용이 같은 자리에 다시 있다
    const r = await scanSource(source, ledger, T0 + 5 * MIN);
    expect(ledger.get("back", file)?.status).toBe("ready");
    expect(r.ready).toBe(1);
  });
});

describe("원장 정리는 하루에 한 번 다시 돈다", () => {
  it("앱을 안 껐어도 보존 기간이 지난 행을 지운다", async () => {
    const dataDir = tmp("matpylon-prune-");
    const srcDir = tmp("matpylon-prune-src-");
    let now = T0;
    const engine = new Engine({
      appVersion: "t",
      dataDir,
      transport: { configured: () => true, deliver: async () => ({ kind: "sent", serverId: "x" }) },
      now: () => now,
    });
    const config = defaultConfig();
    config.sources.push(SourceSchema.parse({ key: "keep", name: "k", path: srcDir }));
    engine.setConfig(config);

    const file = path.join(srcDir, "old.tra");
    write(file, "old");
    await engine.scan();
    now += 3 * MIN;
    await engine.sendNow();
    expect(engine.files("sent")).toHaveLength(1);

    unlinkSync(file); // 보낸 뒤 사람이 치웠다
    now += 91 * DAY; // 앱은 계속 떠 있다 — 재시작 없이 91일
    await engine.scan();
    expect(engine.files()).toHaveLength(0);
    engine.close();
  });
});

// --- 2026-09-21 점검에서 실측으로 확인한 것들 ------------------------------------

describe("보내기 직전에 파일이 사라지거나 잠긴 경우", () => {
  it("transport 가 던져도 배치가 안 멈추고, 그 행이 sending 에 안 갇힌다", async () => {
    const dataDir = tmp("matpylon-boom-");
    const srcDir = tmp("matpylon-boom-src-");
    let now = T0;
    const seen: string[] = [];
    // 첫 건에서만 던진다 — 한 건의 사고가 뒤의 파일을 막으면 안 된다
    const transport: Transport = {
      configured: () => true,
      deliver: async (item) => {
        seen.push(path.basename(item.path));
        if (path.basename(item.path) === "a.tra") throw new TypeError("Unable to open file as blob");
        return { kind: "sent", serverId: "x" };
      },
    };
    const engine = new Engine({ appVersion: "t", dataDir, transport, now: () => now });
    const config = defaultConfig();
    config.sources.push(SourceSchema.parse({ key: "zwick", name: "z", path: srcDir }));
    engine.setConfig(config);
    write(path.join(srcDir, "a.tra"), "a");
    write(path.join(srcDir, "b.tra"), "b");
    await engine.scan();
    now += 3 * MIN;
    await engine.scan(); // 안정화 → ready
    await engine.send(); // 던지지 않아야 한다

    expect(seen).toEqual(["a.tra", "b.tra"]); // 뒤의 것도 시도했다
    expect(engine.files("sending")).toHaveLength(0);
    expect(engine.files("retry")).toHaveLength(1); // 던진 것은 나중에 다시
    expect(engine.files("sent")).toHaveLength(1);
    engine.close();
  });

  it("없어진 파일은 rejected(=failed), 잠긴 파일은 retry 로 접는다", async () => {
    const dir = tmp("matpylon-open-");
    const client = new MatNexusClient({
      baseUrl: "http://127.0.0.1:9",
      secrets: memorySecrets(),
      connectorId: "c1",
    });
    const gone = await client.deliver({
      sourceKey: "k",
      path: path.join(dir, "없는파일.tra"),
      sha256: "s",
      mtimeMs: T0,
      hints: {},
    });
    expect(gone.kind).toBe("rejected"); // 던지지 않는다

    // openAsBlob 은 errno 를 안 준다(없어진 것도 잠긴 것도 ERR_INVALID_ARG_VALUE) —
    // 파일이 아직 있는지로 가른다
    const here = path.join(dir, "있는파일.tra");
    write(here, "x");
    expect(classifyOpen(new TypeError("Unable to open file as blob"), here).kind).toBe("retry");
    expect(classifyOpen(new TypeError("Unable to open file as blob"), path.join(dir, "없다.tra")).kind).toBe(
      "rejected",
    );
  });
});

describe("「활성」을 끈 소스", () => {
  it("이미 대기 중이던 것도 보내지 않는다", async () => {
    const dataDir = tmp("matpylon-off-");
    const srcDir = tmp("matpylon-off-src-");
    let now = T0;
    const seen: string[] = [];
    const transport: Transport = {
      configured: () => true,
      deliver: async (item) => {
        seen.push(path.basename(item.path));
        return { kind: "sent", serverId: "x" };
      },
    };
    const engine = new Engine({ appVersion: "t", dataDir, transport, now: () => now });
    const config = defaultConfig();
    config.sources.push(SourceSchema.parse({ key: "zwick", name: "z", path: srcDir }));
    engine.setConfig(config);
    write(path.join(srcDir, "a.tra"), "a");
    await engine.scan();
    now += 3 * MIN;
    await engine.scan(); // ready 까지 간 뒤에 끈다
    expect(engine.files("ready")).toHaveLength(1);

    const c = engine.getConfig();
    engine.setConfig({ ...c, sources: c.sources.map((s) => ({ ...s, enabled: false })) });
    await engine.send();
    expect(seen).toEqual([]);
    expect(engine.files("ready")).toHaveLength(1); // 큐에 그대로 남는다

    // 다시 켜면 그대로 나간다
    engine.setConfig(engine.getConfig().sources.length ? { ...c, sources: c.sources.map((s) => ({ ...s, enabled: true })) } : c);
    await engine.send();
    expect(seen).toEqual(["a.tra"]);
    engine.close();
  });
});

describe("장비 PC·NAS 시계가 앞선 파일", () => {
  it("미래 mtime 을 기다리지 않는다 — 처음 본 시각으로 잰다", async () => {
    const dir = tmp("matpylon-skew-");
    const f = path.join(dir, "future.tra");
    write(f, "x", T0 + 2 * 3600_000); // 두 시간 앞선 파일
    const source = SourceSchema.parse({ key: "skew", name: "s", path: dir, stableMinutes: 1 });
    const ledger = new Ledger(":memory:");
    await scanSource(source, ledger, T0);
    const r = await scanSource(source, ledger, T0 + 2 * MIN);
    expect(r.ready).toBe(1);
    expect(ledger.get("skew", f)?.status).toBe("ready");
  });
});

describe("오류는 스캔과 전송을 갈라 센다", () => {
  it("heartbeat 가 성공해도 「폴더를 읽지 못했습니다」는 안 지워진다", async () => {
    const dataDir = tmp("matpylon-err-");
    const now = T0;
    const engine = new Engine({
      appVersion: "t",
      dataDir,
      transport: { configured: () => true, deliver: async () => ({ kind: "sent", serverId: "x" }) },
      now: () => now,
    });
    const config = defaultConfig();
    config.sources.push(SourceSchema.parse({ key: "nas", name: "nas", path: path.join(tmpdir(), "없는폴더-" + T0) }));
    engine.setConfig(config);
    await engine.scan();
    expect(engine.status().lastError).toContain("폴더를 읽지 못했습니다");
    await engine.send(); // 전송 쪽은 멀쩡하다
    expect(engine.status().lastError).toContain("폴더를 읽지 못했습니다");
    engine.close();
  });
});
