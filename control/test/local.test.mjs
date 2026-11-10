// TC-DASH-009 — detailed views only for a viewer on this computer; everyone else gets the public view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmp, serve } from './helpers.mjs';
import { checkPublic } from '../lib/public.mjs';

async function hand(t) {
  const d = await tmp(t);
  for (const team of ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH']) await fs.mkdir(path.join(d, team));
  await fs.writeFile(path.join(d, 'TC-PROD', '20261110-1300_TC-VIS-031.json'), JSON.stringify({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-031', title: '상세 작업 제목', state: 'in_progress', evidence: [{ kind: 'commit', ref: 'c' }], at: new Date(Date.now() - 60000).toISOString() }));
  return d;
}
// the test server listens on loopback; with trustedProxies = loopback the test client stands in for nginx
const open = async (t, extra = {}) => serve(t, { handoffDir: await hand(t), publicOnly: undefined, trustedProxies: ['127.0.0.1', '::ffff:127.0.0.1'], ...extra });
const view = async (base, headers = {}) => {
  const s = await (await fetch(`${base}/Houdini/api/session`, { headers })).json();
  const live = await (await fetch(`${base}/Houdini/api/live`, { headers })).json();
  const legacy = (await fetch(`${base}/Houdini/legacy.html`, { headers })).status;
  const teams = (await fetch(`${base}/Houdini/api/teams`, { headers })).status;
  return { detail: s.public !== true, s, live, legacy, teams };
};

test('V1 through nginx from this computer (X-Real-IP loopback) → detailed views incl. cost API and legacy', async t => {
  const base = await open(t);
  for (const ip of ['127.0.0.1', '::1']) {
    const v = await view(base, { 'X-Real-IP': ip });
    assert.ok(v.detail, ip);
    assert.equal(v.live.teams[0].report.title, '상세 작업 제목');
    assert.equal(v.legacy, 200); assert.equal(v.teams, 200);
    assert.equal(v.s.local_detail, true);
  }
});

test('V2 through nginx from another address (LAN, VPN, internet) → public view only', async t => {
  const base = await open(t);
  for (const ip of ['172.16.116.50', '172.16.116.98', '10.8.0.12', '203.0.113.9', '2001:db8::1', 'garbage']) {
    const v = await view(base, { 'X-Real-IP': ip });
    assert.equal(v.detail, false, ip);
    assert.deepEqual(checkPublic(v.live), [], ip);
    assert.equal(v.legacy, 404); assert.equal(v.teams, 404);
  }
});

test('V3 forged headers cannot unlock it: X-Forwarded-For is ignored, the nginx-set X-Real-IP decides', async t => {
  const base = await open(t);
  // nginx appends the client's own X-Forwarded-For value but overwrites X-Real-IP with the real peer
  const v = await view(base, { 'X-Real-IP': '203.0.113.9', 'X-Forwarded-For': '127.0.0.1, 203.0.113.9', Forwarded: 'for=127.0.0.1' });
  assert.equal(v.detail, false);
});

test('V4 a socket that is not a trusted proxy never gets the detailed views, whatever it claims', async t => {
  const base = await open(t, { trustedProxies: ['172.30.0.1'] });
  for (const h of [{}, { 'X-Real-IP': '127.0.0.1' }]) assert.equal((await view(base, h)).detail, false);
});

test('V5 direct request to the loopback-only port without nginx (no X-Real-IP) → this computer → detailed', async t => {
  const base = await open(t);
  assert.ok((await view(base)).detail);
});

test('V6 HPC_LOCAL_DETAIL=0 → public view for everyone, including this computer', async t => {
  const base = await open(t, { localDetail: false });
  for (const h of [{}, { 'X-Real-IP': '127.0.0.1' }]) assert.equal((await view(base, h)).detail, false);
});

test('V7 detailed responses are never cached and carry no secrets from the environment', async t => {
  process.env.HPC_TEST_SECRET_VALUE = 'sk-test-abcdefghijklmnop';
  t.after(() => { delete process.env.HPC_TEST_SECRET_VALUE; });
  const base = await open(t);
  for (const p of ['/api/board', '/api/live', '/api/session', '/api/teams', '/api/overview', '/healthz']) {
    const r = await fetch(`${base}/Houdini${p}`, { headers: { 'X-Real-IP': '127.0.0.1' } });
    const b = await r.text();
    assert.ok(!b.includes('sk-test-abcdefghijklmnop') && !b.includes('HPC_') , p);
    if (p !== '/api/live') assert.equal(r.headers.get('cache-control'), 'no-store', p);
  }
});

test('V8 /api/session local_detail is true only when the detail view opened because the viewer is on this computer', async t => {
  const base = await open(t);
  assert.equal((await (await fetch(`${base}/Houdini/api/session`, { headers: { 'X-Real-IP': '127.0.0.1' } })).json()).local_detail, true);
  assert.equal((await (await fetch(`${base}/Houdini/api/session`, { headers: { 'X-Real-IP': '203.0.113.9' } })).json()).local_detail, undefined);
  const authed = await serve(t, { handoffDir: await hand(t), publicOnly: false });
  assert.equal((await (await fetch(`${authed}/Houdini/api/session`)).json()).local_detail, false, 'an authenticated/detailed service is not a local-only view');
});
