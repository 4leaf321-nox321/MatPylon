/** 힌트 키 — 파일명 규칙의 그룹 이름이 될 수 있는 것. 서버 계약(개발계획 §4)과 같다.
 * 엔진과 화면이 둘 다 보므로 shared 에 둔다.
 *
 * 서버(MatNexus `pipelines/models.py` HINT_KEYS)와 **같은 목록**이어야 한다 — 한쪽만
 * 늘리면 여기서 뽑아 보낸 것을 서버가 조용히 버린다. 일곱에서 스물넷으로 늘린 까닭
 * (2026-09-20): 파일 **밖**(폴더·파일명)에 있는 정보가 재료·시료·시편의 칸과 하나씩
 * 맞는데 받을 자리가 없어 서버 수집함에서 「후보 여럿」 으로 섰다. */
export const HINT_KEYS = [
  // 재료
  "material_code",
  "material_no", // M-000123 — 이름은 바뀌어도 번호는 안 바뀐다
  "thickness", // 0.8 · 0.8t · 0.8mm — 같은 등급 다른 두께를 가른다
  "details", // 재료 이름의 가운데 토막(MDOI …)
  "legacy_id", // 옛 시스템 ID
  // 시료
  "lot",
  "sample", // 시료 번호(01) 또는 이름
  "sample_alias",
  "manufacturer",
  "production_date",
  // 시편
  "specimen", // 이름 전체든 끝자리(MD_01)든
  "specimen_seq",
  "orientation",
  "standard",
  // 시험
  "test_type", // tensile · dma … 프로파일 감지가 갈릴 때 먼저 볼 종류
  "temperature", // 80C · -40 · 353K — 단위 없으면 °C
  "humidity", // 85 · 85%RH
  "commission", // 의뢰 번호 — 서버는 잇지 않고 그 건을 먼저 보인다
  "repeat", // 재시험 표시(r2 …)
  "division",
  "tested_at",
  "operator",
  "instrument",
  // 통째
  "record_name", // SECC_MDOI_1.0__01__MD_01(__TEN_02) — 이름 규칙으로 한 번에
] as const;
export type HintKey = (typeof HINT_KEYS)[number];

/** 화면 단추에 쓰는 우리말. 규칙에 들어가는 이름은 영문 키 그대로다. */
export const HINT_LABELS: Record<HintKey, string> = {
  material_code: "재료",
  material_no: "재료 번호",
  thickness: "두께",
  details: "재료 상세",
  legacy_id: "옛 ID",
  lot: "로트",
  sample: "시료",
  sample_alias: "시료 별칭",
  manufacturer: "업체",
  production_date: "생산일",
  specimen: "시편",
  specimen_seq: "시편 번호",
  orientation: "방향",
  standard: "규격",
  test_type: "시험 종류",
  temperature: "온도",
  humidity: "습도",
  commission: "의뢰 번호",
  repeat: "재시험",
  division: "사업부",
  tested_at: "시험일",
  operator: "시험자",
  instrument: "장비",
  record_name: "이름 통째",
};

/** 화면 단추의 묶음 — 스물넷을 한 줄로 늘어놓으면 고르기 어렵다. */
export const HINT_GROUPS: ReadonlyArray<{ label: string; keys: readonly HintKey[] }> = [
  { label: "재료", keys: ["material_code", "material_no", "thickness", "details", "legacy_id"] },
  { label: "시료", keys: ["lot", "sample", "sample_alias", "manufacturer", "production_date"] },
  { label: "시편", keys: ["specimen", "specimen_seq", "orientation", "standard"] },
  {
    label: "시험",
    keys: ["test_type", "temperature", "humidity", "commission", "repeat", "division", "tested_at", "operator", "instrument"],
  },
  { label: "통째", keys: ["record_name"] },
];
