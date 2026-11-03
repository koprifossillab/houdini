import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmp } from './helpers.mjs';
import { teamLiveView } from '../lib/teamlive.mjs';

const doc = (age_s, extra = {}) => ({
  schema: 'tc-team-live/1', generated_at: new Date(Date.now() - age_s * 1000).toISOString(),
  teams: [
    { team_id: 'TC-PROD', label: 'P', execution: { state: 'RUNNING', basis: 'x' }, session: { id: 'aaaaaaaa', name: 'TC-PROD-1', binding: 'verified', start: '팀 전용 시작 폴더' }, handoff: { available: true, owner_submitted: true, last_confirmed_state: 'see /home/someone/secret.md', next: ['a'] } },
    { team_id: 'TC-QA', label: 'Q', execution: { state: 'IDLE', basis: 'y' }, handoff: { available: false } },
    { team_id: 'TC-WORK', label: 'W', execution: { state: 'BOGUS' } },
  ],
  tokens: { fx: { krw_per_usd: 1450 }, server: { all: { output: 5, cost_usd: 1.5, cost_krw: 2175 } } }, ...extra,
});

test('team live: fresh collector keeps RUNNING / IDLE; unknown states become UNKNOWN; paths masked', async t => {
  const dir = await tmp(t);
  await fs.writeFile(path.join(dir, 'team_live.json'), JSON.stringify(doc(10)));
  const v = await teamLiveView(dir);
  assert.equal(v.state, 'live');
  assert.deepEqual(v.teams.map(x => x.execution.state), ['RUNNING', 'IDLE', 'UNKNOWN']);
  assert.ok(!JSON.stringify(v).includes('/home/'));
  assert.equal(v.tokens.server.all.cost_krw, 2175);
});

test('team live: late collector never shows RUNNING or IDLE', async t => {
  const dir = await tmp(t);
  await fs.writeFile(path.join(dir, 'team_live.json'), JSON.stringify(doc(400)));
  const v = await teamLiveView(dir);
  assert.equal(v.state, 'stale');
  assert.deepEqual(v.teams.map(x => x.execution.state), ['STALE', 'STALE', 'UNKNOWN']);
});

test('team live: missing / malformed file -> every team UNKNOWN', async t => {
  const dir = await tmp(t);
  assert.ok((await teamLiveView(dir)).teams.every(x => x.execution.state === 'UNKNOWN'));
  await fs.writeFile(path.join(dir, 'team_live.json'), '{"schema":"other"}');
  const v = await teamLiveView(dir);
  assert.equal(v.state, 'error');
  assert.ok(v.teams.every(x => x.execution.state === 'UNKNOWN'));
  assert.ok((await teamLiveView(null)).teams.every(x => x.execution.state === 'UNKNOWN'));
});

test('team live: "full" only with verified start folder AND owner handoff; otherwise name_only with reasons', async t => {
  const dir = await tmp(t);
  const d = doc(10);
  d.teams[1].session = { id: 'bbbbbbbb', name: 'TC-QA-1', binding: 'name_only' };
  d.teams[1].handoff = { available: true, owner_submitted: true, placeholder: false };
  await fs.writeFile(path.join(dir, 'team_live.json'), JSON.stringify(d));
  let v = await teamLiveView(dir);
  assert.equal(v.teams[0].link.level, 'full');
  assert.equal(v.teams[1].link.level, 'name_only');
  assert.deepEqual(v.teams[1].link.missing, ['팀 시작 폴더 미분리']);
  d.teams[0].handoff.placeholder = true;
  await fs.writeFile(path.join(dir, 'team_live.json'), JSON.stringify(d));
  v = await teamLiveView(dir);
  assert.equal(v.teams[0].link.level, 'name_only');
  assert.equal(v.teams[2].link.level, 'none');
});
