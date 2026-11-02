// Regression tests for the 2026-11-02 independent-verification findings F1–F4 and the filter rework.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectorFixture, ledgerFixture, serve, rawGet } from './helpers.mjs';
import { ledgerView, codeRefs, parsePyJson } from '../lib/ledger.mjs';
import { collectorSnapshot } from '../lib/collector.mjs';
import { computeState } from '../server.mjs';
import { createAuth, hashPassword, parseUsers } from '../lib/auth.mjs';
import { clean } from '../lib/sanitize.mjs';

const QUEUE_EV = 'PC 워커 큐 — 대기 2 · 실행 1 · 실패 0';
const teams = [
  { key: 'houdini', state: 'running', task: '배치', progress: { total: 3, done: 1, running: 2, failed: 0 }, evidence: ['계산 프로세스 2개 실행 중'] },
  { key: 'verify', state: 'running', task: '검증', evidence: ['검증 프로세스 1개 실행 중'] },
  { key: 'blender', state: 'running', task: 'Blender 작업', evidence: [QUEUE_EV, 'PC 워커가 작업 중(큐 기준)', '서버 Blender 프로세스 1개'] },
];

// ---------- F1 ----------
test('F1 fresh "running" is reported as related-process activity, never as computation', async t => {
  const snap = await collectorSnapshot(await collectorFixture(t, { teams }));
  const c = computeState(snap);
  assert.equal(c.physics.state, 'unverified');
  assert.equal(c.activity.state, 'detected');
  assert.deepEqual(c.activity.teams, ['houdini', 'verify']);
  assert.deepEqual({ inbox: c.blender_queue.inbox, running: c.blender_queue.running, failed: c.blender_queue.failed }, { inbox: 2, running: 1, failed: 0 });
  const text = JSON.stringify({ c, ev: snap.teams.flatMap(x => x.evidence) });
  for (const claim of ['계산 프로세스', '실행 중인 계산', '실행 중 근거 있음', 'PC 워커가 작업 중']) assert.ok(!text.includes(claim), claim);
  assert.ok(text.includes('계산 여부 미확인'));
});

test('F1 stale data makes activity unknown and drops the current queue running count', async t => {
  const snap = await collectorSnapshot(await collectorFixture(t, { teams, generated_at: new Date(Date.now() - 600000).toISOString() }));
  const c = computeState(snap);
  assert.equal(snap.state, 'stale');
  assert.equal(c.physics.state, 'unverified');
  assert.equal(c.activity.state, 'unknown');
  assert.equal(c.activity.teams, undefined);
  assert.equal(c.blender_queue.state, 'unknown');
  assert.equal(c.blender_queue.running, null);
  assert.ok(snap.teams.every(x => x.state === 'unknown'));
  assert.ok(snap.teams.every(x => x.progress === null || x.progress.running === null));
});

test('F1 missing / malformed collector data never claims activity', async t => {
  for (const s of [await collectorSnapshot(null), await collectorSnapshot(await collectorFixture(t, { schema: 'x' }))]) {
    const c = computeState(s);
    assert.equal(c.activity.state, 'unknown');
    assert.equal(c.blender_queue.state, 'missing');
  }
  const none = computeState(await collectorSnapshot(await collectorFixture(t, { teams: [{ key: 'houdini', state: 'done', progress: { total: 1, done: 1, running: 0, failed: 0 } }] })));
  assert.equal(none.activity.state, 'none');
});

test('F1 the client never prints a computation claim', async t => {
  const base = await serve(t, { collectorDir: await collectorFixture(t) });
  const js = await (await fetch(`${base}/Houdini/static/app.js`)).text();
  for (const claim of ['실행 근거 있음', '실행 중 근거 있음', '계산 프로세스']) assert.ok(!js.includes(claim), claim);
});

// ---------- F2 ----------
test('F2 code_sha256 object, string, missing and malformed forms are all classified', () => {
  const pres = new Map([['a.py', new Set(['11'.repeat(32)])]]);
  const all = new Set(['11'.repeat(32)]);
  assert.deepEqual(codeRefs(undefined, pres, all), []);
  assert.equal(codeRefs('11'.repeat(32), pres, all)[0].status, 'match');
  assert.equal(codeRefs('22'.repeat(32), pres, all)[0].status, 'mismatch');
  assert.equal(codeRefs('zz', pres, all)[0].status, 'unverifiable');
  const o = codeRefs({ 'a.py': '11'.repeat(32), 'b.py': '33'.repeat(32), 'c/../d.py': '11'.repeat(32) }, pres, all);
  assert.deepEqual(o.map(x => x.status), ['match', 'unverifiable', 'unverifiable']);
  assert.equal(codeRefs({ 'a.py': '44'.repeat(32) }, pres, all)[0].status, 'mismatch');
  assert.equal(codeRefs([1, 2], pres, all)[0].status, 'unverifiable');
});

test('F2 Python NaN / Infinity are read as null without touching strings', () => {
  const r = parsePyJson('{"a": NaN, "b": -Infinity, "c": "NaN Infinity", "d": [Infinity]}');
  assert.deepEqual(r.value, { a: null, b: null, c: 'NaN Infinity', d: [null] });
  assert.equal(r.nonstandard, 3);
});

test('F2 ledger: match / partial / mismatch (reproducibility not secured) / unverifiable / none', async t => {
  const v = await ledgerView(await ledgerFixture(t));
  const e = Object.fromEntries(v.experiments.map(x => [x.id, x]));
  assert.equal(e['tc00_03/batch_131826'].code_status, 'match');
  assert.equal(e['tc00_03/batch_131826'].code_json.nonstandard_values, 2);
  assert.equal(e['tc00_03/batch_131826'].reproducibility, 'secured');
  assert.equal(e.runs.code_status, 'match', 'bare string hash of the v0 code');
  assert.equal(e['tc00_03R/out/diag_v3_143810'].code_status, 'mismatch');
  assert.equal(e['tc00_03R/out/diag_v3_143810'].reproducibility, 'not_secured');
  assert.match(e['tc00_03R/out/diag_v3_143810'].reproducibility_note, /재현성 미확보/);
  assert.equal(e['tc00_03R/out/diag_v3_143810'].code_mismatches[0].file, 'bpm2d_v1.py');
  assert.equal(e['tc00_03R/out/diag_v5_143847'].code_status, 'mismatch', 'unknown bare hash');
  assert.equal(e['tc00_03R/out/diag_v2c_152318'].code_status, 'unverifiable');
  assert.equal(e['tc00_03R/out/diag_v2_142355'].code_status, 'partial');
  assert.equal(e['tc00_02/kinematics_130254'].code_status, 'none');
  assert.equal(v.code_check.json_with_mismatch, 2);
  assert.equal(v.code_check.refs_mismatch, 2);
  assert.ok(v.code_check.experiments_not_secured.includes('tc00_03R/out/diag_v3_143810'));
});

// ---------- F3 ----------
test('F3 scrypt is asynchronous: the event loop keeps turning while hashes run', async () => {
  const users = parseUsers(`u:${hashPassword('correct horse battery')}`);
  const auth = createAuth({ mode: 'basic', users, limits: { MAX_ACTIVE: 2, MAX_QUEUE: 50, FAIL_PER_CLIENT: 1000, FAIL_GLOBAL_PER_MIN: 1000 } });
  const bad = 'Basic ' + Buffer.from('u:wrong-password-xx').toString('base64');
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 5);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 8 }, (_, i) => auth.check(bad, `c${i}`)));
  clearInterval(timer);
  const ms = Date.now() - t0;
  assert.ok(ticks >= Math.floor(ms / 5) * 0.5, `timer ran ${ticks} times in ${ms} ms`);
});

test('F3 limits: busy queue and repeated failures get 429 without hashing; cached good user unaffected', async () => {
  const users = parseUsers(`u:${hashPassword('correct horse battery')}`);
  const auth = createAuth({ mode: 'basic', users, limits: { MAX_ACTIVE: 1, MAX_QUEUE: 1, FAIL_PER_CLIENT: 3, FAIL_GLOBAL_PER_MIN: 1000 } });
  const good = 'Basic ' + Buffer.from('u:correct horse battery').toString('base64');
  const bad = 'Basic ' + Buffer.from('u:wrong-password-xx').toString('base64');
  assert.ok((await auth.check(good, 'me')).ok);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => auth.check(bad, `b${i}`)));
  assert.ok(burst.some(r => r.status === 429), 'queue overflow is refused immediately');
  for (let i = 0; i < 3; i++) await auth.check(bad, 'x');
  const before = auth.stats.hashed;
  const limited = await auth.check(bad, 'x');
  assert.equal(limited.status, 429);
  assert.ok(limited.retryAfter > 0);
  assert.equal(auth.stats.hashed, before, 'no hashing for a limited client');
  assert.ok((await auth.check(good, 'x')).ok, 'cached credential still works');
});

test('F3 a burst of bad logins does not stall healthz or an authenticated request', async t => {
  const users = `u:${hashPassword('correct horse battery')}`;
  const base = await serve(t, { collectorDir: await collectorFixture(t), authMode: 'basic', users });
  const good = 'Basic ' + Buffer.from('u:correct horse battery').toString('base64');
  assert.equal((await fetch(`${base}/Houdini/api/session`, { headers: { Authorization: good } })).status, 200);
  const storm = Promise.all(Array.from({ length: 40 }, (_, i) => fetch(`${base}/Houdini/api/overview`, { headers: { Authorization: 'Basic ' + Buffer.from(`u:bad-${i}-xxxxxx`).toString('base64') } }).then(r => r.status)));
  const lat = [];
  for (let i = 0; i < 5; i++) {
    let t0 = Date.now();
    assert.equal((await fetch(`${base}/Houdini/healthz`)).status, 200);
    lat.push(['healthz', Date.now() - t0]);
    t0 = Date.now();
    assert.equal((await fetch(`${base}/Houdini/api/session`, { headers: { Authorization: good } })).status, 200);
    lat.push(['authed', Date.now() - t0]);
  }
  const codes = await storm;
  assert.ok(codes.every(c => c === 401 || c === 429), JSON.stringify(codes));
  assert.ok(codes.includes(429), 'limits engaged');
  const worst = Math.max(...lat.map(x => x[1]));
  assert.ok(worst < 400, `worst latency ${worst} ms ${JSON.stringify(lat)}`);
});

test('F3 credentials never appear in responses or logs', async t => {
  const pw = 'Sup3r-Secret-Pass';
  const users = `u:${hashPassword(pw)}`;
  const lines = [];
  const orig = [console.log, console.error];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  process.env.HPC_ACCESS_LOG = '1';
  try {
    const base = await serve(t, { collectorDir: await collectorFixture(t), authMode: 'basic', users });
    const bodies = [];
    for (const cred of [`u:${pw}`, 'u:wrong-guess-123', `ghost:${pw}`]) {
      const auth = 'Basic ' + Buffer.from(cred).toString('base64');
      for (const p of ['/Houdini/api/session', '/Houdini/api/overview?x=1', '/Houdini/nope']) {
        const r = await fetch(`${base}${p}`, { headers: { Authorization: auth } });
        bodies.push(await r.text(), JSON.stringify([...r.headers]));
      }
    }
    const all = bodies.join('\n') + lines.join('\n');
    for (const secret of [pw, Buffer.from(`u:${pw}`).toString('base64'), 'wrong-guess-123', 'scrypt:']) assert.ok(!all.includes(secret), secret);
    assert.ok(lines.length > 0, 'access log was on');
  } finally {
    [console.log, console.error] = orig;
    delete process.env.HPC_ACCESS_LOG;
  }
});

// ---------- F4 ----------
test('F4 every research endpoint requires credentials; healthz carries no research content', async t => {
  const users = `u:${hashPassword('correct horse battery')}`;
  const base = await serve(t, { collectorDir: await collectorFixture(t), ledgerDir: await ledgerFixture(t), authMode: 'basic', users });
  for (const p of ['/', '/index.html', '/static/app.js', '/static/style.css', '/api/session', '/api/overview', '/api/reports', '/api/experiments', '/api/media', '/api/reports/0123456789abcdef', '/media/x']) {
    const r = await fetch(`${base}/Houdini${p}`);
    assert.equal(r.status, 401, p);
    assert.ok(!(await r.text()).includes('V2'), p);
  }
  const h = await (await fetch(`${base}/Houdini/healthz`)).text();
  for (const s of ['issues', 'teams', 'decisions', 'TC-00', 'V2', 'reports']) assert.ok(!h.includes(s), s);
});

test('F4 TLS required: plain HTTP refused before any credential challenge; only the proxy may assert https', async t => {
  const users = `u:${hashPassword('correct horse battery')}`;
  const good = 'Basic ' + Buffer.from('u:correct horse battery').toString('base64');
  const base = await serve(t, { collectorDir: await collectorFixture(t), authMode: 'basic', users, requireTls: true });
  const plain = await fetch(`${base}/Houdini/api/overview`, { headers: { Authorization: good } });
  assert.equal(plain.status, 403);
  assert.equal(plain.headers.get('www-authenticate'), null, 'no Basic challenge over HTTP');
  assert.equal((await fetch(`${base}/Houdini/`)).status, 403);
  assert.equal((await fetch(`${base}/Houdini/healthz`)).status, 200, 'container health check stays on HTTP');
  const viaProxy = await fetch(`${base}/Houdini/api/overview`, { headers: { Authorization: good, 'X-Forwarded-Proto': 'https' } });
  assert.equal(viaProxy.status, 200);
  assert.equal((await fetch(`${base}/Houdini/api/overview`, { headers: { 'X-Forwarded-Proto': 'https' } })).status, 401);
  const untrusted = await serve(t, { collectorDir: await collectorFixture(t), authMode: 'basic', users, requireTls: true, trustedProxies: ['10.9.9.9'] });
  assert.equal((await fetch(`${untrusted}/Houdini/api/overview`, { headers: { Authorization: good, 'X-Forwarded-Proto': 'https' } })).status, 403, 'spoofed header ignored');
});

test('F4 auth=off cannot be combined with TLS-required operation', async () => {
  await assert.rejects(serve({ after() {} }, { authMode: 'off', requireTls: true }), /TLS/);
});

// ---------- path filter ----------
test('filter keeps project-relative names and ordinary text, masks machine paths', () => {
  const keep = ['tools/bpm2d_v1.py', 'tc00_03R/out/diag_v2c_152318', 'thermal_collapse_verify/TC00_20261030/tc00_03R/X.md', 'V2/V3/V5', 'm/s', 'σ_t/τ_c > L/(2H)', '1/2'];
  for (const s of keep) assert.equal(clean(s), s, s);
  const mask = ['/home/u/tc/x.py', '~/tc_wip/a', '/nfs/share/x/', '/srv/App/www/', 'C:\\Users\\x\\y', 'private/notes.md', 'somewhere/else/', '/claude/trex/'];
  for (const s of mask) assert.ok(clean(s).includes('[경로 숨김]'), s);
  assert.ok(!clean('보고서 `Owner9/claude/x.md` 참고').includes('Owner9'));
});

test('F4 proxy token: a trusted address alone cannot claim https when a token is configured', async t => {
  const { routeId } = await import('../server.mjs');
  const users = `u:${hashPassword('correct horse battery')}`;
  const good = 'Basic ' + Buffer.from('u:correct horse battery').toString('base64');
  const base = await serve(t, { collectorDir: await collectorFixture(t), authMode: 'basic', users, requireTls: true, proxyToken: 'proxy-secret-123456' });
  assert.equal((await fetch(`${base}/Houdini/api/overview`, { headers: { Authorization: good, 'X-Forwarded-Proto': 'https' } })).status, 403);
  assert.equal((await fetch(`${base}/Houdini/api/overview`, { headers: { Authorization: good, 'X-Forwarded-Proto': 'https', 'X-HPC-Proxy-Token': 'wrong' } })).status, 403);
  assert.equal((await fetch(`${base}/Houdini/api/overview`, { headers: { Authorization: good, 'X-Forwarded-Proto': 'https', 'X-HPC-Proxy-Token': 'proxy-secret-123456' } })).status, 200);
  assert.equal(routeId('/Houdini/api/reports/0123456789abcdef?token=x'), 'api/report');
  assert.equal(routeId('/Houdini/static/app.js'), 'static');
  assert.equal(routeId('/home/someone/secret'), 'other');
});
