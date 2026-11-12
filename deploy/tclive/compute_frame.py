# Thermal Collapse LIVE — compute ONE frame of a ① model as a TCM1 mesh, inside an isolated container (감독 결정 22·24).
# Runs ① 's model code, so it must only run in the sandbox (run_frame.sh): no network, non-root, read-only inputs,
# CPU / memory / time limits. The model file's SHA-256 is checked BEFORE it is imported (integrity, not safety).
#   python -I -B compute_frame.py --model /in/model.py --sha <64 hex> --frame 300 --out /out/f0300.bin
# Prints one JSON line: timings, sizes, peak memory. Writes nothing but --out.
import argparse, hashlib, importlib.util, json, resource, struct, sys, time

sys.path.insert(0, '/opt/site')          # numpy, mounted read only
import numpy as np                       # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--model', required=True); ap.add_argument('--sha', required=True)
ap.add_argument('--frame', type=int, required=True); ap.add_argument('--out', required=True)
a = ap.parse_args()

t0 = time.perf_counter()
src = open(a.model, 'rb').read()
got = hashlib.sha256(src).hexdigest()
if got != a.sha:
    print(json.dumps({'ok': False, 'error': 'model sha256 mismatch', 'got': got})); sys.exit(2)
spec = importlib.util.spec_from_file_location('tc_model', a.model)
M = importlib.util.module_from_spec(spec); spec.loader.exec_module(M)
t_import = time.perf_counter() - t0

# element ids on screen: 0 pink, 1 gray, 2 blue body, 3 blue basal pieces; br1 lens (4) is pink matrix, grit (5) is pieces
SCREEN = {0: 0, 1: 1, 2: 2, 3: 3, 4: 0, 5: 3}
t1 = time.perf_counter()
rest = {}
for e in range(6):
    try: rest[e] = M.tc_rest(e)
    except Exception: pass            # older models have elements 0–3 only
plan = M.tc_fragment_plan() if hasattr(M, 'tc_fragment_plan') else None
t_rest = time.perf_counter() - t1

t2 = time.perf_counter()
pos, elem, idx, per = [], [], [], {}
base = 0
for e, r in sorted(rest.items()):
    P = np.asarray(r['P'], float)
    key = 'island' if e == 4 else 'piece'
    pc = np.asarray(r.get(key, np.zeros(len(P), int)))
    G = np.asarray(M.tc_deform(e, P, pc, a.frame, plan if e in (3, 5) else None), float)
    if G.shape != P.shape or not np.isfinite(G).all(): print(json.dumps({'ok': False, 'error': f'element {e}: bad deform output'})); sys.exit(3)
    tris = []
    for f in r['F']:
        f = list(f)
        for k in range(1, len(f) - 1): tris.append((f[0] + base, f[k] + base, f[k + 1] + base))   # fan
    pos.append(G.astype('<f4')); elem.append(np.full(len(P), SCREEN[e], 'u1')); idx.extend(tris)
    per[e] = {'verts': len(P), 'tris': len(tris)}
    base += len(P)
t_deform = time.perf_counter() - t2

P = np.concatenate(pos); E = np.concatenate(elem); I = np.asarray(idx, '<u4').reshape(-1)
nv, nt = len(E), len(I) // 3
buf = b'TCM1' + struct.pack('<III', nv, nt, 0) + P.reshape(-1).tobytes() + E.tobytes() + b'\0' * (((nv + 3) & ~3) - nv) + I.tobytes()
with open(a.out, 'wb') as fh: fh.write(buf)
print(json.dumps({'ok': True, 'frame': a.frame, 'model_sha256': got, 'seconds': {'import': round(t_import, 3), 'rest_and_plan': round(t_rest, 3),
  'deform_frame': round(t_deform, 3), 'total': round(time.perf_counter() - t0, 3)}, 'mesh': {'verts': nv, 'tris': nt, 'bytes': len(buf), 'per_element': per},
  'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}))
