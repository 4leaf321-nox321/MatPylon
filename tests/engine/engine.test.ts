/** 엔진 한 바퀴 — 스캔 → 원장 → 전송 결과 셋이 상태로 간다. 타이머 없이 직접 부른다. */
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Engine } from "@engine/index";
import { defaultConfig, SourceSchema } from "@engine/config";
import type { Delivery, DeliveryResult, Transport } from "@engine/transport";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
const T0 = 1_700_000_000_000;
const MIN = 60_000;

function fakeTransport(script: Record<string, DeliveryResult>): Transport & { seen: Delivery[] } {
  const seen: Delivery[] = [];
  return {
    seen,
    configured: () => true,
    deliver: async (item) => {
      seen.push(item);
      return script[path.basename(item.path)] ?? { kind: "sent", serverId: "x" };
    },
  };
}

function build(transport: Transport, move: string | null = null) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "matpylon-data-"));
  const srcDir = mkdtempSync(path.join(tmpdir(), "matpylon-src-"));
  dirs.push(dataDir, srcDir);
  let now = T0;
  const engine = new Engine({ appVersion: "t", dataDir, transport, now: () => now });
  const config = defaultConfig();
  config.sources.push(
    SourceSchema.parse({
      key: "zwick",
      name: "zwick",
      path: srcDir,
      filenameRule: String.raw`^(?<material_code>[^_]+)_(?<specimen>[^.]+)\.tra$`,
      moveAfterSendTo: move,
    }),
  );
  engine.setConfig(config);
  const write = (name: string, body: string) => {
    const f = path.join(srcDir, name);
    writeFileSync(f, body);
    utimesSync(f, T0 / 1000, T0 / 1000);
    return f;
  };
  return { engine, srcDir, write, tick: (ms: number) => (now += ms) };
}

describe("engine", () => {
  it("힌트를 붙여 보내고, 4xx 는 failed, 5xx 는 retry", async () => {
    const transport = fakeTransport({
      "B_2.tra": { kind: "rejected", error: "413" },
      "C_3.tra": { kind: "retry", error: "ECONNREFUSED" },
    });
    const { engine, write, tick } = build(transport);
    write("A_1.tra", "a");
    write("B_2.tra", "b");
    write("C_3.tra", "c");
    await engine.scan(); // 처음 봄 — 안정화는 여기서부터 센다
    tick(3 * MIN);
    await engine.sendNow();

    expect(transport.seen.map((d) => d.hints)).toEqual([
      { material_code: "A", specimen: "1" },
      { material_code: "B", specimen: "2" },
      { material_code: "C", specimen: "3" },
    ]);
    expect(engine.status().counts).toEqual({ ready: 1, sent: 1, failed: 1 });
    expect(engine.files("retry")).toHaveLength(1);
    engine.close();
  });

  it("halt 는 배치를 멈추고 나머지는 대기로 남긴다", async () => {
    const transport = fakeTransport({ "A_1.tra": { kind: "halt", error: "401" } });
    const { engine, write, tick } = build(transport);
    write("A_1.tra", "a");
    write("B_2.tra", "b");
    await engine.scan();
    tick(3 * MIN);
    await engine.sendNow();
    expect(transport.seen).toHaveLength(1);
    expect(engine.status().counts.ready).toBe(2);
    expect(engine.status().lastError).toBe("401");
    engine.close();
  });

  it("옮기기 옵션은 sent 뒤에만, 안 켜면 제자리", async () => {
    const moved = build(fakeTransport({}), "sent");
    const f = moved.write("A_1.tra", "a");
    await moved.engine.scan();
    moved.tick(3 * MIN);
    await moved.engine.sendNow();
    expect(existsSync(f)).toBe(false);
    expect(existsSync(path.join(moved.srcDir, "sent", "A_1.tra"))).toBe(true);
    moved.engine.close();

    const kept = build(fakeTransport({ "A_1.tra": { kind: "rejected", error: "x" } }), "sent");
    const g = kept.write("A_1.tra", "a");
    await kept.engine.scan();
    kept.tick(3 * MIN);
    await kept.engine.sendNow();
    expect(existsSync(g)).toBe(true);
    kept.engine.close();
  });
});
