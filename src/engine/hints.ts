/** 경로 규칙 → 힌트(개발계획 §4). 클라이언트는 확정하지 않고 힌트만 보낸다.
 *
 * 규칙은 **소스 폴더 기준 상대경로**(구분자 `/`)에 댄다. 장비마다 정보가 폴더 계층에
 * 있기도, 파일명에 있기도, 둘에 나뉘어 있기도 하다 — 상대경로 하나에 규칙을 대면 셋 다
 * 규칙 하나로 적힌다. `SUS304/LotA/tensile_01.tra` 처럼.
 *
 * 규칙은 두 문법 중 하나. 현장에서 고치는 사람이 정규식을 모른다는 전제다.
 *
 * - **템플릿**(기본): `{material_code}/{lot}/*_{specimen}.tra`
 *   `{키}` 가 힌트 자리, `*` 는 폴더 한 단계 안의 아무 글자, `**` 는 폴더 여러 단계.
 *   나머지는 글자 그대로. `{키:정규식}` 으로 자리 하나의 모양을 좁힐 수 있다.
 *   `/` 가 없으면 깊이와 상관없이 **파일명에만** 댄다 — 하위 폴더 포함이어도 시편만 뽑는
 *   규칙을 그대로 쓴다. 대소문자는 안 가린다(`.TRA` 도 `.tra`).
 * - **정규식**: 이름 있는 그룹 `(?<material_code>...)` 이 하나라도 있으면 정규식으로 본다.
 *   상대경로에 그대로 댄다(앵커 없음).
 *
 * 규칙에 맞지 않는 파일은 막지 않는다 — 힌트 없이 간다. 서버 수집함이 받는다. */

import { HINT_KEYS, type HintKey } from "@shared/hint-keys";

export type Hints = Partial<Record<HintKey, string>>;
export type RuleKind = "template" | "regex";

export interface RuleCheck {
  ok: boolean;
  kind: RuleKind;
  error?: string;
  /** 규칙이 뽑는 힌트 키(힌트 집합 안의 것만). 비어 있으면 규칙이 아무것도 안 뽑는다. */
  keys: HintKey[];
  /** 힌트 키 집합 밖의 자리 이름. 오타를 GUI 가 경고한다. */
  unknownGroups: string[];
}

interface Compiled {
  kind: RuleKind;
  re: RegExp;
  /** 템플릿에 `/` 가 없다 — 파일명에만 댄다. */
  nameOnly: boolean;
  groups: string[];
}

/** 전역 플래그 정규식은 lastIndex 를 들고 다닌다 — 부를 때마다 새로 만든다. */
const namedGroups = (rule: string) => [...rule.matchAll(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g)].map((m) => m[1]!);
/** `{key}` 또는 `{key:pattern}`. pattern 안의 중괄호는 `\d{2}` 처럼 한 겹까지. */
const placeholders = (t: string) => t.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)(?::((?:[^{}]|\{[^{}]*\})*))?\}/g);

export function ruleKind(rule: string): RuleKind {
  return namedGroups(rule).length ? "regex" : "template";
}

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 템플릿 → 정규식 소스. 자리 밖의 글자는 그대로 맞춘다. */
function templateToRegex(template: string): { source: string; groups: string[]; hasSeparator: boolean } {
  const groups: string[] = [];
  let out = "";
  let last = 0;
  let literals = "";
  for (const m of placeholders(template)) {
    literals += template.slice(last, m.index);
    out += literalPart(template.slice(last, m.index));
    const [, name, pattern] = m;
    groups.push(name!);
    out += `(?<${name}>${pattern !== undefined && pattern !== "" ? pattern : "[^/]+?"})`;
    last = m.index + m[0].length;
  }
  literals += template.slice(last);
  out += literalPart(template.slice(last));
  return { source: `^${out}$`, groups, hasSeparator: /[/\\]/.test(literals) };
}

/** 자리 사이의 글자 그대로 부분. `\` 는 `/` 로 받아 준다 — 사람은 탐색기 경로를 붙여 넣는다.
 * `**\/` → 폴더 0단계 이상, `**` → 아무 글자(폴더 넘어서), `*` → 폴더 한 단계 안. */
function literalPart(s: string): string {
  const star = (seg: string) => seg.split("*").map(escapeLiteral).join("[^/]*");
  return s
    .replace(/\\/g, "/")
    .split("**/")
    .map((part) => part.split("**").map(star).join(".*"))
    .join("(?:.*/)?");
}

function compile(rule: string): Compiled | { error: string; kind: RuleKind } {
  const kind = ruleKind(rule);
  try {
    if (kind === "regex") return { kind, re: new RegExp(rule), nameOnly: false, groups: namedGroups(rule) };
    const { source, groups, hasSeparator } = templateToRegex(rule);
    return { kind, re: new RegExp(source, "i"), nameOnly: !hasSeparator, groups };
  } catch (e) {
    return { error: (e as Error).message, kind };
  }
}

export function checkRule(rule: string): RuleCheck {
  const c = compile(rule);
  if ("error" in c) return { ok: false, kind: c.kind, error: c.error, keys: [], unknownGroups: [] };
  const isKey = (g: string): g is HintKey => (HINT_KEYS as readonly string[]).includes(g);
  return {
    ok: true,
    kind: c.kind,
    keys: [...new Set(c.groups.filter(isKey))],
    unknownGroups: [...new Set(c.groups.filter((g) => !isKey(g)))],
  };
}

/** 소스 기본값 위에 규칙의 값을 덮는다 — 파일이 말한 것이 설정보다 구체적이다.
 * 기본값은 어느 키든 될 수 있다(「이 폴더는 전부 80 °C」·「전부 의뢰 12」). */
export function mergeHints(defaults: Partial<Record<HintKey, string | null>>, fromPath: Hints): Hints {
  const out: Hints = {};
  for (const key of HINT_KEYS) {
    const value = defaults[key];
    if (value) out[key] = value;
  }
  return { ...out, ...fromPath };
}

/** @param relativePath 소스 폴더 기준 상대경로, 구분자 `/`. 엔진은 `toRelativePath` 로 만든다. */
export function extractHints(rule: string | null, relativePath: string): Hints {
  if (!rule) return {};
  const c = compile(rule);
  if ("error" in c) return {};
  const subject = c.nameOnly ? relativePath.slice(relativePath.lastIndexOf("/") + 1) : relativePath;
  const m = c.re.exec(subject);
  if (!m?.groups) return {};
  const hints: Hints = {};
  for (const key of HINT_KEYS) {
    const value = m.groups[key];
    if (value !== undefined && value !== "") hints[key] = value;
  }
  return hints;
}

/** 절대경로 → 규칙에 댈 상대경로. `node:path` 를 안 쓴다 — 렌더러도 이 파일을 본다.
 * root 밖의 파일(있을 수 없지만)은 파일명만 남긴다. */
export function toRelativePath(root: string, file: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const f = norm(file);
  if (f.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return f.slice(r.length + 1);
  return f.slice(f.lastIndexOf("/") + 1);
}
