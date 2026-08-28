import { describe, expect, it } from "vitest";
import { nextRunAt } from "@engine/scheduler";

const T0 = new Date(2026, 7, 28, 10, 0, 0).getTime();
const MIN = 60_000;

describe("scheduler", () => {
  it("interval: 마지막 실행 + 간격, 처음이면 지금 + 간격", () => {
    expect(nextRunAt({ kind: "interval", minutes: 60 }, null, T0)).toBe(T0 + 60 * MIN);
    expect(nextRunAt({ kind: "interval", minutes: 60 }, T0 - 30 * MIN, T0)).toBe(T0 + 30 * MIN);
  });

  it("interval: 밀렸으면(절전) 지금", () => {
    expect(nextRunAt({ kind: "interval", minutes: 60 }, T0 - 5 * 3600_000, T0)).toBe(T0);
  });

  it("daily: 오늘 그 시각이 남았으면 오늘, 지났으면 내일", () => {
    const today = new Date(2026, 7, 28, 23, 30).getTime();
    const tomorrow = new Date(2026, 7, 29, 9, 30).getTime();
    expect(nextRunAt({ kind: "daily", at: "23:30" }, null, T0)).toBe(today);
    expect(nextRunAt({ kind: "daily", at: "09:30" }, null, T0)).toBe(tomorrow);
  });
});
