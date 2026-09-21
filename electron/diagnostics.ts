/** 진단 묶음 — 폐쇄망 장비 PC 에서 들고 나올 파일 하나.
 *
 * 체크리스트가 「실패가 있으면 오류 문구를 그대로 적어 온다」였다. 사람이 옮겨 적으면
 * 틀리고, 옮겨 적을 수 없는 것(설정·타이밍·로그 앞뒤)이 정작 원인이다. 단추 하나로
 * 묶어서 USB 로 들고 나오게 한다.
 *
 * **토큰은 안 들어간다.** PAT 는 `token.bin` 에 따로 있고 설정 파일에는 없다 —
 * 여기서도 「저장됨/없음」만 적는다. 묶음이 메일·USB 를 타고 돌아다닐 것을 전제한다.
 *
 * Electron 을 모르는 순수 함수다. 모으는 것은 `main.ts`, 만드는 것은 여기 — 그래야
 * 내용을 테스트할 수 있다. */

import type { Config } from "@engine/config";
import type { EngineStatus, LedgerRow } from "@shared/ipc";
import { zip, type ZipEntry } from "./zip";

export interface DiagnosticsInput {
  status: EngineStatus;
  config: Config;
  rows: LedgerRow[];
  hasToken: boolean;
  /** `%APPDATA%\MatPylon` */
  dataDir: string;
  hostname: string;
  /** `Windows_NT 10.0.26200` 같은 것. */
  platform: string;
  versions: { electron?: string; node?: string; chrome?: string };
  logs: { name: string; text: string }[];
  now: Date;
}

const fmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("ko-KR") : "—");

function summary(d: DiagnosticsInput): string {
  const { status, config, rows } = d;
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  const lines: string[] = [
    `MatPylon 진단 묶음`,
    `만든 시각: ${d.now.toLocaleString("ko-KR")}`,
    ``,
    `== 이 PC ==`,
    `MatPylon      ${status.appVersion}`,
    `호스트        ${d.hostname}`,
    `OS            ${d.platform}`,
    `Electron/Node ${d.versions.electron ?? "—"} / ${d.versions.node ?? "—"}`,
    `데이터 폴더   ${d.dataDir}`,
    ``,
    `== 상태 ==`,
    `엔진          ${status.running ? "동작 중" : "일시 정지"}`,
    `서버 설정     ${status.serverConfigured ? "됨" : "안 됨"}`,
    `다음 전송     ${status.nextRunAt ? new Date(status.nextRunAt).toLocaleString("ko-KR") : "—"}`,
    `안정화 대기   ${status.stabilizingUntil ? new Date(status.stabilizingUntil).toLocaleString("ko-KR") : "—"}`,
    `마지막 오류   ${status.lastError ?? "없음"}`,
    `대기/보냄/실패 ${status.counts.ready} / ${status.counts.sent} / ${status.counts.failed}`,
    `원장 상태별   ${[...byStatus].map(([s, n]) => `${s} ${n}`).join(" · ") || "비어 있음"}`,
    `  (원장은 최근 ${rows.length}건만 담았습니다)`,
    ``,
    `== 서버 ==`,
    `주소          ${config.server.url ?? "—"}`,
    `커넥터        ${config.server.connectorName || "—"} (${config.server.connectorId ?? "미등록"})`,
    `TLS           ${config.server.tls.insecure ? "검증 끔" : "검증 함"}${config.server.tls.caFile ? ` · CA ${config.server.tls.caFile}` : ""}`,
    `PAT           ${d.hasToken ? "저장됨(값은 이 묶음에 없습니다)" : "없음"}`,
    ``,
    `== 스케줄 ==`,
    `전송          ${config.schedule.kind === "interval" ? `${config.schedule.minutes}분마다` : `매일 ${config.schedule.at}`}`,
    `폴더 훑기     ${config.scanMinutes}분마다`,
    `원장 보존     ${config.retentionDays}일`,
    ``,
    `== 소스 ==`,
  ];

  if (!config.sources.length) lines.push(`(없음)`);
  for (const s of config.sources) {
    const mine = rows.filter((r) => r.source_key === s.key);
    const n = (st: string) => mine.filter((r) => r.status === st).length;
    lines.push(
      `[${s.key}] ${s.name}${s.enabled ? "" : "  ※ 꺼짐"}`,
      `  폴더       ${s.path}`,
      `  확장자     ${s.extensions.join(" ") || "전부"}${s.recursive ? " · 하위 폴더 포함" : ""}${s.moveAfterSendTo ? ` · 보낸 뒤 ${s.moveAfterSendTo}\\ 로 이동` : ""}`,
      `  안정화     ${s.stableMinutes}분`,
      `  경로 규칙  ${s.pathRule ?? "(없음)"}`,
      `  기본값     ${Object.entries(s.defaults).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ") || "(없음)"}`,
      `  원장       대기 ${n("ready") + n("retry")} · 보냄 ${n("sent")} · 실패 ${n("failed")} · 무시함 ${n("dismissed")} · 안정화 대기 ${n("seen")}`,
    );
  }

  const failed = rows.filter((r) => r.status === "failed" || r.status === "retry").slice(0, 20);
  if (failed.length) {
    lines.push(``, `== 실패·재시도 (최근 ${failed.length}건) ==`);
    for (const r of failed)
      lines.push(`${r.status}  ${r.path}`, `        ${r.attempts}회 · ${r.last_error ?? "(사유 없음)"}`);
  }

  return lines.join("\r\n");
}

function historyCsv(rows: LedgerRow[]): string {
  const head = "status,source,path,size,attempts,first_seen,sent_at,server_id,error";
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.status, r.source_key, r.path, r.size, r.attempts, fmt(r.first_seen_at), fmt(r.sent_at), r.server_id, r.last_error]
      .map(cell)
      .join(","),
  );
  // 엑셀이 UTF-8 로 열게 BOM 을 붙인다 — 한글 경로가 깨지면 읽을 수가 없다.
  return "﻿" + [head, ...lines].join("\r\n");
}

export function diagnosticsEntries(d: DiagnosticsInput): ZipEntry[] {
  return [
    { name: "요약.txt", data: summary(d) },
    { name: "config.json", data: JSON.stringify(d.config, null, 2) },
    { name: "이력.csv", data: historyCsv(d.rows) },
    ...d.logs.map((l) => ({ name: `로그/${l.name}`, data: l.text })),
  ];
}

export function diagnosticsZip(d: DiagnosticsInput): Buffer {
  return zip(diagnosticsEntries(d), d.now);
}

/** `matpylon-진단-장비PC-2026-09-21.zip` */
export function diagnosticsFilename(hostname: string, now: Date): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `matpylon-진단-${hostname}-${day}.zip`;
}
