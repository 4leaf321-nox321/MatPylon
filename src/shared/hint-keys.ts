/** 힌트 키 — 파일명 규칙의 그룹 이름이 될 수 있는 것. 서버 계약(개발계획 §4)과 같다.
 * 엔진과 화면이 둘 다 보므로 shared 에 둔다. */
export const HINT_KEYS = [
  "material_code",
  "lot",
  "specimen",
  "orientation",
  "tested_at",
  "operator",
  "instrument",
] as const;
export type HintKey = (typeof HINT_KEYS)[number];
