/** 이력 화면 — 실패를 **닫을 수 있어야** 한다.
 * 닫는 길이 없으면 실패 수가 영영 빨갛게 남고 새 실패가 그 안에 묻힌다. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerRow } from "@shared/ipc";
import { HistoryPage } from "../../src/renderer/pages/HistoryPage";
import { installApi } from "./harness";

afterEach(cleanup);

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  id: 1,
  source_key: "zwick",
  path: "D:\\data\\a.tra",
  size: 10,
  status: "failed",
  attempts: 3,
  last_error: "MNX-PIPE-0002: 형식을 알 수 없습니다",
  server_id: null,
  first_seen_at: 1_700_000_000_000,
  sent_at: null,
  ...over,
});

describe("이력 화면", () => {
  it("실패한 줄에 「다시 시도」와 「무시」가 같이 있다", async () => {
    const api = installApi({ listFiles: vi.fn(async () => [row({})]) });
    render(<HistoryPage />);
    expect(await screen.findByText(/형식을 알 수 없습니다/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "무시" }));
    await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith(1));
  });

  it("무시한 줄은 「다시 시도」만 — 다시 무시할 것이 없다", async () => {
    const api = installApi({ listFiles: vi.fn(async () => [row({ status: "dismissed" })]) });
    render(<HistoryPage />);
    expect(await screen.findByText("무시함")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "무시" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(api.requeue).toHaveBeenCalledWith(1));
  });

  it("보낸 줄에는 아무 단추도 없다", async () => {
    installApi({ listFiles: vi.fn(async () => [row({ status: "sent", last_error: null })]) });
    render(<HistoryPage />);
    expect(await screen.findByText("보냄")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "무시" })).toBeNull();
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });
});
