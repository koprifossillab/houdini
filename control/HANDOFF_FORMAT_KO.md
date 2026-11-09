# 인계 카드 tc-handoff/1 — 팀 제공용 규격 (④ 관제실 담당, 2026-11-10 · TC-HANDOFF-002)

감독 지시 TC-HANDOFF-001 · TC-HANDOFF-002 · TC-DASH-004 D-1 에 따른 작업 상태 기록 규격이다.
관제실은 기록을 **읽기만** 한다. 기록이 없거나, 근거가 없거나, 오래되면 상태를 추정하지 않고 '미확인'으로 둔다.

## 0. 팀별 한눈에

| 팀 | 어디에 기록하나 | 형식 | 관제실 표시 | 검증 방법 |
|---|---|---|---|---|
| ① TC-PROD | 서버 `<카드 폴더>/TC-PROD/` | tc-handoff/1 카드 파일 | 직접 작성 (작성자 신원 미검증) | `check-card.mjs` (§5) |
| ② TC-QA | 서버 `<카드 폴더>/TC-QA/` | tc-handoff/1 카드 파일 | 직접 작성 (작성자 신원 미검증) | `check-card.mjs` (§5) |
| ③ TC-WORK | **서버에 직접 쓰지 않는다** — 기존 서명 Work 기록 제출 경로 그대로 | tc-work-event/1 서명 봉투 | 서명 확인 (무결성만 · 신원 증명 아님) | 접수기의 서명·순번 검증 + 접수 응답의 `event_hash` (§3) |
| ③ (서명 없는 보고) | ④ 가 `<카드 폴더>/TC-WORK/` 에 옮겨 적음 | tc-handoff/1 전사 카드 | 전사 (확정 아님) | ④ 가 `check-card.mjs` 로 확인 |
| ④ 관제실 | 서버 `<카드 폴더>/TC-DASH/` | tc-handoff/1 카드 파일 | 직접 작성 | `check-card.mjs` |

`<카드 폴더>` 의 실제 위치는 감독 전달문에 적는다(공개 저장소에는 서버 경로를 쓰지 않는다).

## 1. 공통 — 언제 기록하나

1. 지시를 받아 작업을 **시작**할 때 — `in_progress` (③: `start` 이벤트)
2. **상태가 바뀔 때** — 넘김 `handed_off`, 차단 `blocked`, 완료 `done` (③: `progress` / `complete`)
3. **완료 또는 감독 판정 요청** 때 — 보고 끝 4줄과 같은 내용
4. **오래 걸리는 작업**에서 새 진행 근거가 생겼을 때 — 새 근거를 붙인 `in_progress` (③: `progress`)

진행 중 기록은 2시간 안에 새 기록이 없으면 화면에서 '미확인'으로 내려간다(의도된 동작).
기록 작성을 이유로 제작·QA 절차를 바꾸거나 작업을 다시 시작하지 않는다.

## 2. ①·②·④ — 카드 파일

### 2.1 저장 위치와 파일 이름

```
<카드 폴더>/<팀>/<YYYYMMDD-HHMM>_<작업번호>.json      예) <카드 폴더>/TC-QA/20261110-1405_TC-VIS-030.json
```

- 자기 팀 폴더에만 쓴다. 폴더와 `team` 이 다르면 관제실이 받지 않는다.
- **덧붙이기만** 한다. 이미 쓴 카드를 고치거나 지우지 않는다. 바뀐 내용은 새 카드로 쓴다. 최신 카드는 `at` 으로 정한다.
- 파일은 다른 사용자도 읽을 수 있는 권한(기본 umask 그대로, 예 `-rw-rw-r--`)이어야 관제실이 읽는다.

### 2.2 필드

| 필드 | 필수 | 값 | 보고 4줄과의 대응 |
|---|---|---|---|
| `schema` | **필수** | `"tc-handoff/1"` | |
| `team` | **필수** | `TC-PROD` · `TC-QA` · `TC-DASH` (폴더와 같게) | 관등성명 |
| `task_id` | **필수** | 감독 지시 번호 `TC-XXX-000`, 예 `TC-VIS-030` | 현재 작업 |
| `title` | **필수** | 한 줄 제목 | 현재 작업 |
| `state` | **필수** | `in_progress` · `handed_off` · `blocked` · `done` | 상태 |
| `at` | **필수** | 이 카드 내용이 사실이 된 시각 (ISO 8601 + 시간대) | |
| `evidence` | **필수(실질)** | `[{ "kind": "report·nas·file·commit", "ref": "…", "sha256": "…(선택)", "at": "…(선택)" }]` — 비우면 "근거 없는 카드"로 표시되고 진행 중으로 치지 않음 | |
| `to` | 넘김·차단이면 **필수** | `TC-PROD` · `TC-QA` · `TC-WORK` · `TC-DASH` · `director` · `user` | 전달받을 팀 |
| `done` | 권장 | 완료한 작업 | 완료한 작업 |
| `next` | 권장 | 다음 작업 | 다음 작업 |
| `user_action` | 선택 | 사용자가 직접 할 일, 없으면 `null` | 사용자 직접 조치 |
| `verdict` | 판정이 있으면 | `PASS` · `FAIL` · `REVIEW` · `UNVERIFIED` — **상태가 아니다** | |
| `verdict_scope` | verdict 와 함께 | `technical` · `visual` · `physics` · `selfcheck` · `run` | |
| `candidate` | 후보 작업이면 | 후보 이름 — 후보의 FAIL 은 그 후보에만 붙고 기준본 표시는 바뀌지 않음 | |
| `issues` | 선택 | `[{ "id", "title", "scope": "project·candidate·track", "candidate", "severity": "blocking·fail·review·known", "resolved" }]` | |
| `author` | 권장 | `{ "method": "self", "session": "세션 이름(선택)" }` — §4 | |

### 2.3 예 — ① TC-PROD

```json
{ "schema": "tc-handoff/1", "team": "TC-PROD", "task_id": "TC-VIS-030", "title": "v6.5h 조명 시험 3장",
  "state": "handed_off", "verdict": "PASS", "verdict_scope": "selfcheck", "candidate": null,
  "done": "Karma 정지 3장 렌더 · 자체 검사 통과", "next": "② QA 실행 검증", "to": "TC-QA", "user_action": null,
  "evidence": [{ "kind": "nas", "ref": "<영상 폴더>/TC3D_..._RAW_PRESERVED", "at": "2026-11-10T13:06:00+09:00" }],
  "author": { "method": "self", "session": "TC-PROD-20261110" },
  "at": "2026-11-10T13:10:00+09:00" }
```

### 2.4 예 — ② TC-QA

```json
{ "schema": "tc-handoff/1", "team": "TC-QA", "task_id": "TC-VIS-030", "title": "조명 시험 3장 실행 검증",
  "state": "done", "verdict": "PASS", "verdict_scope": "technical", "candidate": "v6.5h 조명 시험",
  "done": "실행 기록·해시 재현 · FAIL 없음 (시각 승인 아님)", "next": "③ 시각 검토", "to": "TC-WORK", "user_action": null,
  "evidence": [{ "kind": "report", "ref": "QA_TC3D_..._KO.md", "sha256": "<보고서 SHA-256 64자리>" }],
  "author": { "method": "self", "session": "TC-QA-20261110" },
  "at": "2026-11-10T14:05:00+09:00" }
```

## 3. ③ TC-WORK — 서명 Work 기록 (서버에 직접 쓰지 않음)

③ 은 서버 밖에서 일하므로 카드 폴더에 쓴다고 가정하지 않는다. 지금 쓰고 있는 **서명 Work 기록 `tc-work-event/1`** 을 그대로 쓴다.
관제실은 그 기록을 **읽기 전용으로 변환**해 카드처럼 보여 준다. ③ 이 새로 할 일은 없다(아래 3.4 권장만).

### 3.1 흐름

```
③ Work  ─ 서명(ed25519) ─→  봉투 { payload_b64, signature_b64 }
        ─ SSH 표준입력 ─→  서버 접수기 work-intake.mjs  (서명 · 순번 · previous_hash 사슬 · 제출 시각 5분 창 · 작업 전이 검증)
                            ├─ 이력 보관 (append-only, 순번-해시 이름)            ← 관제실은 읽지 않음
                            └─ 공개용 최신 봉투 4개: 최신 · 작업 시작 · 마지막 완료 · 그 완료의 시작   (읽기 전용)
관제실  ─ 4개 봉투를 읽음 → 같은 공개키로 서명 재검증 → 통과한 것만 카드로 변환 (파일은 쓰지 않음)
```

접수기는 제출 결과로 `{ "accepted": true, "sequence": N, "event_hash": "<64자리>" }` 를 돌려준다.

### 3.2 변환 규칙 (읽기 전용)

| 서명 기록 (`payload`) | 관제실 카드 | 비고 |
|---|---|---|
| `team_id` = `TC-WORK` | `team` = `TC-WORK` | |
| `task_id` | `task_id` | ③ 기록은 `^[A-Z0-9_-]{1,100}$` |
| `summary` | `title` (완료면 `done` 에도) | |
| `event_type` `start` · `progress` | `state` = `in_progress` | 2시간 규칙 적용 |
| `event_type` `complete` | `state` = `done` | 완료는 확인된 산출물 1개 이상 필요(접수기 규칙) |
| `validation` `technical_pass` / `technical_fail` / `not_reviewed` | `verdict` `PASS` / `FAIL` / 없음, `verdict_scope` = `technical` | 독립 검증·감독 승인 아님 |
| `next[0]` | `next` | |
| `artifacts[] {id, label, sha256}` | `evidence[]` (`label`, SHA-256 앞 16자리) | |
| `occurred_at` | `at` | |
| — | `to` = 없음 | 서명 기록에 인계 대상 칸이 없음 |

**원본 보존:** 봉투 파일은 읽기만 하고 고치거나 옮기지 않는다. 카드의 `author.event` 에 원본 식별자를 **그대로** 남긴다.

```json
"author": { "method": "signed", "identity_verified": false,
  "event": { "schema": "tc-work-event/1", "sequence": 8, "event_hash": "<payload 바이트의 SHA-256 64자리 — 접수 응답의 event_hash 와 같음>",
             "previous_hash": "<앞 기록의 event_hash>", "event_id": "<UUID>", "type": "complete", "occurred_at": "…" } }
```

- 서명 검증에 실패한 봉투(내용 변조, 다른 키)는 카드가 생기지 않고, 출처 상태에 '서명 검증 실패 N건'으로만 표시한다.
- 서명은 **기록이 서명 뒤로 바뀌지 않았음**을 보여 줄 뿐, 서명한 사람이 누구인지는 증명하지 않는다. 화면에도 그렇게 적는다.
- 관제실은 공개용 최신 봉투 4개만 보므로, 화면에는 ③ 의 최근 시작·진행·완료만 나온다. 전체 이력은 접수기 이력에 있고 관제실은 읽지 않는다.

### 3.3 ③ 이 확인하는 방법

1. 제출 직후 접수 응답의 `sequence` 와 `event_hash` 를 기록해 둔다.
2. 관제실 '팀 현황' ③ 카드의 근거에 `서명 Work 기록 #순번 · 해시 앞 16자리` 가 나오면 반영된 것이다. 같은 값이 `/api/board` 의 `author.event.event_hash` 에 64자리로 나온다.
3. 거절(서명 오류, 순번·사슬 오류, 시각 창 밖)되면 접수기가 오류를 돌려주고 관제실에는 아무것도 나오지 않는다.

### 3.4 권장

- `task_id` 에 감독 지시 번호(예 `TC-VIS-030`)를 쓰면 ①·② 기록과 같은 작업 줄에 묶인다.
- 판정 요청·인계처럼 서명 기록에 칸이 없는 내용은 ③ 보고문에 적어 두면 ④ 가 §4 의 전사 카드로 보완한다.

## 4. 작성 방법 `author.method` — 직접 작성 · 서명 · 전사

| 방법 | 누가 | 화면 표시 | 규칙 |
|---|---|---|---|
| `self` (기본) | 담당 세션이 자기 작업을 씀 | **직접 작성** — 작성자 신원 미검증 | |
| `signed` | **파일로는 쓸 수 없음** | **서명 확인** — 무결성만, 신원 증명 아님 | ③ 서명 기록에서만 생김. 카드 파일에 `signed` 라고 적으면 직접 작성으로 읽음 |
| `transcribed` | 다른 기록을 사람이 옮겨 씀 (예: ④ 가 ③ 보고문을) | **전사** — 확정 아님, '지금' 상태의 근거 아님 | `transcribed_by` 와 `transcribed_from: {"ref": 원문 위치, "at": 원문 시각}` 필수. 없으면 받지 않음 |

모든 Claude 세션이 같은 서버 계정으로 돌기 때문에 폴더·`author` 로 작성자를 구분하는 것은 약속일 뿐 검증이 아니다.
관제실은 어떤 경우에도 "작성자 신원 확인됨"이라고 표시하지 않는다.

예 — ④ 가 ③ 의 서명 없는 보고를 옮긴 전사 카드:

```json
{ "schema": "tc-handoff/1", "team": "TC-WORK", "task_id": "TC-VIS-030", "title": "정지 3장 시각 검토 결과",
  "state": "done", "verdict": "REVIEW", "verdict_scope": "visual", "done": "검토 5항목 중 2항목 재작업 필요", "next": "감독 판단", "to": "director",
  "evidence": [{ "kind": "report", "ref": "③ 검토 보고 (11/10 15:20)" }],
  "author": { "method": "transcribed", "transcribed_by": "TC-DASH", "transcribed_from": { "ref": "③ 검토 보고 원문", "at": "2026-11-10T15:20:00+09:00" } },
  "at": "2026-11-10T15:20:00+09:00" }
```

## 5. 검증 방법

| 무엇을 | 어떻게 | 결과 |
|---|---|---|
| 카드 파일 (①②④, ④ 의 전사) | `node control/scripts/check-card.mjs <카드 파일> [...]` — 읽기만 함 | `✓` 받음(표시 방식과 주의점 출력) / `✕` 받지 않음(이유 출력), 종료 코드 0/1 |
| ③ 서명 기록 | 접수기 응답(§3.3) — 서명·순번·사슬은 접수기와 관제실이 각각 검증 | 화면의 `#순번 · 해시` 와 접수 응답 대조 |
| 화면 반영 | 관제실 '팀 현황'·'문제·승인·이력' | 새 기록은 다음 갱신(30초)에 반영 |

카드 점검기의 주요 거절 사유: `schema` 다름 · `team` 과 폴더 불일치 · `task_id` 형식 · `state` 값 · `at` 형식 · 전사 카드의 원문 위치·시각 없음.

## 6. 감독 판정과의 관계

승인·반려·보류·종료·기준본은 카드로 정하지 않는다. ④ 가 감독 지시문에서 판정 기록(`tc-decision/1`)으로 옮기고,
감독 원문 보관 기록(지시 번호별 원문 + SHA256)과 대조한다. **원문 내용 일치 + 사용자 확인**이 함께 있을 때만
"유효한 감독 판정"으로 표시한다. SHA256 일치는 내용이 같다는 뜻일 뿐, 감독의 신원이나 승인 권한을 증명하지 않는다.
원문 본문과 보관 위치는 관제실 화면·API 에 나오지 않는다.
