#!/bin/bash
# Houdini Production Control — 서버 쪽 한 번 설치 (root 로: sudo bash install-nginx.sh)
#   1) /srv/Houdini (paleoadmin:paleoadmin 2775) 와 안내 페이지
#   2) /etc/nginx/snippets/Houdini-subpath.conf
#   3) 포털 server 블록에 include 한 줄 (kopricyberfossillab include 바로 아래) — 원본은 백업
#   4) nginx -t 통과할 때만 reload. 실패하면 설정을 백업으로 되돌리고 멈춘다.
# 다시 돌려도 안전하다(이미 있으면 건너뜀). 되돌리기: uninstall-nginx.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE=/etc/nginx/sites-enabled/phyloserver
SNIP=/etc/nginx/snippets/Houdini-subpath.conf
ANCHOR='    include snippets/kopricyberfossillab-subpath.conf;'
LINE='    include snippets/Houdini-subpath.conf;'
STAMP=$(date +%Y%m%d_%H%M%S)

[ "$(id -u)" = 0 ] || { echo "root 로 실행: sudo bash $0" >&2; exit 1; }
[ -f "$SITE" ] || { echo "포털 설정 없음: $SITE" >&2; exit 1; }

echo "[1/4] /srv/Houdini"
install -d -o paleoadmin -g paleoadmin -m 2775 /srv/Houdini /srv/Houdini/www /srv/Houdini/runtime
install -o paleoadmin -g paleoadmin -m 664 "$REPO/deploy/www/Houdini-unavailable.html" /srv/Houdini/www/

echo "[2/4] nginx 조각"
[ -f "$SNIP" ] && cp -p "$SNIP" "$SNIP.bak-$STAMP"
install -m 644 "$REPO/deploy/nginx/Houdini-subpath-http.conf" "$SNIP"

echo "[3/4] 포털 server 블록에 include 한 줄"
if grep -qF "$LINE" "$SITE"; then
  echo "  이미 있음 — 건너뜀"
else
  n=$(grep -cxF "$ANCHOR" "$SITE" || true)
  [ "$n" = 1 ] || { echo "  기준 줄이 정확히 한 번 있어야 함(지금 $n) — 손대지 않고 멈춤" >&2; exit 1; }
  cp -p "$SITE" "$SITE.bak-$STAMP-houdini"
  awk -v a="$ANCHOR" -v l="$LINE" '{print} $0==a{print "    # Houdini Production Control (/Houdini/). 실체는 houdini 저장소의 deploy/nginx/Houdini-subpath-http.conf"; print l}' "$SITE.bak-$STAMP-houdini" > "$SITE"
  diff "$SITE.bak-$STAMP-houdini" "$SITE" || true
fi

echo "[4/4] nginx -t && reload"
if nginx -t; then
  systemctl reload nginx
  echo "완료 — 백업: $SITE.bak-$STAMP-houdini (include 를 더했을 때만)"
else
  echo "nginx -t 실패 — 되돌린다" >&2
  [ -f "$SITE.bak-$STAMP-houdini" ] && cp -p "$SITE.bak-$STAMP-houdini" "$SITE"
  if [ -f "$SNIP.bak-$STAMP" ]; then cp -p "$SNIP.bak-$STAMP" "$SNIP"; else rm -f "$SNIP"; fi
  nginx -t && echo "원래 설정으로 복구됨(reload 하지 않음)"
  exit 1
fi
