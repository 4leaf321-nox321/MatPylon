/** 원장 — 파일 상태 기계(개발계획 §3).
 *
 *   seen ─안정화─▶ ready ─전송─▶ sending ─2xx─▶ sent
 *                                  ├─4xx─▶ failed
 *                                  └─5xx·네트워크─▶ retry ─백오프─▶ ready
 *   ready ─해시가 sent 에 있음─▶ duplicate
 *
 * 정체는 경로가 아니라 sha256 이다. 같은 파일을 다른 이름으로 복사해도 한 번만 간다.
 * 서버도 `source_sha256` 으로 알아보므로 양쪽 기준이 같다. */

import Database from "better-sqlite3";

export type FileStatus =
  | "seen"
  | "ready"
  | "sending"
  | "sent"
  | "failed"
  | "retry"
  | "duplicate"
  | "gone";

export interface FileRow {
  id: number;
  source_key: string;
  path: string;
  size: number;
  mtime_ms: number;
  /** 안정화 판정용 — 이 값으로 마지막에 본 시각. */
  observed_at: number;
  sha256: string | null;
  status: FileStatus;
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  server_id: string | null;
  first_seen_at: number;
  sent_at: number | null;
}

export interface Counts {
  ready: number;
  sent: number;
  failed: number;
  retry: number;
  seen: number;
}

/** 재시도 백오프(분). 넘어가면 마지막 값 — 폐쇄망은 며칠 끊길 수 있어 상한이 없다. */
export const BACKOFF_MINUTES = [1, 5, 15, 60];

export function backoffMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1;
  return BACKOFF_MINUTES[idx]! * 60_000;
}

export class Ledger {
  private readonly db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        source_key TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        sha256 TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        last_error TEXT,
        server_id TEXT,
        first_seen_at INTEGER NOT NULL,
        sent_at INTEGER,
        UNIQUE(source_key, path)
      );
      CREATE INDEX IF NOT EXISTS files_status ON files(status);
      CREATE INDEX IF NOT EXISTS files_sha ON files(sha256);
    `);
  }

  close(): void {
    this.db.close();
  }

  get(sourceKey: string, path: string): FileRow | undefined {
    return this.db
      .prepare("SELECT * FROM files WHERE source_key = ? AND path = ?")
      .get(sourceKey, path) as FileRow | undefined;
  }

  /** 스캔이 본 것을 적는다. 크기·mtime 이 바뀌었으면 안정화를 처음부터 다시 센다.
   * 이미 `sent`·`failed` 등 끝난 파일이 바뀌면 새 파일로 본다 — 장비가 같은 이름에
   * 다시 쓴 것이다. */
  observe(sourceKey: string, path: string, size: number, mtimeMs: number, now: number): FileRow {
    const row = this.get(sourceKey, path);
    if (!row) {
      this.db
        .prepare(
          `INSERT INTO files (source_key, path, size, mtime_ms, observed_at, status, first_seen_at)
           VALUES (?, ?, ?, ?, ?, 'seen', ?)`,
        )
        .run(sourceKey, path, size, mtimeMs, now, now);
      return this.get(sourceKey, path)!;
    }
    if (row.size !== size || row.mtime_ms !== mtimeMs) {
      this.db
        .prepare(
          `UPDATE files SET size = ?, mtime_ms = ?, observed_at = ?, status = 'seen',
             sha256 = NULL, attempts = 0, next_attempt_at = NULL, last_error = NULL
           WHERE id = ?`,
        )
        .run(size, mtimeMs, now, row.id);
      return this.get(sourceKey, path)!;
    }
    return row;
  }

  /** 안정화된 파일에 해시를 붙여 `ready` 로. 같은 해시가 이미 보내졌으면 `duplicate`. */
  markReady(id: number, sha256: string): FileStatus {
    const dup = this.db
      .prepare("SELECT id FROM files WHERE sha256 = ? AND status = 'sent' AND id != ? LIMIT 1")
      .get(sha256, id);
    const status: FileStatus = dup ? "duplicate" : "ready";
    this.db.prepare("UPDATE files SET sha256 = ?, status = ? WHERE id = ?").run(sha256, status, id);
    return status;
  }

  markGone(id: number): void {
    this.db.prepare("UPDATE files SET status = 'gone' WHERE id = ?").run(id);
  }

  /** 보낼 차례인 것. `retry` 는 백오프가 지났을 때만. */
  due(now: number, limit = 100): FileRow[] {
    return this.db
      .prepare(
        `SELECT * FROM files
         WHERE status = 'ready' OR (status = 'retry' AND next_attempt_at <= ?)
         ORDER BY first_seen_at LIMIT ?`,
      )
      .all(now, limit) as FileRow[];
  }

  claim(id: number): void {
    this.db
      .prepare("UPDATE files SET status = 'sending', attempts = attempts + 1 WHERE id = ?")
      .run(id);
  }

  markSent(id: number, serverId: string | null, now: number): void {
    this.db
      .prepare(
        "UPDATE files SET status = 'sent', server_id = ?, sent_at = ?, last_error = NULL WHERE id = ?",
      )
      .run(serverId, now, id);
  }

  markFailed(id: number, error: string): void {
    this.db.prepare("UPDATE files SET status = 'failed', last_error = ? WHERE id = ?").run(error, id);
  }

  markRetry(id: number, error: string, now: number): void {
    const row = this.db.prepare("SELECT attempts FROM files WHERE id = ?").get(id) as {
      attempts: number;
    };
    this.db
      .prepare("UPDATE files SET status = 'retry', last_error = ?, next_attempt_at = ? WHERE id = ?")
      .run(error, now + backoffMs(row.attempts), id);
  }

  /** 사람이 「다시 시도」를 눌렀다. 백오프 없이 다음 배치에 간다. */
  requeue(id: number): void {
    this.db
      .prepare(
        "UPDATE files SET status = 'ready', attempts = 0, next_attempt_at = NULL WHERE id = ? AND status IN ('failed','retry')",
      )
      .run(id);
  }

  /** 앱이 죽어 `sending` 에 남은 것은 결과를 모른다. 다시 보낸다 — 서버가 해시로 중복을 막는다. */
  recoverSending(): number {
    return this.db.prepare("UPDATE files SET status = 'ready' WHERE status = 'sending'").run().changes;
  }

  counts(): Counts {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM files GROUP BY status")
      .all() as { status: FileStatus; n: number }[];
    const c: Counts = { ready: 0, sent: 0, failed: 0, retry: 0, seen: 0 };
    for (const r of rows) if (r.status in c) c[r.status as keyof Counts] = r.n;
    return c;
  }

  /** 한 소스의 **아직 안 끝난** 행 전부. 상한 없음 — 사라짐 판정이 이것으로 하므로
   * 200건에서 잘리면 그 뒤 파일은 영영 `seen` 으로 남는다(실제로 그랬다). */
  pendingBySource(sourceKey: string): FileRow[] {
    return this.db
      .prepare(
        "SELECT * FROM files WHERE source_key = ? AND status IN ('seen','ready','retry')",
      )
      .all(sourceKey) as FileRow[];
  }

  /** heartbeat 용 — 소스별 대기·실패·마지막 전송. 행을 다 읽지 않고 SQL 로 센다. */
  sourceStats(sourceKey: string): { pending: number; failed: number; lastSentAt: number | null } {
    const r = this.db
      .prepare(
        `SELECT
           SUM(status IN ('ready','retry')) AS pending,
           SUM(status = 'failed') AS failed,
           MAX(sent_at) AS last_sent
         FROM files WHERE source_key = ?`,
      )
      .get(sourceKey) as { pending: number | null; failed: number | null; last_sent: number | null };
    return { pending: r.pending ?? 0, failed: r.failed ?? 0, lastSentAt: r.last_sent };
  }

  /** 끝난 행(sent·duplicate·gone)을 보존 기간 뒤 지운다. `failed` 는 사람이 봐야 하니 남긴다.
   * 지우면 같은 해시가 다시 오면 다시 보내지만, 서버가 409 로 막는다. */
  prune(olderThanMs: number): number {
    return this.db
      .prepare(
        `DELETE FROM files WHERE status IN ('sent','duplicate','gone')
         AND COALESCE(sent_at, observed_at) < ?`,
      )
      .run(olderThanMs).changes;
  }

  list(status?: FileStatus, limit = 200): FileRow[] {
    return status
      ? (this.db
          .prepare("SELECT * FROM files WHERE status = ? ORDER BY first_seen_at DESC LIMIT ?")
          .all(status, limit) as FileRow[])
      : (this.db
          .prepare("SELECT * FROM files ORDER BY first_seen_at DESC LIMIT ?")
          .all(limit) as FileRow[]);
  }
}
