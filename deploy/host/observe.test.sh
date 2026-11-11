#!/usr/bin/env bash
# observe.sh verdict 시험 — 관찰 누락·이상을 COMPLETE 로 읽지 않는지 (TC-DASH-011 C). 실행: bash deploy/host/observe.test.sh
set -u
O="$(dirname "$0")/observe.sh"; D=$(mktemp -d); trap 'rm -rf "$D"' EXIT; fail=0
mk() { echo "# observe t"; for i in $(seq 1 "$1"); do echo "10:00:0$i #$i OK img=x errors=0"; done; }
t() { bash "$O" verdict "$2" "${4:-3}" > /dev/null; local r=$?; [ "$r" = "$3" ] && echo "ok   $1" || { echo "FAIL $1 (exit $r, 기대 $3)"; fail=1; }; }
{ mk 3; echo "# end 10:00:04 samples=3 anomalies=0"; } > "$D/ok";               t '모든 회차 + 종료 줄 = COMPLETE' "$D/ok" 0
mk 3 > "$D/noend";                                                             t '종료 줄 없음 = INCOMPLETE' "$D/noend" 2
{ mk 2; echo "# end 10:00:04 samples=3 anomalies=0"; } > "$D/short";            t '회차 부족 = INCOMPLETE' "$D/short" 2
{ mk 3 | grep -v '#2 '; echo "# end x"; } > "$D/gap";                           t '중간 회차 빠짐 = INCOMPLETE' "$D/gap" 2
{ mk 3 | sed 's/#2 OK/#2 ANOMALY/'; echo "# end x"; } > "$D/anom";              t '이상 기록 = ANOMALY' "$D/anom" 1
{ mk 2 | sed 's/#2 OK/#2 ANOMALY/'; } > "$D/anomshort";                         t '이상 + 누락 = ANOMALY 우선' "$D/anomshort" 1
{ mk 3; echo "10:00:05 중간 상세 점검 재실행: ANOMALY"; echo "# end x"; } > "$D/re"; t '중간 재점검 실패 = ANOMALY' "$D/re" 1
t '기록 파일 없음 = INCOMPLETE' "$D/missing" 2
{ mk 3; echo "# end x"; } > "$D/n30";                                           t '회수 30 기대에 3회 = INCOMPLETE' "$D/n30" 2 30
exit $fail
