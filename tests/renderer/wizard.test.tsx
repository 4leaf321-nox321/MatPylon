/** 마법사 — 단계 이동과 풋터. 둘 다 실사용에서 한 번씩 깨졌던 자리다
 * ("단계를 눌러 이동하고 싶다", "버튼 위치가 깨졌다"). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Wizard } from "../../src/renderer/pages/Wizard";
import { installApi } from "./harness";

afterEach(cleanup);

describe("마법사", () => {
  it("단계 이름을 눌러 옮겨 다닌다", async () => {
    installApi();
    render(<Wizard onDone={() => {}} />);
    expect(await screen.findByText("MatNexus 서버")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "3. 전송 주기" }));
    expect(await screen.findByText("전송 주기")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "1. 서버 연결" }));
    expect(await screen.findByText("MatNexus 서버")).toBeTruthy();
  });

  it("풋터에 「이전」이 있고, 첫 단계에서는 못 누른다", async () => {
    installApi();
    render(<Wizard onDone={() => {}} />);
    const prev = await screen.findByRole("button", { name: "이전" });
    expect((prev as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "3. 전송 주기" }));
    const prev3 = await screen.findByRole("button", { name: "이전" });
    expect((prev3 as HTMLButtonElement).disabled).toBe(false);
  });

  it("각 단계 버튼은 저장까지 한다 — 그냥 넘어가지 않는다", async () => {
    const api = installApi();
    render(<Wizard onDone={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "저장하고 다음" }));
    expect(api.setConfig).toHaveBeenCalled();
  });
});
