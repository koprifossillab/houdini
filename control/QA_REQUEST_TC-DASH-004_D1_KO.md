# ② TC-QA 독립 검증 의뢰 — 관제실 D-1 · 감독 원문 차단 (TC-DASH-004 D-1 / TC-DASH-005)

- 의뢰: ④ 관제실 담당 · 2026-11-10
- 대상 브랜치: `work/20261110-houdini-dash-d1` — 커밋 `4b5c65c`(1차 화면) + `087155f`(D-1) + `02d4c81`(이 의뢰서) + TC-HANDOFF-002 커밋(③ 원본 식별자 보존·규격 문서). 기준 운영판 `5dac91d`.
- 범위 밖(하지 말 것): 코드 수정, 운영 컨테이너·nginx·운영 데이터 변경, 운영 배포, push. ② 는 읽고 실행해 보고 판정만 한다.
- 감독 원문 폴더(`TC3D_DIRECTOR_DECISIONS`)는 **아직 만들지 않는다**. 원문 관련 시험은 임시 폴더로 한다.

## 판정해 주실 항목 (항목마다 PASS · FAIL · REVIEW)

| # | 항목 | 확인 방법 제안 |
|---|---|---|
| Q1 | 기존 69개 시험이 그대로 통과 (두 시험은 D-1 규칙에 맞춰 전제만 바뀜: 기준본 grade, 보류 판정의 유효성) | `node --test control/test/*.test.mjs`, `git diff 4b5c65c -- control/test/board.test.mjs` |
| Q2 | 직접 작성 · 서명 · 전사가 API(`/api/board` 의 `grade`, `method`, `provenance`)와 화면에서 구분되고, 어디에도 "작성자 신원 확인됨"으로 보이지 않음 | `lib/handoff.mjs`, `lib/board.mjs`, `public/board.js` 의 GRADE · 범례 |
| Q3 | 파일에 `signed` 라고 적은 카드는 서명으로 취급되지 않음 · 위조·다른 키의 서명 이벤트는 카드가 생기지 않음 · ③ 원래 서명 파일은 바뀌지 않음 | `test/provenance.test.mjs`, 직접 위조 이벤트 작성 |
| Q4 | 전사 카드: 원문 위치·시각 없으면 거부, 확정으로 표시 안 됨, '지금 진행 중'의 근거가 되지 않음 | 위와 같음 |
| Q5 | 출처 없는 감독 승인 기록이 차단되고, 원문 미확인·불일치·사용자 확인 전 기록은 승인 대기를 닫거나 작업을 종료하거나 기준본을 확정하지 않음 | `lib/director.mjs` `decisionValidity`, `lib/board.mjs` `VALID` |
| Q6 | '유효한 감독 판정' = 원문 SHA256 일치 + 사용자 확인 기록, 둘 다 있을 때만. SHA 일치는 내용 일치만 뜻한다는 문구 유지 | 위와 같음 |
| Q7 | 대조 모듈은 INDEX.json 에 있는 파일만 읽고, 본문·파일 이름·경로를 내보내지 않음 (심볼릭 링크·폴더 밖 실경로·경로형 이름 거부) | 임시 폴더로 시험, 응답 문자열 검색 |
| Q8 | 감독 원문 폴더가 NAS 단서 검색에 나오지 않고, `/nasimg/` 등 직접 조회가 막힘 (고정 이름 · `*DIRECTOR_DECISIONS*` · `HPC_NAS_EXCLUDE` · 같은 실경로) | 임시 NAS 구조로 시험 |
| Q9 | 모든 응답(`/api/board`, `/api/nas`, `/api/overview`, `/api/teams`, `/healthz`, 화면)에 서버 경로·계정·NAS 이름·원문 폴더 이름이 없음 | 스테이징을 띄워 문자열 검색 |
| Q10 | 쓰기 API 없음 (GET·HEAD 외 405), 승인·반려·코멘트 버튼 비활성 | |
| Q11 | 운영판 무변경 — 이 브랜치는 운영 컨테이너·이미지·compose 와 무관 | `docker inspect houdini-web-1`, 운영 `/api/board` 가 404 |
| Q12 | `HANDOFF_FORMAT_KO.md` 와 `scripts/check-card.mjs` 가 코드의 실제 규칙과 일치 (문서의 예시 카드가 통과) | |
| Q13 | (TC-HANDOFF-002 추가) ③ 서명 기록 변환이 읽기 전용이고, 카드의 `author.event` 에 원본 `event_hash`(payload 바이트 SHA-256 64자리)·`sequence`·`previous_hash`·`event_id` 가 그대로 남음. 규격 문서 §3 이 ③ 의 서버 직접 기록을 가정하지 않음 | `lib/handoff.mjs` `cardFromEvent`, `test/provenance.test.mjs`, 실제 Work 기록으로 대조 |

## 알려 둔 사항

- `test/timer_collector_test.py` 는 D-1 이전부터 가끔 실패한다(4b5c65c 에서도 12회 중 1회). 해당 수집기·시험 파일은 5dac91d 이후 바뀌지 않았다 — 판정 시 별도 사항으로 봐 주십시오.
- Python 시험은 `python3 -I -B` 로 (바이트코드 캐시를 만들지 않도록).
- 스테이징 자료(옮겨 적은 카드 5장·판정 기록 5건)는 저장소 밖 스테이징 폴더에 있다. 원문 목록이 없으므로 판정 5건은 모두 "원문 미확인"으로 나와야 정상이다.

## 회신 형식

항목별 PASS/FAIL/REVIEW + 근거, 새로 발견한 결함, 전체 의견(배포 판정 요청 가능 / 불가). 보고는 관등성명 형식.
