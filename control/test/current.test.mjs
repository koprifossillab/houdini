// TC-DASH-007 — current task vs control-room work, finished vs open tasks, needed vs past user actions,
// and "no data → unverified". Card shapes follow the real cards of 2026-11-10.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, taskKind, USER_ACTION_FRESH_MS } from '../lib/board.mjs';
import { parseCard } from '../lib/handoff.mjs';

const T = s => Date.parse(s);
const card = (team, task_id, at, extra = {}) => parseCard({ schema: 'tc-handoff/1', team, task_id, title: `${task_id} ${team}`, state: 'handed_off', at, evidence: [{ kind: 'report', ref: 'r' }], ...extra }, team, `${at}_${task_id}.json`);

test('task kinds by directive number', () => {
  for (const id of ['TC-VIS-025', 'TC-VIS-027', 'TC-00-04', 'TC-01S-008', 'TC-01R2-005']) assert.equal(taskKind(id), 'production', id);
  for (const id of ['TC-DASH-006', 'TC-DASH-004', 'TC-HANDOFF-002']) assert.equal(taskKind(id), 'control', id);
  for (const id of ['TC-WORK-TIME-DISPLAY-20261103', '', null]) assert.equal(taskKind(id), 'other', String(id));
});

test('a QA card about control-room work never becomes the current production task (real 08:57 shape)', () => {
  const cards = [
    card('TC-PROD', 'TC-VIS-025', '2026-11-10T08:45:00+09:00', { to: 'user', next: '시각 승인 여부 결정' }),
    card('TC-QA', 'TC-DASH-006', '2026-11-10T08:57:15+09:00', { to: 'TC-DASH', next: '권한 안내', verdict: 'PASS', verdict_scope: 'technical' }),
  ];
  const b = buildBoard({ cards, now: T('2026-11-10T09:00:00+09:00') });
  assert.equal(b.current.task_id, 'TC-VIS-025');
  assert.equal(b.current.kind, 'production');
  assert.deepEqual(b.control.open.map(c => c.task_id), ['TC-DASH-006']);
  assert.ok(!b.history.some(r => r.task_id === 'TC-DASH-006'), 'production history has no control work');
  assert.deepEqual(b.history_control.map(r => r.task_id), ['TC-DASH-006']);
  assert.equal(b.actions.find(a => a.task_id === 'TC-DASH-006').kind, 'control');
});

test('finished tasks are past records, not the current task; nothing open → unverified, no guess', () => {
  const older = card('TC-PROD', 'TC-VIS-031', '2026-11-10T08:00:00+09:00', { state: 'in_progress' });
  const done = card('TC-QA', 'TC-VIS-030', '2026-11-10T09:00:00+09:00', { state: 'done', verdict: 'PASS', verdict_scope: 'technical' });
  const b = buildBoard({ cards: [older, done], now: T('2026-11-10T09:10:00+09:00') });
  assert.equal(b.current.task_id, 'TC-VIS-031', 'the open task, although older');
  assert.equal(b.last_done.task_id, 'TC-VIS-030');
  assert.equal(b.history.find(r => r.task_id === 'TC-VIS-030').open, false);
  // a later card of another team reopens nothing by itself, but a task whose newest card is open is open
  const reopened = card('TC-PROD', 'TC-VIS-030', '2026-11-10T09:05:00+09:00', { state: 'in_progress' });
  assert.equal(buildBoard({ cards: [done, reopened].sort((a, x) => a.at.localeCompare(x.at)), now: T('2026-11-10T09:10:00+09:00') }).current.task_id, 'TC-VIS-030');
  const allDone = buildBoard({ cards: [done], now: T('2026-11-10T09:10:00+09:00') });
  assert.equal(allDone.current.task_id, null);
  assert.equal(allDone.current.now.state, 'unverified');
  assert.match(allDone.current.now.basis, /열린 제작 작업 기록 없음/);
  const none = buildBoard({ cards: [], now: T('2026-11-10T09:10:00+09:00') });
  assert.equal(none.current.task_id, null);
  assert.equal(none.last_done, null);
  assert.deepEqual(none.actions, []);
  assert.deepEqual(none.actions_past, []);
});

test('user actions: needed now vs past records; duplicates once; another team\'s later card is not "handled"', () => {
  const now = T('2026-11-10T09:30:00+09:00');
  const cards = [
    card('TC-PROD', 'TC-VIS-018', '2026-11-08T08:00:00+09:00', { to: 'TC-WORK', user_action: '인계 문서 경로 전달' }),            // > 24 h
    card('TC-PROD', 'TC-VIS-020', '2026-11-10T08:00:00+09:00', { state: 'done', user_action: '결과 확인' }),                      // task done
    card('TC-PROD', 'TC-VIS-025', '2026-11-10T08:45:00+09:00', { to: 'user', next: '시각 승인', user_action: '시각 승인' }),
    card('TC-QA', 'TC-VIS-025', '2026-11-10T08:50:00+09:00', { to: 'TC-PROD', user_action: '시각 승인' }),                        // same text from another team
    card('TC-QA', 'TC-VIS-027', '2026-11-10T09:22:00+09:00', { to: 'TC-PROD', user_action: 'S1 해결 전 BAT 실행 금지' }),
    card('TC-PROD', 'TC-VIS-027', '2026-11-10T09:23:00+09:00', { state: 'blocked', to: 'director', next: '감독 결정' }),            // later, other team
  ];
  const b = buildBoard({ cards, now });
  const user = b.actions.filter(a => a.who === 'user');
  assert.deepEqual(user.map(a => a.task_id).sort(), ['TC-VIS-025', 'TC-VIS-027']);
  assert.equal(user.filter(a => a.task_id === 'TC-VIS-025').length, 1, 'the same user action on two teams\' cards is listed once');
  assert.ok(user.some(a => a.what === 'S1 해결 전 BAT 실행 금지'), 'still needed although ① wrote later');
  const past = Object.fromEntries(b.actions_past.map(a => [a.task_id, a.past_reason]));
  assert.match(past['TC-VIS-018'], /24시간/);
  assert.match(past['TC-VIS-020'], /끝난 뒤/);
  assert.ok(!b.actions.some(a => a.task_id === 'TC-VIS-020'), 'no team/director action for a finished task');
  assert.equal(USER_ACTION_FRESH_MS, 24 * 3600 * 1000);
});

// ② QA R4 / R1
test('R4: a user action a team dropped from its newer card is kept as a past record; R1: other work is not counted as production', async () => {
  const now = T('2026-11-10T10:00:00+09:00');
  const first = card('TC-PROD', 'TC-VIS-040', '2026-11-10T09:00:00+09:00', { user_action: 'BAT 실행' });
  const second = card('TC-PROD', 'TC-VIS-040', '2026-11-10T09:30:00+09:00', { state: 'in_progress' });
  const b = buildBoard({ cards: [first, second], now });
  assert.ok(!b.actions.some(a => a.who === 'user'), 'not needed now');
  const p = b.actions_past.find(a => a.what === 'BAT 실행');
  assert.ok(p, 'kept as a past record, not dropped');
  assert.match(p.past_reason, /뒤 카드에 없는/);
  const other = card('TC-PROD', 'TC-VIS-041', '2026-11-10T09:40:00+09:00', { to: 'director' });
  const b2 = buildBoard({ cards: [other], now });
  assert.equal(b2.actions[0].kind, 'production');
  const js = await (await import('node:fs/promises')).readFile(new URL('../public/board.js', import.meta.url), 'utf8');
  assert.match(js, /const acts = b\.actions\.filter\(a => a\.kind === 'production'\)/, 'home counts production only');
});

// TC-DASH-007 supplementary (감독): R2 · R1 · R4 each tested on its own
test('R2: a transcribed or evidence-less done card does not finish a task — "완료 미확인", never closed by guess', () => {
  const now = T('2026-11-10T10:00:00+09:00');
  const open = card('TC-PROD', 'TC-VIS-050', '2026-11-10T08:00:00+09:00', { state: 'in_progress' });
  const trDone = parseCard({ schema: 'tc-handoff/1', team: 'TC-WORK', task_id: 'TC-VIS-051', title: '전사 완료', state: 'done', at: '2026-11-10T09:00:00+09:00',
    author: { method: 'transcribed', transcribed_by: 'TC-DASH', transcribed_from: { ref: '③ 보고', at: '2026-11-10T08:55:00+09:00' } }, evidence: [{ kind: 'report', ref: '③ 보고' }] }, 'TC-WORK', 'w.json');
  const claimDone = parseCard({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-052', title: '근거 없는 완료', state: 'done', at: '2026-11-10T09:10:00+09:00' }, 'TC-PROD', 'p.json');
  const okDone = card('TC-QA', 'TC-VIS-053', '2026-11-10T09:20:00+09:00', { state: 'done', verdict: 'PASS', verdict_scope: 'technical' });
  const b = buildBoard({ cards: [open, trDone, claimDone, okDone], now });
  assert.equal(trDone.grade, 'transcribed');
  assert.equal(claimDone.grade, 'claim');
  assert.equal(b.last_done.task_id, 'TC-VIS-053', 'only the evidenced done card counts as completed');
  assert.deepEqual(b.done_unverified.map(x => x.task_id).sort(), ['TC-VIS-051', 'TC-VIS-052']);
  const st = Object.fromEntries(b.history.map(r => [r.task_id, r.status]));
  assert.equal(st['TC-VIS-051'], 'done_unverified');
  assert.equal(st['TC-VIS-052'], 'done_unverified');
  assert.equal(st['TC-VIS-053'], 'closed');
  assert.equal(st['TC-VIS-050'], 'open');
  assert.equal(b.current.task_id, 'TC-VIS-050', 'an unverified completion is not the current task either');
  // with only unverified completions nothing is closed and nothing is guessed
  const only = buildBoard({ cards: [trDone], now });
  assert.equal(only.last_done, null);
  assert.equal(only.current.task_id, null);
  assert.equal(only.current.now.state, 'unverified');
  // a pending action on an unverified-done task is not silently dropped
  const asked = card('TC-PROD', 'TC-VIS-052', '2026-11-10T08:30:00+09:00', { to: 'director', next: '판정 요청' });
  const b2 = buildBoard({ cards: [asked, claimDone], now });
  assert.ok(b2.done_unverified.some(x => x.task_id === 'TC-VIS-052'));
});

test('R1: waits on other-kind work are not counted as production', () => {
  const now = T('2026-11-10T10:00:00+09:00');
  const prod = card('TC-PROD', 'TC-VIS-060', '2026-11-10T09:00:00+09:00', { to: 'director', next: '제작 판정' });
  const other = card('TC-PROD', 'TC-WORK-001', '2026-11-10T09:10:00+09:00', { to: 'director', next: '기타 판정' });
  const ctl = card('TC-QA', 'TC-DASH-009', '2026-11-10T09:20:00+09:00', { to: 'TC-DASH', next: '관제실' });
  assert.equal(taskKind('TC-WORK-001'), 'other');
  const b = buildBoard({ cards: [prod, other, ctl], now });
  const by = k => b.actions.filter(a => a.kind === k).map(a => a.task_id);
  assert.deepEqual(by('production'), ['TC-VIS-060']);
  assert.deepEqual(by('other'), ['TC-WORK-001']);
  assert.deepEqual(by('control'), ['TC-DASH-009']);
  assert.ok(!b.history.some(r => r.task_id === 'TC-WORK-001'), 'other work stays out of the production history');
  assert.deepEqual(b.history_other.map(r => r.task_id), ['TC-WORK-001']);
});

test('R4: user actions superseded by a newer card stay in the past records, newest first, once', () => {
  const now = T('2026-11-10T10:00:00+09:00');
  const a1 = card('TC-PROD', 'TC-VIS-070', '2026-11-10T08:00:00+09:00', { user_action: 'PC 실행 1' });
  const a2 = card('TC-PROD', 'TC-VIS-070', '2026-11-10T08:30:00+09:00', { user_action: 'PC 실행 2' });
  const a3 = card('TC-PROD', 'TC-VIS-070', '2026-11-10T09:00:00+09:00', { state: 'in_progress', user_action: 'PC 실행 2' });
  const b = buildBoard({ cards: [a1, a2, a3], now });
  assert.deepEqual(b.actions.filter(a => a.who === 'user').map(a => a.what), ['PC 실행 2'], 'the newest card\'s request is current, once');
  assert.deepEqual(b.actions_past.map(a => a.what), ['PC 실행 1'], 'the superseded request is kept, not dropped');
  assert.match(b.actions_past[0].past_reason, /뒤 카드에 없는/);
});
