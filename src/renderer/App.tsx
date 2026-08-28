import { useEffect, useState } from "react";
import { AboutPage } from "./pages/AboutPage";
import { Dashboard } from "./pages/Dashboard";
import { HistoryPage } from "./pages/HistoryPage";
import { LogPage } from "./pages/LogPage";
import { SchedulePage } from "./pages/SchedulePage";
import { ServerPage } from "./pages/ServerPage";
import { SourcesPage } from "./pages/SourcesPage";
import { Wizard } from "./pages/Wizard";
import { useStatus } from "./hooks";

const TABS = [
  ["dashboard", "대시보드", Dashboard],
  ["server", "서버", ServerPage],
  ["sources", "소스", SourcesPage],
  ["schedule", "스케줄", SchedulePage],
  ["history", "이력", HistoryPage],
  ["log", "로그", LogPage],
  ["about", "정보", AboutPage],
] as const;

type Tab = (typeof TABS)[number][0];

const WIZARD_KEY = "matpylon.wizardDone";

export function App() {
  const status = useStatus();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [wizard, setWizard] = useState<boolean | null>(null);

  useEffect(() => {
    // 마법사는 한 번만. 서버가 설정돼 있으면 이전 설치의 설정이 남은 것이므로 건너뛴다.
    if (status === null) return;
    setWizard(!status.serverConfigured && localStorage.getItem(WIZARD_KEY) !== "1");
  }, [status === null]);

  if (wizard === null) return null;
  if (wizard)
    return (
      <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
        <Wizard
          onDone={() => {
            localStorage.setItem(WIZARD_KEY, "1");
            setWizard(false);
          }}
        />
      </div>
    );

  const Page = TABS.find(([k]) => k === tab)![2];
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <nav className="w-44 shrink-0 border-r border-slate-200 bg-white p-3">
        <div className="mb-4 px-2">
          <div className="font-semibold">MatPylon</div>
          <div className="text-xs text-slate-400">{status?.appVersion}</div>
        </div>
        <ul className="space-y-0.5">
          {TABS.map(([key, label]) => (
            <li key={key}>
              <button
                onClick={() => setTab(key)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  tab === key ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {label}
                {key === "history" && status?.counts.failed ? (
                  <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">{status.counts.failed}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <Page />
      </main>
    </div>
  );
}
