# Houdini Production Control — 배포·롤백 절차 (v0.1.1, HTTPS 전제)

이 문서의 단계는 **모두 승인 뒤에** 운영자가 실행합니다. 개발 브랜치에서는 실행하지 않았습니다.

## 0. 승인 항목

| # | 항목 | 승인 주체 | 비고 |
|---|---|---|---|
| A1 | `main` 병합 | 총괄 감독 | 독립 검증 뒤 |
| A2 | GitHub push | 총괄 감독 | 저장소가 Public이므로 공개 적합성 심사 먼저 |
| A3 | 서비스 폴더, 이미지 빌드, 운영 컨테이너 실행 | 감독 + 포털 운영자 | 루프백 포트 8097, 컨테이너 네트워크 대역 확정 |
| A4 | **TLS**: 인증서 발급과 HTTPS server 블록 추가 | 포털 운영자(sudo) | 443(또는 다른 TLS 포트)이 사내망에서 통과하는지 확인. 기존 블록은 수정하지 않음 |
| A5 | HTTP→HTTPS 이동 조각 include 한 줄 | 포털 운영자 | 평문으로는 프록시하지 않음 |
| A6 | 포털 카드 추가 | 포털 운영자 | `portal/PORTAL_CARD_PROPOSAL.md` |
| A7 | 열람 계정 발급 대상 | 감독 | 메인 화면을 포함한 모든 연구정보에 인증 필요 |
| A8 | 미리보기 미디어 목록 확정 | 감독 | |

**운영자 승인 없이 하지 않는 것**
- 인증 방식을 약화하는 일
- 평문 HTTP로 프록시하는 일
- `HPC_REQUIRE_TLS=0`으로 설정하는 일

## 1. 비밀값을 만들 때 (셸 기록·명령줄·로그에 남기지 않기)

- 비밀값은 모두 **표준입력이나 편집기**로 다룹니다. `echo 비밀`, `-e HPC_USERS=...`, 명령 인자처럼 셸 기록이나 `ps`에 보이는 방법은 쓰지 않습니다.

```bash
# 열람 계정 한 명 — 비밀번호는 화면에 보이지 않게 읽고 바로 지운다
read -rs PW && printf %s "$PW" | docker run --rm -i --network none koprifossillab/houdini-control:0.1.1 \
  node scripts/hash-password.mjs viewer > /srv/Houdini/runtime/user.line; unset PW
# 출력 한 줄을 편집기로 .env 의 HPC_USERS= 뒤에 옮긴다(여러 명은 ; 로 잇는다). 그 다음:
shred -u /srv/Houdini/runtime/user.line

# 프록시 토큰 — 파일 두 곳에만, 화면에 출력하지 않는다
TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '/+=') && \
  printf 'HPC_PROXY_TOKEN=%s\n' "$TOKEN" >> /srv/Houdini/.env && \
  sudo install -d -m 700 /etc/nginx/secrets && \
  printf 'proxy_set_header X-HPC-Proxy-Token "%s";\n' "$TOKEN" | sudo tee /etc/nginx/secrets/houdini-proxy-token.conf >/dev/null && \
  sudo chmod 600 /etc/nginx/secrets/houdini-proxy-token.conf; unset TOKEN
```

- `.env`는 `install -m 640 /dev/null .env`로 빈 파일을 먼저 만든 뒤 편집합니다.
- 서비스 로그에는 경로 이름(route id), 상태 코드, 처리 시간만 남습니다. URL 원문, query, 헤더, 인증정보는 남지 않습니다.

## 2. 준비 (A3)

```bash
sudo install -d -o <포털 운영 계정> -g <포털 운영 그룹> -m 2775 /srv/Houdini /srv/Houdini/www /srv/Houdini/runtime
git clone --branch main <저장소> /srv/Houdini/ledger && chmod -R a-w /srv/Houdini/ledger   # 승인된 판, 읽기 전용
docker build -t koprifossillab/houdini-control:0.1.1 control/     # 기본 이미지는 digest로 고정
cp deploy/srv/docker-compose.yml /srv/Houdini/
install -m 640 deploy/srv/env.example /srv/Houdini/.env           # 편집기로 값 채우기
cp deploy/www/Houdini-unavailable.html /srv/Houdini/www/
```

- compose에는 `pull_policy: never`를 넣었습니다. 로컬에 승인된 이미지가 없으면 내려받지 않고 **멈춥니다.**
- 미디어 목록 형식: `[{id, file(이름만), title, stage, origin(physics|procedural|render|example), model, sampling, caveat, sha256}]`
- `sha256`이 실제 파일과 다르면 서비스가 그 파일을 내보내지 않습니다(409).

## 3. 실행과 확인

```bash
cd /srv/Houdini && docker compose up -d web
docker compose ps                                   # (healthy)
curl -s http://127.0.0.1:8097/Houdini/healthz       # 열려 있는 유일한 주소, 연구정보 없음
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8097/Houdini/   # 403 (TLS 아님)
```

## 4. HTTPS (A4·A5)

1. 인증서와 키를 준비합니다. 기관 또는 사내 CA에서 발급하고, 키는 root 전용 권한으로 둡니다.
2. `nginx/Houdini-https-server.conf`를 **새** 사이트 파일로 추가합니다. 머리말에 순서가 있습니다.
3. `nginx/Houdini-http-redirect.conf`를 포털 블록에 include **한 줄**로 넣습니다.
4. `sudo nginx -t && sudo systemctl reload nginx`

확인:

```bash
curl -sI  http://<서버>/Houdini/                        # 301 → https://<서버>/Houdini/
curl -s  -o /dev/null -w '%{http_code}\n' https://<서버>/Houdini/              # 401 (인증 요구)
curl -s  -o /dev/null -w '%{http_code}\n' https://<서버>/Houdini/healthz       # 200
curl -sI http://<서버>/api/                              # 포털 기존 응답 그대로
```

## 5. 롤백

| 상황 | 조치 |
|---|---|
| 새 판이 이상함 | `.env`의 `IMAGE_TAG`를 이전 판으로 → `docker compose up -d web` |
| 서비스를 잠시 내림 | `docker compose stop web`. Nginx가 502와 함께 안내 페이지를 보여 줌 |
| 완전히 걷어 냄 | 사이트 링크와 include 줄 삭제 → `nginx -t && reload` → `docker compose down` → 조각·토큰 파일 삭제 |

이 서비스는 아무 데도 쓰지 않습니다. 그래서 롤백할 때 되돌릴 데이터가 없습니다.

## 6. 지키는 것

- **인증**: `/healthz`를 뺀 모든 주소(메인 화면, 정적 파일, 상태·보고서·이력·미디어 API)는 인증이 필요합니다. 계정이 설정되지 않으면 전부 잠깁니다.
- **TLS**: TLS가 아닌 요청은 인증 요구(Basic challenge)를 보내기 전에 403으로 거절합니다. `https`라고 주장할 수 있는 쪽은 신뢰 프록시 주소에서 프록시 토큰까지 맞게 보낸 요청뿐입니다.
- **인증 처리 부하**: scrypt는 비동기로 돌리고, 동시 2개·대기 4개로 제한합니다. 실패는 출발지당 5분에 8회, 전체 1분에 60회까지만 받고, 넘으면 해싱 없이 즉시 429를 돌려줍니다. 인증에 성공하면 결과를 10분간 기억합니다(인증 헤더의 해시만 저장).
- **컨테이너**: 입력은 모두 `:ro`로 붙이고, 루트 파일시스템도 읽기 전용입니다. `cap_drop: ALL`, `no-new-privileges`를 적용하고 uid 1000으로 실행하며, 포트는 루프백에만 엽니다.
- 3–5초 관측, 계산 실행, 승인 기록 기능은 없습니다.
