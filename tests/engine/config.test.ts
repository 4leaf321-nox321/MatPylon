import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, defaultConfig, loadConfig, parseConfig, saveConfig } from "@engine/config";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "matpylon-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("config", () => {
  it("기본값: 1시간 간격, 5분 스캔, 소스 없음", () => {
    const c = defaultConfig();
    expect(c.schedule).toEqual({ kind: "interval", minutes: 60 });
    expect(c.scanMinutes).toBe(5);
    expect(c.sources).toEqual([]);
  });

  it("없는 파일은 기본값, 저장하면 다시 읽힌다", () => {
    const dir = tmp();
    expect(loadConfig(dir)).toEqual(defaultConfig());
    const c = defaultConfig();
    c.sources.push({
      key: "zwick-1",
      name: "Zwick",
      path: "C:\\data",
      extensions: [".tra"],
      recursive: false,
      stableMinutes: 2,
      filenameRule: null,
      moveAfterSendTo: null,
      enabled: true,
    });
    saveConfig(dir, c);
    expect(loadConfig(dir).sources[0]?.key).toBe("zwick-1");
    expect(JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8")).version).toBe(1);
  });

  it("틀린 곳을 경로로 말한다", () => {
    expect(() => parseConfig({ sources: [{ key: "BAD KEY", name: "x", path: "y" }] })).toThrow(
      /sources\.0\.key/,
    );
  });

  it("소스 키가 겹치면 거절한다", () => {
    const s = { key: "a", name: "x", path: "y" };
    expect(() => parseConfig({ sources: [s, s] })).toThrow(ConfigError);
  });
});
