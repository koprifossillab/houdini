#!/usr/bin/env node
// Check a tc-handoff/1 card before (or after) saving it — read only, writes nothing.
//   node control/scripts/check-card.mjs <카드 폴더>/<팀>/<YYYYMMDD-HHMM>_<작업번호>.json [...]
// Exit code 0 = every card would be shown; 1 = at least one card would be refused.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCard, TEAMS, NO_ACTION, TASK, TASK_SRC } from '../lib/handoff.mjs';

const NAME = new RegExp(`^\\d{8}-\\d{4}_${TASK_SRC}\\.json$`);
let bad = 0;
for (const file of process.argv.slice(2)) {
  const team = path.basename(path.dirname(file));
  const name = path.basename(file);
  const notes = [];
  let doc;
  try { doc = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { console.log(`✕ ${name}: JSON 을 읽을 수 없음 (${e.message})`); bad += 1; continue; }
  if (!TEAMS.includes(team)) notes.push(`폴더 이름 '${team}' 은 팀 폴더가 아님 (${TEAMS.join(' · ')})`);
  if (!NAME.test(name)) notes.push('파일 이름 권장 형식: YYYYMMDD-HHMM_<작업번호>.json');
  const c = parseCard(doc, team, name);
  if (!c) {
    const why = [];
    if (doc?.schema !== 'tc-handoff/1') why.push('schema 가 tc-handoff/1 이 아님');
    if (doc?.team !== team) why.push(`team(${doc?.team}) 과 폴더(${team}) 가 다름`);
    if (!TASK.test(String(doc?.task_id || ''))) why.push('task_id 형식 오류 (예: TC-VIS-030)');
    if (!['in_progress', 'handed_off', 'blocked', 'done'].includes(doc?.state)) why.push('state 는 in_progress · handed_off · blocked · done 중 하나');
    if (!Number.isFinite(Date.parse(doc?.at))) why.push('at 시각 없음·형식 오류');
    if (doc?.author?.method === 'transcribed') why.push('전사 카드는 author.transcribed_from 에 원문 위치(ref)와 원문 시각(at)을 직접 적어야 함 — 근거·카드 시각으로 대신하지 않음');
    else if (doc?.transcribed_by && !doc?.author) why.push('옛 형식 전사 카드는 첫 근거에 원문 시각(at)이 있어야 함');
    console.log(`✕ ${name}: 관제실이 받지 않음 — ${why.join(' / ') || '형식 오류'}`);
    bad += 1;
    continue;
  }
  if (Date.parse(c.at) > Date.now() + 60000) notes.push('at 이 미래 시각');
  if (c.grade === 'claim') notes.push('evidence 가 없어 "근거 없는 카드"로 표시되고 진행 중으로 치지 않음');
  if (c.author.signed_claim_ignored) notes.push('파일로는 signed 를 쓸 수 없음 — 직접 작성으로 읽음 (서명은 ③ Work 기록에서만)');
  if (c.state === 'in_progress') notes.push('진행 중 카드는 2시간 안에 새 근거로 다시 쓰지 않으면 화면에서 미확인으로 내려감');
  if (typeof doc?.user_action === 'string' && NO_ACTION.test(doc.user_action)) notes.push(`user_action '${doc.user_action}' 은 없음으로 읽음 — 사용자 할 일이 없으면 null 로 쓰기`);
  if (c.user_action && c.to && c.to !== 'user') notes.push(`참고: user_action 이 있어 "사용자 대기"로 표시됨 (to=${c.to} 보다 우선) — 사용자가 할 일이면 그대로, 주의 안내뿐이면 next 에`);
  if (['handed_off', 'blocked'].includes(c.state) && !c.to) notes.push('넘김·차단 카드에 to(받는 쪽)가 없음');
  const label = { confirmed: '직접 작성', claim: '근거 없는 카드', transcribed: '전사' }[c.grade] || c.grade;
  console.log(`✓ ${name}: ${c.team} ${c.task_id} ${c.state}${c.verdict ? ` · ${c.verdict}` : ''} — ${label}`);
  for (const n of notes) console.log(`   · ${n}`);
}
process.exit(bad ? 1 : 0);
