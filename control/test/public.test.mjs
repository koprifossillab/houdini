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
