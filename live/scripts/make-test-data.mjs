#!/usr/bin/env node
// Synthetic TEST scene for the viewer prototype — NOT the Thermal Collapse model (감독 결정 22 2항: 모델 계산 금지 구간).
// Four elements laid out like the shot (pink weak layer under a gray and a blue rock, blue basal pieces at the blue toe)
// with a simple prescribed stretch, so rotate / zoom / frame selection can be checked on screen.
//   node scripts/make-test-data.mjs <out dir> [frames=48]
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encodeMesh } from '../lib/mesh.mjs';

const [out, nfArg] = process.argv.slice(2);
if (!out) { console.error('사용법: make-test-data.mjs <출력 폴더> [프레임 수]'); process.exit(64); }
const NF = Math.max(2, Math.min(300, Number(nfArg || 48)));
const self = await fs.readFile(fileURLToPath(import.meta.url));
const sha = crypto.createHash('sha256').update(self).digest('hex');   // "model" hash of a test scene = this script

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// box from 8 corners, split into nx segments along x so the slab can bend
function box(m, elem, x0, x1, y0, y1, z0, z1, nx = 1, topFn = null, xfm = null) {
  const base = m.elements.length;
  for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * i / nx;
    for (const [y, z] of [[y0, z0], [y0, z1], [y1, z0], [y1, z1]]) {
      let p = [x, y === y1 && topFn ? y + topFn(x, z) : y, z];
      if (xfm) p = xfm(p);
      m.positions.push(...p); m.elements.push(elem);
    }
  }
  const v = (i, k) => base + i * 4 + k;   // k: 0 bottom-near 1 bottom-far 2 top-near 3 top-far
  const q = (a, b, c, d) => m.indices.push(a, b, c, a, c, d);
  for (let i = 0; i < nx; i++) {
    q(v(i, 2), v(i + 1, 2), v(i + 1, 3), v(i, 3));    // top
    q(v(i, 0), v(i, 1), v(i + 1, 1), v(i + 1, 0));    // bottom
    q(v(i, 0), v(i + 1, 0), v(i + 1, 2), v(i, 2));    // near side
    q(v(i, 1), v(i, 3), v(i + 1, 3), v(i + 1, 1));    // far side
  }
  q(v(0, 0), v(0, 2), v(0, 3), v(0, 1));              // left end
  q(v(nx, 0), v(nx, 1), v(nx, 3), v(nx, 2));          // right end
}

const pieces = Array.from({ length: 28 }, (_, i) => ({ x: 3.0 + (i % 7) * 0.32 + rnd() * 0.1, z: -0.8 + Math.floor(i / 7) * 0.45 + rnd() * 0.1,
  s: 0.12 + rnd() * 0.16, h: 0.08 + rnd() * 0.12, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 1.6, go: 0.15 + rnd() * 0.5, drift: 0.8 + rnd() * 1.6 }));

await fs.mkdir(path.join(out), { recursive: true });
const index = { schema: 'tc-live-frames/1', model_sha256: sha, label: '합성 테스트 장면 — 실제 Thermal Collapse 모델 아님', frames: [] };
for (let f = 1; f <= NF; f++) {
  const t = (f - 1) / (NF - 1), s = smooth(t);
  const m = { positions: [], elements: [], indices: [] };
  const stretch = 1 + 0.7 * s;
  box(m, 0, -4.2 * stretch, 4.6 * stretch + 0.6 * s, -0.35 + 0.12 * s, 0, -1.1, 1.1, 24, null,
    ([x, y, z]) => [x, y - 0.18 * s * Math.exp(-((x - 0.2) ** 2) / 0.8), z]);                                   // pink: stretches, sags at the gap
  const ridge = (a, k) => (x, z) => a * (0.55 + 0.45 * Math.sin(x * k + 1.3) * Math.cos(z * 1.7));
  box(m, 1, -3.8 - 1.0 * s, -0.4 - 1.0 * s, 0, 0.9, -1.0, 1.0, 10, ridge(0.5, 2.1));                         // gray: moves left, stays whole
  box(m, 2, 0.5 + 1.4 * s, 3.2 + 1.9 * s, 0.12, 0.85 - 0.2 * s, -0.95, 0.95, 10, ridge(0.45, 2.6));          // blue body: moves right, thins
  for (const p of pieces) {                                                                                  // blue basal pieces: leave and ride right
    const free = smooth((t - p.go) / 0.25);
    const cx = p.x + 1.4 * s + p.drift * free * (t - p.go > 0 ? t - p.go : 0) * 2, cz = p.z, a = p.rot + p.spin * free;
    const ca = Math.cos(a), sa = Math.sin(a), tilt = 0.35 * free;
    box(m, 3, -p.s, p.s, 0, p.h, -p.s * 0.8, p.s * 0.8, 1, null,
      ([x, y, z]) => [cx + x * ca - z * sa, 0.02 + y + x * tilt * 0.5 - 0.06 * free, cz + x * sa + z * ca]);
  }
  const buf = encodeMesh(m);
  const file = `f${String(f).padStart(4, '0')}.bin`;
  await fs.writeFile(path.join(out, file), buf);
  index.frames.push({ frame: f, file, source: 'test', sha256: crypto.createHash('sha256').update(buf).digest('hex') });
}
await fs.writeFile(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
console.log(`테스트 장면 ${NF} 프레임 → ${out} (모델 해시 = 이 스크립트 ${sha.slice(0, 12)})`);
