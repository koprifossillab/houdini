#!/bin/bash
# 관제실 열람 계정 추가·변경 (paleoadmin 또는 docker 그룹 사용자): bash /srv/Houdini/set-viewer.sh [이름]
# 비밀번호는 화면에 보이지 않게 두 번 입력받아, 해시만 .env 의 HPC_USERS 에 넣는다(평문은 어디에도 남지 않음).
# 끝나면 컨테이너를 다시 만들어 새 계정을 읽힌다.
set -euo pipefail
cd /srv/Houdini
NAME="${1:-viewer}"
[[ "$NAME" =~ ^[a-z0-9_.-]{1,40}$ ]] || { echo "이름은 소문자·숫자·_.- 만" >&2; exit 1; }
TAG=$(grep -m1 '^IMAGE_TAG=' .env | cut -d= -f2)
read -rsp "새 비밀번호(12자 이상): " PW; echo
read -rsp "한 번 더: " PW2; echo
[ "$PW" = "$PW2" ] || { unset PW PW2; echo "두 입력이 다름" >&2; exit 1; }
ENTRY=$(printf %s "$PW" | docker run --rm -i --network none "koprifossillab/houdini-control:$TAG" node scripts/hash-password.mjs "$NAME")
unset PW PW2
CUR=$(grep -m1 '^HPC_USERS=' .env | cut -d= -f2- || true)
NEW=$(printf '%s' "$CUR" | tr ';' '\n' | grep -v "^$NAME:" | grep -v '^<' | grep -v '^$' | { cat; echo "$ENTRY"; } | paste -sd ';')
TMP=$(mktemp .env.XXXXXX)
grep -v '^HPC_USERS=' .env > "$TMP"; printf 'HPC_USERS=%s\n' "$NEW" >> "$TMP"
chmod 660 "$TMP"; mv "$TMP" .env
docker compose up -d web >/dev/null
echo "계정 '$NAME' 설정 완료 — 관제실이 새 계정으로 다시 시작됨"
