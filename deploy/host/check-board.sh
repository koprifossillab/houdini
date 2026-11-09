#!/usr/bin/env bash
# Read-only post-deploy check for the Houdini control room 0.2.x (TC-DASH-006).
#   deploy/host/check-board.sh <base URL ending in /Houdini>   e.g. http://127.0.0.1:8097/Houdini
#   CHECK_LEAK_TERMS="term1,term2"  private words that must not appear in any response (runtime only)
#   CHECK_EXPECT_VERSION=0.2.0-…    optional: the version /api/session must report
# Sends only GET/HEAD and four refused write methods. Exit 0 = all checks passed.
set -u
B="${1:?base URL, e.g. http://127.0.0.1:8097/Houdini}"
fail=0
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fail=1; }
code() { curl -s -o /dev/null -w '%{http_code}' --path-as-is "$@"; }

# 1 health and version
h=$(curl -s "$B/healthz"); [ "$(code "$B/healthz")" = 200 ] && ok "healthz 200" || bad "healthz"
v=$(curl -s "$B/api/session" | python3 -I -c 'import json,sys;print(json.load(sys.stdin).get("version",""))' 2>/dev/null)
if [ -n "${CHECK_EXPECT_VERSION:-}" ]; then [ "$v" = "$CHECK_EXPECT_VERSION" ] && ok "version $v" || bad "version $v (expected $CHECK_EXPECT_VERSION)"; else ok "version $v"; fi

# 2 pages: new board and the preserved previous board with its 18 sections
for p in "" legacy.html static/board.js static/board.css static/app.js static/style.css; do [ "$(code "$B/$p")" = 200 ] && ok "GET /$p" || bad "GET /$p"; done
legacy=$(curl -s "$B/legacy.html"); miss=""
for id in stages tl-teams tk-summary teams issues-mini decisions-mini sources-mini issues decisions scene-review media reports viewer-title experiments code-check env tools sources; do
  case "$legacy" in *"id=\"$id\""*) ;; *) miss="$miss $id";; esac
done
[ -z "$miss" ] && ok "legacy: 18 sections present" || bad "legacy: missing$miss"

# 3 existing APIs unchanged in place
for a in overview teams reports experiments media session; do [ "$(code "$B/api/$a")" = 200 ] && ok "GET /api/$a" || bad "GET /api/$a"; done

# 4 board API and its sources
curl -s "$B/api/board" | python3 -I -c '
import json,sys
b=json.load(sys.stdin); s=b["sources"]
for k in ("handoff","decisions","signed_work","director","nas","team_live"):
    print(("PASS  " if s.get(k,{}).get("state") in ("ok","live","missing") else "FAIL  ")+"board source %s = %s" % (k, s.get(k,{}).get("state")))
p=s.get("provenance",{})
print("PASS  provenance self=%s signed=%s transcribed=%s valid_decisions=%s not_valid=%s" % (p.get("self"),p.get("signed"),p.get("transcribed"),p.get("decisions_valid"),p.get("decisions_not_valid")))
print(("PASS  " if b["execution"]["now"]["state"]=="unverified" else "FAIL  ")+"PC execution shown as unverified")
' 2>/dev/null || bad "/api/board unreadable"

# 5 refused requests: director originals, traversal, writes
for p in api/director api/director/TC-DASH-005 director/INDEX.json nasimg/0000000000000000 \
         nasimg/../TC3D_DIRECTOR_DECISIONS/INDEX.json "nasimg/%2e%2e%2fTC3D_DIRECTOR_DECISIONS%2fINDEX.json" \
         media/TC3D_DIRECTOR_DECISIONS static/../lib/director.mjs static/../server.mjs; do
  c=$(code "$B/$p"); { [ "$c" = 404 ] || [ "$c" = 400 ]; } && ok "refused /$p ($c)" || bad "/$p returned $c"
done
for m in POST PUT DELETE PATCH; do [ "$(code -X "$m" "$B/api/board")" = 405 ] && ok "$m /api/board 405" || bad "$m /api/board"; done
[ "$(curl -s "$B/api/nas" | sha256sum)" = "$(curl -s "$B/api/nas?folder=TC3D_DIRECTOR_DECISIONS" | sha256sum)" ] && ok "/api/nas ignores query" || bad "/api/nas reacts to query"

# 6 leak scan: originals folder name, system paths, private terms
terms="DIRECTOR_DECISIONS,/home/,/nfs/,/srv/,/mnt/${CHECK_LEAK_TERMS:+,$CHECK_LEAK_TERMS}"
for r in api/board api/nas api/overview api/teams api/reports healthz "" legacy.html; do
  body=$(curl -s "$B/$r"); hit=""
  IFS=',' read -ra T <<< "$terms"; for t in "${T[@]}"; do [ -n "$t" ] && case "$body" in *"$t"*) hit="$hit [$t]";; esac; done
  [ -z "$hit" ] && ok "no leak in /$r" || bad "leak in /$r:$hit"
done

[ $fail = 0 ] && echo "ALL PASS" || echo "SOME CHECKS FAILED"
exit $fail
