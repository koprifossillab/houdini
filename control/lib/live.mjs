// "지금" view (TC-DASH-008 1단계) — per-team status from evidence that already exists, read only.
//
//   report    — what the team last REPORTED (handoff cards / ③ signed records). Never shown as execution.
//   execution — what was actually OBSERVED running: the team session collector (a Claude session is active;
//               says nothing about which task) and, for ① PROD, finished PC run records. A placed launcher
//               (.bat) is "placed, run not confirmed", never "running".
//   last      — the newest evidence time and where it came from.
//
// Time order (director 2026-11-10, condition 3): a card is ordered by
//   1. a correction record for that card (tc-card-correction/1, the team's own corrections/ folder), else
//   2. the earlier of its written `at` and the file's modification time,
// so a card dated ahead of when it was written cannot move ahead of cards written after it. Cards dated
// in the future are flagged. Original cards are never changed.
//
// Exposure (condition 4): every field below is built explicitly from an allow-list. When the service runs
// without authentication, only coarse states leave the server — no task names, titles, times or feed.
import path from 'node:path';
import fs from 'node:fs/promises';
import { clean, iso, readBounded } from './sanitize.mjs';
import { TEAMS } from './handoff.mjs';

export const LIVE_TEAMS = [['TC-PROD', '① PROD'], ['TC-QA', '② QA'], ['TC-WORK', '③ WORK'], ['TC-DASH', '④ DASH']];
const LABEL = Object.fromEntries(LIVE_TEAMS);
const TO_LABEL = { ...LABEL, director: '감독', user: '사용자' };
export const FRESH_MS = 2 * 3600 * 1000;
export const SKEW_MS = 60 * 1000;
const FEED_WINDOW_MS = 24 * 3600 * 1000;
const PC_RUNNING_MS = 6 * 3600 * 1000;
const FILE = /^[\w.-]{1,120}\.json$/;

// commands never leave the server, even inside a title (paths are already masked by clean())
const CMD = /`[^`]{0,200}`|\b(?:sudo|bash|sh|zsh|docker(?:-compose)?|python3?|node|npm|npx|chmod|chown|rm|curl|wget|ssh|scp|rsync|sed|systemctl|kill|pkill|cmd|powershell)(?:\.exe)?\s+[^\s,·;)]+(?:\s+[^\s,·;)]+){0,6}/gi;
export const scrub = (v, max = 200) => clean(v, 400).replace(CMD, '[명령 숨김]').slice(0, max);

// ── correction records ─────────────────────────────────────────────────────────────────────────────
export function parseCorrection(doc, team, file) {
  if (!doc || doc.schema !== 'tc-card-correction/1' || doc.team !== team) return null;
  if (!FILE.test(String(doc.target_file || '')) || doc.field !== 'at') return null;
  const recorded = iso(doc.recorded_value), corrected = iso(doc.corrected_value), at = iso(doc.at);
  if (!recorded || !corrected || !at) return null;
  return { file, team, target_file: doc.target_file, recorded_value: recorded, corrected_value: corrected, reason: scrub(doc.reason, 200), basis: scrub(doc.basis, 200), at };
}

export async function readCorrections(dir) {
  const items = [];
  let invalid = 0;
  if (!dir) return { items, invalid };
  for (const team of TEAMS) {
    let list;
    try { list = await fs.readdir(path.join(dir, team, 'corrections'), { withFileTypes: true }); } catch { continue; }
    for (const e of list.filter(e => e.isFile() && !e.isSymbolicLink() && FILE.test(e.name)).slice(0, 100)) {
      let doc;
      try { doc = JSON.parse((await readBounded(path.join(dir, team, 'corrections', e.name), 16 * 1024)).toString('utf8')); } catch { doc = null; }
      const c = parseCorrection(doc, team, e.name);
      if (c) items.push(c); else invalid += 1;
    }
  }
  return { items, invalid };
}

// ── ordering ───────────────────────────────────────────────────────────────────────────────────────
export function orderCards(cards, corrections, now) {
  return cards.map(c => {
    // a correction applies only to the card it names, in the same team folder, and only while the card
    // still carries the value the correction says was recorded
    const corr = corrections.find(x => x.team === c.team && x.target_file === c.file && x.recorded_value === c.at && Date.parse(x.corrected_value) <= now + SKEW_MS);
    const w = c.written_at && Date.parse(c.written_at) < Date.parse(c.at) ? c.written_at : null;
    const order_at = corr ? corr.corrected_value : w || c.at;
    const flags = [];
    if (Date.parse(c.at) > now + SKEW_MS) flags.push('future');
    if (c.written_at && Date.parse(c.at) - Date.parse(c.written_at) > SKEW_MS) flags.push('ahead_of_write');
    if (corr) flags.push('corrected');
    return { ...c, order_at, flags, correction: corr || null };
  }).sort((a, b) => a.order_at.localeCompare(b.order_at) || a.file.localeCompare(b.file));
}

// ── report status from the newest card of a team ───────────────────────────────────────────────────
const WAIT = { 'TC-QA': ['wait_qa', 'QA 대기'], 'TC-PROD': ['wait_prod', '① PROD 대기'], 'TC-WORK': ['wait_work', '③ WORK 대기'], 'TC-DASH': ['wait_dash', '④ DASH 대기'], director: ['wait_director', '감독 대기'], user: ['wait_user', '사용자 대기'] };
const VSCOPE = { technical: '기술', visual: '시각', physics: '물리', selfcheck: '자체 검사', run: '실행' };
export function deriveStatus(h, ordered) {
  if (h.state === 'blocked') return { key: 'blocked', label: '차단' };
  if (h.verdict === 'FAIL') return { key: 'fail', label: `FAIL${h.verdict_scope ? ` · ${VSCOPE[h.verdict_scope]}` : ''}` };
  if (h.user_action) return { key: 'wait_user', label: '사용자 대기' };
  if (h.state === 'handed_off') {
    if (!h.to) return { key: 'handed_off', label: '넘김' };
    if (TEAMS.includes(h.to)) {
      const answered = ordered.some(c => c.team === h.to && c.task_id === h.task_id && c.order_at > h.order_at);
      if (answered) return { key: 'handed_answered', label: `넘김 — ${LABEL[h.to]} 응답 기록 있음` };
    }
    const [key, label] = WAIT[h.to];
    return { key, label };
  }
  if (h.state === 'in_progress') return ['confirmed', 'signed'].includes(h.grade) ? { key: 'working', label: '보고된 작업 중' } : { key: 'working_claim', label: '보고된 작업 중 · 근거 없음' };
  if (h.verdict === 'PASS') return { key: 'pass', label: `PASS${h.verdict_scope ? ` · ${VSCOPE[h.verdict_scope]}` : ''}` };
  if (h.verdict === 'REVIEW') return { key: 'review', label: 'REVIEW · 사람 판단 필요' };
  return { key: 'done', label: '완료 보고' };
}

export function reportStatus(head, ordered, now) {
  if (!head) return { key: 'none', label: '기록 없음 — 미확인' };
  const s = deriveStatus(head, ordered);
  if (now - Date.parse(head.order_at) > FRESH_MS) return { key: 'unverified', label: '미확인 — 2시간 안에 새 기록 없음', last: s };
  return s;
}

// ── execution (observed) ───────────────────────────────────────────────────────────────────────────
export function sessionLine(team, tl) {
  if (team === 'TC-WORK') return { key: 'not_connected', label: '미연결 — 별도 Windows 환경, 실시간 활동 연결 없음', basis: '서명 기록이 없다고 쉬는 중인 것은 아님 — 활동을 볼 수 있는 연결이 없음' };
  if (team === 'TC-DASH') return { key: 'not_collected', label: '세션 수집 대상 아님', basis: '관제실 작업은 인계 카드로만 표시' };
  if (!tl || tl.state !== 'live') return { key: 'unknown', label: '세션 확인 불가', basis: '팀 세션 수집기 자료가 최신이 아님' };
  const t = (tl.teams || []).find(x => x.team_id === team);
  const st = t?.execution?.state;
  const observed_at = t?.execution?.observed_at || tl.generated_at || null;
  if (st === 'RUNNING') return { key: 'session_active', label: 'Claude 세션 활동 확인', basis: '세션이 최근 활동함 — 어떤 작업인지는 증명하지 않음', observed_at, last_activity_at: t.session?.last_activity_at || null };
  if (st === 'IDLE') return { key: 'session_idle', label: 'Claude 세션 대기', basis: '세션은 있으나 최근 활동 없음', observed_at, last_activity_at: t.session?.last_activity_at || null };
  if (st === 'STOPPED') return { key: 'session_stopped', label: 'Claude 세션 없음', basis: '연결된 세션이 끝남', observed_at };
  return { key: 'unknown', label: '세션 확인 불가', basis: '수집기가 상태를 정하지 못함', observed_at };
}

export function pcLine(pc, now) {
  if (!pc || pc.state !== 'ok') return { key: 'unknown', label: 'PC 실행 기록 확인 불가', last: null, placed: 0 };
  const last = pc.results.at(-1) || null;
  const running = pc.results.filter(r => r.state === 'running' && now - Date.parse(r.started) < PC_RUNNING_MS).at(-1);
  const base = { last, placed: pc.placed.length, placed_note: '실행 파일 배치는 실행 증거가 아님' };
  if (running) return { ...base, key: 'pc_run_recorded', label: 'PC 실행 시작 기록 있음 (종료 기록 전)', running };
  if (!last) return { ...base, key: 'pc_none', label: 'PC 실행 결과 기록 없음' };
  return { ...base, key: last.state === 'finished' && last.all_ok !== false ? 'pc_last_ok' : 'pc_last_fail', label: `마지막 PC 실행 ${last.state === 'finished' && last.all_ok !== false ? '종료 · 성공' : '실패'} 확인` };
}

const bucket = (t, now) => (!t ? 'none' : now - Date.parse(t) <= FRESH_MS ? 'within_2h' : now - Date.parse(t) <= FEED_WINDOW_MS ? 'within_24h' : 'older');
export const BUCKET_LABEL = { none: '기록 없음', within_2h: '2시간 이내', within_24h: '24시간 이내', older: '24시간보다 오래됨' };

// ── assemble ───────────────────────────────────────────────────────────────────────────────────────
export function buildLive({ cards = [], signed = [], corrections = [], teamLive = null, pc = null, now = Date.now(), detail = false }) {
  const ordered = orderCards([...cards, ...signed.map(s => ({ ...s, written_at: null }))], corrections, now);
  const pcl = pcLine(pc, now);
  const teams = LIVE_TEAMS.map(([id, label]) => {
    const mine = ordered.filter(c => c.team === id);
    const head = mine.at(-1) || null;
    const status = reportStatus(head, ordered, now);
    const session = sessionLine(id, teamLive);
    const lastCands = [
      head && { at: head.order_at, source: head.grade === 'signed' ? '서명 Work 기록' : '인계 카드' },
      id === 'TC-PROD' && pcl.last && { at: pcl.last.finished || pcl.last.started, source: 'PC 실행 결과' },
      session.last_activity_at && { at: session.last_activity_at, source: 'Claude 세션 활동' },
    ].filter(Boolean).sort((a, b) => a.at.localeCompare(b.at));
    const last = lastCands.at(-1) || null;
    const out = { team: id, label, report: { key: status.key, label: status.label, grade: head?.grade || 'none', last: status.last ? { key: status.last.key, label: status.last.label } : null }, session: { key: session.key, label: session.label, basis: session.basis }, last_bucket: bucket(last?.at, now) };
    if (!detail) return out;
    // other tasks this team reported as in progress or blocked (newest card per task) within 24 h;
    // a hand-off is not counted — the receiving team holds the task then
    const heads = new Map();
    for (const c of mine) heads.set(c.task_id, c);
    const open = [...heads.values()].filter(c => c !== head && ['in_progress', 'blocked'].includes(c.state) && now - Date.parse(c.order_at) <= FEED_WINDOW_MS).map(c => c.task_id);
    Object.assign(out.report, head ? {
      task_id: head.task_id, title: scrub(head.title), state: head.state, verdict: head.verdict, verdict_scope: head.verdict_scope,
      to: head.to ? TO_LABEL[head.to] : null, at: head.order_at, recorded_at: head.at, flags: head.flags,
    } : {});
    out.open_tasks = open.slice(0, 8);
    out.session.observed_at = session.observed_at || null;
    out.last = last;
    if (id === 'TC-PROD') out.pc = { key: pcl.key, label: pcl.label, last: pcl.last, running: pcl.running || null, placed: pcl.placed, placed_note: pcl.placed_note };
    return out;
  });
  const flagged = ordered.filter(c => c.flags.includes('future') || c.flags.includes('ahead_of_write'));
  const res = {
    schema: 'tc-live/1', detail,
    detail_note: detail ? null : '인증 없이 열린 화면이라 작업 이름·시각·활동 이력은 보여 주지 않습니다.',
    teams,
    checks: { future: ordered.filter(c => c.flags.includes('future')).length, ahead_of_write: ordered.filter(c => c.flags.includes('ahead_of_write')).length, corrected: ordered.filter(c => c.flags.includes('corrected')).length },
  };
  if (!detail) return res;
  const feed = [
    ...ordered.filter(c => now - Date.parse(c.order_at) <= FEED_WINDOW_MS).map(c => ({ at: c.order_at, team: LABEL[c.team], source: c.grade === 'signed' ? '서명 기록' : '카드', task_id: c.task_id, text: `${deriveStatus(c, ordered).label} — ${scrub(c.title, 120)}`, grade: c.grade, flags: c.flags })),
    ...(pc?.results || []).filter(r => now - Date.parse(r.finished || r.started) <= FEED_WINDOW_MS).map(r => ({ at: r.finished || r.started, team: LABEL['TC-PROD'], source: 'PC 결과', task_id: null, text: `${r.job} ${r.state === 'finished' ? (r.all_ok === false ? '종료 · 점검 실패' : '종료 · 성공') : r.state === 'failed' ? '실패' : '시작 기록'}${r.render_sec !== null ? ` · ${Math.round(r.render_sec / 60)}분` : ''}`, grade: 'confirmed', flags: [] })),
    ...(pc?.placed || []).map(p => ({ at: p.placed_at, team: LABEL['TC-PROD'], source: 'PC 배치', task_id: null, text: `${p.job} 실행 파일 배치 — 실행 여부 미확인`, grade: 'clue', flags: [] })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  res.feed = feed;
  res.corrections = corrections.map(c => ({ team: LABEL[c.team], target_file: c.target_file, recorded_value: c.recorded_value, corrected_value: c.corrected_value, reason: c.reason, at: c.at, flags: Date.parse(c.at) > now + SKEW_MS ? ['future'] : [] }));
  res.flagged = flagged.map(c => ({ team: LABEL[c.team], task_id: c.task_id, file: c.file, recorded_at: c.at, written_at: c.written_at || null, order_at: c.order_at, flags: c.flags }));
  return res;
}
