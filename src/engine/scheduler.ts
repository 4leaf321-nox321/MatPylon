/** 다음 실행 시각. 타이머는 엔진이 잡는다 — 여기는 계산만 해서 테스트한다. */

import type { Schedule } from "./config";

export function nextRunAt(schedule: Schedule, lastRunAt: number | null, now: number): number {
  if (schedule.kind === "interval") {
    const base = lastRunAt ?? now;
    const next = base + schedule.minutes * 60_000;
    return next > now ? next : now;
  }
  const [h, m] = schedule.at.split(":").map(Number) as [number, number];
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
