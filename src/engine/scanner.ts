/** 소스 폴더를 훑어 원장에 적고, 쓰기가 끝난 파일에 해시를 붙인다.
 *
 * 스캔이 정본이다. chokidar 감시는 빨리 알아채는 가속일 뿐 — 네트워크 드라이브와
 * 절전 복귀에서 이벤트가 빠진다. */

import { createHash } from "node:crypto";
import { createReadStream, openSync, closeSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Source } from "./config";
import type { Ledger } from "./ledger";

export interface ScanResult {
  observed: number;
  ready: number;
  duplicate: number;
  gone: number;
  errors: string[];
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** 다른 프로세스가 아직 쓰고 있으면 Windows 는 열기를 거부한다(공유 모드에 따라).
 * 확실한 신호는 아니라 mtime 안정화와 함께 쓴다. */
function canOpen(file: string): boolean {
  try {
    closeSync(openSync(file, "r+"));
    return true;
  } catch {
    return false;
  }
}

function* walk(dir: string, recursive: boolean, skipDir: string | null): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive && e.name !== skipDir) yield* walk(full, true, skipDir);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

export async function scanSource(
  source: Source,
  ledger: Ledger,
  now: number,
  log: (msg: string) => void = () => {},
): Promise<ScanResult> {
  const result: ScanResult = { observed: 0, ready: 0, duplicate: 0, gone: 0, errors: [] };
  const stableMs = source.stableMinutes * 60_000;
  const present = new Set<string>();

  for (const file of walk(source.path, source.recursive, source.moveAfterSendTo)) {
    const ext = path.extname(file).toLowerCase();
    if (source.extensions.length && !source.extensions.includes(ext)) continue;
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    present.add(file);
    result.observed++;
    const row = ledger.observe(source.key, file, st.size, st.mtimeMs, now);
    if (row.status !== "seen") continue;

    // 안정화: 마지막으로 바뀐 것을 본 시각(observed_at)과 mtime 둘 다 stableMs 이전.
    const settled = now - Math.max(row.observed_at, st.mtimeMs) >= stableMs;
    if (!settled || !canOpen(file)) continue;

    try {
      const sha = await sha256File(file);
      const status = ledger.markReady(row.id, sha);
      if (status === "duplicate") result.duplicate++;
      else result.ready++;
      log(`${status}: ${file}`);
    } catch (e) {
      result.errors.push(`${file}: ${(e as Error).message}`);
    }
  }

  // 원장에는 있는데 폴더에 없는 것 — 사람이 지웠거나 옮겼다. 보내지 않은 것만 표시한다.
  for (const row of ledger.list()) {
    if (row.source_key !== source.key || present.has(row.path)) continue;
    if (row.status === "seen" || row.status === "ready" || row.status === "retry") {
      ledger.markGone(row.id);
      result.gone++;
    }
  }
  return result;
}
