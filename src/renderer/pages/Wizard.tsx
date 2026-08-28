import { useState } from "react";
import type { Config } from "@engine/config";
import { useConfig } from "../hooks";
import { Button, Card } from "../ui";
import { ScheduleForm } from "./SchedulePage";
import { ServerForm } from "./ServerPage";
import { SourceEditor } from "./SourcesPage";

/** 첫 실행 — 서버 → 소스 → 주기. 건너뛸 수 있다: 서버가 아직 없어도 폴더는 먼저 볼 수 있다. */
export function Wizard({ onDone }: { onDone: () => void }) {
  const { config, save } = useConfig();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  if (!config) return null;

  const steps = ["서버 연결", "첫 소스 폴더", "전송 주기"];
  const saveAnd = async (next: Config) => {
    const e = await save(next);
    if (!e) setStep(step + 1);
    return e;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <h1 className="text-xl font-semibold">MatPylon 처음 설정</h1>
        <p className="mt-1 text-sm text-slate-600">
          장비 파일을 MatNexus 에 배달합니다. 세 가지만 정하면 됩니다. 나중에 전부 바꿀 수 있습니다.
        </p>
        <ol className="mt-3 flex gap-4 text-sm">
          {steps.map((s, i) => (
            <li key={s} className={i === step ? "font-medium text-blue-700" : i < step ? "text-green-700" : "text-slate-400"}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </Card>

      {step === 0 && (
        <>
          <ServerForm config={config} onSaved={save} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setStep(1)}>
              다음
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)}>
              서버는 나중에
            </Button>
          </div>
        </>
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
          onCancel={() => setStep(2)}
          onSave={async (s) => setErr(await saveAnd({ ...config, sources: [...config.sources, s] }))}
        />
      )}
      {step === 2 && (
        <>
          <ScheduleForm config={config} onSaved={save} />
          <Button variant="primary" onClick={onDone}>
            완료
          </Button>
        </>
      )}
    </div>
  );
}
