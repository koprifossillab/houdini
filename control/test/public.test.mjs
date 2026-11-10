// TC-DASH-008 운영 공개 정책 — an unauthenticated service publishes fixed words and small counts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmp, serve, rawGet, collectorFixture, ledgerFixture } from './helpers.mjs';
import { buildLive } from '../lib/live.mjs';
import { publicLive, publicBoard, checkPublic, scanText } from '../lib/public.mjs';

const SECRET = ['TC-VIS-031', '비밀 작업 제목', 'tc3d_secret_job', 'SecretPerson', 'deploy-9.9.9', 'P0_PLAN_KO'];
async function world(t) {
  const hand = await tmp(t);
  for (const team of ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH']) await fs.mkdir(path.join(hand, team));
  const at = new Date(Date.now() - 5 * 60000).toISOString();
  const card = (team, file, o) => fs.writeFile(path.join(hand, team, file), JSON.stringify({ schema: 'tc-handoff/1', team, task_id: 'TC-VIS-031', title: '비밀 작업 제목 bash /home/SecretPerson/deploy-9.9.9.sh', state: 'handed_off', to: 'TC-QA', user_action: 'tc3d_secret_job.bat 실행 — SecretPerson', done: '/srv/x P0_PLAN_KO.md', next: 'sha 0123456789abcdef0123', evidence: [{ kind: 'nas', ref: 'houdini_film/TC3D_SECRET_FOLDER/P0_PLAN_KO.md', sha256: 'ab'.repeat(32), at }], issues: [{ id: 'I1', title: '비밀 작업 제목 실패 원문 Traceback', scope: 'project', severity: 'blocking' }], at, ...o }));
  await card('TC-PROD', '20261110-1300_TC-VIS-031.json', {});
  await card('TC-QA', '20261110-1301_TC-VIS-031.json', { state: 'in_progress', to: null, user_action: null });
  await card('TC-DASH', '20261110-1302_TC-DASH-031.json', { task_id: 'TC-DASH-031', state: 'in_progress', at: new Date(Date.now() + 600e3).toISOString() });
  const launch = await tmp(t);
  await fs.mkdir(path.join(launch, 'results'));
  await fs.writeFile(path.join(launch, 'launch_tc3d_secret_job.bat'), 'echo');
  await fs.writeFile(path.join(launch, 'results', 'launch_tc3d_secret_job_20261110_100000.json'), JSON.stringify({ job: 'tc3d_secret_job', started: '2026-11-10 10:00:00', finished: '2026-11-10 10:20:00', state: 'finished', all_ok: true, images_ok: true, render_sec: 1200, pid: 4242 }));
  const film = await tmp(t);
  await fs.mkdir(path.join(film, 'TC3D_SECRET_FOLDER'));
  await fs.writeFile(path.join(film, 'TC3D_SECRET_FOLDER', 'P0_PLAN_KO.md'), '# TC-VIS-031 SecretPerson');
  return { handoffDir: hand, nas: { film, launch }, collectorDir: await collectorFixture(t), ledgerDir: await ledgerFixture(t) };
}
const ROUTES = ['/', '/index.html', '/legacy.html', '/static/board.js', '/static/app.js', '/static/style.css', '/static/public.js', '/static/board.css', '/static/icon.svg',
  '/static/scene-review.json', '/static/team-clock.js', '/api/session', '/api/overview', '/api/reports', '/api/reports/0123456789abcdef', '/api/experiments', '/api/media', '/api/teams',
  '/api/board', '/api/nas', '/api/live', '/nasimg/0123456789abcdef', '/media/x', '/api/board?detail=1&sort=at&q=TC-VIS-031', '/api/live?detail=1&team=TC-PROD',
  '/api/board/', '/API/board', '/api/board.json', '/api/live%2f..', '/healthz', '/nope', '/static/../server.mjs', '/static/%2e%2e/server.mjs', '/.env'];
const PUBLIC_OK = new Set(['/', '/index.html', '/static/public.js', '/static/board.css', '/static/icon.svg', '/api/session', '/api/board', '/api/live', '/api/board?detail=1&sort=at&q=TC-VIS-031', '/api/live?detail=1&team=TC-PROD', '/healthz']);

test('P1 crawl: every public response is fixed vocabulary or a clean static file; everything else is the same 404', async t => {
  const base = await serve(t, { ...(await world(t)), publicOnly: undefined });
  for (const r of ROUTES) for (const method of ['GET', 'HEAD', 'POST']) {
    const res = await fetch(`${base}/Houdini${r}`, { method });
    const body = await res.text();
    const where = `${method} ${r} → ${res.status}`;
    if (method === 'POST') { assert.equal(res.status, 405, where); continue; }
    if (!PUBLIC_OK.has(r)) assert.ok([404, 400].includes(res.status), where);
    else assert.equal(res.status, 200, where);
    // Date is the standard HTTP response header; ETag is a hash of the public body itself (nothing private in it)
    for (const [k, v] of res.headers) if (k !== 'date' && k !== 'etag') assert.deepEqual(scanText(`${k}: ${v}`, SECRET), [], `${where} header ${k}`);
    if (method === 'HEAD' || !body) continue;
    assert.deepEqual(scanText(body, SECRET), [], where);
    if (/json/.test(res.headers.get('content-type') || '')) assert.deepEqual(checkPublic(JSON.parse(body)), [], where);
  }
});

test('P2 query strings do not change public output; error bodies are generic', async t => {
  const base = await serve(t, { ...(await world(t)), publicOnly: undefined });
  const a = await (await fetch(`${base}/Houdini/api/board`)).json();
  const b = await (await fetch(`${base}/Houdini/api/board?detail=1&sort=at&q=TC-VIS-031&debug=true`)).json();
  assert.deepEqual(a, b);
  for (const p of ['/nope', '/api/reports/0123456789abcdef', '/nasimg/0123456789abcdef']) assert.deepEqual(await (await fetch(`${base}/Houdini${p}`)).json(), { error: '없음' });
  assert.equal((await rawGet(`${base}/Houdini/api/board`, { Host: 'evil.example' })).status, 403);
});

test('P3 the checker catches private fields deliberately added to a public response', async t => {
  const live = buildLive({ cards: [], now: Date.now(), detail: true });
  const pub = publicLive(live, { handoff: { state: 'ok' } });
  assert.deepEqual(checkPublic(pub), []);
  const inject = [
    o => { o.teams[0].task_id = 'TC-VIS-029'; },
    o => { o.teams[0].status.label = '제작 중 — TC-VIS-029'; },
    o => { o.checked_at = '2026-11-10T05:00:00Z'; },
    o => { o.teams[1].grade.key = 'signed'; },
    o => { o.teams[2].count = 1730000000; },
    o => { o.teams[3].execution = { key: 'confirmed', label: '실행 확인됨', pid: 1 }; },
    o => { o.note = `${o.note} /home/x`; },
  ];
  for (const f of inject) { const o = structuredClone(pub); f(o); assert.ok(checkPublic(o).length > 0, f.toString()); }
  for (const s of ['TC-VIS-029 시작', '14:37 작성', '2026-11-10T05:37', '/home/u/x', 'C:\\Users\\a', 'pid 5588', 'sha 4791f9f7b7d47adc', 'launch_x.bat', 'QA.md']) assert.ok(scanText(s).length > 0, s);
  assert.deepEqual(scanText('TC-PROD · TC-QA · TC-WORK · TC-DASH 20초마다'), []);
  for (const id of ['TC-DASH-008', 'TC-PROD-20261104-0758', 'TC-QA-001', 'TC-WORK-TIME-DISPLAY-20261103', 'TC-VIS-029', 'TC-HANDOFF-002', '/* TC-DASH-003 board */']) assert.ok(scanText(id).includes('작업 번호'), id);
});

test('P4 public states: coarse words only, ③ not connected, stale → 미확인 without grade', () => {
  const now = Date.now();
  const c = (team, o) => ({ file: `${team}.json`, team, task_id: 'TC-VIS-031', title: 'x', state: 'in_progress', verdict: null, to: null, user_action: null, evidence: [{}], grade: 'confirmed', at: new Date(now - 60000).toISOString(), written_at: null, ...o });
  const live = buildLive({ cards: [c('TC-PROD', { state: 'handed_off', user_action: 'BAT 실행' }), c('TC-QA', {}), c('TC-DASH', { at: new Date(now - 3 * 3600e3).toISOString() })], now, detail: true });
  const teams = Object.fromEntries(publicLive(live, {}).teams.map(t => [t.team, t]));
  assert.equal(teams['TC-PROD'].status.label, '사용자 조치 대기');
  assert.equal(teams['TC-QA'].status.label, '검증 중');
  assert.equal(teams['TC-QA'].grade.label, '확인');
  assert.equal(teams['TC-DASH'].status.label, '미확인');
  assert.equal(teams['TC-DASH'].grade.key, 'none');
  assert.equal(teams['TC-WORK'].execution.key, 'not_connected');
  assert.doesNotMatch(JSON.stringify(teams['TC-WORK']), /휴식 중|쉬는 중|중단됨/);
  assert.equal(publicLive(live, {}).freshness.key, 'missing');
});

test('P5 authenticated services keep the detailed views (public projection only without authentication)', async t => {
  const w = await world(t);
  const open = await serve(t, { ...w, publicOnly: undefined });
  assert.equal((await fetch(`${open}/Houdini/legacy.html`)).status, 404);
  const detailed = await serve(t, { ...w, publicOnly: false });
  assert.equal((await fetch(`${detailed}/Houdini/legacy.html`)).status, 200);
});

test('P6 public state changes only at 15-minute marks and is evaluated as of the mark; no Last-Modified, no cost or token data', async t => {
  const w = await world(t);
  const SLOT = 15 * 60 * 1000;
  const slotStart = Math.floor(Date.now() / SLOT) * SLOT;
  // the clock is moved one slot ahead of real time so every fixture record lies before the first mark
  let T = slotStart + SLOT + 60000;
  const base = await serve(t, { ...w, publicOnly: undefined, now: () => T });
  const get = async p => { const r = await fetch(`${base}/Houdini${p}`); return { etag: r.headers.get('etag'), lm: r.headers.get('last-modified'), body: await r.text() }; };
  const a1 = await get('/api/live'), b1 = await get('/api/board');
  assert.equal(a1.lm, null); assert.equal(b1.lm, null);
  // a team writes a new card inside the same slot: nothing public changes until the next mark
  await fs.writeFile(path.join(w.handoffDir, 'TC-PROD', '20261110-1400_TC-VIS-032.json'), JSON.stringify({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-032', title: 'x', state: 'blocked', to: 'director', evidence: [{ kind: 'commit', ref: 'c' }], at: new Date().toISOString() }));
  T = slotStart + 2 * SLOT - 1;
  const a2 = await get('/api/live'), b2 = await get('/api/board');
  assert.equal(a2.body, a1.body); assert.equal(a2.etag, a1.etag);
  assert.equal(b2.body, b1.body); assert.equal(b2.etag, b1.etag);
  // next mark: the change appears, and only then
  T = slotStart + 2 * SLOT + 5000;
  const a3 = await get('/api/live');
  assert.notEqual(a3.body, a1.body);
  assert.equal(JSON.parse(a3.body).teams[0].status.key, 'waiting_result');
  assert.equal(JSON.parse(a1.body).teams[0].status.key, 'waiting_user');
  for (const x of [a1, b1, a3]) assert.doesNotMatch(x.body, /cost|token|krw|usd|원화|토큰|비용|\$/i);
});

test('P7 a snapshot leaves out records written or dated after its mark', () => {
  const mark = Date.parse('2026-11-10T05:00:00Z');
  const c = (file, at, written_at, o = {}) => ({ file, team: 'TC-PROD', task_id: 'TC-VIS-031', title: 'x', state: 'in_progress', verdict: null, to: null, user_action: null, evidence: [{}], grade: 'confirmed', at, written_at, ...o });
  const before = c('a.json', '2026-11-10T04:50:00Z', '2026-11-10T04:50:00Z');
  const after = c('b.json', '2026-11-10T05:05:00Z', '2026-11-10T05:05:00Z', { state: 'blocked', to: 'director' });
  const backdated = c('c.json', '2026-11-10T04:55:00Z', '2026-11-10T05:07:00Z', { user_action: 'x' }); // dated before, written after
  const live = buildLive({ cards: [before, after, backdated], now: Date.parse('2026-11-10T05:10:00Z'), detail: true, asOf: mark });
  assert.equal(live.teams[0].report.key, 'working', 'a back-dated card written after the mark also waits — it did not exist at the mark');
  const live2 = buildLive({ cards: [before, after], now: Date.parse('2026-11-10T05:10:00Z'), detail: true, asOf: mark });
  assert.equal(live2.teams[0].report.key, 'working', 'a card written after the mark waits for the next one');
  const pc = { state: 'ok', results: [{ job: 'j', state: 'running', started: '2026-11-10T05:01:00Z', finished: null, all_ok: null, images_ok: null, render_sec: null }], placed: [] };
  assert.equal(buildLive({ cards: [], pc, now: mark + 600000, detail: true, asOf: mark }).teams[0].pc.key, 'pc_none');
});

test('P8 the first request in a slot still leaves out records written after the slot mark', async t => {
  const SLOT = 15 * 60 * 1000;
  const startSlot = Math.floor(Date.now() / SLOT);
  const w = await world(t); // every fixture file is written now, i.e. after this slot's mark
  const base = await serve(t, { ...w, publicOnly: undefined, now: () => (startSlot + 1) * SLOT - 1000 }); // late in the same slot: all files exist by then
  const j = await (await fetch(`${base}/Houdini/api/live`)).json();
  if (Math.floor(Date.now() / SLOT) !== startSlot) return t.skip('slot boundary crossed during the test');
  assert.equal(j.teams[0].status.key, 'unverified');
  assert.equal(j.teams[1].status.key, 'unverified');
});
