import { useState, type ReactNode } from "react";
import type { Config } from "@engine/config";
import { useConfig } from "../hooks";
import { Button, Card } from "../ui";
import { ScheduleForm } from "./SchedulePage";
import { ServerForm } from "./ServerPage";
import { SourceEditor } from "./SourcesPage";

const STEPS = ["서버 연결", "첫 소스 폴더", "전송 주기"] as const;

/** 첫 실행 — 서버 → 소스 → 주기. 단계 이름을 눌러 옮겨 다닐 수 있고, 건너뛸 수 있다:
 * 서버가 아직 없어도 폴더는 먼저 볼 수 있다. 버튼은 풋터 오른쪽에 나란히 둔다. */
export function Wizard({ onDone }: { onDone: () => void }) {
  const { config, save } = useConfig();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  if (!config) return null;

  const go = (n: number) => {
    setErr(null);
    setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
  };

  const saveSource = async (next: Config) => {
    const e = await save(next);
    setErr(e);
    if (!e) go(step + 1);
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col gap-4">
      <Card>
        <h1 className="text-xl font-semibold">MatPylon 처음 설정</h1>
        <p className="mt-1 text-sm text-slate-600">
          장비 파일을 MatNexus 에 배달합니다. 세 가지만 정하면 됩니다. 나중에 전부 바꿀 수 있습니다.
        </p>
        <ol className="mt-3 flex gap-2 text-sm">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => go(i)}
                className={`rounded-md px-2 py-1 hover:bg-slate-100 ${
                  i === step ? "font-medium text-blue-700" : i < step ? "text-green-700" : "text-slate-400"
                }`}
              >
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex-1">
        {step === 0 && (
          <ServerForm
            config={config}
            onSaved={save}
            footer={({ save: saveServer }) => (
              <Footer step={step} onPrev={() => go(-1)}>
                <Button variant="ghost" onClick={() => go(1)}>
                  서버는 나중에
                </Button>
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (await saveServer()) go(1);
                  }}
                >
                  저장하고 다음
                </Button>
              </Footer>
            )}
          />
        )}
        {step === 1 && (
          <SourceEditor
            source={{
              key: "",
              name: "",
              path: "",
              extensions: [],
              recursive: false,
              stableMinutes: 2,
              filenameRule: null,
              moveAfterSendTo: null,
              enabled: true,
            }}
            isNew
            existingKeys={config.sources.map((s) => s.key)}
            error={err}
            onCancel={() => go(2)}
            onSave={(s) => void saveSource({ ...config, sources: [...config.sources, s] })}
            footer={({ submit, canSubmit }) => (
              <Footer step={step} onPrev={() => go(0)}>
                <Button variant="ghost" onClick={() => go(2)}>
                  {config.sources.length ? "다음" : "소스는 나중에"}
                </Button>
                <Button variant="primary" disabled={!canSubmit} onClick={submit}>
                  저장하고 다음
                </Button>
              </Footer>
            )}
          />
        )}
        {step === 2 && (
          <ScheduleForm
            config={config}
            onSaved={save}
            footer={({ save: saveSchedule }) => (
              <Footer step={step} onPrev={() => go(1)}>
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (await saveSchedule()) onDone();
                  }}
                >
                  저장하고 완료
                </Button>
              </Footer>
            )}
          />
        )}
      </div>
    </div>
  );
}

/** 풋터 — 「이전」은 왼쪽이 아니라 오른쪽 묶음의 맨 앞. 버튼이 전부 한 줄에 나란히 선다. */
function Footer({ step, onPrev, children }: { step: number; onPrev: () => void; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t border-slate-200 bg-slate-50/95 px-6 py-3 backdrop-blur">
      <Button onClick={onPrev} disabled={step === 0}>
        이전
      </Button>
      {children}
    </div>
  );
}
