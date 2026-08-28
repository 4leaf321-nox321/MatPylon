import { useEffect, useState } from "react";
import type { LedgerRow } from "@shared/ipc";
import { useConfig, useStatus } from "../hooks";
import { Badge, Button, Card, fmtTime } from "../ui";

export function Dashboard() {
  const status = useStatus();
  const { config } = useConfig();
  const [recent, setRecent] = useState<LedgerRow[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => window.matpylon.listFiles().then((rows) => setRecent(rows.slice(0, 20)));
  useEffect(() => {
    void refresh();
  }, [status]);

  const sendNow = async () => {
    setBusy(true);
    try {
      await window.matpylon.sendNow();
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  return (
    <div className="space-y-4">
      <Card
        title="상태"
        actions={
          <>
            {status.running ? (
              <Button onClick={() => window.matpylon.pause()}>일시 정지</Button>
            ) : (
              <Button onClick={() => window.matpylon.resume()}>다시 시작</Button>
            )}
            <Button variant="primary" disabled={busy || !status.serverConfigured} onClick={sendNow}>
              {busy ? "보내는 중…" : "지금 보내기"}
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-slate-500">엔진</dt>
          <dd>{status.running ? <Badge tone="ok">동작 중</Badge> : <Badge tone="warn">일시 정지</Badge>}</dd>
          <dt className="text-slate-500">서버</dt>
          <dd>
            {status.serverConfigured ? (
              <Badge tone="ok">연결 설정됨</Badge>
            ) : (
              <Badge tone="bad">설정 필요 — 「서버」 탭</Badge>
            )}
          </dd>
          <dt className="text-slate-500">다음 전송</dt>
          <dd>{fmtTime(status.nextRunAt)}</dd>
          <dt className="text-slate-500">대기 / 보냄 / 실패</dt>
          <dd>
            {status.counts.ready} / {status.counts.sent} /{" "}
            <span className={status.counts.failed ? "font-medium text-red-700" : ""}>{status.counts.failed}</span>
          </dd>
          {status.lastError && (
            <>
              <dt className="text-slate-500">마지막 오류</dt>
              <dd className="text-red-700">{status.lastError}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card title="소스">
        {config?.sources.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">이름</th>
                <th>폴더</th>
                <th>확장자</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {config.sources.map((s) => (
                <tr key={s.key} className="border-t border-slate-100">
                  <td className="py-1.5">{s.name}</td>
                  <td className="font-mono text-xs text-slate-600">{s.path}</td>
                  <td className="text-xs">{s.extensions.join(" ") || "전부"}</td>
                  <td>{s.enabled ? <Badge tone="ok">활성</Badge> : <Badge tone="muted">꺼짐</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">소스 폴더가 없습니다. 「소스」 탭에서 추가하세요.</p>
        )}
      </Card>

      <Card title="최근 파일">
        {recent.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">파일</th>
                <th>상태</th>
                <th>본 시각</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="max-w-md truncate py-1.5 font-mono text-xs" title={r.path}>
                    {r.path.split(/[\\/]/).pop()}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="text-xs text-slate-500">{fmtTime(r.first_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">아직 본 파일이 없습니다.</p>
        )}
      </Card>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, ["ok" | "warn" | "bad" | "muted", string]> = {
    seen: ["muted", "쓰는 중?"],
    ready: ["warn", "대기"],
    sending: ["warn", "보내는 중"],
    sent: ["ok", "보냄"],
    failed: ["bad", "실패"],
    retry: ["warn", "재시도 대기"],
    duplicate: ["muted", "중복"],
    gone: ["muted", "사라짐"],
  };
  const [tone, label] = map[status] ?? ["muted", status];
  return <Badge tone={tone}>{label}</Badge>;
}
