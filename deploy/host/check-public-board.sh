#!/usr/bin/env bash
# Read-only post-deploy check of the PUBLIC view of the control room 0.3.x (TC-DASH-008 운영 공개 정책).
#   deploy/host/check-public-board.sh <base URL ending in /Houdini>   e.g. http://127.0.0.1:8097/Houdini
#   CHECK_LEAK_TERMS="term1,term2"  private words that must not appear in any response (runtime only, never printed)
#   CHECK_EXPECT_VERSION=0.3.0      the version /api/session must report
# Sends only GET/HEAD and refused write methods. Exit 0 = all checks passed.
set -u
B="${1:?base URL, e.g. http://127.0.0.1:8097/Houdini}"
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fail=1; }
# TC-DASH-009: pose as a remote client forwarded by nginx (a viewer on this computer gets the detailed views)
RH='X-Real-IP: 198.51.100.7'
code() { curl -s -H "$RH" -o /dev/null -w '%{http_code}' --path-as-is "$@"; }

# 1 health: public form only (status, service, version)
h=$(curl -s -H "$RH" "$B/healthz")
echo "$h" | python3 -I -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if set(d)=={"status","service","version"} and d["status"]=="ok" else 1)' && ok "healthz 공개 형식" || bad "healthz 형식"
v=$(curl -s -H "$RH" "$B/api/session" | python3 -I -c 'import json,sys;d=json.load(sys.stdin);print(d.get("version","") if d.get("public") is True else "NOT-PUBLIC")' 2>/dev/null)
[ "$v" = "${CHECK_EXPECT_VERSION:-$v}" ] && [ "$v" != NOT-PUBLIC ] && ok "version $v · public" || bad "version/public: $v (expected ${CHECK_EXPECT_VERSION:-?})"

# 2 public files and APIs open; detailed screens and APIs closed
for p in "" static/public.js static/board.css static/icon.svg api/board api/live; do [ "$(code "$B/$p")" = 200 ] && ok "GET /$p 200" || bad "GET /$p"; done
for p in legacy.html static/board.js static/app.js api/overview api/teams api/nas api/reports api/experiments api/media; do [ "$(code "$B/$p")" = 404 ] && ok "GET /$p 404" || bad "GET /$p 열려 있음"; done

# 3 no change times: no Last-Modified / check-time header; body and ETag stable across two requests
hd=$(curl -s -H "$RH" -D - -o /dev/null "$B/api/live")
case "$hd" in *[Ll]ast-[Mm]odified*|*[Xx]-[Ll]ive-[Cc]hecked*) bad "시각 헤더 있음";; *) ok "Last-Modified·확인 시각 헤더 없음";; esac
e1=$(curl -s -H "$RH" -D - -o /dev/null "$B/api/live" | grep -i '^etag'); e2=$(curl -s -H "$RH" -D - -o /dev/null "$B/api/live" | grep -i '^etag')
[ -n "$e1" ] && [ "$e1" = "$e2" ] && ok "ETag 연속 요청 동일" || bad "ETag 변동"

# 4 full exposure crawl (closed vocabulary + private patterns), same checker the tests use
out=$(CHECK_LEAK_TERMS="${CHECK_LEAK_TERMS:-}" node "$HERE/../../control/scripts/check-public.mjs" "$B"); rc=$?   # rc of node itself, not of a pipe
printf '%s\n' "$out" | tail -3
[ $rc = 0 ] && ok "공개 노출 크롤" || bad "공개 노출 크롤"

# 5 (② QA REVIEW 421763a-1) the real nginx: a request through the portal from a NON-loopback address of this
#   host must get the public view, also with a forged X-Real-IP — proves nginx overwrites the header in production.
#   CHECK_PORTAL=http://<host LAN address>/Houdini  CHECK_PORTAL_FROM=<that address>  (both optional; skipped if unset)
if [ -n "${CHECK_PORTAL:-}" ] && [ -n "${CHECK_PORTAL_FROM:-}" ]; then
  pp() { curl -s --interface "$CHECK_PORTAL_FROM" "$@" "$CHECK_PORTAL/api/session" | python3 -I -c 'import json,sys;print(json.load(sys.stdin).get("public") is True)' 2>/dev/null; }
  [ "$(pp)" = True ] && ok "포털(실제 nginx) 비루프백 주소 → 공개" || bad "포털 비루프백 주소에 상세 화면"
  [ "$(pp -H 'X-Real-IP: 127.0.0.1')" = True ] && ok "포털 + X-Real-IP 127.0.0.1 위조 → 공개" || bad "포털 X-Real-IP 위조로 상세 화면"
  [ "$(pp -H 'X-Forwarded-For: 127.0.0.1')" = True ] && ok "포털 + X-Forwarded-For 위조 → 공개" || bad "포털 XFF 위조로 상세 화면"
else
  echo "SKIP  포털 실제 nginx 점검 (CHECK_PORTAL·CHECK_PORTAL_FROM 미지정)"
fi

[ $fail = 0 ] && echo "공개 점검 통과" || echo "공개 점검 실패"
exit $fail
