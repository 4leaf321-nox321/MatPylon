import { describe, expect, it } from "vitest";
import { checkRule, extractHints, ruleKind, toRelativePath } from "@engine/hints";

const RULE = String.raw`^(?<material_code>[A-Z0-9.-]+)_(?<lot>[^_]+)_(?<specimen>[A-Z]{2}-?\d+)\.tra$`;

describe("정규식 규칙", () => {
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
    expect(checkRule("(?<material>.+)")).toMatchObject({ ok: true, kind: "regex", keys: [], unknownGroups: ["material"] });
    expect(checkRule("(?<lot>.+)")).toMatchObject({ keys: ["lot"], unknownGroups: [] });
    expect(checkRule("(?<lot>(").ok).toBe(false);
    // 이름 있는 그룹이 없으면 템플릿 — 괄호는 글자 그대로라 오류가 아니다
    expect(checkRule("(")).toMatchObject({ ok: true, kind: "template", keys: [] });
  });

  it("상대경로에 댄다 — 폴더 이름도 그룹으로 잡을 수 있다", () => {
    expect(extractHints(String.raw`^(?<material_code>[^/]+)/.*_(?<specimen>\d+)\.tra$`, "SUS304/LotA/t_01.tra")).toEqual({
      material_code: "SUS304",
      specimen: "01",
    });
  });
});

describe("템플릿 규칙 — 현장에서 정규식 없이 적는 문법", () => {
  it("이름 있는 그룹이 없으면 템플릿이다", () => {
    expect(ruleKind("{material_code}/{lot}/{specimen}.tra")).toBe("template");
    expect(ruleKind("(?<lot>.+)")).toBe("regex");
  });

  it("폴더 계층 + 파일명 조합에서 뽑는다", () => {
    expect(extractHints("{material_code}/{lot}/*_{specimen}.tra", "SUS304/LotA/tensile_01.tra")).toEqual({
      material_code: "SUS304",
      lot: "LotA",
      specimen: "01",
    });
  });

  it("`*` 는 폴더 한 단계 안, `**` 는 여러 단계", () => {
    // 한 단계만 건너뛰는 자리에 두 단계가 오면 안 맞는다
    expect(extractHints("{material_code}/*/{specimen}.tra", "SUS304/2026/09/01.tra")).toEqual({});
    expect(extractHints("{material_code}/**/{specimen}.tra", "SUS304/2026/09/01.tra")).toEqual({
      material_code: "SUS304",
      specimen: "01",
    });
    expect(extractHints("{material_code}/**/{specimen}.tra", "SUS304/01.tra")).toEqual({
      material_code: "SUS304",
      specimen: "01",
    });
  });

  it("`/` 가 없으면 깊이와 상관없이 파일명에만 댄다", () => {
    expect(extractHints("{specimen}.tra", "SUS304/LotA/MD_01.tra")).toEqual({ specimen: "MD_01" });
    expect(extractHints("{specimen}.tra", "MD_01.tra")).toEqual({ specimen: "MD_01" });
  });

  it("글자 그대로 부분은 정규식 특수문자여도 그대로다, 대소문자는 안 가린다", () => {
    expect(extractHints("{lot}.{specimen}.tra", "L-1.MD01.TRA")).toEqual({ lot: "L-1", specimen: "MD01" });
    expect(extractHints("{lot}(x).tra", "A(x).tra")).toEqual({ lot: "A" });
    expect(extractHints("{lot}.tra", "A.txt")).toEqual({});
  });

  it("`{키:정규식}` 으로 자리 하나의 모양을 좁힌다 — 구분자 없는 이름", () => {
    expect(extractHints("{lot}{specimen:\\d{2}}.tra", "LOTA01.tra")).toEqual({ lot: "LOTA", specimen: "01" });
  });

  it("Windows 식 `\\` 로 적어도 `/` 로 받아 준다 — 사람은 탐색기 경로를 붙여 넣는다", () => {
    expect(extractHints("{material_code}\\{specimen}.tra", "SUS304/01.tra")).toEqual({
      material_code: "SUS304",
      specimen: "01",
    });
  });

  it("검사: 뽑는 키·모르는 이름·힌트 자리 없음", () => {
    expect(checkRule("{material_code}/{lot}/*_{specimen}.tra")).toMatchObject({
      ok: true,
      kind: "template",
      keys: ["material_code", "lot", "specimen"],
      unknownGroups: [],
    });
    expect(checkRule("{material}/{specimen}.tra").unknownGroups).toEqual(["material"]);
    expect(checkRule("SUS304/01.tra")).toMatchObject({ ok: true, keys: [] });
    expect(checkRule("{specimen:[}.tra").ok).toBe(false);
  });
});

describe("상대경로", () => {
  it("소스 폴더 기준, 구분자는 `/`, 드라이브 문자 대소문자 무시", () => {
    expect(toRelativePath("C:\\data\\zwick", "C:\\data\\zwick\\SUS304\\LotA\\01.tra")).toBe("SUS304/LotA/01.tra");
    expect(toRelativePath("c:\\data\\zwick\\", "C:\\data\\zwick\\01.tra")).toBe("01.tra");
    expect(toRelativePath("\\\\nas\\lab", "\\\\nas\\lab\\a\\b.tra")).toBe("a/b.tra");
  });
  it("루트 밖이면 파일명만", () => {
    expect(toRelativePath("C:\\data\\zwick", "D:\\x\\01.tra")).toBe("01.tra");
  });
});

describe("소스 기본값과 경로 힌트", () => {
  it("기본값이 빈 칸을 채우고, 경로가 뽑은 값이 이긴다", async () => {
    const { mergeHints } = await import("@engine/hints");
    expect(mergeHints({ material_code: "SECC_MDOI_1.0", lot: "L240612" }, { specimen: "MD_01" })).toEqual({
      material_code: "SECC_MDOI_1.0",
      lot: "L240612",
      specimen: "MD_01",
    });
    expect(mergeHints({ material_code: "X", lot: null }, { material_code: "Y" })).toEqual({ material_code: "Y" });
    expect(mergeHints({}, {})).toEqual({});
  });
});
