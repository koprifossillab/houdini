// Thermal Collapse LIVE — prototype viewer server (감독 결정 22). Node 22, no dependencies, read only.
//   LIVE_HOST    must be a loopback address (127.0.0.1 / ::1) — the prototype is reached through SSH port forwarding only
//   LIVE_PORT    default 18100
//   LIVE_MESH_DIR    folder with index.json (tc-live-frames/1) and fNNNN.bin (TCM1)
//   LIVE_STATUS_FILE ① 's progress file (tc-live-status/1); may be absent
//   LIVE_HANDOFF_DIR handoff card folder, read for confirmed QA verdicts only; may be absent
// Routes (GET/HEAD only, everything else 405): /  /static/*  /api/state  /api/frame/<n>  /healthz
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMesh } from './lib/mesh.mjs';
import { parseStatus, readFrames, readQa, frameView } from './lib/state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, 'public');
const VERSION = JSON.parse(await fs.readFile(path.join(HERE, 'package.json'), 'utf8')).version;
const STATIC = { 'index.html': 'text/html; charset=utf-8', 'viewer.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8' };
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function makeServer(cfg) {
  const send = (res, code, type, body, extra = {}) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'", ...extra });
    res.end(body);
  };
  const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

  async function state() {
    const now = Date.now();
    let status = null;
    if (cfg.statusFile) { try { const st = await fs.lstat(cfg.statusFile); if (st.isFile() && st.size < 256 * 1024) status = parseStatus(JSON.parse(await fs.readFile(cfg.statusFile, 'utf8')), now); } catch { status = null; } }
    const frames = cfg.meshDir ? await readFrames(cfg.meshDir) : null;
    const view = frames ? frameView(frames, status) : [];
    const qa = status?.candidate ? await readQa(cfg.handoffDir, status.candidate) : [];
    return {
      version: VERSION, served_at: new Date(now).toISOString(),
      notice: '형상 확인용 화면입니다. Karma 렌더가 아니며, 시각 승인 근거가 아닙니다.',
      status, status_state: !cfg.statusFile ? 'not_configured' : status ? (status.future ? 'future' : status.stale ? 'stale' : 'live') : 'missing',
      mesh: frames ? { model_sha256: frames.model_sha256, label: frames.label, frames: view, latest_completed: status ? status.last_completed_frame : null } : null,
      qa,
    };
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'read only', { allow: 'GET, HEAD' });
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/healthz') return json(res, 200, { status: 'ok', version: VERSION });
      if (p === '/' || p === '/index.html') return send(res, 200, STATIC['index.html'], await fs.readFile(path.join(PUB, 'index.html')));
      const sm = /^\/static\/([a-z]+\.(?:js|css))$/.exec(p);
      if (sm && Object.hasOwn(STATIC, sm[1])) return send(res, 200, STATIC[sm[1]], await fs.readFile(path.join(PUB, sm[1])));
      if (p === '/api/state') return json(res, 200, await state());
      const fm = /^\/api\/frame\/(\d{1,5})$/.exec(p);
      if (fm && cfg.meshDir) {
        const frames = await readFrames(cfg.meshDir);
        const f = frames?.frames.find(x => x.frame === Number(fm[1]));
        if (!f) return json(res, 404, { error: '그 프레임의 형상이 없음' });
        const file = path.join(cfg.meshDir, f.file);
        const st = await fs.lstat(file).catch(() => null);
        if (!st || !st.isFile() || st.size > 120 * 1024 * 1024) return json(res, 404, { error: '형상 파일 없음' });
        const buf = await fs.readFile(file);
        if (!checkMesh(buf)) return json(res, 422, { error: '형상 파일 형식 오류' });
        return send(res, 200, 'application/octet-stream', buf, { 'x-model-sha256': frames.model_sha256 });
      }
      return json(res, 404, { error: 'not found' });
    } catch { return json(res, 500, { error: '서버 오류' }); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.LIVE_HOST || '127.0.0.1';
  if (!LOOPBACK.has(host)) { console.error(`LIVE_HOST=${host} — 루프백 주소만 허용 (SSH 포트 전달 전용 시제품)`); process.exit(1); }
  const port = Number(process.env.LIVE_PORT || 18100);
  makeServer({ meshDir: process.env.LIVE_MESH_DIR || null, statusFile: process.env.LIVE_STATUS_FILE || null, handoffDir: process.env.LIVE_HANDOFF_DIR || null })
    .listen(port, host, () => console.log(`tc-live ${VERSION} on http://${host}:${port}/`));
}
