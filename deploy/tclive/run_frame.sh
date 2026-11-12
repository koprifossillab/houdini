#!/usr/bin/env bash
# Thermal Collapse LIVE — isolated one-frame computation (감독 결정 22·24 조건). Read only on everything but the output folder.
#   run_frame.sh <model.py> <expected sha256> <frame> <output folder>
# Isolation: --network none · the invoking non-root uid · read-only root · cap-drop ALL · no-new-privileges ·
#            1 CPU · 2 GiB memory (no swap) · 64 pids · 300 s · no Docker socket, no home, no secrets mounted.
# The Python + numpy used are an existing interpreter, mounted read only; the base image only provides libc.
set -u
MODEL=$1 SHA=$2 FRAME=$3 OUT=$4
PY=${TCLIVE_PY:-/home/shkim/tools/blender-5.2.2-linux-x64/5.2/python}
SITE=${TCLIVE_SITE:-/home/shkim/venv/houdini-tc/lib/python3.13/site-packages}
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(sha256sum "$MODEL" | cut -c1-64)" = "$SHA" ] || { echo "모델 해시 불일치 — 실행 안 함"; exit 2; }
[ -d "$OUT" ] && [ -z "$(ls -A "$OUT")" ] || { echo "출력 폴더는 비어 있는 기존 폴더여야 함"; exit 2; }
F=$(printf 'f%04d.bin' "$FRAME")
exec timeout --kill-after=10 300 docker run --rm --name "tclive-frame-$$" \
  --network none --user "$(id -u):$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --cpus 1 --memory 2g --memory-swap 2g --pids-limit 64 \
  --tmpfs /tmp:size=16m,mode=1777 -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
  -v "$PY":/opt/py:ro -v "$SITE":/opt/site:ro \
  -v "$MODEL":/in/model.py:ro -v "$HERE/compute_frame.py":/in/compute_frame.py:ro \
  -v "$OUT":/out \
  python:3.12-slim /opt/py/bin/python3.13 -I -B /in/compute_frame.py --model /in/model.py --sha "$SHA" --frame "$FRAME" --out "/out/$F"
