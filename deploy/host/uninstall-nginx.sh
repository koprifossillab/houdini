#!/bin/bash
# install-nginx.sh 되돌리기 (root): include 줄과 주석 줄을 빼고 조각을 치운 뒤 nginx -t && reload.
# /srv/Houdini 와 컨테이너는 그대로 둔다(docker compose down 은 따로).
set -euo pipefail
SITE=/etc/nginx/sites-enabled/phyloserver
SNIP=/etc/nginx/snippets/Houdini-subpath.conf
STAMP=$(date +%Y%m%d_%H%M%S)
[ "$(id -u)" = 0 ] || { echo "root 로 실행: sudo bash $0" >&2; exit 1; }
BAK="/etc/nginx/sites-available/phyloserver.bak-$STAMP-houdini-uninstall"   # never in sites-enabled
RM="/etc/nginx/sites-available/Houdini-subpath.conf.removed-$STAMP"            # never in snippets (not loaded anyway)
cp -p "$SITE" "$BAK"
grep -vF -e '    include snippets/Houdini-subpath.conf;' -e '# Houdini Production Control (/Houdini/).' "$BAK" > "$SITE"
[ -f "$SNIP" ] && mv "$SNIP" "$RM"
if nginx -t; then systemctl reload nginx; echo "걷어 냄 — 백업: $BAK"; else cp -p "$BAK" "$SITE"; [ -f "$RM" ] && mv "$RM" "$SNIP"; echo "nginx -t 실패 — 원래대로 둠" >&2; exit 1; fi
