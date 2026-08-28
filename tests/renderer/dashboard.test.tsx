/** 대시보드 — **기다리는 기준이 화면에 있어야 한다.**
 *
 * "지금 보내기를 눌렀는데 0/0/0 이고 「쓰는 중?」 이라 얼마나 기다려야 할지 모르겠다" 는
 * 실제 사용에서 나온 말이다. 그 줄이 사라지면 같은 일이 다시 난다. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../src/renderer/pages/Dashboard";
import { installApi } from "./harness";

afterEach(cleanup);

describe("대시보드", () => {
  it("안정화 대기가 있으면 언제 이어지는지 말한다", async () => {
    installApi({}, { status: { counts: { seen: 3, ready: 0, sent: 0, failed: 0 }, stabilizingUntil: "2026-08-29T09:31:00.000Z" } });
    render(<Dashboard />);
    expect(await screen.findByText("안정화 대기")).toBeTruthy();
    expect(screen.getByText(/3개/)).toBeTruthy();
    expect(screen.getByText(/자동으로 이어집니다/)).toBeTruthy();
  });

  it("안정화 대기가 없으면 그 줄은 없다", async () => {
    installApi({}, { status: { counts: { seen: 0, ready: 2, sent: 5, failed: 0 } } });
    render(<Dashboard />);
    await screen.findByText("상태");
    expect(screen.queryByText("안정화 대기")).toBeNull();
  });

  it("서버가 설정 안 됐으면 「지금 보내기」를 못 누른다", async () => {
    installApi({}, { status: { serverConfigured: false } });
    render(<Dashboard />);
    const button = await screen.findByRole("button", { name: "지금 보내기" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/설정 필요/)).toBeTruthy();
  });

  it("마지막 오류를 숨기지 않는다", async () => {
    installApi({}, { status: { lastError: "폴더를 읽지 못했습니다 — \\\\nas\\share" } });
    render(<Dashboard />);
    expect(await screen.findByText(/폴더를 읽지 못했습니다/)).toBeTruthy();
  });
});
