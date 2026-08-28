import { useState, type ReactNode } from "react";
import type { Config, Schedule } from "@engine/config";
import { nextRunAt } from "@engine/scheduler";
import { useConfig } from "../hooks";
import { Button, Card, Field, Input, Select, fmtTime } from "../ui";

const PRESETS: { label: string; schedule: Schedule }[] = [
  { label: "15분마다", schedule: { kind: "interval", minutes: 15 } },
  { label: "30분마다", schedule: { kind: "interval", minutes: 30 } },
  { label: "1시간마다 (기본)", schedule: { kind: "interval", minutes: 60 } },
  { label: "6시간마다", schedule: { kind: "interval", minutes: 360 } },
  { label: "매일 지정 시각", schedule: { kind: "daily", at: "02:00" } },
];

function presetIndex(s: Schedule) {
  const i = PRESETS.findIndex((p) => JSON.stringify(p.schedule) === JSON.stringify(s));
  if (i >= 0) return i;
  return s.kind === "daily" ? 4 : -1;
}

export function ScheduleForm({
  config,
  onSaved,
  footer,
}: {
  config: Config;
  onSaved: (c: Config) => Promise<string | null>;
  /** 마법사처럼 저장 버튼을 풋터에 두고 싶을 때. */
  footer?: (ctx: { save: () => Promise<boolean> }) => ReactNode;
}) {
  const [schedule, setSchedule] = useState<Schedule>(config.schedule);
  const [scanMinutes, setScanMinutes] = useState(config.scanMinutes);
  const [msg, setMsg] = useState<string | null>(null);
  const idx = presetIndex(schedule);
  const persist = async (): Promise<boolean> => {
    const err = await onSaved({ ...config, schedule, scanMinutes });
    setMsg(err ?? "저장했습니다");
    return err === null;
  };

  return (
    <div className="space-y-4">
      <Card title="전송 주기">
        <div className="grid grid-cols-2 gap-3">
          <Field label="주기">
            <Select
              value={idx}
              onChange={(e) => {
                const i = Number(e.target.value);
                if (i >= 0) setSchedule(PRESETS[i]!.schedule);
                else setSchedule({ kind: "interval", minutes: 60 });
              }}
            >
              {PRESETS.map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
              <option value={-1}>직접 입력(분)</option>
            </Select>
          </Field>
          {schedule.kind === "interval" && idx === -1 && (
            <Field label="간격(분)">
              <Input
                type="number"
                min={1}
                max={1440}
                value={schedule.minutes}
                onChange={(e) => setSchedule({ kind: "interval", minutes: Number(e.target.value) })}
              />
            </Field>
          )}
          {schedule.kind === "daily" && (
            <Field label="시각">
              <Input type="time" value={schedule.at} onChange={(e) => setSchedule({ kind: "daily", at: e.target.value })} />
            </Field>
          )}
          <Field label="폴더 훑는 주기(분)" hint="새 파일을 알아채는 빠르기. 전송 주기와는 별개입니다">
            <Input type="number" min={1} max={60} value={scanMinutes} onChange={(e) => setScanMinutes(Number(e.target.value))} />
          </Field>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          이 설정이면 다음 전송은 <b>{fmtTime(nextRunAt(schedule, null, Date.now()))}</b> 쯤입니다.
        </p>
      </Card>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      {footer ? (
        footer({ save: persist })
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => void persist()}>
            저장
          </Button>
        </div>
      )}
    </div>
  );
}

export function SchedulePage() {
  const { config, save } = useConfig();
  if (!config) return null;
  return <ScheduleForm config={config} onSaved={save} />;
}
