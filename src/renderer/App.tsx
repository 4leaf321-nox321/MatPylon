import { useEffect, useState } from "react";
import type { EngineStatus } from "@shared/ipc";

/** P0: 엔진 상태가 보이고 자동 시작을 켜고 끌 수 있으면 된다. 화면 7개는 P3. */
export function App() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);

  useEffect(() => {
    void window.matpylon.getStatus().then(setStatus);
    void window.matpylon.getAutoLaunch().then(setAutoLaunch);
    return window.matpylon.onStatus(setStatus);
  }, []);

  const toggleAutoLaunch = async () => {
    const next = !autoLaunch;
    await window.matpylon.setAutoLaunch(next);
    setAutoLaunch(next);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <h1 className="text-2xl font-semibold">MatPylon</h1>
      <p className="mt-1 text-sm text-slate-500">
        장비 파일을 MatNexus 에 배달합니다. 창을 닫아도 트레이에서 계속 돕니다.
      </p>

      <section className="mt-6 rounded-lg border bg-white p-4">
        <h2 className="font-medium">상태</h2>
        {status ? (
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-slate-500">버전</dt>
            <dd>{status.appVersion}</dd>
            <dt className="text-slate-500">엔진</dt>
            <dd>{status.running ? "동작 중" : "일시 정지"}</dd>
            <dt className="text-slate-500">서버</dt>
            <dd>{status.serverConfigured ? "설정됨" : "아직 설정되지 않음"}</dd>
            <dt className="text-slate-500">대기 / 보냄 / 실패</dt>
            <dd>
              {status.counts.ready} / {status.counts.sent} / {status.counts.failed}
            </dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-slate-400">불러오는 중…</p>
        )}
      </section>

      <section className="mt-4 rounded-lg border bg-white p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoLaunch ?? false}
            disabled={autoLaunch === null}
            onChange={toggleAutoLaunch}
          />
          Windows 로그인 시 자동 시작
        </label>
      </section>
    </div>
  );
}
