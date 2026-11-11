#!/usr/bin/env bash
# 관제실 배포 후 관찰 (읽기 전용) — TC-DASH-011 C. 운영 코드와 무관한 운영 도구이며 이미지에 들어가지 않는다.
#
#   시작:  observe.sh start <로그 파일> <기대 판 번호> <기대 이미지 ID> [회수=30] [간격 초=60]
#          → 세션과 분리된 프로세스(setsid nohup)로 실행. 터미널·Claude 세션이 끝나도 계속 돈다.
#   판정:  observe.sh verdict <로그 파일> [회수=30]
#          → COMPLETE(0) 모든 회차 기록 + 종료 줄 + 이상 0 / ANOMALY(1) 이상 기록 있음 /
#            INCOMPLETE(2) 종료 줄 없음·회차 빠짐·순서 어긋남 — 관찰 누락을 PASS 로 읽지 않는다.
#   상태:  observe.sh status <로그 파일>   → 실행 중이면 RUNNING pid, 아니면 STOPPED
#
# 환경 변수: OBS_BASE(기본 http://127.0.0.1:8097/Houdini) OBS_CONTAINER(기본 houdini-web-1)
#            OBS_CHECK(점검기 경로, 있으면 중간에 1회 재실행) OBS_RECHECK_AT(재실행할 회차, 기본 22)
#            OBS_LEAK_TERMS(점검기 노출 검사 단어) OBS_ROADMAP_MIN(로드맵 최소 판, 기본 4)
set -u
cmd=${1:-}; shift || true

verdict() {
  local log=$1 n=${2:-30}
  [ -f "$log" ] || { echo "INCOMPLETE  기록 파일 없음"; return 2; }
  local seq got anom end
  got=$(grep -cE '^[0-9:]{8} #[0-9]+ (OK|ANOMALY) ' "$log")
  anom=$(grep -cE '^[0-9:]{8} #[0-9]+ ANOMALY |ANOMALY$' "$log")
  seq=$(grep -oE '^[0-9:]{8} #[0-9]+ ' "$log" | awk '{sub("#","",$2); printf "%s ", $2}')
  end=$(grep -cE '^# end ' "$log")
  local want; want=$(seq 1 "$n" | tr '\n' ' ')
  if [ "$anom" -gt 0 ]; then echo "ANOMALY     이상 기록 ${anom}건 (기록 ${got}/${n})"; return 1; fi
  if [ "$end" != 1 ] || [ "$seq" != "$want" ]; then
    echo "INCOMPLETE  기록 ${got}/${n}회 · 종료 줄 $([ "$end" = 1 ] && echo 있음 || echo 없음) — 빠진 회차는 UNVERIFIED, PASS 로 보지 않음"; return 2
  fi
  echo "COMPLETE    ${n}/${n}회 · 이상 0 · 종료 줄 있음"; return 0
}

run() {
  local log=$1 ver=$2 id=$3 n=${4:-30} gap=${5:-60}
  local B=${OBS_BASE:-http://127.0.0.1:8097/Houdini} C=${OBS_CONTAINER:-houdini-web-1} RA=${OBS_RECHECK_AT:-22} RMIN=${OBS_ROADMAP_MIN:-4}
  local start cg; start=$(docker inspect "$C" --format '{{.State.StartedAt}}')
  cg=/sys/fs/cgroup/system.slice/docker-$(docker inspect "$C" --format '{{.Id}}').scope
  echo "# observe $ver start=$start samples=$n gap=${gap}s pid=$$" >> "$log"
  local i
  for i in $(seq 1 "$n"); do
    local img st mem hz lv anon loc pub rm rp errs ok
    img=$(docker inspect "$C" --format '{{.Image}}'); st=$(docker inspect "$C" --format '{{.State.StartedAt}} {{.State.Health.Status}} {{.RestartCount}}')
    mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$C" | cut -d/ -f1 | tr -d ' ')
    hz=$(curl -s -o /dev/null -w '%{http_code}' "$B/healthz"); lv=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/live")
    anon=$(awk '$1=="anon"{printf "%.1fMiB", $2/1048576}' "$cg/memory.stat" 2>/dev/null)
    loc=$(curl -s "$B/api/session" | python3 -I -c 'import json,sys;print(json.load(sys.stdin).get("local_detail"))' 2>/dev/null)
    pub=$(curl -s -H 'X-Real-IP: 198.51.100.7' "$B/api/session" | python3 -I -c 'import json,sys;print(json.load(sys.stdin).get("public"))' 2>/dev/null)
    rm=$(curl -s "$B/api/roadmap" | python3 -I -c 'import json,sys;p=json.load(sys.stdin)["projects"][0];print(str(p["version"])+"/"+str(len(p["glance"])))' 2>/dev/null)
    rp=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/roadmap")
    errs=$(docker logs --since "$start" "$C" 2>&1 | grep -c '"error"')
    ok=OK
    { [ "$img" = "$id" ] && [ "${st%% *}" = "$start" ] && [[ "$st" == *" healthy 0" ]] && [ "$hz" = 200 ] && [ "$lv" = 200 ] \
      && [ "$pub" = None ] && [ "$loc" = False ] && [ "$errs" = 0 ] && [ "${rm%%/*}" -ge "$RMIN" ] 2>/dev/null && [ "${rm#*/}" = 8 ] && [ "$rp" = 405 ]; } || ok=ANOMALY
    echo "$(date '+%H:%M:%S') #$i $ok img=${img:7:12} $st mem=$mem anon=$anon healthz=$hz live=$lv local_detail=$loc remote_public=$pub roadmap=$rm roadmap_post=$rp errors=$errs" >> "$log"
    if [ "$i" = "$RA" ] && [ -n "${OBS_CHECK:-}" ]; then
      if CHECK_EXPECT_VERSION=$ver CHECK_LEAK_TERMS="${OBS_LEAK_TERMS:-}" bash "$OBS_CHECK" "$B" > "$log.recheck.txt" 2>&1; then echo "$(date '+%H:%M:%S') 중간 상세 점검 재실행: 통과" >> "$log"; else echo "$(date '+%H:%M:%S') 중간 상세 점검 재실행: ANOMALY" >> "$log"; fi
    fi
    [ "$i" -lt "$n" ] && sleep "$gap"
  done
  echo "# end $(date '+%H:%M:%S') samples=$n anomalies=$(grep -cE ' ANOMALY |ANOMALY$' "$log")" >> "$log"
}

case "$cmd" in
  start)
    [ $# -ge 3 ] || { echo "사용법: observe.sh start <로그> <판> <이미지 ID> [회수] [간격]"; exit 64; }
    [ -e "$1" ] && { echo "기록 파일이 이미 있음 — 덮어쓰지 않음: $1"; exit 1; }
    : > "$1"
    setsid nohup bash "$0" _run "$@" > /dev/null 2>&1 < /dev/null &
    echo $! > "$1.pid"; echo "관찰 시작 pid $(cat "$1.pid") — 세션과 분리됨. 판정: observe.sh verdict $1";;
  _run) run "$@";;
  verdict) verdict "$@"; exit $?;;
  status)
    p=$(cat "$1.pid" 2>/dev/null); if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo "RUNNING $p"; else echo "STOPPED"; fi;;
  *) sed -n '2,15p' "$0"; exit 64;;
esac
