import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ledgerView, publicLedger } from '../lib/ledger.mjs';
import { mediaItems } from '../lib/media.mjs';
import { ledgerFixture, collectorFixture, tmp, serve, sha } from './helpers.mjs';

test('ledger: experiments grouped by stage, failure record and superseded marks kept', async t => {
  const v = await ledgerView(await ledgerFixture(t));
  assert.equal(v.state, 'ok');
  const byId = Object.fromEntries(v.experiments.map(e => [e.id, e]));
  assert.equal(byId['tc00_03/batch_131826'].results, 2);
  assert.equal(byId['tc00_03/batch_131826'].code_status, 'match');
  assert.equal(byId['tc00_03/batch_131826'].time_kst, '2026-10-30 13:18:26');
  assert.equal(byId.runs.validity, 'invalid');
  assert.equal(byId.runs.untracked_files, 1);
  assert.equal(byId['tc00_02/kinematics_130254'].validity, 'superseded');
  assert.equal(v.environment.python, '3.13.13');
  assert.deepEqual(v.environment.packages[0], { name: 'numpy', version: '2.5.4' });
  assert.equal(v.tools.find(x => x.name === 'proxy2d_dem.py').role, 'v0 · 무효(이력용)');
  assert.ok(!JSON.stringify(publicLedger(v)).includes('_path'));
});

test('ledger: missing and malformed manifests are explicit', async t => {
  assert.equal((await ledgerView(null)).state, 'missing');
  const dir = await tmp(t);
  assert.equal((await ledgerView(dir)).state, 'missing');
  await fs.mkdir(path.join(dir, 'manifests'));
  await fs.writeFile(path.join(dir, 'manifests', 'tc00_import_manifest.json'), '[');
  assert.equal((await ledgerView(dir)).state, 'error');
});

test('ledger: manifest entries with unsafe paths are ignored', async t => {
  const dir = await ledgerFixture(t);
  const p = path.join(dir, 'manifests', 'tc00_import_manifest.json');
  const m = JSON.parse(await fs.readFile(p, 'utf8'));
  m.files.push({ path: '../../etc/passwd', source_rel: 'tc00_03/batch_131826/z/result.json', kind: 'result_json', sha256: 'aa'.repeat(32) });
  m.files.push({ path: '/etc/passwd', source_rel: '/etc/passwd', kind: 'report', sha256: 'aa'.repeat(32) });
  await fs.writeFile(p, JSON.stringify(m));
  const v = await ledgerView(dir);
  assert.equal(v.experiments.find(e => e.id === 'tc00_03/batch_131826').results, 2);
  assert.ok(!v.reports.some(r => r.file === 'passwd'));
});

async function mediaFixture(t) {
  const dir = await tmp(t);
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const mp4 = Buffer.alloc(4096, 7);
  await fs.writeFile(path.join(dir, 'a.png'), png);
  await fs.writeFile(path.join(dir, 'b.mp4'), mp4);
  await fs.writeFile(path.join(dir, 'c.png'), png);
  const manifest = path.join(await tmp(t), 'media.json');
  await fs.writeFile(manifest, JSON.stringify([
    { id: 'snap', file: 'a.png', title: '스냅', origin: 'physics', sha256: sha(png) },
    { id: 'clip', file: 'b.mp4', title: '영상', origin: 'physics', sampling: { frames: 100, playback_fps: 20, sim_interval_s: 0.05 }, sha256: sha(mp4) },
    { id: 'tampered', file: 'c.png', title: '바뀐 파일', origin: 'physics', sha256: '00'.repeat(32) },
    { id: 'escape', file: '../a.png', title: 'x', sha256: sha(png) },
    { id: 'gone', file: 'missing.png', title: '없는 파일', sha256: sha(png) },
    { id: 'BAD ID', file: 'a.png', sha256: sha(png) },
  ]));
  return { dir, manifest, mp4 };
}

test('media: allowlist, hash check, range requests, unknown origin labelled', async t => {
  const { dir, manifest, mp4 } = await mediaFixture(t);
  const m = await mediaItems(dir, manifest);
  assert.deepEqual(m.items.map(x => x.id), ['snap', 'clip', 'tampered', 'gone']);
  assert.equal(m.items.find(x => x.id === 'gone').present, false);
  assert.equal(m.items.find(x => x.id === 'gone').origin_label, '출처 미기재');
  const base = await serve(t, { collectorDir: await collectorFixture(t), mediaDir: dir, mediaManifest: manifest });
  const list = await (await fetch(`${base}/Houdini/api/media`)).json();
  assert.ok(!JSON.stringify(list).includes('a.png') && !JSON.stringify(list).includes(dir), 'no file names or dirs leak');
  const img = await fetch(`${base}/Houdini/media/snap`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/Houdini/media/tampered`)).status, 409);
  assert.equal((await fetch(`${base}/Houdini/media/escape`)).status, 404);
  assert.equal((await fetch(`${base}/Houdini/media/gone`)).status, 404);
  const part = await fetch(`${base}/Houdini/media/clip`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${mp4.length}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(`${base}/Houdini/media/clip`, { headers: { Range: 'bytes=99999-' } })).status, 416);
});
