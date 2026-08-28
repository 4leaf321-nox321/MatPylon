import { describe, expect, it } from "vitest";
import { checkRule, extractHints } from "@engine/hints";

const RULE = String.raw`^(?<material_code>[A-Z0-9.-]+)_(?<lot>[^_]+)_(?<specimen>[A-Z]{2}-?\d+)\.tra$`;

describe("hints", () => {
  it("이름 있는 그룹만 힌트가 된다", () => {
    expect(extractHints(RULE, "SECC-1.0_LOT-A_MD1.tra")).toEqual({
      material_code: "SECC-1.0",
      lot: "LOT-A",
      specimen: "MD1",
    });
  });

  it("안 맞는 파일은 막지 않는다 — 빈 힌트", () => {
    expect(extractHints(RULE, "readme.txt")).toEqual({});
    expect(extractHints(null, "x.tra")).toEqual({});
  });

  it("힌트 키 밖의 그룹 이름은 경고한다", () => {
    expect(checkRule("(?<material>.+)")).toEqual({ ok: true, unknownGroups: ["material"] });
    expect(checkRule("(?<lot>.+)").unknownGroups).toEqual([]);
    expect(checkRule("(").ok).toBe(false);
  });
});
