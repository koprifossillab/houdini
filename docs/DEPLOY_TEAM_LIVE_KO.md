# 팀 세션 연동 — 운영 배포 사전 검증 결과·배포 승인 요청 (2026-11-03, ② TC-QA)

운영 시스템 변경, cron 설치, 컨테이너 재생성은 하지 않았다. 이 문서는 승인 뒤 운영자가 실행할 절차다.

## 0. 배포 후보 — 운영 기준판에 따라 둘 중 하나

| 운영에서 지금 도는 판 | 배포할 후보 | 브랜치 · 커밋 | 시험 |
|---|---|---|---|
| 0.1.4-rc.1 계열 (`521b1c1`, 밝은 UI·영상 검수 A–D) | **0.1.5-rc.1** | `work/20261103-qa-team-live-on-014` · `04adcc6` | node 44/44 · 합성 21/21 |
| 0.1.2 (`456c3d5`) | 0.1.5-dev.1 | `work/20261103-qa-team-live` · `9e63fc6` | node 43/43 · 합성 21/21 |

- 0.1.3(`93faea2`, Production Link)은 두 후보 모두에 들어 있지 않다. 독립 재검토 결과가 아직 나오지 않았다.
- **운영 기준판은 미확인이다.** 운영 조회는 권한상 거부됐다. 아래 1번 명령으로 운영자가 확인한 뒤 후보를 고른다.
- 롤백 대상은 버전 이름이 아니라 **배포 직전에 실제로 돌던 이미지 ID와 태그**다. "무조건 0.1.2로 되돌리기"가 아니다.

## 1. 운영자 확인 명령 (읽기 전용, 배포 전 · 결과는 비공개로 보관)
```bash
cd /srv/Houdini
docker compose ps web                                             # 실행 중 여부, 상태(healthy)
docker inspect houdini-web-1 --format '{{.Config.Image}} {{.Image}}'   # 실행 중인 태그와 이미지 ID ← 롤백 기준
grep -E '^(IMAGE_TAG|HPC_AUTH|HPC_ALLOW_OPEN|HPC_REQUIRE_TLS)=' .env   # 값만 확인. .env 전체를 출력하거나 복사하지 말 것
sha256sum docker-compose.yml .env > ~/houdini_predeploy_$(date +%Y%m%d%H%M).sha256
cp -p docker-compose.yml docker-compose.yml.pre-teamlive          # compose 백업 (같은 폴더, 비공개)
docker images koprifossillab/houdini-control --format '{{.Tag}} {{.ID}} {{.CreatedAt}}'
curl -s http://127.0.0.1:8097/Houdini/healthz                     # version 필드 = 지금 운영 판
crontab -l > ~/crontab.pre-teamlive && grep -n tc_dash ~/crontab.pre-teamlive   # 기존 1분 수집기 줄
docker ps --format '{{.Names}} {{.Image}} {{.Status}}' > ~/docker_ps.pre-teamlive  # DikeMap 등 다른 서비스 기준
```

## 2. 배포 준비 체크리스트
- [ ] 1번 확인 결과로 운영 판과 이미지 ID를 기록하고, 0번 표에서 후보를 고른다.
- [ ] 후보 커밋에서 이미지를 빌드한다. 새 태그를 쓰고 기존 태그는 덮어쓰지 않는다. 예: `docker build -t koprifossillab/houdini-control:0.1.5-rc.1 control/`
- [ ] 격리 시험 (기존 방식): 새 이미지를 `--network none`, uid 1000, 입력 `:ro`로 띄우고 다음을 확인한다.
  - `/healthz` 응답
  - `/api/overview`, `/api/teams`, 보고서, 미디어 4건의 해시와 Range 응답
- [ ] 수집기 폴더를 만든다.
  - `install -d -m 755 ~/tc_team_live ~/tc_team_live/out && install -d -m 700 ~/tc_team_live/state`
  - `~/tc_team_live/config.json`은 저장소의 `scripts/team_live.config.example.json`을 복사해 채운다. 권한은 600.
- [ ] 수집기 사본을 고정한다: `install -m 644 control/scripts/team_live_collect.py ~/tc_team_live/team_live_collect.py`. 실행은 이 사본으로 하고, sha256을 기록해 둔다.
- [ ] 수동으로 1회 실행한다: `/usr/bin/python3 -I -B ~/tc_team_live/team_live_collect.py --config ~/tc_team_live/config.json`
  - `out/` 안에 `team_live.json` 하나만 있는지 확인한다.
  - `grep -c '/home' ~/tc_team_live/out/team_live.json` 결과가 0인지 확인한다.
- [ ] PROD에 팀 시작 폴더와 첫 인수인계 제출 계획을 안내한다. 제출하지 않아도 배포는 가능하다. 그 경우 화면에 "팀 이름만 식별"로 표시된다.

## 3. 정확한 변경점 (적용 순서)
| # | 대상 | 변경 | 비고 |
|---|---|---|---|
| C1 | 호스트 cron | 줄 **추가** 1개: `* * * * * flock -n $HOME/tc_team_live/.lock timeout 50 /usr/bin/python3 -I -B $HOME/tc_team_live/team_live_collect.py --config $HOME/tc_team_live/config.json` | 기존 `tc_dash` 줄은 그대로 둔다 |
| C2 | `/srv/Houdini/.env` | 줄 **추가** 2개: `HPC_TEAM_LIVE_HOST_DIR=<HOME>/tc_team_live/out`, 그리고 `IMAGE_TAG`를 후보 태그로 **변경** | 다른 값은 그대로 |
| C3 | `/srv/Houdini/docker-compose.yml` | web.environment에 `HPC_TEAM_LIVE_DIR: /data/team_live` **추가**. web.volumes에 `- ${HPC_TEAM_LIVE_HOST_DIR:?팀 세션 수집 출력}:/data/team_live:ro` **추가** | 마운트되는 것은 `out/`뿐이다. `state/`와 `config.json`은 마운트하지 않는다 |
| C4 | 컨테이너 | `docker compose up -d --no-deps web` | web만 다시 만든다 |

바꾸지 않는 것: Nginx, 포트 8097, 포털 카드, 인증·TLS 설정, 기존 마운트 4개, `tc_dash` 수집기와 그 cron, NAS, DikeMap.

## 4. 예상 중단·영향 범위
- C4에서 web 컨테이너를 다시 만드는 동안 `/Houdini/`가 잠깐 끊긴다. 보통 수 초이며, 그동안 Nginx가 502와 기존 안내 페이지를 보여 준다. 다른 경로와 서비스에는 영향이 없다.
- C1 수집기: 호스트에서 1분마다 실행된다.
  - 개발 환경 측정으로는 첫 실행(토큰 캐시 생성)에 약 4초, 이후 증분 실행은 0.22초다.
  - 쓰는 곳은 `~/tc_team_live`뿐이다. Claude 기록, `/proc`, WORK 기록은 읽기만 한다.
- 새 화면은 관제 개요 탭 맨 위에 패널 2개가 추가되는 것이다. 기존 탭과 메뉴는 그대로다.
- DikeMap: DikeMap의 Thermal Collapse 화면은 `~/tc_dash/status.json`을 읽는다. 이번 변경은 `tc_dash`를 건드리지 않으므로 데이터 경로에 영향이 없다. 컨테이너와 Nginx도 바뀌지 않는다.

## 5. 배포 전후 확인
배포 직후:
```bash
curl -s http://127.0.0.1:8097/Houdini/healthz        # version = 후보, sources.team_live = "live", degraded = false
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8097/Houdini/api/teams        # 200
curl -s http://127.0.0.1:8097/Houdini/api/teams | grep -cE '/home|/srv|/nfs|/tmp'        # 0
curl -s http://127.0.0.1:8097/Houdini/api/overview | head -c 300                          # 기존 개요 정상
docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | diff ~/docker_ps.pre-teamlive -   # houdini-web-1 줄만 달라야 함
```
- 포털 → `/Houdini/` 화면에서 확인할 것:
  - 팀 카드 3장
  - PROD·QA의 연결 수준 배지("팀 이름만 식별 — 완전 연결 아님")
  - 토큰 패널의 경고 문구와 1,345원 기준 표시
  - 기존 탭(검증·승인, 영상 검수 또는 미리보기, 보고서, 실험·재현, 데이터 상태)
  - 미디어 4건 재생
  - 새로고침 2회 뒤에도 같은 상태
- DikeMap 확인:
  - 배포 전후로 DikeMap 주소의 HTTP 코드가 같은지 본다(운영자가 아는 DikeMap 경로에 `curl -s -o /dev/null -w '%{http_code}'`).
  - DikeMap의 Thermal Collapse 화면 수집 시각이 계속 1분 간격으로 갱신되는지 본다.
  - 다른 컨테이너의 이미지 ID가 그대로인지 본다(위 diff).
- 3분 뒤 `/healthz`에서 `team_live: live`가 유지되는지 본다. 수집기 cron이 실제로 돌고 있는지 확인하는 단계다.

## 6. 롤백 (역순, 문제가 보이면 즉시. 운영 중에 고쳐 보지 않는다)
1. **C4 되돌리기:** `.env`의 `IMAGE_TAG`를 1번에서 기록한 **배포 직전 태그**로 되돌리고 `docker compose up -d --no-deps web`을 실행한다. 이미지 ID가 기록과 같은지 `docker inspect`로 확인한다.
2. **C3 되돌리기:** `cp -p docker-compose.yml.pre-teamlive docker-compose.yml`. 새 줄은 이전 판이 쓰지 않으므로 무해하다. 그래도 원상태로 되돌리고 싶으면 이 단계를 하고 1번의 `up`을 한 번 더 실행한다.
3. **C2 되돌리기:** `.env`에서 `HPC_TEAM_LIVE_HOST_DIR` 줄을 지운다. `sha256sum`으로 배포 전 값과 같은지 대조한다.
4. **C1 되돌리기:** `crontab ~/crontab.pre-teamlive`로 원래 crontab을 복원한다. `tc_dash` 줄이 그대로인지 확인한다.
5. 남은 것: `~/tc_team_live`는 지우지 않아도 된다. 운영 데이터를 바꾸지 않았으므로 되돌릴 데이터도 없다.
6. 롤백 뒤에는 5번 확인을 다시 한다. 이전 버전, 미디어 4건, DikeMap을 확인한다.

## 7. 노출 검토 결과 (로그인 없는 사내망 전제)
- `/api/teams`에 실제 데이터를 넣고 점검했다. `/home`, `/tmp`, `/srv`, `/nfs`, 계정 이름, 호스트, IP, 이메일, 요금제 이름, 명령줄, 대화 기록 파일명, cwd, pid가 나오지 않았다.
- 세션 원문과 프롬프트는 수집기가 읽어 내보내지 않는다. 토큰은 사용량 숫자만 읽는다.
- 인수인계 문구는 WORK의 `safe_text`와 웹의 `clean()`으로 두 번 거르고, 경로는 숨긴다.
- 토큰과 비용은 집계 숫자만 보여 준다. 세션별 표는 Houdini 세션만 담는다(사용자가 지정한 팀 이름, ID 앞 8자). 다른 프로젝트는 서버 전체 합계에만 포함된다.
- 남는 위험:
  - 인수인계 본문은 담당 팀이 쓴 문장이 그대로 표시된다(경로는 숨김). 비밀 정보를 적지 않는 것은 제출자가 책임진다.
  - 세션 이름은 사용자가 정한 것이다. 허용 문자는 `[\w .()-]` 60자까지다.

## 8. 토큰 집계 검증 (감독 4번)
- 캐시 구분: 입력, 출력, 캐시 쓰기(5분과 1시간), 캐시 읽기를 따로 센다. Houdini 오늘 합계의 약 98%는 캐시 읽기다. 예를 들어 09:0x 기준 55.8M 중 캐시 읽기가 54.8M이고, 출력은 0.35M, 캐시 쓰기 1시간은 0.67M, 입력은 508이다.
  - 그래서 토큰 숫자는 크지만 비용 대부분은 캐시 읽기($0.20/M), 출력($20/M), 캐시 쓰기($8/M)에서 나온다.
- 중복:
  - 같은 파일 안 중복: 같은 메시지 ID의 줄 631건을 확인했다. 사용량 값이 모두 같아 1회로 센다.
  - **파일 사이 중복(결함, 수정함):** 재개·분기된 세션 파일에 이전 메시지가 복사돼 50건이 두 번 집계되고 있었다. 9.3M 토큰, $6.02어치이며 모두 다른 프로젝트에서 나왔다. Houdini 합계에는 영향이 없었다. 전체 파일 기준으로 한 번만 세도록 고쳤고, 회귀 시험 T1b를 추가했다.
- 환율: 1 USD = 1,345 KRW. 2026-11-03 기준이며, 총괄 감독이 지정한 임시 표시값(추정치)이다. 출처와 추정치라는 점을 화면에 적는다.
- 경고: 패널 머리에 "실제 청구액이 아닙니다 — API 정가 환산 추정치" 배너를 둔다.

## 9. 이번 회귀 검사 (변경과 운영 차이에 해당하는 것만)
- 0.1.4-rc.1 위에 체리픽: 충돌은 `package.json` 판 표기와 `style.css` 2곳뿐이었고, 둘 다 양쪽 내용을 살려 해결했다. 전체 node 시험 44/44가 통과했다.
- 밝은 테마 화면 캡처로 고정색 대비 문제를 찾아 수정했다(값이 거의 안 보이던 것을 테마 변수로 바꿈).
- 파일 사이 중복 수정: 합성 시험 T1b를 추가했다(전체 21/21).
- 연결 수준: node 시험을 추가했다. "완전 연결"은 팀 시작 폴더, 담당 팀 인수인계, 팀 이름이 모두 맞을 때만 표시한다.
- cron이 쓸 `/usr/bin/python3` 3.14로 개발 수집 루프가 매분 정상 동작한다.
- 공개 파일 권한은 664/775이고, 컨테이너 uid 1000은 world-read로 읽는다. 기존 수집기 마운트와 같은 방식이다.

## 10. 미확인 항목
- 운영의 실제 이미지 태그·ID, `.env` 값, compose 해시 (권한 거부 → 1번 명령 필요)
- 0.1.4-rc.1이 실제로 운영에 배포됐는지 (`521b1c1`의 커밋 메시지 "authorized release" 외 근거 없음)
- 후보 이미지의 실제 빌드와 격리 컨테이너 시험 (Docker 사용은 운영 범위로 보고 하지 않음)
- DikeMap의 실제 주소와 응답 (조회하지 않음)
- 실제 PROD 인수인계 (미제출 → PROD 카드는 "팀 이름만 식별")
- 실제 환율 (임시값 1,345원)
- 0.1.3 Production Link 포함 여부 (독립 재검토 결과 미확인)

## 11. 배포 승인 요청
다음 네 가지를 승인해 주십시오.
- 1번 확인 결과에 따라 고른 후보(0.1.5-rc.1 또는 0.1.5-dev.1)
- C1 cron 줄 1개 추가
- C2·C3 `.env`와 compose 줄 추가
- C4 web만 재생성 (수 초 중단)

실행 주체는 포털 운영자이며, 작업 시간대도 함께 정해 주십시오. 승인 전까지 QA는 대기한다.
