// Ported from the Work prototype tests (dashboard/test/server.test.mjs, 2026-11-02) and adapted to lib/collector.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectorSnapshot, collectorReport, publicSnapshot } from '../lib/collector.mjs';
import { clean } from '../lib/sanitize.mjs';
import { collectorFixture } from './helpers.mjs';

test('W1 fresh evidence stays distinct from director approval', async t => {
  const d = await collectorSnapshot(await collectorFixture(t));
  assert.equal(d.state, 'live');
  assert.equal(d.provenance, 'collected');
  assert.equal(d.teams[0].state, 'running');
  assert.equal(d.teams[0].progress.done, 1);
  assert.equal(d.approval, undefined);
});

test('W2 stale data removes current execution claim and running count', async t => {
  const d = await collectorSnapshot(await collectorFixture(t, { generated_at: new Date(Date.now() - 181000).toISOString() }));
  assert.equal(d.state, 'stale');
  assert.equal(d.teams[0].state, 'unknown');
  assert.equal(d.teams[0].reported_state, 'running');
  assert.equal(d.teams[0].progress.running, null);
});

test('W3 missing, malformed, unsupported schema and future timestamps are explicit', async t => {
  assert.equal((await collectorSnapshot(null)).state, 'missing');
  const dir = await collectorFixture(t);
  await fs.writeFile(path.join(dir, 'status.json'), '{');
  assert.equal((await collectorSnapshot(dir)).state, 'error');
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema: 'other', teams: [], generated_at: new Date().toISOString() }));
  assert.equal((await collectorSnapshot(dir)).state, 'error');
  const future = await collectorFixture(t, { generated_at: new Date(Date.now() + 120000).toISOString() });
  assert.equal((await collectorSnapshot(future)).state, 'error');
  await fs.rm(path.join(dir, 'status.json'));
  assert.equal((await collectorSnapshot(dir)).state, 'missing');
});

test('W4 oversized state is rejected rather than parsed', async t => {
  const dir = await collectorFixture(t);
  await fs.writeFile(path.join(dir, 'status.json'), ' '.repeat(1024 * 1024 + 1));
  assert.equal((await collectorSnapshot(dir)).state, 'error');
});

test('W5 private source fields never pass through to browser', async t => {
  const dir = await collectorFixture(t, { private_value: 'unexposed', teams: [{ key: 'houdini', state: 'running', task: 'inspect /home/private/work at 203.0.113.9 token=abcdefghi', cmd: 'private command', session: 'private-session', evidence: ['secret=abcd'] }, { key: 'another-researcher', task: 'PRIVATE' }] });
  const body = JSON.stringify(publicSnapshot(await collectorSnapshot(dir)));
  for (const s of ['203.0.113.9', '/home/private', 'abcdefghi', 'private command', 'private-session', 'PRIVATE', 'unexposed', 'TC00_03R_DIAGNOSIS.md']) assert.ok(!body.includes(s), s);
  assert.equal((await collectorSnapshot(dir)).teams.length, 1);
  assert.ok(!clean('https://internal.example/x api_key=abc').includes('abc'));
});

test('W6 reports require valid ID and snapshot allowlist', async t => {
  const dir = await collectorFixture(t);
  await fs.mkdir(path.join(dir, 'reports'));
  await fs.writeFile(path.join(dir, 'reports', '0123456789abcdef.md'), '<script>alert(1)</script> /home/person/private');
  const snap = await collectorSnapshot(dir);
  assert.equal(await collectorReport(dir, snap, '../../secret'), null);
  assert.equal(await collectorReport(dir, snap, 'ffffffffffffffff'), null);
  const body = clean(await collectorReport(dir, snap, '0123456789abcdef'), 400000);
  assert.ok(body.includes('<script>'), 'kept as text, rendered with textContent');
  assert.ok(!body.includes('/home/person'));
});

test('W7 malformed optional fields cannot supply raw state or invalid counts', async t => {
  const dir = await collectorFixture(t, { teams: [null, { key: 'verify', state: 'SUPERPASS', task: { secret: 'x' }, progress: { total: -1, done: 1.5, running: '2' } }] });
  const d = await collectorSnapshot(dir);
  assert.equal(d.teams[0].state, 'unknown');
  assert.equal(d.teams[0].task, '');
  assert.deepEqual(d.teams[0].progress, { total: null, done: null, running: null, failed: null, waiting: null });
});

test('symlinked status.json is refused', async t => {
  const dir = await collectorFixture(t);
  const other = path.join(dir, 'real.json');
  await fs.rename(path.join(dir, 'status.json'), other);
  await fs.symlink(other, path.join(dir, 'status.json'));
  assert.equal((await collectorSnapshot(dir)).state, 'error');
});

test('filter gaps found on real reports are closed (hyphenated host, glued segment, runtime terms)', async () => {
  const { clean: c, setRedactTerms } = await import('../lib/sanitize.mjs');
  assert.ok(!c('서버 alpha-server CPU').includes('alpha-server'));
  assert.ok(!c('세션 betaserver-x1').includes('betaserver'));
  assert.ok(c('web server 와 Server 라는 낱말').includes('server'), 'plain word kept');
  assert.equal(c('observer 와 preserver'), 'observer 와 preserver');
  const glued = c('N: `Owner9/claude/thermal_collapse/x.md`');
  assert.ok(!glued.includes('Owner9'), glued);
  setRedactTerms(['Researcher9']);
  try { assert.ok(!c('담당 researcher9 의 폴더').toLowerCase().includes('researcher9')); } finally { setRedactTerms([]); }
  assert.equal(c('V2 / V3 / V5 원인 진단'), 'V2 / V3 / V5 원인 진단', 'ordinary text untouched');
});
