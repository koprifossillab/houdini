#!/usr/bin/env bash
# Thermal Collapse LIVE — isolated one-frame computation (감독 결정 22·24 조건). Read only on everything but the output folder.
#   run_frame.sh <model.py> <expected sha256> <frame> <output folder>
# Isolation: --network none · the invoking non-root uid · read-only root · cap-drop ALL · no-new-privileges ·
#            1 CPU · 2 GiB memory (no swap) · 64 pids · 300 s (killed on timeout) · 200 MiB per file · no Docker socket, no home, no secrets mounted.
# The Python + numpy used are an existing interpreter, mounted read only; the base image only provides libc.
set -u
MODEL=$1 SHA=$2 FRAME=$3 OUT=$4
PY=${TCLIVE_PY:-/home/shkim/tools/blender-5.2.2-linux-x64/5.2/python}
SITE=${TCLIVE_SITE:-/home/shkim/venv/houdini-tc/lib/python3.13/site-packages}
HERE=$(cd "$(dirname "$0")" && pwd)
LIMIT=${TCLIVE_TIMEOUT:-300}
# ② QA 0.4.2 REVIEW 2: an integer 1–300 only (timeout 0 would mean no limit)
[[ "$LIMIT" =~ ^[0-9]{1,3}$ ]] && [ "$LIMIT" -ge 1 ] && [ "$LIMIT" -le 300 ] || { echo "TCLIVE_TIMEOUT 은 1–300 정수만"; exit 2; }
[ "$(sha256sum "$MODEL" | cut -c1-64)" = "$SHA" ] || { echo "모델 해시 불일치 — 실행 안 함"; exit 2; }
[ -d "$OUT" ] && [ -z "$(ls -A "$OUT")" ] || { echo "출력 폴더는 비어 있는 기존 폴더여야 함"; exit 2; }
F=$(printf 'f%04d.bin' "$FRAME")
# ② QA REVIEW b: the model writes into a fresh empty folder; the host checks the one expected mesh file and moves
# only that file into OUT (the index is written by the host, never by the container)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/tclive-frame.XXXXXX")
NAME="tclive-frame-$$"
# ② QA 10c7cb8 REVIEW 1: timeout only ends the docker client — the container itself is killed here on every exit path
trap 'docker kill "$NAME" >/dev/null 2>&1; docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
timeout --kill-after=10 "$LIMIT" docker run --rm --name "$NAME" \
  --network none --user "$(id -u):$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --cpus 1 --memory 2g --memory-swap 2g --pids-limit 64 --ulimit fsize=209715200:209715200 \
  --tmpfs /tmp:size=16m,mode=1777 -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
  -v "$PY":/opt/py:ro -v "$SITE":/opt/site:ro \
  -v "$MODEL":/in/model.py:ro -v "$HERE/compute_frame.py":/in/compute_frame.py:ro \
  -v "$WORK":/out \
  python:3.12-slim /opt/py/bin/python3.13 -I -B /in/compute_frame.py --model /in/model.py --sha "$SHA" --frame "$FRAME" --out "/out/$F"
rc=$?
[ $rc = 0 ] || { echo "계산 실패 (rc $rc) — 결과 옮기지 않음"; exit $rc; }
[ "$(ls -A "$WORK")" = "$F" ] || { echo "출력 폴더에 예상 밖 파일: $(ls -A "$WORK" | tr '\n' ' ') — 결과 옮기지 않음"; exit 3; }
[ -f "$WORK/$F" ] && [ ! -L "$WORK/$F" ] || { echo "출력 파일이 일반 파일이 아님 — 결과 옮기지 않음"; exit 3; }
# ② QA 10c7cb8 REVIEW 2: size first (the container is also capped at 200 MiB per file by --ulimit fsize)
[ "$(stat -c %s "$WORK/$F")" -le 125829120 ] || { echo "출력 파일이 너무 큼(120 MiB 초과) — 결과 옮기지 않음"; exit 3; }
node --input-type=module -e "import {checkMesh} from '$HERE/../../control/lib/tclive-mesh.mjs'; import fs from 'node:fs'; process.exit(checkMesh(fs.readFileSync(process.argv[1])) ? 0 : 1)" "$WORK/$F" \
  || { echo "TCM1 형식 검사 실패 — 결과 옮기지 않음"; exit 3; }
mv "$WORK/$F" "$OUT/$F" && chmod 444 "$OUT/$F" && echo "옮김: $F"
