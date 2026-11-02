import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectorFixture, ledgerFixture, serve, rawGet } from './helpers.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { createApp } from '../server.mjs';

test('W8 HTTP is read-only, host restricted, no filesystem URL access, strict headers', async t => {
  const base = await serve(t, { collectorDir: await collectorFixture(t) });
  assert.equal((await fetch(`${base}/Houdini/api/overview`)).status, 200);
  assert.equal((await fetch(`${base}/Houdini/api/overview`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/Houdini/api/overview`, { method: 'DELETE' })).status, 405);
  assert.equal((await rawGet(`${base}/Houdini/api/overview`, { Host: 'attacker.example' })).status, 403);
  for (const p of ['/.env', '/Houdini/.env', '/Houdini/../server.mjs', '/Houdini/static/../server.mjs', '/Houdini/static/%2e%2e/server.mjs', '/Houdini/data/records.json', '/Houdini/lib/auth.mjs']) {
    const s = (await rawGet(`${base}${p}`)).status;
    assert.ok(s === 404 || s === 400, `${p} -> ${s}`);
  }
  const home = await fetch(`${base}/Houdini/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(home.headers.get('cache-control'), 'no-store');
});

test('W9 HEAD keeps plain-text report type; missing report is 404', async t => {
  const dir = await collectorFixture(t);
  await fs.mkdir(path.join(dir, 'reports'));
  await fs.writeFile(path.join(dir, 'reports', '0123456789abcdef.md'), '<img src=x onerror=alert(1)>');
  const base = await serve(t, { collectorDir: dir });
  const r = await fetch(`${base}/Houdini/api/reports/0123456789abcdef`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/plain/);
  const head = await fetch(`${base}/Houdini/api/reports/0123456789abcdef`, { method: 'HEAD' });
  assert.match(head.headers.get('content-type'), /^text\/plain/);
  assert.equal((await fetch(`${base}/Houdini/api/reports/ffffffffffffffff`)).status, 404);
});

test('works under /Houdini/ and unprefixed; assets are relative', async t => {
  const base = await serve(t, { collectorDir: await collectorFixture(t) });
  for (const p of ['/Houdini/', '/', '/Houdini/static/app.js', '/static/style.css', '/Houdini/healthz', '/healthz']) assert.equal((await fetch(`${base}${p}`)).status, 200, p);
  const html = await (await fetch(`${base}/Houdini/`)).text();
  assert.ok(!/(src|href)="\//.test(html), 'no absolute asset URLs (would escape /Houdini/)');
  const js = await (await fetch(`${base}/Houdini/static/app.js`)).text();
  assert.ok(!/fetch\(['"`]\//.test(js) && !/getJson\(['"`]\//.test(js), 'no absolute API URLs in the client');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js), 'no HTML injection sinks');
});

test('auth: deny by default; Basic credentials unlock everything; wrong password refused', async t => {
  const dir = await collectorFixture(t);
  await fs.mkdir(path.join(dir, 'reports'));
  await fs.writeFile(path.join(dir, 'reports', '0123456789abcdef.md'), '본문');
  const locked = await serve(t, { collectorDir: dir, authMode: 'basic', users: '' });
  const r0 = await fetch(`${locked}/Houdini/api/reports/0123456789abcdef`);
  assert.equal(r0.status, 401);
  assert.match(r0.headers.get('www-authenticate'), /^Basic /);
  assert.equal((await fetch(`${locked}/Houdini/api/media`)).status, 401);
  assert.equal((await fetch(`${locked}/Houdini/api/overview`)).status, 401, 'F4: overview needs credentials too');
  const h0 = await (await fetch(`${locked}/Houdini/healthz`)).json();
  assert.equal(h0.auth.configured, false);

  const base = await serve(t, { collectorDir: dir, authMode: 'basic', users: `viewer:${hashPassword('correct horse battery')}` });
  const good = 'Basic ' + Buffer.from('viewer:correct horse battery').toString('base64');
  const bad = 'Basic ' + Buffer.from('viewer:wrong password!!').toString('base64');
  const nobody = 'Basic ' + Buffer.from('ghost:correct horse battery').toString('base64');
  assert.equal((await fetch(`${base}/Houdini/api/reports/0123456789abcdef`, { headers: { Authorization: bad } })).status, 401);
  assert.equal((await fetch(`${base}/Houdini/api/reports/0123456789abcdef`, { headers: { Authorization: nobody } })).status, 401);
  const ok = await fetch(`${base}/Houdini/api/reports/0123456789abcdef`, { headers: { Authorization: good } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '본문');
  const sess = await (await fetch(`${base}/Houdini/api/session`, { headers: { Authorization: good } })).json();
  assert.equal(sess.user, 'viewer');
});

test('auth off is refused on a non-loopback listener', () => {
  assert.throws(() => createApp({ host: '0.0.0.0', authMode: 'off', allowedHosts: [], basePath: '/Houdini' }), /루프백/);
  assert.throws(() => createApp({ host: '127.0.0.1', authMode: 'none', allowedHosts: [], basePath: '/Houdini' }));
});

test('missing collector copy falls back to the redacted repository report', async t => {
  const base = await serve(t, { collectorDir: await collectorFixture(t), ledgerDir: await ledgerFixture(t) });
  const list = await (await fetch(`${base}/Houdini/api/reports`)).json();
  const r = list.items.find(x => x.id === '0123456789abcdef');
  assert.equal(r.source, 'repository');
  assert.equal(r.redacted, true);
  assert.equal(list.items.find(x => x.id === 'aaaaaaaaaaaaaaaa').source, 'none');
  const txt = await fetch(`${base}/Houdini/api/reports/0123456789abcdef`);
  assert.equal(txt.headers.get('x-report-source'), 'repository');
  const body = await txt.text();
  assert.ok(body.includes('<LAB_SERVER>'));
  assert.ok(!body.includes('/home/someone'));
  assert.equal((await fetch(`${base}/Houdini/api/reports/aaaaaaaaaaaaaaaa`)).status, 404);
});

test('overview: compute claim follows freshness; sources list every input; records keep 03R', async t => {
  const base = await serve(t, { collectorDir: await collectorFixture(t) });
  const o = await (await fetch(`${base}/Houdini/api/overview`)).json();
  assert.equal(o.mode, 'live');
  assert.equal(o.compute.physics.state, 'unverified');
  assert.equal(o.compute.activity.state, 'detected');
  assert.deepEqual(o.sources.map(s => s.key), ['collector', 'records', 'ledger', 'media', 'reports']);
  assert.equal(o.records.current_recorded_stage, 'TC-00-03R');
  assert.equal(o.collector.stage, 'TC-00-03', 'collector value shown as collected, not rewritten');
  assert.ok(o.records.issues.map(i => i.id).join() === 'V2,V3,V5');
  const stale = await serve(t, { collectorDir: await collectorFixture(t, { generated_at: new Date(Date.now() - 600000).toISOString() }) });
  const s = await (await fetch(`${stale}/Houdini/api/overview`)).json();
  assert.equal(s.compute.activity.state, 'unknown');
  const none = await serve(t, { collectorDir: null });
  const n = await (await fetch(`${none}/Houdini/api/overview`)).json();
  assert.equal(n.collector.state, 'missing');
  assert.equal(n.compute.activity.state, 'unknown');
});

test('example mode is labelled everywhere it matters', async t => {
  const base = await serve(t, { demo: true, collectorDir: await collectorFixture(t) });
  const o = await (await fetch(`${base}/Houdini/api/overview`)).json();
  assert.equal(o.mode, 'example');
  assert.equal(o.collector.provenance, 'example');
  assert.ok(o.collector.teams.every(t => /예시/.test(t.task)));
  assert.equal((await (await fetch(`${base}/Houdini/healthz`)).json()).demo, true);
  assert.equal((await (await fetch(`${base}/Houdini/api/session`)).json()).demo, true);
});

test('healthz reports source states without paths', async t => {
  const dir = await collectorFixture(t);
  const base = await serve(t, { collectorDir: dir, ledgerDir: await ledgerFixture(t) });
  const r = await fetch(`${base}/Houdini/healthz`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'ok');
  assert.equal(j.sources.collector, 'live');
  assert.equal(j.sources.ledger, 'ok');
  assert.ok(!JSON.stringify(j).includes(dir));
  assert.ok(!JSON.stringify(j).includes('/tmp'));
});
