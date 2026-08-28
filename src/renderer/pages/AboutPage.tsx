import { useEffect, useState } from "react";
import { useConfig, useStatus } from "../hooks";
import { Button, Card, Toggle } from "../ui";

export function AboutPage() {
  const status = useStatus();
  const { reload } = useConfig();
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const [paths, setPaths] = useState<{ dataDir: string; configFile: string; logFile: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void window.matpylon.getAutoLaunch().then(setAutoLaunch);
    void window.matpylon.paths().then(setPaths);
  }, []);

  return (
    <div className="space-y-4">
      <Card title="MatPylon">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-slate-500">버전</dt>
          <dd>{status?.appVersion}</dd>
          <dt className="text-slate-500">데이터 폴더</dt>
          <dd className="font-mono text-xs">{paths?.dataDir}</dd>
          <dt className="text-slate-500">설정 파일</dt>
          <dd className="font-mono text-xs">{paths?.configFile}</dd>
          <dt className="text-slate-500">로그 파일</dt>
          <dd className="font-mono text-xs">{paths?.logFile}</dd>
        </dl>
        <div className="mt-3">
          <Button onClick={() => window.matpylon.openDataFolder()}>데이터 폴더 열기</Button>
        </div>
      </Card>

      <Card title="시작">
        <Toggle
          checked={autoLaunch ?? false}
          onChange={async (v) => {
            await window.matpylon.setAutoLaunch(v);
            setAutoLaunch(v);
          }}
          label="Windows 로그인 시 자동 시작 (트레이에 상주)"
        />
      </Card>

      <Card title="설정 복제" >
        <p className="mb-3 text-sm text-slate-600">
          장비 PC 여러 대에 같은 소스·주기를 쓸 때. 토큰과 이 PC 의 커넥터 id 는 파일에 들어가지 않습니다 — PC 마다 따로 등록합니다.
        </p>
        <div className="flex items-center gap-2">
          <Button
            onClick={async () => {
              if (await window.matpylon.exportConfig()) setMsg("내보냈습니다");
            }}
          >
            내보내기
          </Button>
          <Button
            onClick={async () => {
              try {
                if (await window.matpylon.importConfig()) {
                  await reload();
                  setMsg("가져왔습니다");
                }
              } catch (e) {
                setMsg((e as Error).message.replace(/^.*Error: /, ""));
              }
            }}
          >
            가져오기
          </Button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </Card>
    </div>
  );
}
