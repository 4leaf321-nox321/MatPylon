# MatNexus 에 요청하는 것 — `pipelines` 모듈

MatPylon(장비 PC 수집 에이전트)이 붙으려면 MatNexus 에 이것이 있어야 한다.
계약의 정본은 [matpylon-openapi.yaml](matpylon-openapi.yaml) 이다. 이 문서는 그것을
**어디에 어떻게** 만들지에 대한 제안이고, 결정은 MatNexus 쪽이 한다.

MatPylon 은 P2 까지 목 서버로 검증돼 있다(`tests/engine/matnexus.test.ts`). 이 계약대로
만들면 바로 붙는다.

## 왜 이 모양인가 — 셋

1. **파싱은 서버가 한다.** MatPylon 은 원본만 보낸다. ADR 0005(형식 프로파일)와
   ADR 0017("곡선을 API 로 직접 꽂지 않는다")의 결정을 그대로 따른 것이다.
2. **시편을 만들지 않는다.** 클라이언트는 힌트만 보내고, 서버가 후보를 좁히고, 하나로
   안 정해지면 사람이 붙인다. 오타 하나로 유령 시편이 생기는 병을 피한다.
3. **서버 원장이 정본이다.** 같은 sha256 이 이미 있으면 409 로 기존 id 를 돌려주고,
   MatPylon 은 그것을 "보냄" 으로 닫는다. 앱이 죽었다 살아나도 두 번 등록되지 않는다.

## 만들 것

### 모듈 — `app/modules/pipelines/` ↔ `frontend/src/modules/pipelines/`

개발계획 §구조에 이미 예약된 이름이다. 모듈끼리 직접 부르지 않는다는 규칙대로,
`tests` 모듈의 업로드 경로는 `shared` 를 거치거나 `tests.services` 의 공개 함수를 쓴다
(`services.get_test_type` · `next_run_seq` · `parse_run` 처럼 이미 있는 것).

### 테이블 — 둘

```
pipeline_connectors
  id · workspace_id(FK) · name · hostname · is_active
  app_version · last_seen_at · next_run_at · last_heartbeat(JSONB: sources[])
  created_by_id · created_at · deleted_at
  UNIQUE(workspace_id, hostname)          ← 재등록은 기존 것을 돌려준다

pipeline_inbox_items
  id · connector_id(FK) · source_key · status
  filename · size · sha256 · client_path · mtime · hints(JSONB)
  source_path(filestore 상대경로) · test_type_id(FK,null) · profile_id(FK,null)
  test_run_id(FK,null) · candidates(JSONB) · summary(JSONB) · error
  received_at · resolved_at · resolved_by_id · discard_reason
  INDEX(sha256) · INDEX(status, connector_id)
```

`app/all_models.py` 에 import 를 추가한다(안 하면 autogenerate 가 테이블을 지운다).
의존성 레지스트리(`shared/dependents.py`)에 `connector → inbox_items` 를 먼저 등록한다 —
삭제 기능을 만들기 전에.

### 파일 — `filestore/inbox/YYYY/MM/<item_id>/source/<파일명>`

기존 `filestore.save_stream` 그대로. `registered` 가 되면 `test-runs/…/source/` 로
**이동**한다(복사 아님 — 원본은 한 곳에만). 정리 잡(`TESTS_CLEANUP_STORAGE`)이
`discarded`·`registered` 된 inbox 폴더를 보존 기간 뒤 지운다.

### 워커 핸들러 — `kinds.PIPELINES_PARSE_INBOX`

```
1. 프로파일 감지     tests.routes.detect_test_type 의 로직을 services 로 올려 공유
2. 파싱             profiles.apply(profile, data) → ParsedTest
3. 후보 조회         identity(ParsedTest.identity) + hints 로
                     Material.code → Sample.lot → Specimen.name 순으로 좁힌다
                     둘 다 있으면 identity 가 우선(파일이 증거, 힌트는 이름표)
4. 후보 1개          기존 upload_test_run 의 몸통을 services 함수로 뽑아 재사용
                     → TestRun 생성 + parse 큐 (또는 이미 파싱했으니 결과를 바로 저장)
5. 0 또는 2+         needs_specimen · notifications 로 부서 관리자에게
```

**후보 조회 규칙은 처음엔 좁게.** `material_code` 가 없으면 후보를 만들지 않는다 —
시편 이름만으로 전 부서를 뒤지면 엉뚱한 재료에 붙는다.

### 오류 코드 — `MNX-PIPE-*`

| 코드 | 상태 | 뜻 |
|---|---|---|
| 0001 | 404 | 커넥터 없음·비활성 |
| 0002 | 404 | 소스 키 모름 (heartbeat 로 온 적 없는 키) — **1차는 안 막아도 됨**, 그냥 받는다 |
| 0003 | 400 | 해시 불일치 |
| 0004 | 409 | 같은 내용 있음 — `details.existing_id`, `details.existing_kind` |
| 0005 | 403 | 그 부서 구성원 아님 |
| 0006 | 400 | hints 가 JSON 객체 아님 |
| 0007 | 409 | 이미 registered/discarded 된 항목에 assign |

### 화면 — `/admin/pipelines`

| 탭 | 내용 |
|---|---|
| 커넥터 | 이름·호스트·마지막 heartbeat(시간 색으로: 2주기 넘으면 주황, 하루 넘으면 빨강)·대기·실패 |
| 수집함 | `needs_specimen` 기본 필터. 항목을 열면 파싱 요약·후보 목록·시편 검색 → 붙이기 / 버리기 |
| 실패 | `failed` — 오류와 프로파일 링크. 프로파일 고친 뒤 「다시 파싱」 |

### 권한

- 커넥터 등록·heartbeat·inbox POST: 그 부서의 `member` 이상 (PAT 주인 기준)
- 수집함 assign·discard·retry: 그 부서의 `manager` (재료·프로파일을 만드는 역할과 같다, ADR 0006)
- 목록 조회: 가시 범위 규칙 그대로

## 순서 제안

1. 테이블·모델·마이그레이션·`all_models` · `dependents`
2. `POST /connectors` · `heartbeat` · `POST /inbox`(저장까지만, 워커 없이 `received`)
   → **여기서 MatPylon 을 실서버에 붙여 본다.** 파일이 filestore 에 떨어지면 절반이다
3. 워커 핸들러 — 감지·파싱·후보·자동 등록
4. 수집함 화면 — assign·discard·retry
5. `export_openapi.py` 결과와 `matpylon-openapi.yaml` 대조 테스트

## MatPylon 쪽에서 미리 알려 둘 것

- `file` 파트는 multipart 의 **마지막**이다. FastAPI `UploadFile` 이 스트리밍으로 받는다.
- `hints` 는 문자열 파트(JSON 문자열)로 온다. `Form(...)` 으로 받아 `json.loads`.
- `mtime` 은 ISO 8601 UTC(`2026-08-28T05:12:00.000Z`).
- 타임아웃은 요청당 60초. 그 안에 202 를 못 주면 MatPylon 은 retry 로 두고 다시 보낸다 —
  그래서 409 가 필요하다.
- heartbeat 는 배치마다 온다. 기본 주기 1시간, 최소 1분.
