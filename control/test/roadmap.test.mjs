// TC-DASH-010 — project roadmap: states come only from director-approved versions; cards are evidence beside them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmp, serve } from './helpers.mjs';
import { readRoadmaps, buildRoadmapView, parseRoadmap } from '../lib/roadmap.mjs';
import { readCards } from '../lib/handoff.mjs';

const NOW = Date.parse('2026-11-11T01:00:00Z');
const T = m => new Date(NOW - m * 60000).toISOString();
const base = (o = {}) => ({
  schema: 'tc-roadmap/1', project: { id: 'demo', name: '시험 프로젝트', goal: '목표' }, version: 1, previous: null,
  approved: { by: 'director', directive: 'TC-DASH-010', at: T(30), transcribed_by: 'TC-DASH', source: { ref: 'r' } },
  stages: [{ no: 1, name: '기획', status: 'done' }, { no: 2, name: '개선', status: 'in_progress' }, { no: 3, name: '승인', status: 'waiting' }],
  tasks: [
    { id: 'P0-1', name: '판상', stage: 2, team: 'TC-PROD', status: 'on_hold', resolution: 'unresolved', hold: { reason: 'A2 우선', resume: 'A2 뒤 감독 판단' } },
    { id: 'P0-2', name: '파편 A2', stage: 2, team: 'TC-PROD', status: 'director_wait', resolution: 'unresolved', links: { task_ids: ['TC-VIS-029'], candidates: ['p0r-A2'] } },
    { id: 'SH', name: '그림자 S', stage: 2, team: 'TC-PROD', status: 'director_wait', links: { task_ids: ['TC-VIS-029'], candidates: ['p0r-S'] } },
    { id: 'X', name: '일정 근거 없음', stage: 3, status: 'planned', schedule: { text: '11/20' } },
  ],
  priority: ['P0-2'], next_steps: ['표본'], changes: [{ version: 1, at: T(30), what: '등록', basis: 'TC-DASH-010' }], ...o });
const card = (o) => ({ file: 'x.json', team: 'TC-PROD', task_id: 'TC-VIS-029', title: 't', state: 'handed_off', verdict: null, verdict_scope: null, candidate: null, to: null, evidence: [{}], grade: 'confirmed', at: T(40), ...o });
const view = (docs, cards, now = NOW) => buildRoadmapView({ state: 'ok', projects: [{ id: 'demo', versions: docs.map((d, i) => parseRoadmap(d, 'demo', `v00${d.version}.json`)) }] }, cards, now).projects[0];

const CARDS = [
  card({ candidate: 'p0r-A2 c3a97df', verdict: 'FAIL', verdict_scope: 'selfcheck', title: 'D2 처음 형상 대비 FAIL', at: T(120) }),
  card({ candidate: 'p0r-A2 c3a97df', verdict: 'PASS', verdict_scope: 'selfcheck', title: '구간별 P1–P6 PASS', at: T(60) }),
  card({ team: 'TC-QA', candidate: 'p0r-A2 c3a97df', verdict: 'PASS', verdict_scope: 'technical', title: 'A2 기술 PASS', at: T(50) }),
  card({ team: 'TC-QA', candidate: 'p0r-SA fb410ee', verdict: 'FAIL', verdict_scope: 'technical', title: 'SA D2·D5 FAIL', at: T(45) }),
  card({ candidate: 'p0r-S fb410ee', verdict: 'PASS', verdict_scope: 'technical', title: 'S 기술 PASS', at: T(300) }),
];

test('R1 A2 technical PASS stays a task-level technical result: task waits for the director, stage 2 in progress, no visual verdict', () => {
  const p = view([base()], CARDS);
  const a2 = p.tasks.find(t => t.id === 'P0-2');
  assert.equal(a2.status, 'director_wait');
  assert.deepEqual(p.counts, { total: 3, done: 1, in_progress: 1, waiting: 1 });
  assert.equal(p.stages[1].status, 'in_progress');
  assert.ok(a2.evidence.verdicts.some(v => v.scope === 'technical' && v.verdict === 'PASS'));
  assert.equal(a2.evidence.visual_verdict, null);
  assert.ok(!('percent' in p) && !JSON.stringify(p).includes('percent'));
});

test('R2 the D2 FAIL record and the per-segment P1–P6 PASS are both shown, never merged', () => {
  const a2 = view([base()], CARDS).tasks.find(t => t.id === 'P0-2');
  assert.ok(a2.evidence.fails.some(f => f.title.includes('D2')));
  assert.ok(a2.evidence.verdicts.some(v => v.scope === 'selfcheck' && v.verdict === 'PASS'));
});

test('R3 a visual REVIEW in the roadmap is not shown as done', () => {
  const sh = view([base()], CARDS).tasks.find(t => t.id === 'SH');
  assert.equal(sh.status, 'director_wait');
  assert.notEqual(sh.status_label, '완료');
});

test('R4 the SA FAIL candidate never feeds the A2 task (candidate name matched without the commit)', () => {
  const a2 = view([base()], CARDS).tasks.find(t => t.id === 'P0-2');
  assert.ok(!JSON.stringify(a2.evidence).includes('SA D2·D5'));
  assert.ok(!a2.evidence.fails.some(f => f.title.includes('SA')));
});

test('R5 no automatic progress: a newer "done" card changes nothing and only asks for a roadmap review', () => {
  const later = [...CARDS, card({ team: 'TC-PROD', candidate: 'p0r-A2 c3a97df', state: 'done', verdict: 'PASS', verdict_scope: 'visual', title: '시각 PASS 주장', at: T(5) })];
  const p = view([base()], later);
  const a2 = p.tasks.find(t => t.id === 'P0-2');
  assert.equal(a2.status, 'director_wait');
  assert.equal(p.stages[1].status, 'in_progress');
  assert.deepEqual(p.counts, { total: 3, done: 1, in_progress: 1, waiting: 1 });
  assert.ok(a2.evidence.newer_than_roadmap);
  assert.ok(p.review_needed.includes('P0-2'));
});

test('R6 old or missing evidence is shown as not confirmed, with the last evidence time', () => {
  const p = view([base()], CARDS);
  const sh = p.tasks.find(t => t.id === 'SH');
  assert.equal(sh.evidence.state, 'stale');
  assert.match(sh.evidence.label, /미확인/);
  assert.equal(sh.evidence.last.at, T(300));
  assert.equal(p.tasks.find(t => t.id === 'P0-1').evidence.state, 'none');
  assert.equal(view([base()], []).tasks.find(t => t.id === 'P0-2').evidence.state, 'none');
});

test('R7 P0-1 is on hold and unresolved with its reason and resume condition; a schedule without basis is not shown', () => {
  const p = view([base()], CARDS);
  const p01 = p.tasks.find(t => t.id === 'P0-1');
  assert.equal(p01.status_label, '보류');
  assert.equal(p01.resolution_label, '미해결');
  assert.deepEqual(p01.hold, { reason: 'A2 우선', resume: 'A2 뒤 감독 판단' });
  assert.equal(p.tasks.find(t => t.id === 'X').schedule, null);
});

test('R8 versions: the newest approved version is used, older ones are kept in the history; bad or unapproved files are refused', async t => {
  const dir = await tmp(t);
  const pdir = path.join(dir, 'ROADMAP', 'demo');
  await fs.mkdir(pdir, { recursive: true });
  for (const team of ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH']) await fs.mkdir(path.join(dir, team));
  await fs.writeFile(path.join(pdir, 'v001.json'), JSON.stringify(base()));
  await fs.writeFile(path.join(pdir, 'v002.json'), JSON.stringify(base({ version: 2, previous: 1, stages: [{ no: 1, name: '기획', status: 'done' }, { no: 2, name: '개선', status: 'done' }, { no: 3, name: '승인', status: 'in_progress' }] })));
  await fs.writeFile(path.join(pdir, 'v003.json'), JSON.stringify(base({ version: 4 })));                          // name/version mismatch
  await fs.writeFile(path.join(pdir, 'v004.json'), JSON.stringify(base({ version: 4, approved: { by: 'TC-DASH', at: T(1) } }))); // not director-approved
  const r = await readRoadmaps(dir);
  assert.equal(r.invalid, 2);
  const p = buildRoadmapView(r, [], NOW).projects[0];
  assert.equal(p.version, 2);
  assert.deepEqual(p.history.map(h => h.version), [1, 2]);
  assert.equal(p.current_stage.no, 3);
  // the card reader never sees the roadmap folder
  const cards = await readCards(dir);
  assert.equal(cards.invalid, 0);
  assert.equal(cards.items.length, 0);
});

test('R9 /api/roadmap is read only and absent from the public projection', async t => {
  const dir = await tmp(t);
  await fs.mkdir(path.join(dir, 'ROADMAP', 'demo'), { recursive: true });
  for (const team of ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH']) await fs.mkdir(path.join(dir, team));
  await fs.writeFile(path.join(dir, 'ROADMAP', 'demo', 'v001.json'), JSON.stringify(base()));
  const b = await serve(t, { handoffDir: dir });
  const j = await (await fetch(`${b}/Houdini/api/roadmap`)).json();
  assert.equal(j.state, 'ok'); assert.equal(j.projects[0].counts.total, 3);
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(`${b}/Houdini/api/roadmap`, { method: m })).status, 405);
  const pub = await serve(t, { handoffDir: dir, publicOnly: true, localDetail: false });
  assert.equal((await fetch(`${pub}/Houdini/api/roadmap`)).status, 404);
  const none = await serve(t, { handoffDir: await tmp(t) });
  assert.equal((await (await fetch(`${none}/Houdini/api/roadmap`)).json()).state, 'missing');
});

test('R10 (QA REVIEW 1) a roadmap without a cited source is refused; without a matched original it says so even when not transcribed', () => {
  assert.equal(parseRoadmap(base({ approved: { by: 'director', at: T(30) } }), 'demo', 'v001.json'), null);
  assert.equal(parseRoadmap(base({ approved: { by: 'director', at: T(30), source: {} } }), 'demo', 'v001.json'), null);
  const r = parseRoadmap(base({ approved: { by: 'director', directive: 'D', at: T(30), source: { ref: '원문' } } }), 'demo', 'v001.json');
  assert.equal(r.approved.original_checked, false);
  const ok = parseRoadmap(base({ approved: { by: 'director', at: T(30), source: { ref: '원문', sha256: 'ab'.repeat(32) } } }), 'demo', 'v001.json');
  assert.equal(ok.approved.original_checked, true);
});

test('R11 (QA REVIEW 2) approval time and transcription time are kept apart; "newer than the roadmap" uses the recorded time', () => {
  const legacy = parseRoadmap(base(), 'demo', 'v001.json'); // transcribed_by with only `at` (written at transcription)
  assert.equal(legacy.approved.at, null);
  assert.equal(legacy.approved.transcribed_at, T(30));
  const split = parseRoadmap(base({ approved: { by: 'director', at: '2026-11-11T00:00:00+09:00', at_precision: 'date', transcribed_by: 'TC-DASH', transcribed_at: T(30), source: { ref: 'r' } } }), 'demo', 'v001.json');
  assert.equal(split.approved.at, '2026-11-10T15:00:00.000Z');
  assert.equal(split.approved.at_precision, 'date');
  assert.equal(split.approved.recorded_at, T(30));
  const p = view([base()], [card({ candidate: 'p0r-A2', at: T(40) })]);
  assert.equal(p.tasks.find(t => t.id === 'P0-2').evidence.newer_than_roadmap, false, 'a card before the recorded time is not newer');
});

test('R12 a card dated in the future is not shown as current evidence', () => {
  const p = view([base()], [card({ candidate: 'p0r-A2', at: new Date(NOW + 3600e3).toISOString() })]);
  const e = p.tasks.find(t => t.id === 'P0-2').evidence;
  assert.equal(e.state, 'future');
  assert.match(e.label, /미확인/);
});
