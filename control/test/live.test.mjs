// TC-DASH-008 1단계 — "지금" view: ordering, status rules, PC records, exposure, HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmp, serve } from './helpers.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { buildLive, orderCards, reportStatus, parseCorrection, readCorrections, scrub, pcLine } from '../lib/live.mjs';
import { readPcRuns, parseResult } from '../lib/pcrun.mjs';
import { readCards } from '../lib/handoff.mjs';

const NOW = Date.parse('2026-11-10T06:00:00Z');
const T = m => new Date(NOW - m * 60000).toISOString();
const card = (o = {}) => ({ file: `${o.file || 'x'}.json`, team: 'TC-PROD', task_id: 'TC-VIS-030', title: '작업', state: 'in_progress', verdict: null, verdict_scope: null, to: null, user_action: null, evidence: [{ kind: 'commit', ref: 'a' }], grade: 'confirmed', at: T(10), written_at: null, ...o, file: `${o.file || 'x'}.json` });

test('L1 a card dated ahead of its write time does not move ahead of a later-written card', () => {
  const a = card({ file: 'a', at: T(-3), written_at: T(3), title: 'A' }); // dated 3 min in the future, written 3 min ago
  const b = card({ file: 'b', at: T(1), written_at: T(1), title: 'B' }); // written after A
  const o = orderCards([a, b], [], NOW);
  assert.deepEqual(o.map(c => c.title), ['A', 'B']);
  assert.ok(o[0].flags.includes('future') && o[0].flags.includes('ahead_of_write'));
  assert.deepEqual(o[1].flags, []);
  // without the write-time rule the future card would be newest
  const naive = [a, b].sort((x, y) => x.at.localeCompare(y.at)).map(c => c.title);
  assert.deepEqual(naive, ['B', 'A']);
  const live = buildLive({ cards: [a, b], now: NOW, detail: true });
  assert.equal(live.teams[0].report.title, 'B');
  assert.equal(live.checks.future, 1);
});

test('L2 correction applies only to its own team card with the recorded value, never to a future value', () => {
  const c = card({ file: '20261110-1440_TC-DASH-007', team: 'TC-DASH', task_id: 'TC-DASH-007', at: '2026-11-10T05:40:00.000Z' });
  const ok = parseCorrection({ schema: 'tc-card-correction/1', team: 'TC-DASH', target_file: c.file, field: 'at', recorded_value: '2026-11-10T14:40:00+09:00', corrected_value: '2026-11-10T14:37:48+09:00', reason: 'r', at: '2026-11-10T14:52:00+09:00' }, 'TC-DASH', 'k.json');
  assert.ok(ok);
  assert.equal(orderCards([c], [ok], NOW)[0].order_at, '2026-11-10T05:37:48.000Z');
  assert.ok(orderCards([c], [ok], NOW)[0].flags.includes('corrected'));
  assert.equal(parseCorrection({ ...ok, schema: 'tc-card-correction/1', team: 'TC-PROD', target_file: c.file, field: 'at', recorded_value: ok.recorded_value, corrected_value: ok.corrected_value, at: ok.at }, 'TC-DASH', 'k.json'), null, 'team must match its folder');
  assert.equal(parseCorrection({ schema: 'tc-card-correction/1', team: 'TC-DASH', target_file: c.file, field: 'state', recorded_value: ok.recorded_value, corrected_value: ok.corrected_value, at: ok.at }, 'TC-DASH', 'k.json'), null, 'only the time can be corrected');
  const otherTeam = { ...ok, team: 'TC-QA' };
  assert.equal(orderCards([c], [otherTeam], NOW)[0].order_at, c.at);
  const staleValue = { ...ok, recorded_value: '2026-11-10T05:41:00.000Z' };
  assert.equal(orderCards([c], [staleValue], NOW)[0].order_at, c.at);
  const future = { ...ok, corrected_value: new Date(NOW + 3600e3).toISOString() };
  assert.equal(orderCards([c], [future], NOW)[0].order_at, c.at);
});

test('L3 report states: QA wait vs answered, user wait, blocked, FAIL, claim, stale → 미확인', () => {
  const st = (cards, team = 'TC-PROD') => buildLive({ cards, now: NOW, detail: true }).teams.find(t => t.team === team).report;
  assert.equal(st([card({ state: 'handed_off', to: 'TC-QA' })]).key, 'wait_qa');
  assert.equal(st([card({ state: 'handed_off', to: 'TC-QA' }), card({ file: 'q', team: 'TC-QA', at: T(5) })]).key, 'handed_answered');
  assert.equal(st([card({ state: 'handed_off', to: 'director' })]).key, 'wait_director');
  assert.equal(st([card({ state: 'handed_off', to: 'TC-QA', user_action: 'PC 실행' })]).key, 'wait_user');
  assert.equal(st([card({ state: 'blocked' })]).key, 'blocked');
  assert.equal(st([card({ state: 'done', verdict: 'FAIL', verdict_scope: 'technical' })]).key, 'fail');
  assert.equal(st([card({ state: 'done', verdict: 'PASS', verdict_scope: 'technical' })]).key, 'pass');
  assert.equal(st([card({ grade: 'claim', evidence: [] })]).key, 'working_claim');
  assert.equal(st([card({ grade: 'transcribed' })]).key, 'working_claim');
  const old = st([card({ at: T(121) })]);
  assert.equal(old.key, 'unverified');
  assert.equal(old.last.key, 'working');
  assert.equal(st([], 'TC-QA').key, 'none');
  assert.equal(reportStatus(null, [], NOW).label, '기록 없음 — 미확인');
});

test('L4 ③ WORK is shown as not connected, never as resting, with or without signed records', () => {
  for (const signed of [[], [card({ team: 'TC-WORK', task_id: 'TC-WORK-001', grade: 'signed', at: T(60 * 24 * 7) })]]) {
    const w = buildLive({ cards: [], signed, now: NOW, detail: true }).teams.find(t => t.team === 'TC-WORK');
    assert.equal(w.session.key, 'not_connected');
    assert.match(w.session.label, /별도 Windows 환경/);
    assert.doesNotMatch(JSON.stringify(w), /쉬는 중입니다|휴식|IDLE|대기 중/);
  }
});

test('L5 a placed BAT alone is never running; PC records keep only allow-listed fields', async t => {
  const dir = await tmp(t);
  await fs.mkdir(path.join(dir, 'results'));
  await fs.writeFile(path.join(dir, 'launch_job_a.bat'), 'echo');
  let pc = await readPcRuns(dir, Date.now());
  assert.equal(pc.placed.length, 1);
  const l = pcLine(pc, Date.now());
  assert.equal(l.key, 'pc_none');
  assert.doesNotMatch(l.label, /실행 중/);
  await fs.writeFile(path.join(dir, 'results', 'launch_job_a_20261110_114153.json'), JSON.stringify({
    job: 'job_a', started: '2099-01-01 00:00:00', finished: '2099-01-01 00:30:00', state: 'finished', all_ok: true, images_ok: true, render_sec: 1800.4,
    pid: 5588, license: 'licenseCategoryType.Apprentice', result: 'C:\\Users\\someone\\out.json', chained: '\\\\nas\\share\\x', local_boot_sha: 'b'.repeat(40), error: 'Traceback /home/x', monitor: { pid: 1 },
  }));
  pc = await readPcRuns(dir, Date.now());
  assert.equal(pc.placed.length, 0, 'a result started after the BAT was placed answers it');
  assert.deepEqual(Object.keys(pc.results[0]).sort(), ['all_ok', 'finished', 'images_ok', 'job', 'render_sec', 'started', 'state']);
  assert.equal(pc.results[0].started, '2098-12-31T15:00:00.000Z');
  assert.equal(parseResult({ job: 'x', started: '2026-11-10 10:00:00' }, 'launch_x_20261110_100000.json'), null, 'old formats without a state are not counted');
  const s = JSON.stringify(buildLive({ cards: [], pc, now: Date.now(), detail: true }));
  for (const bad of ['5588', 'Apprentice', 'Users', 'someone', 'nas', 'Traceback', 'bbbbbbbb']) assert.ok(!s.includes(bad), bad);
});

test('L6 without authentication only coarse states leave the server', () => {
  const cards = [card({ title: '비밀 작업 제목', task_id: 'TC-VIS-031', at: T(5) })];
  const pc = { state: 'ok', results: [{ job: 'tc3d_job', state: 'finished', started: T(40), finished: T(20), all_ok: true, images_ok: true, render_sec: 60 }], placed: [{ job: 'tc3d_next', placed_at: T(3) }] };
  const open = buildLive({ cards, pc, now: NOW, detail: false });
  const s = JSON.stringify(open);
  for (const bad of ['비밀 작업 제목', 'TC-VIS-031', 'tc3d_job', 'tc3d_next', T(5), T(20), '"feed"', '"pc"']) assert.ok(!s.includes(bad), bad);
  assert.equal(open.teams[0].report.key, 'working');
  assert.equal(open.teams[0].last_bucket, 'within_2h');
  assert.ok(open.detail_note);
  const full = buildLive({ cards, pc, now: NOW, detail: true });
  assert.equal(full.teams[0].report.title, '비밀 작업 제목');
  assert.ok(full.feed.some(f => f.text.includes('tc3d_next') && f.text.includes('실행 여부 미확인')));
});

test('L7 titles never carry commands or paths', () => {
  for (const [raw, gone] of [['bash /home/u/deploy.sh rollback 실행', ['bash', '/home', 'deploy.sh']], ['`docker compose up -d web` 후 확인', ['docker', 'compose']], ['sudo chmod 777 /srv/Houdini 처리', ['sudo', '/srv']], ['결과 C:\\Users\\a\\x.json 보존', ['Users', 'C:']]]) {
    const out = scrub(raw);
    for (const g of gone) assert.ok(!out.includes(g), `${raw} → ${out}`);
  }
  assert.equal(scrub('seq1 c4(F231–300) 배치 — PC 실행 대기'), 'seq1 c4(F231–300) 배치 — PC 실행 대기');
});

async function fixture(t) {
  const hand = await tmp(t);
  for (const team of ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH']) await fs.mkdir(path.join(hand, team));
  const at = new Date(Date.now() - 5 * 60000).toISOString();
  await fs.writeFile(path.join(hand, 'TC-PROD', '20261110-1300_TC-VIS-030.json'), JSON.stringify({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-030', title: '작업 제목 X', state: 'handed_off', to: 'TC-QA', evidence: [{ kind: 'commit', ref: 'c' }], at }));
  const future = new Date(Date.now() + 10 * 60000).toISOString();
  await fs.writeFile(path.join(hand, 'TC-DASH', '20261110-1310_TC-DASH-009.json'), JSON.stringify({ schema: 'tc-handoff/1', team: 'TC-DASH', task_id: 'TC-DASH-009', title: '미래 카드', state: 'in_progress', evidence: [], at: future }));
  return hand;
}

test('L8 HTTP: open service gets coarse JSON, ETag/304 with check time header, writes refused, files untouched', async t => {
  const hand = await fixture(t);
  const before = await fs.stat(path.join(hand, 'TC-PROD', '20261110-1300_TC-VIS-030.json'));
  const base = await serve(t, { handoffDir: hand });
  const r = await fetch(`${base}/Houdini/api/live`);
  assert.equal(r.status, 200);
  const etag = r.headers.get('etag');
  assert.ok(etag && r.headers.get('x-live-checked-at'));
  const j = await r.json();
  assert.equal(j.detail, false);
  assert.ok(!JSON.stringify(j).includes('작업 제목 X'));
  assert.equal(j.teams.find(x => x.team === 'TC-PROD').report.key, 'wait_qa');
  const r2 = await fetch(`${base}/Houdini/api/live`, { headers: { 'If-None-Match': etag } });
  assert.equal(r2.status, 304);
  assert.ok(r2.headers.get('x-live-checked-at'));
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(`${base}/Houdini/api/live`, { method: m })).status, 405);
  // /api/board keeps its 0.2.2 shape — no write time leaks into it
  const b = await (await fetch(`${base}/Houdini/api/board`)).json();
  assert.ok(!JSON.stringify(b).includes('written_at'));
  assert.ok(['actions_past', 'history_control', 'done_unverified', 'control'].every(k => k in b));
  const after = await fs.stat(path.join(hand, 'TC-PROD', '20261110-1300_TC-VIS-030.json'));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual((await fs.readdir(path.join(hand, 'TC-DASH'))).sort(), ['20261110-1310_TC-DASH-009.json']);
});

test('L9 HTTP: authenticated viewers get detail; unauthenticated requests are refused', async t => {
  const hand = await fixture(t);
  const base = await serve(t, { handoffDir: hand, authMode: 'basic', users: `viewer:${hashPassword('correct horse battery')}` });
  assert.equal((await fetch(`${base}/Houdini/api/live`)).status, 401);
  const j = await (await fetch(`${base}/Houdini/api/live`, { headers: { Authorization: `Basic ${Buffer.from('viewer:correct horse battery').toString('base64')}` } })).json();
  assert.equal(j.detail, true);
  assert.equal(j.teams.find(x => x.team === 'TC-PROD').report.title, '작업 제목 X');
  const dash = j.teams.find(x => x.team === 'TC-DASH');
  assert.ok(dash.report.flags.includes('future') && dash.report.flags.includes('ahead_of_write'));
  assert.equal(j.checks.future, 1);
  assert.ok(Date.parse(dash.report.at) <= Date.now(), 'ordered by write time, not by the future date');
});

test('L10 readCards keeps its board output unless the write time is asked for; corrections are read from the team folder only', async t => {
  const hand = await fixture(t);
  assert.ok((await readCards(hand)).items.every(c => !('written_at' in c)));
  assert.ok((await readCards(hand, { writtenAt: true })).items.every(c => typeof c.written_at === 'string'));
  await fs.mkdir(path.join(hand, 'TC-DASH', 'corrections'));
  const doc = { schema: 'tc-card-correction/1', team: 'TC-DASH', target_file: '20261110-1310_TC-DASH-009.json', field: 'at', recorded_value: '2026-11-10T13:10:00Z', corrected_value: '2026-11-10T13:05:00Z', reason: 'r', at: '2026-11-10T13:20:00Z' };
  await fs.writeFile(path.join(hand, 'TC-DASH', 'corrections', 'a.json'), JSON.stringify(doc));
  await fs.writeFile(path.join(hand, 'TC-DASH', 'corrections', 'b.json'), JSON.stringify({ ...doc, team: 'TC-PROD' }));
  const r = await readCorrections(hand);
  assert.equal(r.items.length, 1);
  assert.equal(r.invalid, 1);
});
