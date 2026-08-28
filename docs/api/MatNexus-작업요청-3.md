# MatNexus 에 요청하는 것 (3) — 자동 등록에 승인을 넣는다

2026-08-29. v1.146.0(resolve·reference) 위에 얹는 것. 계약의 정본은
[matpylon-openapi.yaml](matpylon-openapi.yaml) 의 `auto_register` · `suggested` · `approve` 다.

## 왜

지금 워커는 후보가 하나로 좁혀지면 **승인 없이** `TestRun` 을 만든다(요청서 1 의 정의 그대로).
그런데 파일명 규칙이 "틀리게 맞으면" — 다른 재료를 잡았는데 하필 시편 하나로 좁혀지면 —
엉뚱한 시편에 시험이 붙고, 사람은 나중에야 안다. 재료·시편을 보수적 기본값으로 지킨 것
(없는 시편을 만들지 않는다, ADR 0004)과 같은 이유로, **자동 등록도 기본은 승인 대기**여야 한다.

규칙이 검증된 커넥터는 승인이 요식이 된다. 그래서 켜고 끌 수 있게 한다 — 파일럿 초기엔
승인 대기, 대조 열이 한동안 전부 맞으면 그 커넥터만 자동으로.

## ① 커넥터에 `auto_register` (기본 **false**)

- `pipeline_connectors` 에 칼럼 하나 (마이그레이션 1건).
- `POST /pipelines/connectors` 요청에 `auto_register?: boolean = false`,
  `PATCH` 로 변경 가능, `ConnectorOut` 에 포함.
- 기존 행은 마이그레이션에서 **false** 로 — 지금 도는 커넥터가 갑자기 승인 대기로 바뀌는
  것이 맞다. 아직 파일럿 전이라 실제로 잃는 것이 없고, 기본값의 뜻과 일치한다.

## ② 워커 — 후보 하나일 때의 갈림

```
후보 1  + auto_register=true   → registered (지금과 같음)
후보 1  + auto_register=false  → suggested — 후보를 candidates[0] 에 담아 두고 승인 대기
후보 0 / 2+                     → needs_specimen (지금과 같음)
```

- `suggested` 를 `InboxStatus` 에 추가. 알림은 `needs_specimen` 과 같은 수신자에게,
  다만 묶어서 — "승인 대기 N건" (한 배치 20건이 알림 20개가 되면 아무도 안 읽는다).
- resolve(요청서 2)는 그대로 `unique` 를 돌려준다 — "규칙이 맞으면 하나로 좁혀진다" 는
  판정은 승인과 무관하다. 화면 문구는 MatPylon 이 커넥터의 `auto_register` 를 보고 바꾼다.

## ③ 승인

**한 건** — 기존 `assign` 을 그대로 쓴다. `suggested` 항목에 `assign` 하면 등록.
화면이 후보를 미리 채워 주면 사람은 확인하고 누를 뿐이다. 다른 시편으로 바꿔 붙일 수도
있어야 하므로 `assign` 이 자연스럽다. (`suggested` 가 `assign` 을 받도록 상태 검사에 추가.)

**여럿** — `POST /api/pipelines/inbox/approve`

```json
// 요청
{ "item_ids": ["…", "…"] }          // ≤100, 전부 suggested 여야 하는 것은 아니다
// 응답 — 되는 것은 하고, 안 된 것은 이름을 말한다 (일괄 작업 규칙 그대로)
{ "results": [
    {"item_id": "…", "ok": true,  "test_run_id": "…", "test_run_name": "…"},
    {"item_id": "…", "ok": false, "reason": "이미 registered 된 항목입니다."},
    {"item_id": "…", "ok": false, "reason": "suggested 상태가 아닙니다."}
] }
```

- 각 항목은 저장해 둔 `candidates[0]` 로 등록한다. 한 건이 막혀도 나머지는 진행.
- 권한: assign 과 같음(부서 manager).

## ④ 화면 (저쪽)

- 수집함 목록에 `suggested` 필터. 항목에 제안된 시편 이름이 보이고, 체크박스로 여럿 골라
  「승인」. 커넥터 탭에 `auto_register` 토글.
- 커넥터 카드의 대기 수에 `suggested` 도 세면 좋다(안 세면 "다 됐다" 로 보인다).

## MatPylon 쪽 (이쪽 일 — 참고)

- 「서버」 탭 커넥터에 토글 "후보가 하나면 자동 등록"(기본 꺼짐) → `PATCH auto_register`.
- 대조 열 문구: `auto_register` 가 꺼져 있으면 `unique` 를 「승인 대기(후보 1)」 로,
  켜져 있으면 지금처럼 「자동 등록」 으로 보여 준다.
- 서버가 아직 이 요청을 반영하지 않았으면(응답에 `auto_register` 없음) 토글을 숨긴다.

## 안 하는 것

- 승인 없이 자동 등록을 아예 없애기 — 검증된 규칙에는 승인이 요식이다. 커넥터 단위 선택이 맞다.
- `registered` 의 사후 취소 흐름 추가 — 이미 시험 삭제가 있다. 새 길을 만들지 않는다.
