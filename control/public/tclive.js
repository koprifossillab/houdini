// Thermal Collapse LIVE viewer (감독 결정 22·23) — /Houdini/live/ page. WebGL 1, no libraries. Orbit camera, flat shading, colour by element.
(() => {
'use strict';
const $ = id => document.getElementById(id);
const COLORS = [[0.85, 0.47, 0.62], [0.56, 0.58, 0.61], [0.25, 0.44, 0.71], [0.15, 0.28, 0.48]];
const POLL_MS = 20000;
const live = window.__tcLive = { frame: null, loaded: null, cam: null, state: null, errors: [] };

// ── text helpers (all text via textContent) ──
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v); for (const c of kids.flat()) if (c != null) e.append(c); return e; };
const when = s => { if (!s) return '—'; const d = new Date(s); return `${d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('ko-KR', { hour12: false })}`; };
const short = h => (h ? `${h.slice(0, 12)}…` : '—');
function dl(node, rows) { node.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', {}, v)])); }

// ── WebGL ──
const canvas = $('gl');
const gl = canvas.getContext('webgl', { antialias: true });
if (!gl) { $('srcbadge').textContent = '이 브라우저는 WebGL 을 지원하지 않습니다'; return; }
const vs = `attribute vec3 p;attribute vec3 n;attribute vec3 c;uniform mat4 mvp;varying vec3 vn;varying vec3 vc;void main(){vn=n;vc=c;gl_Position=mvp*vec4(p,1.0);}`;
const fs = `precision mediump float;varying vec3 vn;varying vec3 vc;uniform vec3 L;void main(){vec3 N=normalize(vn);float d=max(dot(N,L),0.0);float b=max(dot(N,normalize(vec3(-0.4,0.3,-0.8))),0.0);gl_FragColor=vec4(vc*(0.45+0.62*d+0.22*b),1.0);}`;
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), c: gl.getAttribLocation(prog, 'c'), mvp: gl.getUniformLocation(prog, 'mvp'), L: gl.getUniformLocation(prog, 'L') };
const bufs = { p: gl.createBuffer(), n: gl.createBuffer(), c: gl.createBuffer() };
let count = 0, bounds = null;
gl.enable(gl.DEPTH_TEST);

// TCM1 → flat-shaded triangle soup
function parse(ab) {
  const dv = new DataView(ab);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'TCM1') throw new Error('형상 파일 형식 아님');
  const nv = dv.getUint32(4, true), nt = dv.getUint32(8, true);
  const P = new Float32Array(ab, 16, nv * 3), E = new Uint8Array(ab, 16 + nv * 12, nv), I = new Uint32Array(ab, 16 + nv * 12 + ((nv + 3) & ~3), nt * 3);
  const pos = new Float32Array(nt * 9), nor = new Float32Array(nt * 9), col = new Float32Array(nt * 9);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const k = COLORS[E[I[t * 3]]] || COLORS[0];
    [a, b, c].forEach((v, j) => { const o = t * 9 + j * 3; for (let q = 0; q < 3; q++) { pos[o + q] = P[v + q]; lo[q] = Math.min(lo[q], P[v + q]); hi[q] = Math.max(hi[q], P[v + q]); col[o + q] = k[q]; } nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz; });
  }
  return { pos, nor, col, count: nt * 3, lo, hi, nv, nt };
}
function upload(m) {
  for (const [k, arr] of [['p', m.pos], ['n', m.nor], ['c', m.col]]) { gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  count = m.count;
  if (!bounds) bounds = { lo: m.lo, hi: m.hi };
}

// ── camera (orbit) ──
const cam = live.cam = { yaw: -0.55, pitch: 0.42, dist: 14, tx: 0, ty: 0, tz: 0 };
const VIEWS = {
  all: () => { const b = bounds || { lo: [-6, -1, -1], hi: [8, 1, 1] }; Object.assign(cam, { yaw: -0.55, pitch: 0.42, tx: (b.lo[0] + b.hi[0]) / 2, ty: 0.2, tz: 0, dist: Math.max(6, (b.hi[0] - b.lo[0]) * 0.8) }); },
  toe: () => { const b = bounds || { lo: [-6, -1, -1], hi: [8, 1, 1] }; Object.assign(cam, { yaw: -0.35, pitch: 0.22, tx: b.lo[0] + (b.hi[0] - b.lo[0]) * 0.72, ty: 0.05, tz: 0, dist: Math.max(3, (b.hi[0] - b.lo[0]) * 0.32) }); },
  top: () => { const b = bounds || { lo: [-6, -1, -1], hi: [8, 1, 1] }; Object.assign(cam, { yaw: 0, pitch: 1.45, tx: (b.lo[0] + b.hi[0]) / 2, ty: 0, tz: 0, dist: Math.max(6, (b.hi[0] - b.lo[0]) * 1.0) }); },
};
function setView(name) { VIEWS[name](); for (const v of ['all', 'toe', 'top']) $(`v-${v}`).setAttribute('aria-pressed', String(v === name)); draw(); }
function mat() {
  const w = canvas.clientWidth, h = canvas.clientHeight, asp = w / Math.max(h, 1), f = 1 / Math.tan(0.45), nr = 0.05, fr = 500;
  const ex = cam.tx + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), ey = cam.ty + cam.dist * Math.sin(cam.pitch), ez = cam.tz + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw);
  let zx = ex - cam.tx, zy = ey - cam.ty, zz = ez - cam.tz; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = zz, xy = 0, xz = -zx; l = Math.hypot(xx, xz) || 1; xx /= l; xz /= l;           // x = up × z
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const V = [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1];
  const Pm = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fr + nr) / (nr - fr), -1, 0, 0, 2 * fr * nr / (nr - fr), 0];
  const M = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += Pm[k * 4 + j] * V[i * 4 + k]; M[i * 4 + j] = s; }
  return { M, right: [xx, xy, xz], up: [yx, yy, yz] };
}
function draw() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h); gl.clearColor(0.10, 0.118, 0.141, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!count) return;
  gl.uniformMatrix4fv(loc.mvp, false, mat().M); gl.uniform3f(loc.L, 0.45, 0.8, 0.4);
  for (const [k, a] of [['p', loc.p], ['n', loc.n], ['c', loc.c]]) { gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0); }
  gl.drawArrays(gl.TRIANGLES, 0, count);
}
window.addEventListener('resize', draw);

// mouse / touch
let drag = null;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan) { const { right, up } = mat(); const s = cam.dist * 0.0016; cam.tx -= (right[0] * dx - up[0] * dy) * s; cam.ty -= (right[1] * dx - up[1] * dy) * s; cam.tz -= (right[2] * dx - up[2] * dy) * s; }
  else { cam.yaw -= dx * 0.006; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * 0.006)); }
  for (const v of ['all', 'toe', 'top']) $(`v-${v}`).setAttribute('aria-pressed', 'false');
  draw();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(0.5, Math.min(200, cam.dist * Math.exp(e.deltaY * 0.001))); draw(); }, { passive: false });
for (const v of ['all', 'toe', 'top']) $(`v-${v}`).addEventListener('click', () => setView(v));

// ── frames ──
let frames = [], cache = new Map(), loading = 0;
async function loadFrame(n) {
  const my = ++loading;
  try {
    let m = cache.get(n);
    if (!m) { const r = await fetch(`../api/tclive/frame/${n}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`프레임 ${n} 을 받지 못함 (${r.status})`); m = parse(await r.arrayBuffer()); cache.set(n, m); if (cache.size > 12) cache.delete(cache.keys().next().value); }
    if (my !== loading) return;
    upload(m); live.frame = n; live.loaded = { frame: n, nv: m.nv, nt: m.nt };
    if (live.firstView !== true) { live.firstView = true; setView('all'); }
    showFrame(); draw();
  } catch (e) { live.errors.push(String(e.message || e)); $('srcbadge').textContent = String(e.message || e); $('srcbadge').className = 'srcbadge other'; }
}
function showFrame() {
  const f = frames.find(x => x.frame === live.frame);
  $('frlabel').textContent = live.frame == null ? 'F—' : `F${live.frame}`;
  $('slider').value = String(frames.findIndex(x => x.frame === live.frame) + 1);
  const b = $('srcbadge');
  b.textContent = f ? `F${f.frame} · ${f.source_label}` : '프레임 없음';
  b.className = `srcbadge ${f?.source === 'production' ? 'prod' : f?.source === 'test' ? 'test' : 'other'}`;
}
let playing = null;
function stopPlay() { if (playing) { clearInterval(playing); playing = null; $('play').textContent = '재생'; $('play').setAttribute('aria-label', '재생'); } }
$('play').addEventListener('click', () => {
  if (playing) return stopPlay();
  if (!frames.length) return;
  $('follow').checked = false;
  let i = frames.findIndex(x => x.frame === live.frame); if (i < 0 || i >= frames.length - 1) i = -1;
  $('play').textContent = '멈춤'; $('play').setAttribute('aria-label', '멈춤');
  playing = setInterval(() => { i += 1; if (i >= frames.length) return stopPlay(); loadFrame(frames[i].frame); }, 160);
});
live.isPlaying = () => !!playing;
$('slider').addEventListener('input', e => { stopPlay(); const f = frames[Number(e.target.value) - 1]; if (f) { $('follow').checked = false; loadFrame(f.frame); } });
$('prev').addEventListener('click', () => { stopPlay(); const i = frames.findIndex(x => x.frame === live.frame); if (i > 0) { $('follow').checked = false; loadFrame(frames[i - 1].frame); } });
$('next').addEventListener('click', () => { stopPlay(); const i = frames.findIndex(x => x.frame === live.frame); if (i >= 0 && i < frames.length - 1) { $('follow').checked = false; loadFrame(frames[i + 1].frame); } });
$('latest').addEventListener('click', () => { const t = latestTarget(); if (t != null) loadFrame(t); });
function latestTarget() {
  const s = live.state;
  const done = s?.mesh?.latest_completed;
  if (done != null && frames.some(x => x.frame === done && x.source === 'production')) return done;
  return frames.length ? frames[frames.length - 1].frame : null;   // no ① frame: the last available frame (its badge says what it is)
}

// ── state panel ──
function render(s) {
  $('ver').textContent = `관제실 ${s.version} · LIVE 시제품`;
  $('notice').textContent = s.notice;
  const st = s.status;
  const warn = $('statwarn');
  if (!st) {
    dl($('status'), [['상태', s.status_state === 'not_configured' ? '① 진행 상태 파일 미연결' : '① 진행 상태 파일 없음']]);
    warn.hidden = false; warn.textContent = '① 제작 진행 정보가 없습니다. 아래 형상은 ① 이 계산을 마친 프레임이 아닙니다.';
  } else {
    dl($('status'), [['작업', st.task_id || '—'], ['후보', st.candidate || '—'], ['모델', el('span', { class: 'mono', text: short(st.model_sha256) })], ['단계', st.stage_label],
      ['마지막 완료', st.last_completed_frame != null ? `F${st.last_completed_frame}${st.frames_total ? ` / ${st.frames_total}` : ''}` : '—'],
      ['진행 중', st.current_frame != null ? `F${st.current_frame}` : '—'], ['갱신 시각', when(st.updated_at)]]);
    warn.hidden = !(st.stale || st.future);
    warn.textContent = st.future ? '갱신 시각이 미래입니다 — 지금 상태 미확인' : `최근 10분 동안 갱신 없음 — 지금 상태 미확인 (마지막 ${when(st.updated_at)})`;
  }
  const items = st?.checks?.items || [];
  $('checks').replaceChildren(...(items.length ? [el('div', { text: `출처 ${st.checks.source || '—'} · ${st.checks.state === 'running' ? '진행 중' : st.checks.state === 'done' ? '완료' : '—'}` }),
    ...items.map(c => el('div', {}, el('span', { class: `v ${c.result}`, text: c.result === 'pending' ? '판정 전' : c.result }), ` ${c.name} ${c.value ?? '—'}${c.limit != null ? ` / 한도 ${c.limit}` : ''}${c.frame != null ? ` (F${c.frame})` : ''}`))]
    : [el('div', { text: '① 진행 상태 파일에 검사 결과 없음' })]));
  $('qa').replaceChildren(...(s.qa.length ? s.qa.map(q => el('div', {}, el('span', { class: `v ${q.verdict}`, text: q.verdict }), ` ${q.scope || ''} · ${when(q.at)} · ${q.title}`)) : [el('div', { text: st?.candidate ? '이 후보의 ② QA 판정 카드 없음' : '후보 정보가 없어 QA 판정을 찾지 않음' })]));
  const hasProd = !!(s.mesh && s.mesh.latest_completed != null && s.mesh.frames.some(f => f.frame === s.mesh.latest_completed && f.source === 'production'));
  $('latest').textContent = hasProd ? `① 최신 완료 프레임 (F${s.mesh.latest_completed})` : '마지막 프레임 (① 완료 정보 없음)';
  const m = s.mesh;
  if (!m) { dl($('mesh'), [['자료', '형상 자료 없음']]); return; }
  const kinds = [...new Set(m.frames.map(f => f.source_label))].join(' · ');
  const match = st ? (st.model_sha256 === m.model_sha256 ? '① 진행 모델과 같음' : '① 진행 모델과 다름') : '비교할 ① 정보 없음';
  dl($('mesh'), [['자료', m.label || '—'], ['종류', kinds || '—'], ['모델', el('span', { class: 'mono', text: short(m.model_sha256) })], ['모델 대조', match], ['프레임', m.frames.length ? `F${m.frames[0].frame}–F${m.frames[m.frames.length - 1].frame} (${m.frames.length})` : '없음']]);
}

let lastOk = null;
async function poll() {
  try {
    const r = await fetch('../api/tclive/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const s = await r.json(); live.state = s; lastOk = Date.now();
    const prevLast = frames.length ? frames[frames.length - 1].frame : null;
    frames = s.mesh ? s.mesh.frames : [];
    $('slider').max = String(Math.max(1, frames.length));
    render(s);
    const t = latestTarget();
    if (live.frame == null && t != null) loadFrame(t);
    else if ($('follow').checked && t != null && t !== live.frame && (frames.length ? frames[frames.length - 1].frame : null) !== prevLast) loadFrame(t);
    else showFrame();
    $('poll').textContent = `마지막 확인 ${new Date(lastOk).toLocaleTimeString('ko-KR', { hour12: false })} · ${POLL_MS / 1000}초마다`; $('poll').className = 'poll';
  } catch {
    $('poll').textContent = `연결 안 됨 — 마지막 성공 ${lastOk ? new Date(lastOk).toLocaleTimeString('ko-KR', { hour12: false }) : '없음'}`; $('poll').className = 'poll bad';
  }
}
poll(); setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
