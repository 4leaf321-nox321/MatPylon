import { describe, expect, it } from "vitest";
import { BACKOFF_MINUTES, Ledger, backoffMs } from "@engine/ledger";

const T0 = 1_700_000_000_000;

describe("ledger 상태 기계", () => {
  it("seen → ready → sending → sent", () => {
    const l = new Ledger(":memory:");
    const row = l.observe("s", "a.tra", 10, T0, T0);
    expect(row.status).toBe("seen");
    expect(l.markReady(row.id, "sha1")).toBe("ready");
    expect(l.due(T0)).toHaveLength(1);
    l.claim(row.id);
    expect(l.due(T0)).toHaveLength(0);
    l.markSent(row.id, "srv-1", T0 + 1);
    expect(l.counts()).toMatchObject({ sent: 1, ready: 0 });
  });

  it("같은 해시가 이미 보내졌으면 duplicate", () => {
    const l = new Ledger(":memory:");
    const a = l.observe("s", "a.tra", 10, T0, T0);
    l.markReady(a.id, "same");
    l.markSent(a.id, null, T0);
    const b = l.observe("s", "copy of a.tra", 10, T0, T0);
    expect(l.markReady(b.id, "same")).toBe("duplicate");
    expect(l.due(T0)).toHaveLength(0);
  });

  it("크기·mtime 이 바뀌면 처음부터 — 끝난 파일도", () => {
    const l = new Ledger(":memory:");
    const a = l.observe("s", "a.tra", 10, T0, T0);
    l.markReady(a.id, "h1");
    l.markSent(a.id, null, T0);
    const again = l.observe("s", "a.tra", 20, T0 + 5000, T0 + 5000);
    expect(again.status).toBe("seen");
    expect(again.sha256).toBeNull();
    expect(again.attempts).toBe(0);
  });

  it("retry 는 백오프가 지나야 due, failed 는 영영 아님", () => {
    const l = new Ledger(":memory:");
    const a = l.observe("s", "a.tra", 10, T0, T0);
    l.markReady(a.id, "h");
    l.claim(a.id);
    l.markRetry(a.id, "500", T0);
    expect(l.due(T0)).toHaveLength(0);
    expect(l.due(T0 + backoffMs(1))).toHaveLength(1);

    const b = l.observe("s", "b.tra", 10, T0, T0);
    l.markReady(b.id, "h2");
    l.claim(b.id);
    l.markFailed(b.id, "413");
    expect(l.due(T0 + 1e12).map((r) => r.id)).toEqual([a.id]);
    l.requeue(b.id);
    expect(l.due(T0 + 1e12)).toHaveLength(2);
  });

  it("백오프는 1·5·15·60분에서 멈춘다", () => {
    expect([1, 2, 3, 4, 9].map(backoffMs)).toEqual(
      [...BACKOFF_MINUTES, 60].map((m) => m * 60_000),
    );
  });

  it("죽었다 살아나면 sending 을 ready 로", () => {
    const l = new Ledger(":memory:");
    const a = l.observe("s", "a.tra", 10, T0, T0);
    l.markReady(a.id, "h");
    l.claim(a.id);
    expect(l.recoverSending()).toBe(1);
    expect(l.due(T0)).toHaveLength(1);
  });
});
