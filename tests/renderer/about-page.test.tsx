/** 정보 화면 — 폐쇄망에서 들고 나올 진단 묶음을 여기서 만든다. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutPage } from "../../src/renderer/pages/AboutPage";
import { installApi } from "./harness";

afterEach(cleanup);

describe("정보 화면", () => {
  it("진단 묶음을 내보내면 저장된 경로를 말해 준다", async () => {
    const api = installApi({
      exportDiagnostics: vi.fn(async () => String.raw`D:\matpylon-진단-ZWICK-PC-2026-09-21.zip`),
    });
    render(<AboutPage />);
    fireEvent.click(await screen.findByRole("button", { name: "진단 묶음 내보내기" }));
    await waitFor(() => expect(api.exportDiagnostics).toHaveBeenCalled());
    expect(await screen.findByText(/matpylon-진단-ZWICK-PC/)).toBeTruthy();
  });

  it("취소하면(null) 아무 말도 안 한다", async () => {
    installApi({ exportDiagnostics: vi.fn(async () => null) });
    render(<AboutPage />);
    fireEvent.click(await screen.findByRole("button", { name: "진단 묶음 내보내기" }));
    await waitFor(() => expect(window.matpylon.exportDiagnostics).toHaveBeenCalled());
    expect(screen.queryByText(/저장했습니다/)).toBeNull();
  });
});
