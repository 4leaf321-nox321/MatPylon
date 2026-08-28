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
  filenameRule: null,
  defaults: { material_code: null, lot: null },
  moveAfterSendTo: null,
  enabled: true,
};

function show(source: Partial<Source>, api: Parameters<typeof installApi>[0] = {}) {
  installApi({ listFilenames: vi.fn(async () => ["MD_01.tra", "MD_02.tra", "readme.txt"]), ...api });
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
    show({ filenameRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$` });
    expect(await screen.findByText("specimen=MD_01")).toBeTruthy();
    expect(screen.getByText("specimen=MD_02")).toBeTruthy();
    // 규칙에 안 맞는 파일도 막지 않는다 — 힌트 없이 간다는 것을 화면이 말한다
    expect(screen.getByText("— 규칙에 안 맞음")).toBeTruthy();
  });

  it("소스 기본값이 빈 힌트를 채우고, 파일명이 뽑은 값이 이긴다", async () => {
    show({
      filenameRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$`,
      defaults: { material_code: "SECC_MDOI_1.0", lot: "L240612" },
    });
    expect(
      await screen.findByText(/material_code=SECC_MDOI_1\.0\s+lot=L240612\s+specimen=MD_01/),
    ).toBeTruthy();
  });

  it("정규식이 깨졌거나 모르는 그룹 이름이면 경고한다", async () => {
    show({ filenameRule: "(?<material>.+)" });
    expect(await screen.findByText(/힌트가 아닌 그룹 이름: material/)).toBeTruthy();

    cleanup();
    show({ filenameRule: "(" });
    expect(await screen.findByText(/정규식 오류/)).toBeTruthy();
  });

  it("MatNexus 대조 결과를 파일 옆에 붙인다", async () => {
    show(
      { filenameRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$` },
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
    show({ filenameRule: String.raw`^(?<specimen>[A-Z]{2}_\d+)\.tra$` }); // resolveHints → null
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
});
