import { useCallback, useEffect, useState } from "react";
import type { LedgerRow } from "@shared/ipc";
import { useStatus } from "../hooks";
import { Button, Card, Select, fmtBytes, fmtTime } from "../ui";
import { StatusBadge } from "./Dashboard";

const FILTERS = [
  ["", "전부"],
  ["ready", "대기"],
  ["retry", "재시도 대기"],
  ["failed", "실패"],
  ["sent", "보냄"],
  ["duplicate", "중복"],
  ["seen", "쓰는 중"],
  ["gone", "사라짐"],
] as const;

export function HistoryPage() {
  const status = useStatus();
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<LedgerRow[]>([]);

  const load = useCallback(
    () => window.matpylon.listFiles(filter || undefined).then(setRows),
    [filter],
  );
  // status 가 바뀌면(전송이 돌았으면) 목록도 다시 읽는다.
  useEffect(() => {
    void load();
  }, [load, status]);

  const exportCsv = () => {
    const head = "status,source,path,size,attempts,first_seen,sent_at,server_id,error";
    const lines = rows.map((r) =>
      [r.status, r.source_key, r.path, r.size, r.attempts, fmtTime(r.first_seen_at), fmtTime(r.sent_at), r.server_id ?? "", r.last_error ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob(["﻿" + [head, ...lines].join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `matpylon-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <Card
      title="이력"
      actions={
        <>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Button onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">해당하는 파일이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">상태</th>
                <th>소스</th>
                <th>파일</th>
                <th>크기</th>
                <th>본 시각</th>
                <th>보낸 시각</th>
                <th>오류</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="py-1.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="text-xs">{r.source_key}</td>
                  <td className="max-w-xs truncate font-mono text-xs" title={r.path}>
                    {r.path.split(/[\\/]/).pop()}
                  </td>
                  <td className="text-xs">{fmtBytes(r.size)}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(r.first_seen_at)}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(r.sent_at)}</td>
                  <td className="max-w-xs text-xs text-red-700">
                    {r.last_error}
                    {r.attempts > 1 && <span className="text-slate-400"> ({r.attempts}회)</span>}
                  </td>
                  <td>
                    {(r.status === "failed" || r.status === "retry") && (
                      <Button variant="ghost" onClick={() => window.matpylon.requeue(r.id).then(load)}>
                        다시 시도
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
