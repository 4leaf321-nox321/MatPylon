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
  /** 폴더(또는 하위 폴더) 하나라도 못 읽었다. **이때는 사라짐 판정을 하지 않는다.** */
  unreadable: boolean;
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
 * 확실한 신호는 아니라 mtime 안정화와 함께 쓴다.
 *
 * `r+` 만 시도하면 **읽기 전용 파일이 영영 `seen`** 이다 — 장비 소프트웨어가 결과를
 * 읽기 전용으로 떨구는 경우가 있다. 쓰기 열기가 안 되면 읽기로 한 번 더 본다. */
function canOpen(file: string): boolean {
  for (const mode of ["r+", "r"]) {
    try {
      closeSync(openSync(file, mode));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EACCES" && (e as NodeJS.ErrnoException).code !== "EPERM")
        return false;
    }
  }
  return false;
}

/** 못 읽은 폴더를 `failed` 에 적는다 — **삼키지 않는다.**
 *
 * 실측 전 설계 결함: 여기서 조용히 빈 목록을 돌려주면 아래 사라짐 판정이 대기 중이던
 * 파일을 전부 `gone` 으로 찍는다. 네트워크 드라이브가 1초 끊긴 것뿐인데 큐가 비고,
 * 드라이브가 돌아와도 파일 내용이 그대로면 `gone` 인 채 영영 다시 안 잡힌다. */
function* walk(
  dir: string,
  recursive: boolean,
  skipDir: string | null,
  failed: string[],
): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    failed.push(`${dir}: ${(e as Error).message}`);
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // 보낸 파일 폴더는 소스 루트 바로 아래 하나뿐이다(`moveSent` 가 구조를 그 아래에
      // 그대로 미러링한다). 그래서 루트에서만 건너뛴다 — 깊은 곳에 같은 이름의 재료·로트
      // 폴더가 있어도 잡아먹지 않는다.
      if (e.name === skipDir) continue;
      if (recursive) yield* walk(full, true, null, failed);
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
  const result: ScanResult = {
    observed: 0,
    ready: 0,
    duplicate: 0,
    gone: 0,
    errors: [],
    unreadable: false,
  };
  const stableMs = source.stableMinutes * 60_000;
  const present = new Set<string>();
  const failed: string[] = [];

  for (const file of walk(source.path, source.recursive, source.moveAfterSendTo, failed)) {
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
    //
    // **미래 mtime 은 안 믿는다.** 장비 PC·NAS 시계가 앞서 있으면(흔하다) 그 시각이 올
    // 때까지 파일이 묶인다 — 두 시간 앞서면 두 시간. 그때는 mtime 을 버리고 `observed_at`
    // 으로만 잰다: 이 크기·mtime 으로 처음 본 시각이고, 우리 시계라 믿을 수 있다.
    // (`now` 로 자르면 매 스캔마다 안정화가 처음부터 다시 시작돼 영영 안 끝난다.)
    const skewed = st.mtimeMs > now;
    const changedAt = skewed ? row.observed_at : Math.max(row.observed_at, st.mtimeMs);
    const settled = now - changedAt >= stableMs;
    if (!settled || !canOpen(file)) continue;

    try {
      const sha = await sha256File(file);
      const status = ledger.markReady(row.id, sha);
      if (status === "duplicate") result.duplicate++;
      else result.ready++;
      log(`${status}: ${file}`);
      if (skewed)
        log(
          `  파일 시각이 미래입니다(${new Date(st.mtimeMs).toISOString()}) — 시계가 어긋난 것으로 보고` +
            ` 처음 본 시각으로 안정화를 판정했습니다`,
        );
    } catch (e) {
      result.errors.push(`${file}: ${(e as Error).message}`);
    }
  }

  // 폴더를 못 읽었으면 여기서 멈춘다. "안 보인다" 와 "못 봤다" 는 다르다 —
  // 못 본 것을 사라졌다고 찍으면 큐가 통째로 날아간다.
  if (failed.length) {
    result.unreadable = true;
    for (const f of failed) result.errors.push(`폴더를 읽지 못했습니다 — ${f}`);
    return result;
  }

  // 원장에는 있는데 폴더에 없는 것 — 사람이 지웠거나 옮겼다. 보내지 않은 것만 표시한다.
  for (const row of ledger.pendingBySource(source.key)) {
    if (present.has(row.path)) continue;
    ledger.markGone(row.id);
    result.gone++;
  }
  return result;
}

/** 규칙 편집기의 미리보기용 — 스캔과 같은 눈(재귀·건너뛰는 폴더·확장자)으로 본 상대경로.
 *
 * 폴더마다 돌아가며 뽑는다. 하위 폴더가 재료별이면 앞에서 20개를 끊었을 때 첫 폴더만
 * 보이고, 그 규칙은 둘째 폴더에서 틀린다. 큰 트리는 중간에 멈춘다 — 미리보기다. */
export function previewPaths(
  source: Pick<Source, "path" | "recursive" | "extensions" | "moveAfterSendTo">,
  limit: number,
): string[] {
  const byDir = new Map<string, string[]>();
  let seen = 0;
  for (const file of walk(source.path, source.recursive, source.moveAfterSendTo, [])) {
    const ext = path.extname(file).toLowerCase();
    if (source.extensions.length && !source.extensions.includes(ext)) continue;
    const dir = path.dirname(file);
    const list = byDir.get(dir) ?? [];
    if (list.length < limit) {
      list.push(path.relative(source.path, file).split(path.sep).join("/"));
      byDir.set(dir, list);
    }
    if (++seen >= 5000 || byDir.size >= 200) break;
  }
  const out: string[] = [];
  const groups = [...byDir.values()];
  for (let i = 0; out.length < limit && groups.some((g) => i < g.length); i++)
    for (const g of groups) if (i < g.length && out.length < limit) out.push(g[i]!);
  return out;
}
