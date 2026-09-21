/** 서버 화면 — 자체 서명 인증서 폐쇄망의 첫 설정이 여기서 막혔다.
 * 「연결 확인」은 저장 전 화면의 TLS 로 가는데 「등록」만 저장된 설정으로 가서,
 * 확인은 되고 등록만 인증서 오류로 실패했다. 둘은 같은 조건이어야 한다. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@engine/config";
import { ServerForm } from "../../src/renderer/pages/ServerPage";
import { installApi } from "./harness";

afterEach(cleanup);

function showHttps() {
  const api = installApi({ hasToken: vi.fn(async () => true) });
  const config = defaultConfig();
  config.server.url = "https://matnexus.local:8443";
  render(<ServerForm config={config} onSaved={vi.fn(async () => null)} />);
  // 등록 단추는 이름·부서·토큰이 다 있어야 눌린다
  fireEvent.change(screen.getByLabelText(/커넥터 이름/), { target: { value: "인장기-1" } });
  return api;
}

describe("서버 화면", () => {
  it("커넥터 등록이 저장 전 화면의 TLS 설정으로 간다", async () => {
    const api = showHttps();
    // 자체 서명 인증서 — 화면에서 검증을 끈다(아직 저장 전이다)
    fireEvent.click(await screen.findByLabelText(/인증서 검증 끄기/));
    fireEvent.change(screen.getByLabelText(/부서.*ID/), {
      target: { value: "11111111-2222-3333-4444-555555555555" },
    });
    fireEvent.click(screen.getByRole("button", { name: "커넥터 등록" }));

    await waitFor(() => expect(api.registerConnector).toHaveBeenCalled());
    expect(api.registerConnector).toHaveBeenCalledWith(
      "https://matnexus.local:8443",
      expect.any(String),
      "11111111-2222-3333-4444-555555555555",
      expect.objectContaining({ insecure: true }),
    );
  });

  it("「연결 확인」과 「등록」이 같은 TLS 를 쓴다", async () => {
    const api = showHttps();
    fireEvent.click(await screen.findByLabelText(/인증서 검증 끄기/));
    fireEvent.click(screen.getByRole("button", { name: "연결 확인" }));
    await waitFor(() => expect(api.testConnection).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/부서.*ID/), { target: { value: "ws-1" } });
    fireEvent.click(screen.getByRole("button", { name: "커넥터 등록" }));
    await waitFor(() => expect(api.registerConnector).toHaveBeenCalled());

    const checkTls = vi.mocked(api.testConnection).mock.calls[0]![1];
    const registerTls = vi.mocked(api.registerConnector).mock.calls[0]![3];
    expect(registerTls).toEqual(checkTls);
  });
});
