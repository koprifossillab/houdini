// TC-DASH-003 — board, handoff cards, decision records and the restricted NAS reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tmp, serve, rawGet } from './helpers.mjs';
import { buildBoard, nowState, LIVE_WINDOW_MS } from '../lib/board.mjs';
import { parseCard, parseDecision, readCards, readDecisions, refText } from '../lib/handoff.mjs';
import { nasClues, nasImage, publicNas, clearNasCache, clueOf } from '../lib/nas.mjs';
import { setRedactTerms } from '../lib/sanitize.mjs';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const T = s => Date.parse(s);
const put = async (p, body) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, body); };

// Times copied from the real TC-VIS-018 / 021 / 024 evidence (2026-11-09 KST) — kept as they were.
const card = (team, task, extra) => parseCard({ schema: 'tc-handoff/1', team, task_id: task, title: `${task} 작업`, state: 'handed_off', evidence: [{ kind: 'nas', ref: `FOLDER_${task}` }], ...extra }, team, `${task}.json`);
const decision = extra => parseDecision({ schema: 'tc-decision/1', source: { ref: '감독 지시 원문' }, ...extra }, `${extra.id || extra.kind}.json`);
const BASE = [
  decision({ id: 'baseline', kind: 'baseline', at: '2026-11-05T00:00:00+09:00', at_precision: 'date', baseline: { name: 'v6.5h', commit: 'f8e2818', label: '발표 주 후보' }, subject: '발표 주 후보 v6.5h' }),
  decision({ id: 'cand-v65h', kind: 'candidate_status', at: '2026-11-05T00:00:00+09:00', candidate: { name: 'v6.5h', status: 'baseline' } }),
];
const C024 = card('TC-PROD', 'TC-VIS-024', { at: '2026-11-09T14:44:58+09:00', to: 'director', next: 'P0-2 중단 여부 결정', verdict: 'REVIEW', verdict_scope: 'selfcheck', candidate: 'v6.5h-p02-display',
  issues: [{ id: 'wedge', title: '윗쐐기 미끄럼 미작동', scope: 'project', severity: 'known' }, { id: 'p02-pen', title: '표시 형상 관통', scope: 'candidate', candidate: 'v6.5h-p02-display', severity: 'fail' }] });
const C021 = card('TC-PROD', 'TC-VIS-021', { at: '2026-11-09T14:05:39+09:00', to: 'director', verdict: 'FAIL', verdict_scope: 'selfcheck', candidate: 'v6.5h-p02',
  issues: [{ id: 'd7', title: 'D7 몸체 밑 빈 공간 10.7%', scope: 'candidate', candidate: 'v6.5h-p02', severity: 'fail' }] });
const C018 = card('TC-QA', 'TC-VIS-018', { at: '2026-11-09T13:10:22+09:00', state: 'done', verdict: 'PASS', verdict_scope: 'technical', to: 'TC-WORK', next: '시각 검토' });

test('card and decision parsing: evidence decides the grade, decisions need a source', () => {
  assert.equal(C024.grade, 'confirmed');
  assert.equal(parseCard({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-030', state: 'in_progress', at: '2026-11-09T15:00:00+09:00' }, 'TC-PROD', 'x.json').grade, 'claim');
  assert.equal(parseCard({ schema: 'tc-handoff/1', team: 'TC-QA', task_id: 'TC-VIS-030', state: 'done', at: '2026-11-09T15:00:00+09:00' }, 'TC-PROD', 'x.json'), null, 'team must match its folder');
  assert.equal(parseCard({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: '../etc', state: 'done', at: '2026-11-09T15:00:00+09:00' }, 'TC-PROD', 'x.json'), null);
  assert.equal(parseCard({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-030', state: 'approved', at: '2026-11-09T15:00:00+09:00' }, 'TC-PROD', 'x.json'), null, 'approval is not a card state');
  assert.equal(parseDecision({ schema: 'tc-decision/1', kind: 'approval', task_id: 'TC-VIS-030', at: '2026-11-09T15:00:00+09:00' }, 'a.json'), null, 'no source → rejected');
});

test('TC-VIS-024 → TC-VIS-025 replay: the screen follows the new card, old evidence times are kept', () => {
  const cards = [C018, C021, C024];
  const at1515 = buildBoard({ cards, decisions: BASE, now: T('2026-11-09T15:15:00+09:00') });
  assert.equal(at1515.current.task_id, 'TC-VIS-024');
  assert.equal(at1515.current.now.state, 'unverified', 'handed off to the director: what PROD does now is unknown');
  assert.equal(at1515.current.last.state, 'handed_off');
  assert.equal(at1515.current.last.at, new Date('2026-11-09T14:44:58+09:00').toISOString());
  assert.ok(at1515.actions.some(a => a.who === 'director' && a.task_id === 'TC-VIS-024'));

  // a new TC-VIS-025 card arrives (test card — no real TC-VIS-025 existed when this was written)
  const C025 = card('TC-PROD', 'TC-VIS-025', { at: '2026-11-09T15:30:00+09:00', state: 'in_progress', title: 'TC-VIS-025 시험 카드', next: '작업 중', evidence: [{ kind: 'file', ref: 'test evidence' }] });
  const at1540 = buildBoard({ cards: [...cards, C025], decisions: BASE, now: T('2026-11-09T15:40:00+09:00') });
  assert.equal(at1540.current.task_id, 'TC-VIS-025');
  assert.equal(at1540.current.now.state, 'in_progress');
  assert.equal(at1540.current.last.title, 'TC-VIS-025 시험 카드');
  assert.equal(at1540.current.team, 'TC-PROD');
  const h024 = at1540.history.find(r => r.task_id === 'TC-VIS-024');
  assert.equal(h024.last_at, new Date('2026-11-09T14:44:58+09:00').toISOString(), 'TC-VIS-024 keeps its original evidence time');
  assert.equal(at1540.history[0].task_id, 'TC-VIS-025');

  // no new evidence for more than the live window: last state kept, current state unverified
  const later = buildBoard({ cards: [...cards, C025], decisions: BASE, now: T('2026-11-09T15:30:00+09:00') + LIVE_WINDOW_MS + 60000 });
  assert.equal(later.current.task_id, 'TC-VIS-025');
  assert.equal(later.current.now.state, 'unverified');
  assert.equal(later.current.last.state, 'in_progress', 'the last confirmed state is preserved');
  assert.match(later.current.now.basis, /갱신되지 않음/);
});

test('a candidate FAIL stays with the candidate; the approved baseline is never shown as FAIL', () => {
  const b = buildBoard({ cards: [C018, C021, C024], decisions: BASE, now: T('2026-11-09T15:15:00+09:00') });
  assert.equal(b.baseline.name, 'v6.5h');
  // D-1: a transcribed baseline record without a checked original is shown, but not as a valid decision
  assert.equal(b.baseline.grade, 'transcribed');
  assert.equal(b.baseline.valid, false);
  const v65h = b.candidates.find(c => c.name === 'v6.5h');
  assert.equal(v65h.status, 'baseline');
  assert.ok(!v65h.verdicts.some(v => v.verdict === 'FAIL'));
  const p02 = b.candidates.find(c => c.name === 'v6.5h-p02');
  assert.equal(p02.status, 'unapproved');
  assert.ok(p02.verdicts.some(v => v.verdict === 'FAIL'));
  assert.deepEqual(b.issues.project.map(i => i.id), ['wedge']);
  assert.deepEqual(b.issues.candidate.map(i => i.id).sort(), ['d7', 'p02-pen']);
  assert.ok(b.issues.candidate.every(i => i.candidate));
});

test('process liveness and claims never make a team "in progress"; current execution is always unverified', () => {
  const tl = { teams: [{ team_id: 'TC-PROD', execution: { process_alive: true, state: 'RUNNING' }, link: { label: '팀 이름만 식별' } }] };
  const b = buildBoard({ cards: [], decisions: [], teamLive: tl, now: Date.now() });
  const prod = b.teams.find(t => t.id === 'TC-PROD');
  assert.equal(prod.now.state, 'unverified');
  assert.match(prod.session.label, /살아 있음/);
  assert.equal(b.execution.now.state, 'unverified');
  const claim = parseCard({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-031', state: 'in_progress', at: new Date().toISOString() }, 'TC-PROD', 'c.json');
  assert.equal(nowState(claim, Date.now()).state, 'unverified', 'an in-progress card without evidence is not progress');
  assert.equal(nowState(card('TC-WORK', 'TC-VIS-018', { at: '2026-11-09T13:10:22+09:00' }), T('2026-11-09T15:15:00+09:00'), true).label, '관측 불가');
});

test('verdicts, pending and in-progress are different fields; approval comes only from decisions', () => {
  const b = buildBoard({ cards: [C018, C021, C024], decisions: BASE, now: T('2026-11-09T15:15:00+09:00') });
  const s = Object.fromEntries(b.current.steps.map(x => [x.key, x]));
  assert.equal(s.self.kind, 'verdict');
  assert.equal(s.self.value, 'REVIEW');
  assert.equal(s.director.kind, 'state');
  assert.equal(s.director.value, 'pending', 'a card sent to the director is pending, not approved');
  assert.equal(s.directive.grade, 'claim', 'no directive record → the task number is only claimed by the card');
  // D-1 / TC-DASH-005: a hold only counts once its original matched and a user confirmation is recorded
  const hold = decision({ id: 'hold', kind: 'hold', task_id: 'TC-VIS-024', directive_id: 'TC-VIS-024', at: '2026-11-09T14:44:58+09:00', subject: '전면 수정 보류' });
  const checked = { byDirective: new Map([['TC-VIS-024', { content: 'matched', check_method: 'user_confirmed', checked_at: '2026-11-10T09:00:00+09:00', sha256: 'ab'.repeat(8) }]]) };
  const withHold = buildBoard({ cards: [C024], decisions: [...BASE, hold], originals: checked, now: T('2026-11-09T15:15:00+09:00') });
  const d = withHold.current.steps.find(x => x.key === 'director');
  assert.equal(d.kind, 'decision');
  assert.equal(d.value, 'hold');
  assert.equal(d.grade, 'valid_decision');
  assert.ok(!withHold.actions.some(a => a.who === 'director'), 'answered by a decision → no longer pending');
});

async function nasFixture(t) {
  const root = await tmp(t);
  const outside = await tmp(t);
  const film = path.join(root, 'film');
  const launch = path.join(root, 'launch');
  const good = path.join(film, 'TC3D_X_RESULT_20261109_125858_RAW_PRESERVED');
  const png = Buffer.from('89504e470d0a1a0a00', 'hex');
  await put(path.join(good, 'results', 'RUN.lock'), '');
  await put(path.join(good, 'results', 'a.png'), png);
  await put(path.join(good, 'results', 'unlisted.png'), png);
  await put(path.join(good, 'results', 'tampered.png'), png);
  await put(path.join(good, 'README_KO.md'), '# 결과 보존 (TC-VIS-018)\n본문\n');
  await put(path.join(good, 'run.py'), '# TC-VIS-777 must not be read\n');
  await put(path.join(good, 'results', 'deep', 'x', 'note.md'), 'TC-VIS-999');
  await put(path.join(good, 'BIG_KO.md'), 'TC-VIS-555 ' + 'x'.repeat(300 * 1024));
  await put(path.join(good, 'RAW_SHA256_FILES.txt'), `${sha(png)}  results/a.png\n${'00'.repeat(32)}  results/tampered.png\n${sha(png)}  ../../etc/passwd\n`);
  await put(path.join(film, 'TC3D_Y_20261109_STAGING_NOT_APPROVED', 'README_KO.md'), '# 스테이징\nTC-VIS-009\n');
  await put(path.join(film, 'private_folder', 'README_KO.md'), 'TC-VIS-444');
  await put(path.join(outside, 'TC_SECRET', 'README_KO.md'), '# outside\nTC-VIS-333');
  await fs.symlink(path.join(outside, 'TC_SECRET'), path.join(film, 'TC_LINKED_OUT'));
  await fs.symlink(path.join(outside, 'TC_SECRET', 'README_KO.md'), path.join(good, 'LINK_KO.md'));
  await put(path.join(launch, 'launch_tc3d_x.bat'), '@echo off');
  await put(path.join(launch, 'other.bat'), '@echo off');
  clearNasCache();
  return { film, launch, root, outside };
}

test('NAS reader: only named folders, depth 2, allowlisted kinds, size limits, no symlinks', async t => {
  const fx = await nasFixture(t);
  const v = await nasClues({ film: fx.film, launch: fx.launch });
  assert.equal(v.state, 'ok');
  const names = v.folders.map(f => f.name).sort();
  assert.deepEqual(names, ['TC3D_X_RESULT_20261109_125858_RAW_PRESERVED', 'TC3D_Y_20261109_STAGING_NOT_APPROVED']);
  const g = v.folders.find(f => f.name.includes('RAW_PRESERVED'));
  assert.equal(g.clue, 'run_preserved');
  assert.equal(g.grade, 'clue');
  assert.equal(g.run_lock, true);
  assert.deepEqual(g.task_ids, ['TC-VIS-018'], '.py, too-deep, oversized and symlinked files are not read');
  assert.equal(g.title, '결과 보존 (TC-VIS-018)');
  assert.deepEqual(v.launchers.map(l => l.name), ['launch_tc3d_x.bat']);
  const pub = JSON.stringify(publicNas(v));
  for (const leak of [fx.root, fx.outside, '_rel', '_sha', '_root', 'RUN.lock contents']) assert.ok(!pub.includes(leak), `no ${leak} in public output`);
  const img = id => g.images.find(i => i.file === id).id;
  assert.equal((await nasImage(v, img('a.png'))).status, 200);
  assert.equal((await nasImage(v, img('unlisted.png'))).status, 404, 'not in the SHA list');
  assert.equal((await nasImage(v, img('tampered.png'))).status, 409, 'hash mismatch');
  assert.equal((await nasImage(v, '0000000000000000')).status, 404);
  assert.equal((await nasImage(v, '../../etc/passwd')).status, 404);
});

test('NAS names go through redaction; folder names never confirm a state', async t => {
  const fx = await nasFixture(t);
  await put(path.join(fx.film, 'TC_PRIVATEHOST_RUN_20261109', 'README_KO.md'), '# x');
  setRedactTerms(['PRIVATEHOST']);
  t.after(() => setRedactTerms((process.env.HPC_REDACT_TERMS || '').split(',')));
  clearNasCache();
  const v = await nasClues({ film: fx.film });
  assert.ok(!JSON.stringify(publicNas(v)).includes('PRIVATEHOST'));
  assert.equal(clueOf('TC3D_P2_V65H_KARMA_20261109').clue, 'unclassified', 'a package name without a marker is not read as approved');
  const b = buildBoard({ cards: [], decisions: [], nas: v, now: Date.now() });
  assert.equal(b.execution.last_run.grade, 'clue');
  assert.equal(b.current.task_id, null, 'NAS folders alone never create a current task');
});

test('HTTP: board follows a new card file without restart; no write API; no server paths in responses', async t => {
  const fx = await nasFixture(t);
  const hand = await tmp(t);
  const dec = await tmp(t);
  await put(path.join(dec, 'baseline.json'), JSON.stringify({ schema: 'tc-decision/1', kind: 'baseline', at: '2026-11-05T00:00:00+09:00', at_precision: 'date', baseline: { name: 'v6.5h', commit: 'f8e2818' }, subject: '발표 주 후보', source: { ref: '감독 TC-066-09' } }));
  await put(path.join(hand, 'TC-PROD', '20261109-1444_TC-VIS-024.json'), JSON.stringify({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-024', title: '결함 기록', state: 'handed_off', to: 'director', at: '2026-11-09T14:44:58+09:00', evidence: [{ kind: 'nas', ref: 'DEFECT_KO.md' }] }));
  await put(path.join(hand, 'TC-PROD', 'broken.json'), '{not json');
  const base = await serve(t, { handoffDir: hand, decisionsDir: dec, nas: { film: fx.film, launch: fx.launch } });
  const b1 = await (await fetch(base + '/Houdini/api/board')).json();
  assert.equal(b1.current.task_id, 'TC-VIS-024');
  assert.equal(b1.sources.handoff.invalid, 1);
  assert.equal(b1.baseline.name, 'v6.5h');
  await put(path.join(hand, 'TC-PROD', '20261109-1530_TC-VIS-025.json'), JSON.stringify({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-025', title: '다음 작업', state: 'in_progress', next: '진행', at: new Date().toISOString(), evidence: [{ kind: 'file', ref: 'x' }] }));
  const b2 = await (await fetch(base + '/Houdini/api/board')).json();
  assert.equal(b2.current.task_id, 'TC-VIS-025');
  assert.equal(b2.current.now.state, 'in_progress');
  assert.equal(b2.history.find(r => r.task_id === 'TC-VIS-024').last_at, new Date('2026-11-09T14:44:58+09:00').toISOString());
  for (const route of ['api/board', 'api/nas']) {
    const text = await (await fetch(base + '/Houdini/' + route)).text();
    for (const leak of [fx.root, hand, dec, fx.outside]) assert.ok(!text.includes(leak), `${route} leaks a server path`);
  }
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(base + '/Houdini/api/board', { method: m })).status, 405, `${m} refused`);
  assert.ok([400, 404].includes((await rawGet(base + '/Houdini/nasimg/../../etc/passwd')).status), 'traversal refused');
  assert.ok([400, 404].includes((await rawGet(base + '/Houdini/nasimg/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status), 'encoded traversal refused');
  assert.equal((await fetch(base + '/Houdini/nasimg/zzzz')).status, 404);
  const img = (await (await fetch(base + '/Houdini/api/nas')).json()).folders[0].images.find(i => i.file === 'a.png');
  const r = await fetch(base + '/Houdini/nasimg/' + img.id);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
});

test('new home and the preserved legacy page are both served; the legacy page keeps all 18 sections', async t => {
  const base = await serve(t, {});
  const home = await (await fetch(base + '/Houdini/')).text();
  assert.match(home, /static\/board\.js/);
  assert.doesNotMatch(home, /style=/, 'no inline styles (CSP)');
  const legacy = await (await fetch(base + '/Houdini/legacy.html')).text();
  for (const id of ['stages', 'tl-teams', 'tk-summary', 'teams', 'issues-mini', 'decisions-mini', 'sources-mini', 'issues', 'decisions', 'scene-review', 'media', 'reports', 'viewer-title', 'experiments', 'code-check', 'env', 'tools', 'sources']) assert.match(legacy, new RegExp(`id="${id}"`), id);
  for (const a of ['static/app.js', 'static/style.css', 'static/board.js', 'static/board.css', 'legacy.html']) assert.equal((await fetch(base + '/Houdini/' + a)).status, 200, a);
  const b = await (await fetch(base + '/Houdini/api/board')).json();
  assert.equal(b.sources.handoff.state, 'missing');
  assert.equal(b.current.task_id, null);
  assert.equal(b.current.now.state, 'unverified');
});

test('evidence references stay readable without exposing roots', () => {
  assert.equal(refText('film_root/TC3D_X_20261109/DEFECT_KO.md'), 'TC3D_X_20261109 › DEFECT_KO.md');
  assert.equal(refText("film_root/TC3D_X_20261109/sub/a.md '감독 결정'"), "TC3D_X_20261109 › a.md '감독 결정'");
  assert.equal(refText('film_root/TC3D_X_RAW_PRESERVED'), 'TC3D_X_RAW_PRESERVED');
  assert.equal(refText('/home/someone/secret/x.md'), '[경로 숨김]');
  assert.match(refText('QA_REPORT_KO.md'), /QA_REPORT_KO\.md/);
});

test('step labels keep the stage name; the badge text is separate', () => {
  const b = buildBoard({ cards: [C018, C021, C024], decisions: BASE, now: T('2026-11-09T15:15:00+09:00') });
  assert.deepEqual(b.current.steps.map(s => s.label), ['지시', '제작', '자체 검증', 'QA 독립 검증', '감독 판정', '결과']);
  assert.equal(b.history[0].steps.length, 6);
});
