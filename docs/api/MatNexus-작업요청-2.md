# MatNexus 에 요청하는 것 (2) — 파일명 규칙을 서버 데이터와 대조하기

2026-08-28. 첫 요청서([MatNexus-작업요청.md](MatNexus-작업요청.md))의 `pipelines` 모듈은
v1.143.0 으로 나왔고 실서버로 한 바퀴 돌았다. 이 문서는 그 위에 얹는 **둘**이다.
계약의 정본은 [matpylon-openapi.yaml](matpylon-openapi.yaml) 의 `/pipelines/resolve` ·
`/pipelines/reference` 다.

## 왜

실연결에서 힌트 `SECC / LOT-A / MD1` 이 `needs_specimen` 으로 떨어졌다. 실제 데이터는
`SECC_MDOI_1.0 / 01 / MD_01` 이었다. **규칙을 만드는 사람이 그 이름을 볼 수 없었다** —
파일명 규칙은 MatPylon 화면에서 만드는데, 맞춰야 할 이름은 MatNexus 에 있다.

그래서 MatPylon 의 소스 편집기(파일명 규칙 미리보기)에 두 가지를 붙인다.

1. **대조** — 폴더의 파일 20개에서 뽑은 힌트를 서버에 보내 "이 힌트면 어느 시편에 붙나 /
   왜 안 붙나" 를 받아 파일 옆에 보여 준다. 규칙을 고치면 즉시 다시 물어본다.
2. **참조** — 부서의 재료 → 시료(로트) → 시편 이름을 트리로 보여 준다. 파일명이 어느 이름과
   맞아야 하는지 보면서 정규식을 잡는다.

**매칭 규칙은 워커 한 군데에만 있어야 한다.** MatPylon 이 재료 목록을 받아 스스로 맞추면
규칙이 두 벌이 되고, 워커가 바뀔 때 화면은 옛 규칙으로 "붙는다" 고 말한다. 그래서 ①은
워커와 **같은 함수**를 부르는 엔드포인트로 만든다.

## ① `POST /api/pipelines/resolve` — 힌트 → 시편 후보

```json
// 요청
{
  "workspace_id": "3b8e5d68-…",
  "hints": [
    {"material_code": "SECC_MDOI_1.0", "lot": "01", "specimen": "MD_01"},
    {"material_code": "SECC", "lot": "LOT-A", "specimen": "MD1"},
    {}
  ]
}
// 응답 — 요청과 같은 순서, 같은 개수
{
  "results": [
    {"outcome": "unique",
     "candidate": {"specimen_id": "aa3b…", "specimen_name": "SECC_MDOI_1.0__01__MD_01",
                   "material_name": "SECC_MDOI_1.0", "sample_name": "01",
                   "reason": "재료 이름 · 로트 · 시편 이름 일치"}},
    {"outcome": "none",      "reason": "'SECC' 에 로트 'LOT-A' 인 시료가 없습니다."},
    {"outcome": "none",      "reason": "재료 코드 힌트가 없습니다."}
  ]
}
```

- `outcome`: `unique`(자동 등록됨) · `multiple`(후보 여럿 → `candidates[]`, 수집함행) ·
  `none`(0건, `reason`) — 워커가 `registered` / `needs_specimen` 을 가르는 것과 같은 판정.
- **워커의 후보 함수를 그대로 부른다** (`services` 에 있는 것을 라우트에서 호출). 새 규칙을
  만들지 않는다. 그래야 화면이 "붙는다" 고 한 것이 실제로 붙는다.
- 한 번에 최대 **50개**. 화면은 20개를 보낸다.
- 권한: 그 부서의 구성원. 읽기만 하고 아무것도 만들지 않는다.
- 파일 없이 힌트만으로 판정하므로 프로파일 `identity`(파일 메타)는 못 본다 — 그것은 반입
  뒤 워커가 한다. 응답에 그 사실을 적어 두지 않아도 된다; MatPylon 화면이 "파일 안의
  identity 가 힌트를 이깁니다" 라고 안내한다.

## ② `GET /api/pipelines/reference?workspace_id=…` — 재료 → 시료 → 시편 이름 트리

```json
{
  "materials": [
    {"id": "…", "name": "SECC_MDOI_1.0", "grade": "SECC", "aliases": ["SECC-1.0"],
     "samples": [
       {"id": "…", "lot": "01",
        "specimens": [{"id": "aa3b…", "name": "MD_01", "orientation": "MD"}, …]}
     ]}
  ],
  "generated_at": "2026-08-28T…"
}
```

- **이름만** 있으면 된다 — 화면이 참조로 보는 것이지 편집하지 않는다. 기존 `materials`
  API 를 세 번 부르면 되지만, 규칙 편집기가 열릴 때마다 N+1 로 부르는 것보다 한 번에
  주는 쪽이 싸다. 부서 하나가 수천 시편이면 `materials[].samples[].specimens[]` 를 이름만
  실어도 수백 KB 안이다.
- `aliases` 는 워커가 `material_code` 를 맞출 때 보는 것과 같은 집합(이름·grade·별칭).
  화면이 "이 셋 중 하나와 같아야 붙는다" 고 보여 준다.
- 삭제된 것(`deleted_at`)은 뺀다. 권한은 ①과 같다.

## MatPylon 쪽 (이쪽 일 — 참고)

- 소스 편집기 미리보기 표에 「MatNexus 대조」 열: ✔ 시편 이름 / ⚠ 후보 N개 / ✖ 이유
- 참조 패널: ② 의 트리. 이름을 누르면 정규식 예시를 만들어 준다
- **소스 기본값**: "이 폴더 파일은 전부 재료 X · 로트 Y" 를 소스에 고정하고 파일명에서
  시편만 뽑는 옵션. 힌트를 합쳐 보낼 뿐이라 **서버 변경 없음** — 장비가 시편 번호만
  파일명에 적는 현장을 위한 것이다.
- 서버 연결이 안 됐거나 ①②가 아직 없으면(404) 지금처럼 힌트만 보인다.

## 안 하는 것

- 화면에서 시편을 **만들기** — 없는 시편은 MatNexus 에서 만든다. 오타로 유령 시편이
  생기는 병(ADR 0004)을 여기서 다시 만들지 않는다.
- 클라이언트 쪽 매칭 — 위 "왜" 참조.
