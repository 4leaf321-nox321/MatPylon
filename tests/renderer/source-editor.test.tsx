/** 소스 편집기 — **자동 등록률을 정하는 화면이다.**
 *
 * 파일명 규칙·소스 기본값이 어떤 힌트가 되는지, 그 힌트가 서버에서 붙는지를 사람이 여기서
 * 본다. 미리보기가 조용히 틀리면 규칙이 틀린 채로 파일럿에 나간다. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@engine/config";
import { SourceEditor } from "../../src/renderer/pages/SourcesPage";
import { installApi } from "./harness";

afterEach(cleanup);

const SOURCE: Source = {
  key: "zwick",
  name: "인장기",
  path: "C:\\data",
  extensions: [".tra"],
  recursive: false,
  stableMinutes: 2,
  pathRule: null,
  defaults: { material_code: null, lot: null },
  moveAfterSendTo: null,
  enabled: true,
};

function show(source: Partial<Source>, api: Parameters<typeof installApi>[0] = {}) {
  installApi({ previewPaths: vi.fn(async () => ["MD_01.tra", "MD_02.tra", "readme.txt"]), ...api });
  const onSave = vi.fn();
  render(
    <SourceEditor
      source={{ ...SOURCE, ...source }}
      isNew={false}
      existingKeys={[]}
      error={null}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  return { onSave };
}

describe("소스 편집기", () => {
  it("파일명 규칙이 뽑은 힌트를 파일마다 보여 준다", async () => {
    show({ pathRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$` });
    expect(await screen.findByText("specimen=MD_01")).toBeTruthy();
    expect(screen.getByText("specimen=MD_02")).toBeTruthy();
    // 규칙에 안 맞는 파일도 막지 않는다 — 힌트 없이 간다는 것을 화면이 말한다
    expect(screen.getByText("— 규칙에 안 맞음")).toBeTruthy();
  });

  it("소스 기본값이 빈 힌트를 채우고, 파일명이 뽑은 값이 이긴다", async () => {
    show({
      pathRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$`,
      defaults: { material_code: "SECC_MDOI_1.0", lot: "L240612" },
    });
    expect(
      await screen.findByText(/material_code=SECC_MDOI_1\.0\s+lot=L240612\s+specimen=MD_01/),
    ).toBeTruthy();
  });

  it("규칙이 깨졌거나 모르는 자리 이름이면 경고한다", async () => {
    show({ pathRule: "{material}/{specimen}.tra" });
    expect(await screen.findByText(/힌트가 아닌 자리 이름: material/)).toBeTruthy();

    cleanup();
    show({ pathRule: "(?<lot>(" });
    expect(await screen.findByText(/규칙 오류/)).toBeTruthy();

    cleanup();
    show({ pathRule: "SUS304/01.tra" });
    expect(await screen.findByText(/규칙에 힌트 자리가 없습니다/)).toBeTruthy();
  });

  it("템플릿 규칙 — 폴더 계층에서 뽑고, 미리보기는 스캔과 같은 눈으로 본다", async () => {
    const previewPaths = vi.fn(async () => ["SUS304/LotA/tensile_01.tra", "AL6061/LotB/tensile_02.tra"]);
    show({ pathRule: "{material_code}/{lot}/*_{specimen}.tra", recursive: true, extensions: [".tra"] }, { previewPaths });
    expect(await screen.findByText(/material_code=SUS304\s+lot=LotA\s+specimen=01/)).toBeTruthy();
    expect(screen.getByText(/material_code=AL6061\s+lot=LotB\s+specimen=02/)).toBeTruthy();
    expect(screen.getByText("템플릿으로 해석", { exact: false })).toBeTruthy();
    // 하위 폴더·확장자·건너뛰는 폴더까지 넘겨야 스캔이 볼 것과 같은 것을 본다
    expect(previewPaths).toHaveBeenCalledWith(
      { path: "C:\\data", recursive: true, extensions: [".tra"], moveAfterSendTo: null },
      20,
    );
  });

  it("경로를 누르면 규칙 칸에 올라가고, 힌트 단추가 고른 자리에 끼워진다", async () => {
    show({ recursive: true }, { previewPaths: vi.fn(async () => ["SUS304/LotA/tensile_01.tra"]) });
    fireEvent.click(await screen.findByRole("button", { name: "SUS304/LotA/tensile_01.tra" }));
    const input = screen.getByPlaceholderText("예: {material_code}/{lot}/*_{specimen}.tra") as HTMLInputElement;
    expect(input.value).toBe("SUS304/LotA/tensile_01.tra");
    // 「SUS304」 를 고르고 「재료」 를 누른다
    input.setSelectionRange(0, 6);
    fireEvent.click(screen.getByRole("button", { name: "재료" }));
    expect(input.value).toBe("{material_code}/LotA/tensile_01.tra");
    expect(await screen.findByText("material_code=SUS304")).toBeTruthy();
  });

  it("MatNexus 대조 결과를 파일 옆에 붙인다", async () => {
    show(
      { pathRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$` },
      {
        resolveHints: vi.fn(async () => [
          { outcome: "unique" as const, label: "승인 대기(후보 1)", detail: "SECC__01__MD_01" },
          { outcome: "none" as const, label: "수집함행", detail: "재료 코드 힌트가 없습니다." },
          { outcome: "none" as const, label: "수집함행", detail: "재료 코드 힌트가 없습니다." },
        ]),
      },
    );
    expect(await screen.findByText("승인 대기(후보 1)")).toBeTruthy();
    expect(screen.getByText("SECC__01__MD_01")).toBeTruthy();
    expect(await screen.findByText(/자동 등록 1 \/ 3/)).toBeTruthy();
  });

  it("서버가 대조를 못 해 주면(구버전·미연결) 그 열을 아예 안 그린다", async () => {
    show({ pathRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$` }); // resolveHints → null
    await screen.findByText("specimen=MD_01");
    await waitFor(() => expect(window.matpylon.resolveHints).toHaveBeenCalled());
    expect(screen.queryByText("MatNexus 대조")).toBeNull();
  });

  it("저장하면 화면에 적은 것이 그대로 소스가 된다", async () => {
    const { onSave } = show({});
    fireEvent.change(screen.getByPlaceholderText("예: SECC_MDOI_1.0"), {
      target: { value: "SECC_MDOI_1.0" },
    });
    fireEvent.change(screen.getByPlaceholderText("예: L240612"), { target: { value: "L240612" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaults: { material_code: "SECC_MDOI_1.0", lot: "L240612" } }),
    );
  });

  it("재료·로트 밖의 기본값도 칸으로 보이고, 저장해도 안 사라진다 — config.json 에 손으로 넣은 것", async () => {
    const { onSave } = show({
      pathRule: "{specimen}.tra",
      defaults: { material_code: "SECC_MDOI_1.0", temperature: "80C", commission: "12" },
    });
    // 미리보기 힌트에 실린다
    expect(await screen.findByText(/material_code=SECC_MDOI_1\.0\s+specimen=MD_01\s+temperature=80C\s+commission=12/)).toBeTruthy();
    // 칸 라벨(div) — 규칙 카드의 끼워 넣기 단추(button)에도 같은 글자가 있다
    expect(screen.getByText("온도", { selector: "div" })).toBeTruthy();
    expect(screen.getByText("의뢰 번호", { selector: "div" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("예: L240612"), { target: { value: "L1" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: { material_code: "SECC_MDOI_1.0", lot: "L1", temperature: "80C", commission: "12" },
      }),
    );
  });

  it("「+ 다른 기본값」으로 키를 골라 칸을 만들고, 「빼기」로 지운다", async () => {
    const { onSave } = show({});
    fireEvent.change(screen.getByLabelText("다른 기본값 추가"), { target: { value: "temperature" } });
    const field = screen.getByText("온도", { selector: "div" }).parentElement!;
    fireEvent.change(field.querySelector("input")!, { target: { value: "-40" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ defaults: { temperature: "-40" } }));

    fireEvent.click(screen.getByRole("button", { name: "빼기" }));
    expect(screen.queryByText("온도", { selector: "div" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ defaults: {} }));
  });
});
