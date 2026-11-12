import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeMesh, checkMesh } from '../lib/mesh.mjs';
import { parseStatus, readFrames, frameView } from '../lib/state.mjs';
import { makeServer } from '../server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = 'a'.repeat(64), B = 'b'.repeat(64);
const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], elements: [0, 1, 3], indices: [0, 1, 2] };
const NOW = Date.parse('2026-11-12T03:00:00Z');
const status = (o = {}) => ({ schema: 'tc-live-status/1', task_id: 'TC-VIS-030', candidate: 'br1 9b60ced', model_sha256: A, stage: 'computing',
  frames_total: 300, last_completed_frame: 2, current_frame: 3, completed_frames: [1, 2], updated_at: new Date(NOW - 60000).toISOString(), ...o });
async function tmp(t) { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'tclive-')); t.after(() => fs.rm(d, { recursive: true, force: true })); return d; }

test('L1 mesh file: round trip, and malformed files are refused', () => {
  const buf = encodeMesh(tri);
  assert.deepEqual(checkMesh(buf), { nv: 3, nt: 1 });
  const bad = Buffer.from(buf); bad.writeUInt32LE(9, 16 + 3 * 12 + 4); assert.equal(checkMesh(bad), null);      // index out of range
  const el = Buffer.from(buf); el[16 + 36] = 7; assert.equal(checkMesh(el), null);                               // unknown element
  const nan = Buffer.from(buf); nan.writeFloatLE(NaN, 16); assert.equal(checkMesh(nan), null);
  assert.equal(checkMesh(buf.subarray(0, buf.length - 1)), null);
  assert.equal(checkMesh(Buffer.from('nope')), null);
});

test('L2 (결정 22 4항) a frame is "① 계산 완료" only when ① lists it for the same model; viewer and test frames never are', () => {
  const frames = { model_sha256: A, frames: [{ frame: 1, source: 'production' }, { frame: 2, source: 'viewer' }, { frame: 3, source: 'production' }, { frame: 4, source: 'test' }] };
  const st = parseStatus(status(), NOW);
  const v = Object.fromEntries(frameView(frames, st).map(x => [x.frame, x.source]));
  assert.deepEqual(v, { 1: 'production', 2: 'viewer', 3: 'unconfirmed', 4: 'test' });
  // a different model hash: nothing is ①'s
  const other = Object.fromEntries(frameView({ ...frames, model_sha256: B }, st).map(x => [x.frame, x.source]));
  assert.equal(other[1], 'unconfirmed');
  // no status file at all: nothing is ①'s
  assert.equal(frameView(frames, null)[0].source, 'unconfirmed');
});

test('L3 status file: old or future updates are marked, unknown fields are dropped, bad files are refused', () => {
  assert.equal(parseStatus(status(), NOW).stale, false);
  assert.equal(parseStatus(status({ updated_at: new Date(NOW - 11 * 60000).toISOString() }), NOW).stale, true);
  assert.equal(parseStatus(status({ updated_at: new Date(NOW + 5 * 60000).toISOString() }), NOW).future, true);
  assert.equal(parseStatus(status({ model_sha256: 'x' }), NOW), null);
  assert.equal(parseStatus({ ...status(), schema: 'other' }, NOW), null);
  const s = parseStatus(status({ stage: 'hacked', task_id: 'TC-VIS-30', checks: { source: 'selfcheck', state: 'running', items: { D1: { value: 0.03, limit: 0.01, result: 'FAIL', frame: 270 }, 'bad key': { value: 1 } } } }), NOW);
  assert.equal(s.stage, 'idle'); assert.equal(s.task_id, null);
  assert.deepEqual(s.checks.items.map(x => x.name), ['D1']);
});

test('L4 server: read only, no path escape, frame bytes checked', async t => {
  const dir = await tmp(t);
  await fs.writeFile(path.join(dir, 'f0001.bin'), encodeMesh(tri));
  await fs.writeFile(path.join(dir, 'f0002.bin'), Buffer.from('TCM1 broken'));
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ schema: 'tc-live-frames/1', model_sha256: A, label: 't',
    frames: [{ frame: 1, file: 'f0001.bin', source: 'test' }, { frame: 2, file: 'f0002.bin', source: 'test' }, { frame: 3, file: '../x.bin', source: 'test' }] }));
  const srv = makeServer({ meshDir: dir, statusFile: path.join(dir, 'missing.json'), handoffDir: null });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await fetch(`${base}/api/state`, { method: m })).status, 405, m);
  const s = await (await fetch(`${base}/api/state`)).json();
  assert.equal(s.status_state, 'missing');
  assert.deepEqual(s.mesh.frames.map(f => f.frame), [1, 2]);          // ../x.bin dropped
  assert.match(s.notice, /Karma 렌더가 아니며/);
  assert.equal((await fetch(`${base}/api/frame/1`)).status, 200);
  assert.equal((await fetch(`${base}/api/frame/2`)).status, 422);
  assert.equal((await fetch(`${base}/api/frame/3`)).status, 404);
  assert.equal((await fetch(`${base}/static/..%2fserver.mjs`)).status, 404);
  assert.ok((await fetch(`${base}/`)).headers.get('content-security-policy').includes("default-src 'self'"));
});

test('L5 the server refuses to bind to anything but loopback', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'server.mjs')], { env: { ...process.env, LIVE_HOST: '0.0.0.0', LIVE_PORT: '0' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /루프백 주소만 허용/);
});

test('L6 the viewer writes text only through textContent (no innerHTML)', async () => {
  const js = await fs.readFile(path.join(HERE, '..', 'public', 'viewer.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js));
});
