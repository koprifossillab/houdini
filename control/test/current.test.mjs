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
