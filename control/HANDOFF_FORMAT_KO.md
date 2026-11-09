# 인계 카드 tc-handoff/1 — 최종 형식 (④ 관제실 담당, 2026-11-10)

감독 지시 TC-HANDOFF-001 · TC-DASH-004 D-1 에 따른 ① TC-PROD · ② TC-QA · ③ TC-WORK · ④ 관제실 공통 형식이다.
관제실은 카드를 **읽기만** 하고, 카드가 없거나 근거가 없거나 오래되면 상태를 추정하지 않고 '미확인'으로 둔다.

## 1. 저장 위치와 파일 이름

```
<카드 폴더>/<팀>/<YYYYMMDD-HHMM>_<작업번호>.json
<팀> = TC-PROD | TC-QA | TC-WORK | TC-DASH      예) <카드 폴더>/TC-QA/20261110-1405_TC-VIS-030.json
```

- `<카드 폴더>` 의 실제 위치는 감독 전달문에 적는다(공개 저장소에는 서버 경로를 쓰지 않는다).
- **덧붙이기만** 한다. 이미 쓴 카드를 고치거나 지우지 않는다. 바뀐 내용은 새 카드로 쓴다. 최신 카드는 `at` 으로 정한다.
- 자기 팀 폴더에만 쓴다. 폴더와 `team` 이 다르면 관제실이 받지 않는다.
- 저장 전후에 점검: `node control/scripts/check-card.mjs <카드 파일>` (읽기만 함).

## 2. 언제 쓰나

1. 지시를 받아 작업을 **시작**할 때 — `in_progress`
2. **상태가 바뀔 때** — 넘김 `handed_off`, 차단 `blocked`, 완료 `done`
3. **완료 또는 감독 판정 요청** 때 — 보고 끝 4줄과 같은 내용
4. **오래 걸리는 작업**에서 새 진행 근거가 생겼을 때 — 새 근거를 붙인 `in_progress`
   (2시간 안에 새 카드가 없으면 화면은 '미확인'으로 내려간다. 의도된 동작이다.)

카드 작성을 이유로 제작·QA 절차를 바꾸거나 작업을 다시 시작하지 않는다.

## 3. 필드

| 필드 | 필수 | 값 | 보고 4줄과의 대응 |
|---|---|---|---|
| `schema` | 필수 | `"tc-handoff/1"` | |
| `team` | 필수 | `TC-PROD` · `TC-QA` · `TC-WORK` · `TC-DASH` (폴더와 같게) | 관등성명 |
| `task_id` | 필수 | 감독 지시 번호, 예 `TC-VIS-030` | 현재 작업 |
| `title` | 필수 | 한 줄 제목 | 현재 작업 |
| `state` | 필수 | `in_progress` · `handed_off` · `blocked` · `done` | 상태 |
| `at` | 필수 | 이 카드 내용이 사실이 된 시각, ISO 8601 + 시간대 | |
| `evidence` | 사실상 필수 | `[{ "kind": "report·nas·file·commit", "ref": "…", "sha256": "…(선택)", "at": "…(선택)" }]` — 없으면 "근거 없는 카드"로 표시되고 진행 중으로 치지 않음 | |
| `done` | 권장 | 완료한 작업 | 완료한 작업 |
| `next` | 권장 | 다음 작업 | 다음 작업 |
| `to` | 넘김·차단이면 필수 | `TC-PROD` · `TC-QA` · `TC-WORK` · `TC-DASH` · `director` · `user` | 전달받을 팀 |
| `user_action` | 선택 | 사용자가 직접 할 일, 없으면 `null` | 사용자 직접 조치 |
| `verdict` | 판정이 있으면 | `PASS` · `FAIL` · `REVIEW` · `UNVERIFIED` — 상태가 아니다 | |
| `verdict_scope` | verdict 와 함께 | `technical` · `visual` · `physics` · `selfcheck` · `run` | |
| `candidate` | 후보 작업이면 | 후보 이름 — 후보의 FAIL 은 그 후보에만 붙고 기준본 표시는 바뀌지 않음 | |
| `issues` | 선택 | `[{ "id", "title", "scope": "project·candidate·track", "candidate", "severity": "blocking·fail·review·known", "resolved" }]` | |
| `author` | 권장 | 아래 4 | |

## 4. 작성 방법 `author` — 직접 작성 · 서명 · 전사

| 방법 | 누가 | 화면 표시 | 규칙 |
|---|---|---|---|
| `self` (기본값) | 담당 세션이 자기 작업을 씀 | **직접 작성** — 작성자 신원은 검증되지 않음 | `{"method": "self", "session": "세션 이름(선택)"}` |
| `transcribed` | 다른 기록을 사람이 옮겨 씀 (예: ④ 가 ③ 보고문을 옮김) | **전사** — 확정이 아님, 지금 상태의 근거가 아님 | `transcribed_by`, `transcribed_from: {"ref": 원문 위치, "at": 원문 시각}` 필수. 없으면 받지 않음 |
| `signed` | **파일로는 쓸 수 없음** | **서명 확인** — 무결성만 증명, 신원 증명 아님 | ③ 의 서명 Work 기록(`tc-work-event/1`)을 관제실이 검증해 만든다. 파일에 `signed` 라고 적으면 직접 작성으로 읽는다 |

모든 세션이 같은 서버 계정으로 돌기 때문에, 폴더나 `author` 로 작성자를 구분하는 것은 약속일 뿐 검증이 아니다.
관제실은 어떤 경우에도 "작성자 신원 확인됨"이라고 표시하지 않는다.

## 5. 팀별 메모

- **① TC-PROD · ② TC-QA** — 자기 폴더에 `self` 카드. QA 판정은 `verdict` + `verdict_scope` 로 (기술 PASS 는 시각 승인이 아님).
- **③ TC-WORK** — 서버 밖에서 일하므로 두 길:
  1. 기존 서명 Work 기록을 그대로 계속 쓴다 → 관제실이 서명을 검증해 카드로 보여 준다(원본 이벤트 해시·순번을 출처로 남김, 원본 파일은 건드리지 않음).
  2. 서명 기록이 없는 보고는 ④ 가 `TC-WORK/` 에 `transcribed` 카드로 옮겨 적는다(원문 위치·시각 필수).
- **④ 관제실** — 자기 작업은 `self` 카드. 감독 판정은 카드가 아니라 판정 기록(`tc-decision/1`)으로 전사한다.

## 6. 감독 판정과의 관계

승인·반려·보류·종료·기준본은 카드로 정하지 않는다. ④ 가 감독 지시문에서 판정 기록으로 옮기고,
감독 원문 보관 기록(지시 번호별 원문 + SHA256)과 대조한다. **원문 내용 일치 + 사용자 확인**이 함께 있을 때만
"유효한 감독 판정"으로 표시한다. SHA256 일치는 내용이 같다는 뜻일 뿐, 감독의 신원이나 승인 권한을 증명하지 않는다.
원문 본문과 보관 위치는 관제실 화면·API 에 나오지 않는다.

## 7. 예

```json
{ "schema": "tc-handoff/1", "team": "TC-PROD", "task_id": "TC-VIS-030", "title": "v6.5h 조명 시험 3장",
  "state": "handed_off", "verdict": "PASS", "verdict_scope": "selfcheck", "candidate": null,
  "done": "Karma 정지 3장 렌더 · 자체 검사 통과", "next": "② QA 실행 검증", "to": "TC-QA", "user_action": null,
  "evidence": [{ "kind": "nas", "ref": "<영상 폴더>/TC3D_..._RAW_PRESERVED", "at": "2026-11-10T13:06:00+09:00" }],
  "author": { "method": "self", "session": "TC-PROD-20261110" },
  "at": "2026-11-10T13:10:00+09:00" }
```

```json
{ "schema": "tc-handoff/1", "team": "TC-WORK", "task_id": "TC-VIS-030", "title": "정지 3장 시각 검토 결과",
  "state": "done", "verdict": "REVIEW", "verdict_scope": "visual", "done": "검토 5항목 중 2항목 재작업 필요", "next": "감독 판단", "to": "director",
  "evidence": [{ "kind": "report", "ref": "③ 검토 보고 (11/10 15:20)" }],
  "author": { "method": "transcribed", "transcribed_by": "TC-DASH", "transcribed_from": { "ref": "③ 검토 보고 원문", "at": "2026-11-10T15:20:00+09:00" } },
  "at": "2026-11-10T15:20:00+09:00" }
```
