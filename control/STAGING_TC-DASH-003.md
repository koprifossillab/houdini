# TC-DASH-003 스테이징 — 관제실 1차 구현

판 `0.2.0-staging.1`, 브랜치 `work/20261109-houdini-dash-v2` (운영판 `0.1.6-rc.2 / 5dac91d` 에서 분기).
**운영 배포 미승인** — 운영 컨테이너·이미지·데이터·nginx 는 이 브랜치와 무관하다.

## 화면

| 주소 | 화면 |
|---|---|
| `/Houdini/#home` | 프로젝트 관제 홈 (현재 작업 · 실행 상태 · 마지막 완료 · 다음 행동 · 진행 단계 · 문제 · 최신 결과물) |
| `#teams` | 팀별 작업 현황 (지금 / 마지막 확인 / 세션 줄 분리) |
| `#issues` | 승인 대기 · 프로젝트 문제 · 후보 한정 문제 · 지시별 이력 · 기호 범례 |
| `#review` | 프리뷰 검수 (후보 지위 = 판정 기록, 판정 = 카드, 그림 = SHA 목록 등재분) · 쓰기 버튼 잠금 |
| `#tech` | 기술 상세 · 자료 출처 상태 · 이전 화면 링크 |
| `#data` | 데이터 근거표 · NAS 단서 목록 · 카드/판정 기록 형식 |
| `/Houdini/legacy.html` | 이전 관제 화면 (0.1.6-rc.2 그대로, 18개 섹션) |

## 데이터 흐름 (모두 읽기 전용)

```
인계 카드  <HPC_HANDOFF_DIR>/<TC-PROD|TC-QA|TC-WORK|TC-DASH>/*.json  (tc-handoff/1) ─┐
판정 기록  <HPC_DECISIONS_DIR>/*.json                                (tc-decision/1) ─┤
NAS 단서   <HPC_NAS_FILM_DIR>/TC…/  ·  <HPC_NAS_LAUNCH_DIR>/launch_*.bat              ─┼→ lib/board.mjs → GET /api/board
팀 세션    <HPC_TEAM_LIVE_DIR> (기존)                                                  ─┘
NAS 그림   GET /nasimg/<16hex>  — 폴더 SHA 목록 등재 + 해시 일치만
기존 API   /api/overview · teams · reports · experiments · media  — 변경 없음
```

근거 등급: **확정** = 판정 기록 · 근거 첨부 인계 카드 / **단서** = NAS 폴더 이름·파일 존재 / **근거 없는 카드** = evidence 없는 카드.
승인·보류·종료·기준본은 판정 기록으로만 확정한다. NAS 이름만으로는 어떤 상태도 확정하지 않는다.

상태 규칙: '지금'이 진행 중이 되려면 근거 있는 `in_progress` 카드가 2시간 이내여야 한다. 아니면 미확인이며 마지막 확인 상태는 그대로 보존한다.
PC 실행 상태는 전송 장치(2차)가 없으므로 항상 미확인. 세션·프로세스 생존은 팀 카드의 '세션 연결' 줄에만 쓴다.
후보의 FAIL 은 그 후보와 '후보 한정 문제'에만 붙고 기준본 표시를 바꾸지 않는다.

## NAS 읽기 제한 (lib/nas.mjs)

- 루트 2곳(환경 변수)만. URL 은 불투명 ID 만 받는다.
- 최상위 폴더 이름 `^TC[0-9A-Za-z_-]{2,120}$` (목업의 `[0-9A-Z_]` 에서 실제 이름의 소문자 `fix2a` 등 때문에 넓힘), 최근 80개, 깊이 2.
- 본문 `.md .txt` ≤ 256 KB (깊이 1만) — 작업 번호와 첫 제목만 내보냄, 본문은 내보내지 않음.
- 그림 `.png .jpg` ≤ 25 MB, SHA 목록 등재 + 해시 일치 때만 전달. `.hip .bgeo .py .bat .json` 등은 열지 않음.
- 심볼릭 링크 · `..` · 루트 밖 실경로 거부, 쓰기 없음, 응답에 서버 경로 없음, `HPC_REDACT_TERMS` 적용, 목록 60초 캐시.

## 스테이징 실행

```
cd control && env HOST=127.0.0.1 PORT=18096 HPC_AUTH=off HPC_ALLOW_OPEN=1 HPC_REQUIRE_TLS=0 \
  HPC_HANDOFF_DIR=… HPC_DECISIONS_DIR=… HPC_NAS_FILM_DIR=… HPC_NAS_LAUNCH_DIR=… (기존 HPC_* 그대로) node server.mjs
```

스테이징 카드·판정 기록은 저장소 밖(서버 홈의 스테이징 폴더)에 있으며, 기존 기록을 ④ 가 옮겨 적은 것이다(`transcribed_by: TC-DASH`, 시각은 원래 근거 파일 시각, 시각을 모르면 `at_precision: date`).

## 운영판으로 복귀

이 브랜치는 운영에 배포되지 않았으므로 되돌릴 운영 변경이 없다. 나중에 배포된 뒤 되돌릴 때:
1. 컨테이너 이미지를 `koprifossillab/houdini-control:0.1.6-rc.2-5dac91d` 로 되돌려 `docker compose up -d`.
2. 새 환경 변수(`HPC_HANDOFF_DIR` 등)와 그 마운트는 무시되거나 지워도 된다 — 이전 판은 읽지 않는다.
3. 인계 카드·판정 기록 폴더는 읽기 전용 입력이라 지울 필요 없음.

## 금지 (이번 승인 범위 밖)

운영 배포 · 컨테이너 교체 · 운영 데이터 수정 · 쓰기 API · 인증 없는 쓰기 · ① PROD BAT 수정.

---

# D-1 · TC-DASH-005 추가 (0.2.0-staging.2, 브랜치 work/20261110-houdini-dash-d1)

## 출처 3구분 (lib/handoff.mjs, lib/board.mjs)

| 방법 | 출처 | 화면 표지 | '지금 진행 중' 근거가 되나 |
|---|---|---|---|
| `self` | 팀 폴더의 카드 | 직접 작성 (작성자 신원 미검증) | 근거가 있고 2시간 이내면 예 |
| `signed` | ③ 서명 Work 기록, 서버가 공개키로 검증 | 서명 확인 (무결성만 · 신원 증명 아님) | 예 |
| `transcribed` | 다른 기록에서 옮겨 적은 카드 (`transcribed_from` 필수) | 전사 | 아니오 |

파일에 `"method": "signed"` 라고 적어도 직접 작성으로 읽는다. ③ 의 원래 서명 파일은 읽기만 한다.

## 감독 판정의 유효성 (lib/director.mjs)

판정 기록은 ④ 가 옮긴 전사 기록이다. `directive_id` 로 감독 원문 목록(`INDEX.json`, `tc-director-index/1`)과 대조한다.

| 결과 | 표시 | 승인 대기를 닫나 · 종료 · 기준본 확정 |
|---|---|---|
| 원문 목록·파일 없음 | 전사 · 원문 미확인 | 아니오 |
| SHA256 불일치 | 전사 · 원문과 내용 불일치 | 아니오 |
| SHA256 일치, 사용자 확인 없음 | 원문 내용 일치 · 사용자 확인 전 | 아니오 |
| SHA256 일치 + `check_method: user_confirmed` | 유효한 감독 판정 (신원·권한 증명 아님) | 예 |

대조 모듈은 목록에 있는 파일만 읽고(평범한 이름 `.md`/`.txt`, 256 KB 이하, 심볼릭 링크·폴더 밖 실경로 거부),
결과·시각·확인 방법만 낸다. 본문·파일 이름·경로는 내보내지 않는다. 대조 전용 API 는 없다.

## 감독 원문 폴더 차단

- NAS 단서 검색에서 `TC3D_DIRECTOR_DECISIONS`, 이름에 `DIRECTOR_DECISIONS` 가 들어간 모든 폴더, `HPC_NAS_EXCLUDE` 이름, 그리고 `HPC_DIRECTOR_DIR` 과 실경로가 같은 폴더를 제외한다.
- 제외된 폴더의 파일에는 ID 가 생기지 않으므로 `/nasimg/` 로 직접 요청할 수 없다.
- 근거 참조가 원문 폴더를 가리키면 "감독 원문 보관 기록 (위치 비공개)" 로만 표시한다.

## 새 환경 변수

`HPC_DIRECTOR_DIR` (원문 보관 위치, 대조 전용), `HPC_NAS_EXCLUDE` (쉼표로 구분한 추가 제외 폴더 이름).
③ 서명 기록은 기존 `HPC_WORK_ACTIVITY_DIR` 과 `data/work-public.pem` 을 그대로 쓴다.

## 인계 카드

형식은 `HANDOFF_FORMAT_KO.md`, 점검은 `node control/scripts/check-card.mjs <카드>` (읽기만).
