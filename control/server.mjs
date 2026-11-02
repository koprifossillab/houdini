// Houdini Production Control — Thermal Collapse production control web service.
// Read-only: it never writes to the collector, the production repository, NAS media or the portal.
// No compute launch, no approval writes, no session observation.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean, hex, readJson } from './lib/sanitize.mjs';
import { collectorSnapshot, collectorReport, publicSnapshot } from './lib/collector.mjs';
import { ledgerView, ledgerReport, publicLedger } from './lib/ledger.mjs';
import { mediaItems, mediaResponse, publicMedia } from './lib/media.mjs';
import { createAuth, parseUsers } from './lib/auth.mjs';
import { exampleCollector, EXAMPLE_REPORT } from './lib/example.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
export const VERSION = PKG.version;

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const SECURITY = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const ASSETS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/static/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/static/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/static/icon.svg': ['icon.svg', 'image/svg+xml'],
};

export function configFromEnv(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 0),
    basePath: (env.HPC_BASE_PATH ?? '/Houdini').replace(/\/+$/, ''),
    allowedHosts: (env.HPC_ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    collectorDir: env.HPC_COLLECTOR_DIR || null,
    ledgerDir: env.HPC_LEDGER_DIR || null,
    mediaDir: env.HPC_MEDIA_DIR || null,
    mediaManifest: env.HPC_MEDIA_MANIFEST || null,
    recordsFile: env.HPC_RECORDS || path.join(ROOT, 'data', 'records.json'),
    authMode: env.HPC_AUTH || 'basic',
    allowOpen: env.HPC_ALLOW_OPEN === '1',
    users: env.HPC_USERS || '',
    demo: env.HPC_DEMO === '1',
    demoState: ['live', 'stale', 'missing', 'error'].includes(env.HPC_DEMO_STATE) ? env.HPC_DEMO_STATE : 'live',
    // F4: research views need HTTPS unless the listener is loopback-only development.
    requireTls: env.HPC_REQUIRE_TLS !== undefined ? env.HPC_REQUIRE_TLS === '1' : !isLoopback(env.HOST || '127.0.0.1'),
    // Only these peers may assert X-Forwarded-Proto / X-Real-IP (the reverse proxy).
    trustedProxies: (env.HPC_TRUSTED_PROXIES || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim()).filter(Boolean),
    // Optional shared secret the reverse proxy adds; when set, a peer is trusted only if it also sends it
    // (host-local users reaching the loopback port cannot then claim https).
    proxyToken: env.HPC_PROXY_TOKEN || '',
  };
}

function isLoopback(h) { return h === '127.0.0.1' || h === '::1' || h === 'localhost'; }

async function loadRecords(file) {
  try {
    const r = await readJson(file, 256 * 1024);
    if (!r || !Array.isArray(r.stages) || !Array.isArray(r.issues) || !Array.isArray(r.decisions)) throw Error('shape');
    return { state: 'ok', ...r };
  } catch {
    return { state: 'error', provenance: 'recorded', stages: [], issues: [], decisions: [], teams: {}, message: '승인·진단 기록을 읽을 수 없음' };
  }
}

// F1: three separate statements, none of which is "a physics computation is running".
//   physics  — always unverified: no source registers computation jobs (task ID / PID) yet.
//   activity — collector saw processes related to the Houdini / verification folders (shells count).
//   blender_queue — file counts of the Blender PC worker queue, as the collector recorded them.
// Stale or missing collector data turns activity and queue counts into "unknown".
export function computeState(snap) {
  const fresh = snap.state === 'live';
  const physics = { state: 'unverified', label: '계산 실행 여부 미확인', basis: '계산 작업을 직접 가리키는 근거(등록된 작업 ID·프로세스)가 없음 — 1분 수집기의 프로세스 감지는 셸·편집기·검사 명령과 계산을 구분하지 못함' };
  const hits = fresh ? snap.teams.filter(t => (t.key === 'houdini' || t.key === 'verify') && (t.state === 'running' || (t.progress?.running ?? 0) > 0)) : [];
  const activity = !fresh
    ? { state: 'unknown', label: '확인 불가', basis: '수집 자료가 최신이 아님 — 지금 활동을 말할 수 없음' }
    : hits.length
      ? { state: 'detected', label: '관련 프로세스 감지', teams: hits.map(t => t.key), basis: '작업 폴더와 관련된 프로세스가 보임 — 셸·편집기일 수 있어 계산 여부는 미확인' }
      : { state: 'none', label: '관련 프로세스 없음', basis: '마지막 수집 시점에 작업 폴더 관련 프로세스가 보이지 않음' };
  const q = snap.teams.find(t => t.key === 'blender')?.queue || null;
  const blender_queue = !q
    ? { state: 'missing', label: '큐 기록 없음', inbox: null, running: null, failed: null }
    : { state: fresh ? 'ok' : 'unknown', label: fresh ? 'Blender PC 워커 큐' : 'Blender PC 워커 큐 — 지금 값 아님', inbox: q.inbox, running: fresh ? q.running : null, failed: q.failed, basis: '큐 폴더의 파일 수(수집기 기준) — 렌더 진행의 증거가 아님' };
  return { physics, activity, blender_queue, observed_at: snap.generated_at, fresh };
}

const ROUTES = [[/^\/healthz$/, 'healthz'], [/^\/(?:index\.html)?$/, 'page'], [/^\/static\/[\w.-]+$/, 'static'], [/^\/api\/(session|overview|reports|experiments|media)$/, 'api/$1'], [/^\/api\/reports\/[a-f0-9]{16}$/, 'api/report'], [/^\/media\/[a-z0-9_-]{1,60}$/, 'media']];
export function routeId(raw) {
  let p = String(raw || '').split('?')[0];
  p = p.replace(/^\/Houdini(?=\/|$)/, '') || '/';
  for (const [re, id] of ROUTES) { const m = re.exec(p); if (m) return id.replace('$1', m[1] || ''); }
  return 'other';
}

export function createApp(cfg = configFromEnv()) {
  const auth = createAuth({ mode: cfg.authMode, users: parseUsers(cfg.users), loopbackOnly: isLoopback(cfg.host), allowOpen: !!cfg.allowOpen, limits: cfg.authLimits });
  if (cfg.authMode === 'off' && cfg.requireTls) throw Error('HPC_AUTH=off 와 TLS 요구는 함께 쓸 수 없음');
  const example = () => (cfg.demo && cfg.demoState !== 'missing' ? exampleCollector(Date.now(), cfg.demoState) : null);
  // The ledger changes only with a new checkout; re-read at most every 30 s.
  let ledgerCache = { at: 0, value: null };
  async function loadLedger() {
    if (ledgerCache.value && Date.now() - ledgerCache.at < 30000) return ledgerCache.value;
    ledgerCache = { at: Date.now(), value: await ledgerView(cfg.ledgerDir) };
    return ledgerCache.value;
  }

  async function gather() {
    const [snap, records, ledger, media] = await Promise.all([
      collectorSnapshot(cfg.demo ? null : cfg.collectorDir, Date.now(), example()),
      loadRecords(cfg.recordsFile),
      cfg.demo ? Promise.resolve({ state: 'missing', experiments: [], tools: [], reports: [], environment: null, totals: null, message: '예시 모드에서는 읽지 않음' }) : loadLedger(),
      cfg.demo ? Promise.resolve({ state: 'missing', items: [] }) : mediaItems(cfg.mediaDir, cfg.mediaManifest),
    ]);
    if (cfg.demo) Object.assign(snap, { provenance: 'example', source: '예시 데이터 — 실제 수집 자료 아님' });
    return { snap, records, ledger, media };
  }

  async function reportIndex(g) {
    const out = [];
    const seen = new Set();
    for (const r of [...g.snap.reports, ...g.snap.teams.map(t => t.report).filter(Boolean)]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      let copy = false;
      if (cfg.demo) copy = true;
      else if (cfg.collectorDir) { try { const s = await fs.lstat(path.join(cfg.collectorDir, 'reports', `${r.id}.md`)); copy = s.isFile() && !s.isSymbolicLink(); } catch { copy = false; } }
      const repo = r._file ? g.ledger.reports.find(x => x.file === r._file) : null;
      out.push({ id: r.id, title: r.title, team: r.team, mtime: r.mtime, stage: r.stage, source: copy ? 'collector' : repo ? 'repository' : 'none', redacted: !copy && !!repo?.redacted, _file: r._file });
    }
    for (const x of g.ledger.reports) {
      if (out.some(r => r._file === x.file)) continue;
      out.push({ id: x.sha256, title: x.file, team: 'houdini', mtime: null, stage: null, source: 'repository', redacted: x.redacted, _file: x.file });
    }
    return out;
  }

  function send(req, res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(code, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...SECURITY, ...extra });
    res.end(req.method === 'HEAD' ? undefined : buf);
  }
  const deny = (req, res, r) => (r.status === 429
    ? send(req, res, 429, { error: '인증 시도가 너무 많음 — 잠시 뒤 다시' }, undefined, { 'Retry-After': String(r.retryAfter || 5) })
    : send(req, res, 401, { error: '열람 권한 필요', configured: auth.configured }, undefined, { 'WWW-Authenticate': 'Basic realm="Houdini Production Control", charset="UTF-8"' }));
  const tokenBuf = cfg.proxyToken ? crypto.createHash('sha256').update(cfg.proxyToken).digest() : null;
  const trusted = req => {
    if (!(cfg.trustedProxies || []).includes(req.socket.remoteAddress || '')) return false;
    if (!tokenBuf) return true;
    const got = crypto.createHash('sha256').update(String(req.headers['x-hpc-proxy-token'] || '')).digest();
    return crypto.timingSafeEqual(got, tokenBuf);
  };
  const clientOf = req => {
    const ip = trusted(req) ? String(req.headers['x-real-ip'] || '') : '';
    return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : (req.socket.remoteAddress || 'unknown');
  };
  const protoOf = req => (req.socket.encrypted ? 'https' : trusted(req) && /^https$/i.test(String(req.headers['x-forwarded-proto'] || '')) ? 'https' : 'http');

  async function handle(req, res) {
    if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, { error: '조회 전용 서비스' }, undefined, { Allow: 'GET, HEAD' });
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!cfg.allowedHosts.includes(host)) return send(req, res, 403, { error: '허용되지 않은 호스트' });
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { return send(req, res, 400, { error: '잘못된 주소' }); }
    let p = url.pathname;
    if (cfg.basePath && (p === cfg.basePath || p.startsWith(cfg.basePath + '/'))) p = p.slice(cfg.basePath.length) || '/';
    if (p.includes('..') || p.includes('\\') || p.includes('\0')) return send(req, res, 400, { error: '잘못된 주소' });

    // the only open endpoint: liveness + source states, no research content, no paths
    if (p === '/healthz') {
      const g = await gather();
      const degraded = g.snap.state !== 'live' || g.records.state !== 'ok' || (!cfg.demo && g.ledger.state !== 'ok');
      return send(req, res, 200, { status: 'ok', service: 'houdini-production-control', version: VERSION, degraded, demo: cfg.demo, sources: { collector: g.snap.state, records: g.records.state, ledger: g.ledger.state, media: g.media.state }, auth: { configured: auth.configured }, tls_required: cfg.requireTls });
    }
    // F4: everything else is research information — HTTPS first (no credential challenge over HTTP), then credentials
    if (cfg.requireTls && protoOf(req) !== 'https') return send(req, res, 403, { error: 'HTTPS 로만 열람할 수 있음' });
    const a = await auth.check(req.headers.authorization, clientOf(req));
    if (!a.ok) return deny(req, res, a);
    if (ASSETS[p]) {
      const [file, type] = ASSETS[p];
      return send(req, res, 200, await fs.readFile(path.join(ROOT, 'public', file)), type);
    }
    if (p === '/api/session') return send(req, res, 200, { auth: auth.mode, configured: auth.configured, authorized: true, user: a.user, demo: cfg.demo, version: VERSION, tls_required: cfg.requireTls });
    if (p === '/api/overview') {
      const g = await gather();
      const reports = await reportIndex(g);
      const missingCopies = reports.filter(r => r.source !== 'collector').length;
      return send(req, res, 200, {
        served_at: new Date().toISOString(),
        mode: cfg.demo ? 'example' : 'live',
        collector: publicSnapshot(g.snap),
        compute: computeState(g.snap),
        records: g.records,
        ledger: { state: g.ledger.state, message: g.ledger.message, experiments: g.ledger.experiments.length, tracked: g.ledger.totals?.tracked ?? null, revision: g.ledger.revision },
        sources: [
          { key: 'collector', label: '1분 수집기', provenance: g.snap.provenance, state: g.snap.state, detail: g.snap.message, observed_at: g.snap.generated_at, age_s: g.snap.age_s },
          { key: 'records', label: '승인·진단 기록', provenance: 'recorded', state: g.records.state, detail: g.records.state === 'ok' ? '손으로 옮긴 기록 — 자동 판정 아님' : g.records.message, observed_at: g.records.recorded_at || null },
          { key: 'ledger', label: '제작 저장소 manifest', provenance: 'repository', state: g.ledger.state, detail: g.ledger.message, observed_at: null },
          { key: 'media', label: '미리보기 미디어', provenance: 'manifest', state: g.media.state, detail: g.media.state === 'ok' ? `${g.media.items.filter(m => m.present).length}/${g.media.items.length}개 파일 확인` : '미디어 목록이 설정되지 않음', observed_at: null },
          { key: 'reports', label: '보고서 사본', provenance: 'collected', state: missingCopies ? 'partial' : reports.length ? 'ok' : 'missing', detail: missingCopies ? `${missingCopies}건은 수집기 사본이 없음 — 저장소 사본으로 대체하거나 열람 불가` : `${reports.length}건`, observed_at: null },
        ],
      });
    }
    if (p === '/api/reports') {
      const g = await gather();
      return send(req, res, 200, { items: (await reportIndex(g)).map(({ _file, ...r }) => r) });
    }
    const rm = /^\/api\/reports\/([a-f0-9]{16})$/.exec(p);
    if (rm) {
      const g = await gather();
      const r = (await reportIndex(g)).find(x => x.id === rm[1]);
      if (!r) return send(req, res, 404, '보고서 없음', 'text/plain; charset=utf-8');
      let text = null;
      if (cfg.demo) text = EXAMPLE_REPORT;
      else if (r.source === 'collector') text = await collectorReport(cfg.collectorDir, g.snap, r.id);
      else if (r.source === 'repository') text = await ledgerReport(cfg.ledgerDir, g.ledger, r._file);
      if (text === null) return send(req, res, 404, '보고서 사본을 읽을 수 없음', 'text/plain; charset=utf-8');
      return send(req, res, 200, clean(text, 400 * 1024), 'text/plain; charset=utf-8', { 'X-Report-Source': r.source });
    }
    if (p === '/api/experiments') {
      const g = await gather();
      return send(req, res, 200, publicLedger(g.ledger));
    }
    if (p === '/api/media') {
      const g = await gather();
      return send(req, res, 200, { state: g.media.state, items: publicMedia(g.media.items) });
    }
    const mm = /^\/media\/([a-z0-9_-]{1,60})$/.exec(p);
    if (mm) {
      if (cfg.demo) return send(req, res, 404, '예시 모드 — 미디어 없음', 'text/plain; charset=utf-8');
      const { items } = await mediaItems(cfg.mediaDir, cfg.mediaManifest);
      const item = items.find(x => x.id === mm[1] && x.present);
      if (!item) return send(req, res, 404, '미디어 없음', 'text/plain; charset=utf-8');
      const r = await mediaResponse(cfg.mediaDir, item, req.headers.range);
      return send(req, res, r.status, r.body, r.type || 'text/plain; charset=utf-8', { ...(r.headers || {}), 'Cache-Control': 'private, max-age=300' });
    }
    return send(req, res, 404, { error: '없음' });
  }

  return http.createServer(async (req, res) => {
    const t0 = Date.now();
    try {
      await handle(req, res);
    } catch (err) {
      // details go to the server log only, never to the client
      console.error(JSON.stringify({ t: new Date().toISOString(), error: String(err?.stack || err).slice(0, 2000) }));
      if (!res.headersSent) send(req, res, 500, { error: '조회 실패 — 내부 상세 정보는 제공하지 않음' });
      else res.destroy();
    } finally {
      // route id only — never the raw URL, query string or any header (credentials stay out of logs)
      if (process.env.HPC_ACCESS_LOG === '1') console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, r: routeId(req.url), s: res.statusCode, ms: Date.now() - t0 }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = configFromEnv();
  const server = createApp(cfg);
  server.listen(cfg.port, cfg.host, () => {
    const a = server.address();
    console.log(`houdini-production-control ${VERSION} listening on ${a.address}:${a.port} base=${cfg.basePath || '/'} auth=${cfg.authMode} demo=${cfg.demo}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
