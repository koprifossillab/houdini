# 팀 세션 연속성·실행 상태·토큰 사용량 연동 (개발판 0.1.5-dev.1)

작성: ② TC-QA (2026-11-03). 기준판은 운영 0.1.2(456c3d5)이다. 운영에는 배포하지 않았다.

## 1. 왜 관제실이 옛 TC-00 기록만 보였나
- 기존 1분 수집기(호스트 cron, `tc_dash/bin/collect.py`)가 읽는 곳은 2026-10-30 기준의 옛 작업 폴더와 NAS의 TC-00 폴더다. 그래서 "35/35"와 TC-00-03 보고서가 계속 표시된다.
- 새 작업 공간은 읽지 않는다. 대상은 worktree, QA 폴더, Work 연속성 기록, Claude 세션 등록 정보다.
- 수집기의 프로세스 감지는 작업 폴더를 기준으로 한다. 셸·편집기와 계산을 구분하지 못하고, 어느 Claude 세션이 어느 팀인지도 알 수 없다.
- 결과적으로 "수집 자료 연결"은 수집기가 매분 정상 실행된다는 뜻일 뿐이다. 제작 세션이 실행 중이라는 증거가 아니다.

## 2. 구성
| 부분 | 위치 | 역할 |
|---|---|---|
| 팀 세션 수집기 | `control/scripts/team_live_collect.py` | 호스트에서 1분마다 실행, 입력은 모두 읽기 전용. 공개 요약 `team_live.json` 하나만 쓴다 |
| 팀 전용 시작기 | `control/scripts/team_session.py` | 팀 이름(`-n`)과 팀 시작 폴더로 `claude`를 시작한다. 시작 전에 Work 신원·기록 대조를 거친다 |
| 웹 읽기 모듈 | `control/lib/teamlive.mjs` + `GET /api/teams` | 요약을 다시 검증하고, 수집이 늦으면 RUNNING·IDLE을 표시하지 않는다 |
| 화면 | 관제 개요 탭 맨 위 | "팀 실시간 현황", "토큰 사용량 · 비용 환산". 기존 부서별 상태에는 "과거 기록 · TC-00" 표시 |

Work 연속성 도구(`team_start.py`, `records.py`, `dev_link.py`)는 수정하지 않고 그대로 불러 쓴다.

## 3. 실행 상태 판정 (세션별 근거)
근거는 세 가지다.
- Claude Code 세션 등록 파일 `~/.claude/sessions/<pid>.json`: sessionId, procStart, 사용자가 붙인 이름, busy/idle, updatedAt
- `/proc/<pid>/stat`의 시작 시각
- 대화 기록 파일의 수정 시각

| 상태 | 조건 |
|---|---|
| RUNNING | 프로세스가 살아 있고 시작 시각이 일치함, 세션 상태가 busy, 최근 10분 안에 활동 근거 있음 |
| IDLE | 프로세스가 살아 있고 시작 시각이 일치함, 세션이 idle(입력 대기)로 보고함 |
| STALE | 프로세스는 살아 있으나 busy 표시 뒤 10분 넘게 활동 근거 없음, 또는 웹이 받은 수집 요약이 3분보다 오래됨 |
| STOPPED | 이전에 연결된 세션이 끝났음을 확인함: 등록 파일 삭제, 프로세스 없음, PID 재사용(시작 시각 불일치) 중 하나 |
| UNKNOWN | 이 팀으로 연결된 세션을 본 적 없음, 서버에서 관측할 수 없는 팀(TC-WORK = ChatGPT Work), 또는 사용자 PC의 Houdini |

- PID만으로는 판정하지 않는다. sessionId와 procStart(프로세스 시작 tick)가 모두 맞아야 같은 세션으로 본다.
- 로그 파일이 존재하거나 커밋이 있다는 사실만으로 RUNNING이 되지 않는다.

## 4. 팀 신원
세션은 다음 두 조건으로 팀에 연결된다.
- 사용자가 지정한 세션 이름의 접두어(`TC-PROD-…`, `TC-QA-…`). `nameSource=user`일 때만 인정한다.
- 시작 폴더를 대조한 결과
  - `verified`: 팀 시작 폴더와 일치
  - `name_only`: 공용 저장소에서 시작함(경고)
  - `conflict`: 다른 팀의 시작 폴더에서 시작함

공용 Claude 메모리 문장은 읽지 않는다. 이름이 없는 세션은 어느 팀에도 표시하지 않고 "팀 미지정 세션 N개"로만 센다. 같은 팀 이름으로 살아 있는 세션이 둘 이상이면 중복 경고를 표시한다.

### 일반 `claude` 실행과 팀 전용 실행의 차이
| | 공용 저장소에서 `claude` 실행 | `team_session.py --team TC-QA` |
|---|---|---|
| 시작 폴더 | 공용 저장소. 메모리를 다른 팀과 공유 | 팀 전용 폴더 |
| 세션 이름 | 없음 → 관제실에서 팀 미지정 | `TC-QA-YYYYmmdd-HHMM` → 관제실에서 QA로 연결 |
| 시작 전 확인 | 없음 | Work `team_start.py restore`가 팀 ID·entrypoint·CLAUDE.md·기록 team_id를 대조. 불일치하면 시작하지 않음 |
| 기록 복원 | 없음 | 마지막 인수인계(작업·커밋·상태·다음 작업)를 화면에 출력. 작업 재개 허가는 아님 |

세션을 마치기 전에 담당 팀이 Work 절차(`team_start.py submit`)로 인수인계를 제출해야 다음 세션과 관제실에 이어진다.

## 5. 토큰 사용량·비용
- 이 서버의 Claude Code 대화 기록 전체를 증분으로 읽는다(하위 에이전트 포함). 같은 메시지 ID가 여러 줄에 나오면 한 번만 센다.
- 입력, 출력, 캐시 쓰기(5분·1시간), 캐시 읽기를 따로 집계한다.
- 집계 단위: 팀별, Houdini 프로젝트, 서버 전체, 최근 세션 12개
- 기간: 최근 5분, 최근 60분, 오늘(KST), 누적
- 단가는 Anthropic API 정가다(Opus 5.5: 입력 $4, 출력 $20, 캐시 쓰기 $5 / $8, 캐시 읽기 $0.20, 백만 토큰당). fast 모드는 2배로 계산한다.
  - **실제 청구액이 아니다.** 구독 요금제(Claude Max 등)로 쓴 몫은 청구와 무관하며, "API로 했다면 얼마였을지"를 보여 주는 환산 값이다.
- 원화 환산은 설정 `fx.krw_per_usd` 값을 쓴다. 현재 값은 1,450원이며 기준을 화면에 표시한다. 실제 환율로 갱신하는 것은 운영자가 할 일이다.
- 집계 범위 밖: ChatGPT Work, 다른 PC의 Claude 세션

## 6. 노출 방지 (로그인 없는 사내망 화면)
- 공개 파일 `team_live.json`에는 경로, 명령줄, 프롬프트, 대화 내용, PID가 없다. 세션 ID는 앞 8자만 들어간다.
- 내부 상태(대화 기록 경로, 메시지 ID)는 `state_dir`에 둔다. 이 폴더는 출력 폴더 안에 둘 수 없다(수집기가 거부함). 컨테이너에는 출력 폴더만 마운트한다.
- 웹 모듈은 모든 문자열을 `clean()`으로 다시 거른다. 경로는 숨기고 허용된 필드만 내보낸다.

## 7. 운영 배포에 필요한 변경 (승인 전 실행 금지)
1. 호스트 수집기 설치
   - `mkdir -p ~/tc_team_live/{out,state}`
   - `scripts/team_live.config.example.json`을 `~/tc_team_live/config.json`으로 복사해 값을 채운다.
   - QA 시작 폴더는 감독 승인으로 정해진 QA 전용 폴더다. PROD 시작 폴더는 PROD가 정해야 한다.
2. **cron 한 줄 추가** (운영 cron 변경이므로 승인 필요)
   `* * * * * flock -n $HOME/tc_team_live/.lock timeout 50 /usr/bin/python3 -I -B <승인된 사본>/team_live_collect.py --config $HOME/tc_team_live/config.json`
3. 승인된 커밋에서 이미지를 빌드한다(예: `koprifossillab/houdini-control:0.1.5`). 기존 0.1.2 태그는 덮어쓰지 않는다.
4. `/srv/Houdini/docker-compose.yml`의 web 서비스에 두 가지를 추가한다.
   - environment: `HPC_TEAM_LIVE_DIR: /data/team_live`
   - volumes: `- ${HPC_TEAM_LIVE_HOST_DIR:?팀 세션 수집 출력}:/data/team_live:ro` (`.env`에 `HPC_TEAM_LIVE_HOST_DIR=<HOME>/tc_team_live/out`)
5. `.env`의 `IMAGE_TAG`를 바꾼 뒤 `docker compose up -d --no-deps web`을 실행한다. Nginx, 포트, 포털, DikeMap은 바꾸지 않는다.
6. 확인 항목
   - `/Houdini/healthz`에서 `sources.team_live = live`
   - 기존 경로 응답(`/Houdini/api/overview`, 보고서, 미디어 4건) 정상
   - 포털과 다른 서비스 응답 정상

## 8. 롤백
- 화면만 되돌릴 때: `IMAGE_TAG=0.1.2`로 바꾸고 `docker compose up -d --no-deps web`을 실행한다.
  - 추가한 environment와 volume은 0.1.2가 쓰지 않으므로 무해하다. compose도 원래대로 되돌리려면 4번에서 추가한 두 줄을 지운다.
- 수집기를 멈출 때: cron 줄을 지운다. `~/tc_team_live`는 남겨 두어도 된다. 다른 데이터를 쓰지 않으므로 되돌릴 자료가 없다.
- 수집기가 멈추면 웹은 3분 뒤 모든 팀을 STALE이나 UNKNOWN으로 보여 준다. 잘못된 RUNNING은 표시되지 않는다.

## 9. 시험
- `python3 -I -B control/test/team_live_collect_test.py`: 합성 상태 전이 20건
  - 대상: 동시 실행, STALE, 종료, 없는 PID, PID 재사용, 재연결, 이전 세션, 충돌·공용 폴더 연결, 중복 세션, 이름 없는 세션, 출력 노출
- `node --test control/test/*.test.mjs`: 42건 (기존 39건 + 팀 연동 3건)
- 실제 Claude Code 세션 재시작 시험(2026-11-03)의 기록은 QA 인수인계(`QA_HANDOVER.md`)에 있다.
