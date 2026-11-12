// 감독 결정 23 — Thermal Collapse LIVE inside the control room: same address, same access rules, read only,
// no internal path or model code in any answer, and ①'s frames told apart from viewer and test frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmp, serve } from './helpers.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { encodeMesh, checkMesh } from '../lib/tclive-mesh.mjs';
import { parseStatus, frameView, qaFor, readStatusDir, tcliveState } from '../lib/tclive.mjs';

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
  // ② QA REVIEW 1: a status file dated in the future confirms nothing
  const fut = parseStatus(statusDoc({ updated_at: new Date(Date.now() + 3600e3).toISOString() }), Date.now());
  assert.ok(fut.future && frameView(frames, fut).every(x => x.source !== 'production'), 'future status');
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

test('TL6 (결정 27 3항) QA verdicts are linked by model SHA-256 and task, never by a part of the candidate name', () => {
  const M1 = 'e534bf2192a82e13f2acd915b26fde8fec8a9d75f33738677745077731d2d6e8', M2 = '54db5955' + 'c'.repeat(56);
  const c = (o) => ({ team: 'TC-QA', task_id: 'TC-VIS-030', verdict: 'FAIL', verdict_scope: 'technical', at: '2026-11-12T08:27:00Z', title: 't', candidate: null, evidence: [], ...o });
  const cards = [
    c({ candidate: 'br1 시험 6 (1658263, 모델 54db5955) — 우측 부분 후보', at: '2026-11-12T08:27:00Z' }),          // other model, same name
    c({ candidate: 'br1a 0f6abbe (모델 e534bf21)', verdict: 'REVIEW', at: '2026-11-12T11:40:00Z' }),                 // this model by prefix
    c({ candidate: 'br1a', verdict: 'PASS', evidence: [{ sha256: M1.slice(0, 16) }], at: '2026-11-12T11:45:00Z' }), // this model by the reader's 16-hex evidence hash
    c({ candidate: 'br1a', verdict: 'FAIL', evidence: [{ sha256: 'e534bf2' }], at: '2026-11-12T11:58:00Z' }),          // 7 hex: too short to count
    c({ candidate: 'br1a 0f6abbe', verdict: 'PASS', at: '2026-11-12T11:50:00Z' }),                                  // names no model
    c({ candidate: '모델 e534bf21', task_id: 'TC-VIS-029', at: '2026-11-12T11:55:00Z' }),                            // other task
    c({ team: 'TC-PROD', candidate: '모델 e534bf21', at: '2026-11-12T11:56:00Z' }),                                  // not QA
    c({ candidate: 'br1a e534bf2', at: '2026-11-12T11:57:00Z' }),                                                   // 7-hex commit-like token, no "모델"
    c({ candidate: 'br1a (모델 e534bf2)', at: '2026-11-12T11:59:00Z' }),                                              // "모델" but only 7 hex: too short
  ];
  const st = { task_id: 'TC-VIS-030', model_sha256: M1 };
  assert.deepEqual(qaFor(cards, st).map(x => x.verdict), ['PASS', 'REVIEW']);
  assert.deepEqual(qaFor(cards, { task_id: 'TC-VIS-030', model_sha256: M2 }).map(x => x.verdict), ['FAIL']);
  assert.deepEqual(qaFor(cards, null), []);
  assert.deepEqual(qaFor(cards, { task_id: null, model_sha256: M1 }), []);
});

test('TL7 the LIVE viewer writes text only through textContent', async () => {
  const js = await fs.readFile(new URL('../public/tclive.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js));
});

test('TL8 (결정 29) ① status folder: the file with the shown model hash is used; WIP notes and technical state reach the screen', async t => {
  const md = await meshDir(t, 'viewer');
  const idx = JSON.parse(await fs.readFile(path.join(md, 'index.json'), 'utf8'));
  idx.notes = ['제작 중 — 최종 승인 모델 아님', '우측 부분 후보 · 왼쪽 파쇄 미구현']; idx.tech = { result: 'FAIL', text: 'E-G (세립 매몰)' };
  await fs.writeFile(path.join(md, 'index.json'), JSON.stringify(idx));
  const sd = await tmp(t);
  await fs.writeFile(path.join(sd, 'TC-VIS-030-other.json'), JSON.stringify(statusDoc({ model_sha256: B, candidate: 'pc1 3976521' })));
  await fs.writeFile(path.join(sd, 'TC-VIS-030-br1a.json'), JSON.stringify(statusDoc({ completed_frames: [1, 2], updated_at: new Date(Date.now() - 60e3).toISOString() })));
  await fs.writeFile(path.join(sd, 'TC-VIS-030-br1a-old.json'), JSON.stringify(statusDoc({ stage: 'done', updated_at: new Date(Date.now() - 3600e3).toISOString() })));
  await fs.writeFile(path.join(sd, 'junk.json'), '{not json');
  const r = await readStatusDir(sd, A, Date.now());
  assert.equal(r.state, 'live'); assert.equal(r.status.stage, 'computing'); assert.equal(r.status.model_sha256, A);
  assert.equal((await readStatusDir(sd, 'c'.repeat(64))).state, 'missing');
  assert.equal((await readStatusDir(null, A)).state, 'not_configured');
  const s = await tcliveState({ meshDir: md, statusDir: sd, cards: [] });
  assert.deepEqual(s.mesh.notes, idx.notes); assert.deepEqual(s.mesh.tech, { result: 'FAIL', text: 'E-G (세립 매몰)' });
  assert.equal(s.mesh.frames[1].source_label, '④ 격리 계산기 생성 — ① 계산 완료 아님');
  // the folder path never reaches the answer
  const b = await serve(t, { handoffDir: await hand(t), tcliveMeshDir: md, tcliveStatusDir: sd });
  const raw = await (await fetch(`${b}/Houdini/api/tclive/state`)).text();
  assert.ok(!raw.includes(sd) && !raw.includes('TC-VIS-030-br1a.json'));
  assert.equal(JSON.parse(raw).status_state, 'live');
});

test('TL9 (결정 33 2항) a status time without a zone, or one that does not parse, is 미확인 and confirms no ① frame', async t => {
  const frames = { model_sha256: A, frames: [{ frame: 1, source: 'production' }] };
  for (const bad of ['2026-11-12T12:00:00', '2026-11-12 12:00:00+09:00', '12:00', 'yesterday', '', null, 1731380400000, '2026-11-12T12:00:00+0900']) {
    const st = parseStatus(statusDoc({ updated_at: bad, completed_frames: [1] }), Date.now());
    assert.equal(st.time_ok, false, String(bad));
    assert.equal(frameView(frames, st)[0].source, 'unconfirmed', String(bad));
  }
  for (const good of [new Date().toISOString(), new Date(Date.now() - 60e3).toISOString().replace('Z', '+00:00')]) {
    const st = parseStatus(statusDoc({ updated_at: good, completed_frames: [1] }), Date.now());
    assert.equal(st.time_ok, true, good);
    assert.equal(frameView(frames, st)[0].source, 'production', good);
  }
  const sd = await tmp(t);
  await fs.writeFile(path.join(sd, 's.json'), JSON.stringify(statusDoc({ updated_at: '2026-11-12T12:00:00' })));
  assert.equal((await readStatusDir(sd, A)).state, 'time_unknown');
});
