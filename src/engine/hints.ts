/** 파일명 규칙 → 힌트(개발계획 §4). 클라이언트는 확정하지 않고 힌트만 보낸다.
 *
 * 규칙에 맞지 않는 파일은 막지 않는다 — 힌트 없이 간다. 서버 수집함이 받는다. */

import { HINT_KEYS, type HintKey } from "./config";

export type Hints = Partial<Record<HintKey, string>>;

export interface RuleCheck {
  ok: boolean;
  error?: string;
  /** 힌트 키 집합 밖의 그룹 이름. 오타를 GUI 가 경고한다. */
  unknownGroups: string[];
}

const GROUP_NAME = /\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g;

export function checkRule(rule: string): RuleCheck {
  try {
    new RegExp(rule);
  } catch (e) {
    return { ok: false, error: (e as Error).message, unknownGroups: [] };
  }
  const groups = [...rule.matchAll(GROUP_NAME)].map((m) => m[1]!);
  const unknownGroups = groups.filter((g) => !(HINT_KEYS as readonly string[]).includes(g));
  return { ok: true, unknownGroups };
}

export function extractHints(rule: string | null, filename: string): Hints {
  if (!rule) return {};
  let re: RegExp;
  try {
    re = new RegExp(rule);
  } catch {
    return {};
  }
  const m = re.exec(filename);
  if (!m?.groups) return {};
  const hints: Hints = {};
  for (const key of HINT_KEYS) {
    const value = m.groups[key];
    if (value !== undefined && value !== "") hints[key] = value;
  }
  return hints;
}
