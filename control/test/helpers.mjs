import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { createApp } from '../server.mjs';

export async function tmp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hpc-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function collectorFixture(t, change = {}) {
  const dir = await tmp(t);
  const doc = {
    schema: 'tc-dash/1',
    generated_at: new Date().toISOString(),
    stage: 'TC-00-03',
    teams: [{ key: 'houdini', state: 'running', task: 'TC-00-03R', progress: { total: 2, done: 1, running: 1, failed: 0 }, evidence: ['unit test'], report: { id: '0123456789abcdef', team: 'houdini', title: '진단 보고서', file: 'TC00_03R_DIAGNOSIS.md' } }],
    reports: [{ id: '0123456789abcdef', team: 'houdini', title: '진단 보고서', file: 'TC00_03R_DIAGNOSIS.md' }, { id: 'aaaaaaaaaaaaaaaa', team: 'verify', title: '검증', file: 'CHECK.md' }],
    ...change,
  };
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(doc));
  return dir;
}

export const sha = b => crypto.createHash('sha256').update(b).digest('hex');

export async function ledgerFixture(t) {
  const dir = await tmp(t);
  const put = async (rel, body) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), body); return Buffer.from(body); };
  const files = [];
  const add = async (rel, body, kind, extra = {}) => { const b = await put(`tc/tc00/${rel}`, body); files.push({ path: `tc/tc00/${rel}`, source_rel: rel, kind, bytes: b.length, source_sha256: sha(b), sha256: sha(b), identical: true, ...extra }); };
  await add('tools/bpm2d_v1.py', 'print(1)\n', 'code');
  await add('tools/proxy2d_dem.py', 'print(0)\n', 'code');
  await add('TC00_03R_DIAGNOSIS.md', '# 03R\n<LAB_SERVER> 에서 실행. /home/someone/x 경로\n', 'report', { identical: false });
  await add('tc00_03/batch_131826/a/result.json', JSON.stringify({ code_sha256: 'ab'.repeat(32) }), 'result_json');
  await add('tc00_03/batch_131826/b/result.json', JSON.stringify({ code_sha256: 'ab'.repeat(32) }), 'result_json');
  await add('runs/free_uniform/result.json', JSON.stringify({ code_sha256: 'cd'.repeat(32) }), 'result_json');
  await add('tc00_02/kinematics_130254/kinematics.json', '{}', 'result_json');
  await put('manifests/tc00_import_manifest.json', JSON.stringify({ files }));
  await put('manifests/tc00_source_inventory.json', JSON.stringify({ files: [
    ...files.map(f => ({ path: f.source_rel, bytes: f.bytes, sha256: f.sha256, tracked: true })),
    { path: 'tc00_02/kinematics_130254/NOTE_superseded.txt', bytes: 10, sha256: 'ee'.repeat(32), tracked: false },
    { path: 'runs/free_uniform/frames.npz', bytes: 1000, sha256: 'ff'.repeat(32), tracked: false },
  ] }));
  await put('env/requirements-tc00.txt', '# Interpreter: CPython 3.13.13 (see env)\nnumpy==2.5.4\nscipy==1.18.1\n');
  return dir;
}

export async function serve(t, cfg) {
  const server = createApp({ host: '127.0.0.1', basePath: '/Houdini', allowedHosts: ['127.0.0.1', 'localhost'], authMode: 'off', users: '', demo: false, recordsFile: new URL('../data/records.json', import.meta.url).pathname, ...cfg });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

export function rawGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    req.on('error', reject);
  });
}
