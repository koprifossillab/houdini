# Houdini Production Control — 배포·롤백 절차

이 문서의 단계는 **모두 승인 뒤에** 운영자가 실행합니다. 개발 브랜치에서는 실행하지 않았습니다.

## 0. 승인 항목

| # | 항목 | 승인 주체 | 비고 |
|---|---|---|---|
| A1 | `main` 병합 | 총괄 감독 | 독립 검증 뒤 |
| A2 | GitHub push | 총괄 감독 | 저장소가 Public → 공개 적합성 심사 먼저 |
| A3 | 서비스 폴더 생성 (제안: `/srv/Houdini/`), 이미지 빌드, 운영 컨테이너 실행 | 감독 + 포털 운영자 | 루프백 포트 8097 확정 필요 |
| A4 | Nginx 조각 설치 + include 한 줄 | 포털 운영자(sudo) | 전체 설정 덮어쓰기 금지 |
| A5 | 포털 첫 화면 카드 추가 | 포털 운영자 | `portal/PORTAL_CARD_PROPOSAL.md` |
| A6 | 보고서·미디어 열람 계정 발급 | 감독 | 누구에게 열람을 허용할지 |
| A7 | 미리보기 미디어 목록 확정 | 감독 | 어떤 결과를 보여 줄지 |

## 1. 준비 (A3)

```bash
# 1) 서비스 폴더 — 소유는 포털 운영 계정, 그룹 쓰기
sudo install -d -o <포털 운영 계정> -g <포털 운영 그룹> -m 2775 /srv/Houdini /srv/Houdini/www /srv/Houdini/runtime

# 2) 승인된 판을 읽기 전용으로 checkout 해 둔다 (제작 저장소 자료 = 실험 이력·재현 정보)
git clone --branch main <저장소> /srv/Houdini/ledger && chmod -R a-w /srv/Houdini/ledger

# 3) 이미지 (저장소의 control/ 에서)
docker build -t koprifossillab/houdini-control:0.1.0 control/

# 4) 설정
cp deploy/srv/docker-compose.yml /srv/Houdini/
cp deploy/srv/env.example /srv/Houdini/.env && chmod 640 /srv/Houdini/.env   # 값 채우기
cp deploy/www/Houdini-unavailable.html /srv/Houdini/www/
# 미디어 목록: [{id, file(이름만), title, stage, origin(physics|procedural|render|example), model, sampling, caveat, sha256}]
#   sha256 이 다르면 서비스가 그 파일을 내보내지 않는다(409).
```

열람 계정 만들기(비밀번호는 표준입력으로 — 셸 기록에 남지 않게):

```bash
printf %s '<12자 이상 비밀번호>' | docker run --rm -i koprifossillab/houdini-control:0.1.0 node scripts/hash-password.mjs viewer
# 출력 한 줄을 .env 의 HPC_USERS 에 (여러 명은 ; 로 잇는다)
```

## 2. 실행과 확인

```bash
cd /srv/Houdini && docker compose up -d web
docker compose ps                         # STATUS 에 (healthy)
curl -s http://127.0.0.1:8097/Houdini/healthz
```

`/healthz` 응답:
- `status: ok` — 프로세스가 살아 있다는 뜻입니다.
- `degraded: true` — 입력 자료 가운데 하나가 없거나, 오래됐거나, 오류라는 뜻입니다. 어느 것인지는 `sources`에 나옵니다.
- 이 응답에는 경로가 들어 있지 않습니다.

## 3. Nginx (A4)

`nginx/Houdini-subpath.conf` 머리말의 순서를 그대로 따릅니다.
1. 조각 파일을 snippets 폴더에 넣습니다.
2. 포털 server 블록에 include **한 줄만** 추가합니다.
3. `nginx -t` 검사를 통과한 뒤 reload 합니다.

확인:

```bash
curl -sI http://<서버>/Houdini        # 301 → /Houdini/
curl -s  http://<서버>/Houdini/healthz
curl -sI http://<서버>/houdini/       # 301 → /Houdini/
curl -sI http://<서버>/api/            # 포털 기존 응답 그대로 (충돌 없음 확인)
```

## 4. 롤백

| 상황 | 조치 |
|---|---|
| 새 판이 이상함 | `.env`의 `IMAGE_TAG`를 이전 판으로 되돌림 → `docker compose up -d web` |
| 서비스를 잠시 내림 | `docker compose stop web`. Nginx는 안내 페이지(502/504 → `Houdini-unavailable.html`)를 보여 줌 |
| 완전히 걷어 냄 | include 줄 삭제 → `nginx -t && reload` → `docker compose down` → 조각 파일 삭제 |

이 서비스는 아무 데도 쓰지 않습니다. 그래서 롤백할 때 되돌릴 데이터가 없습니다. 수집기, cron, 제작 저장소, NAS는 이 서비스와 무관하게 그대로 둡니다.

## 5. 지키는 것

- 입력 4개(수집기 출력, 제작 저장소 checkout, 미디어 폴더, 미디어 목록)는 모두 `:ro`로 마운트합니다. 컨테이너 루트 파일시스템도 읽기 전용입니다.
- 권한 제거(`cap_drop: ALL`)와 `no-new-privileges`를 적용합니다. 실행 사용자는 uid 1000이고, 메모리는 256 MiB, 프로세스는 64개로 제한합니다.
- 포트는 루프백에만 엽니다. 바깥에서 들어오는 길은 Nginx 하나뿐입니다.
- 3–5초 단위 세션 관측, 계산 실행, 승인 기록 기능은 없습니다.
