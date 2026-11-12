// 감독 결정 23 — Thermal Collapse LIVE inside the control room: same address, same access rules, read only,
// no internal path or model code in any answer, and ①'s frames told apart from viewer and test frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmp, serve } from './helpers.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { encodeMesh, checkMesh } from '../lib/tclive-mesh.mjs';
import { parseStatus, frameView, qaFor } from '../lib/tclive.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], elements: [0, 1, 3], indices: [0, 1, 2] };
const statusDoc = (o = {}) => ({ schema: 'tc-live-status/1', task_id: 'TC-VIS-030', candidate: 'br1 9b60ced', model_sha256: A, stage: 'computing',
  frames_total: 300, last_completed_frame: 2, current_frame: 3, completed_frames: [1, 2], updated_at: new Date().toISOString(), ...o });

async function meshDir(t, source = 'production', model = A) {
  const dir = await tmp(t);
  await fs.writeFile(path.join(dir, 'f0001.bin'), encodeMesh(tri));
  await fs.writeFile(path.join(dir, 'f0002.bin'), encodeMesh(tri));
  await fs.writeFile(path.join(dir, 'f0003.bin'), Buffer.from('TCM1 broken'));
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ schema: 'tc-live-frames/1', model_sha256: model, label: '시험',
    frames: [{ frame: 1, file: 'f0001.bin', source }, { frame: 2, file: 'f0002.bin', source: 'viewer' }, { frame: 3, file: 'f0003.bin', source }, { frame: 4, file: '../x.bin', source }] }));
  return dir;
}
async function hand(t) { const d = await tmp(t); for (const x of ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH']) await fs.mkdir(path.join(d, x)); return d; }

test('TL1 the LIVE page and its APIs answer under the control room address; /live goes to /live/', async t => {
  const md = await meshDir(t, 'test');
  const b = await serve(t, { handoffDir: await hand(t), tcliveMeshDir: md });
  const page = await fetch(`${b}/Houdini/live/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Thermal Collapse LIVE/);
  const red = await fetch(`${b}/Houdini/live`, { redirect: 'manual' });
  assert.equal(red.status, 301); assert.equal(red.headers.get('location'), '/Houdini/live/');
  for (const s of ['tclive.js', 'tclive.css']) assert.equal((await fetch(`${b}/Houdini/static/${s}`)).status, 200);
  const home = await (await fetch(`${b}/Houdini/`)).text();
  assert.match(home, /href="live\/"[^>]*>LIVE</, 'LIVE in the menu');
  const s = await (await fetch(`${b}/Houdini/api/tclive/state`)).json();
  assert.equal(s.status_state, 'not_configured');
  assert.match(s.notice, /Karma 렌더가 아니며/);
  assert.deepEqual(s.mesh.frames.map(f => [f.frame, f.source]), [[1, 'test'], [2, 'viewer'], [3, 'test']]);   // ../x.bin dropped
  const f1 = await fetch(`${b}/Houdini/api/tclive/frame/1`);
  assert.equal(f1.status, 200); assert.ok(checkMesh(Buffer.from(await f1.arrayBuffer())));
  assert.equal((await fetch(`${b}/Houdini/api/tclive/frame/3`)).status, 422);
  assert.equal((await fetch(`${b}/Houdini/api/tclive/frame/4`)).status, 404);
  assert.equal((await fetch(`${b}/Houdini/api/tclive/frame/99`)).status, 404);
});

test('TL2 read only: every write method is refused on the LIVE page and APIs', async t => {
  const b = await serve(t, { handoffDir: await hand(t), tcliveMeshDir: await meshDir(t, 'test') });
  for (const p of ['live/', 'api/tclive/state', 'api/tclive/frame/1']) for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal((await fetch(`${b}/Houdini/${p}`, { method: m })).status, 405, `${m} ${p}`);
});

test('TL3 same access rules as the rest of the site: basic auth guards LIVE; public-only mode does not serve it', async t => {
  const users = `u:${hashPassword('correct horse battery')}`;
  const md = await meshDir(t, 'test');
  const b = await serve(t, { handoffDir: await hand(t), tcliveMeshDir: md, authMode: 'basic', users });
  for (const p of ['live/', 'api/tclive/state', 'api/tclive/frame/1', 'static/tclive.js']) assert.equal((await fetch(`${b}/Houdini/${p}`)).status, 401, p);
  const good = 'Basic ' + Buffer.from('u:correct horse battery').toString('base64');
  assert.equal((await fetch(`${b}/Houdini/api/tclive/state`, { headers: { Authorization: good } })).status, 200);
  const pub = await serve(t, { handoffDir: await hand(t), tcliveMeshDir: md, publicOnly: true, localDetail: false });
  for (const p of ['live/', 'api/tclive/state', 'api/tclive/frame/1', 'static/tclive.js']) assert.equal((await fetch(`${pub}/Houdini/${p}`, { headers: { 'X-Real-IP': '198.51.100.7' } })).status, 404, p);
});

test('TL4 no internal path, file name or model code leaves the server', async t => {
  const md = await meshDir(t, 'production');
  const sf = path.join(await tmp(t), 'status.json');
  await fs.writeFile(sf, JSON.stringify(statusDoc()));
  const b = await serve(t, { handoffDir: await hand(t), tcliveMeshDir: md, tcliveStatusFile: sf });
  const raw = await (await fetch(`${b}/Houdini/api/tclive/state`)).text();
  for (const leak of [md, sf, 'f0001.bin', 'index.json', 'status.json', '/tmp/', 'hpc-test-']) assert.ok(!raw.includes(leak), leak);
  const bad = await (await fetch(`${b}/Houdini/api/tclive/frame/3`)).text();
  assert.ok(!bad.includes(md) && !bad.includes('f0003'));
});

test('TL5 (결정 22 4항) "① 계산 완료" only for frames ① lists for the same model; the rest are told apart', async t => {
  const st = parseStatus(statusDoc(), Date.now());
  const frames = { model_sha256: A, frames: [{ frame: 1, source: 'production' }, { frame: 2, source: 'viewer' }, { frame: 3, source: 'production' }, { frame: 4, source: 'test' }] };
  assert.deepEqual(frameView(frames, st).map(x => x.source), ['production', 'viewer', 'unconfirmed', 'test']);
  assert.ok(frameView({ ...frames, model_sha256: B }, st).every(x => x.source !== 'production'), 'other model hash');
  assert.ok(frameView(frames, null).every(x => x.source !== 'production'), 'no status file');
  // end to end through the API
  const md = await meshDir(t, 'production');
  const sf = path.join(await tmp(t), 'status.json');
  await fs.writeFile(sf, JSON.stringify(statusDoc({ completed_frames: [1] })));
  const b = await serve(t, { handoffDir: await hand(t), tcliveMeshDir: md, tcliveStatusFile: sf });
  const s = await (await fetch(`${b}/Houdini/api/tclive/state`)).json();
  assert.equal(s.status_state, 'live');
  assert.deepEqual(s.mesh.frames.map(f => f.source), ['production', 'viewer', 'unconfirmed']);
  // an old status file is marked, and its frames are still not promoted beyond what it lists
  await fs.writeFile(sf, JSON.stringify(statusDoc({ updated_at: new Date(Date.now() - 3600e3).toISOString() })));
  assert.equal((await (await fetch(`${b}/Houdini/api/tclive/state`)).json()).status_state, 'stale');
});

test('TL6 QA panel: only ② QA cards of the same candidate, newest first', () => {
  const c = (team, cand, verdict, at) => ({ team, candidate: cand, verdict, verdict_scope: 'technical', at, title: 't', task_id: 'TC-VIS-030' });
  const cards = [c('TC-QA', 'br1 1658263', 'FAIL', '2026-11-12T08:27:00Z'), c('TC-PROD', 'br1 1658263', 'FAIL', '2026-11-12T08:23:00Z'),
    c('TC-QA', 'pc1 3976521', 'PASS', '2026-11-12T08:00:00Z'), c('TC-QA', 'br1 9b60ced', 'REVIEW', '2026-11-12T09:00:00Z'), c('TC-QA', 'br1', null, '2026-11-12T09:30:00Z')];
  assert.deepEqual(qaFor(cards, 'br1 9b60ced').map(x => x.verdict), ['REVIEW', 'FAIL']);
  assert.deepEqual(qaFor(cards, null), []);
});

test('TL7 the LIVE viewer writes text only through textContent', async () => {
  const js = await fs.readFile(new URL('../public/tclive.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js));
});
