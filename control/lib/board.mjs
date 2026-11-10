// Project board (TC-DASH-003): what the home, team, issue, history and review screens show.
// Pure function of the inputs and the clock — no I/O here, so the TC-VIS-024 → 025 transition and the
// staleness rules are replayable in tests with the original evidence times.
//
// Rules kept apart on purpose:
//   - "now" (actual state) vs "last" (last confirmed state). "now" is in_progress only when a confirmed
//     in_progress card is younger than LIVE_WINDOW_MS; otherwise it is unverified, and "last" is kept.
//   - verdicts (PASS / FAIL / REVIEW / UNVERIFIED) vs states (in_progress / handed_off / blocked / done /
//     pending) are separate fields with separate vocabularies.
//   - session / process liveness is reported as a session line only, never as work state.
//   - a candidate's FAIL never changes the baseline; the baseline comes from decision records only.
//   - NAS folder names are clues only; approvals come from decision records only.
//   - provenance (D-1): self-submitted / signed / transcribed records carry different grades and labels;
//     only self-submitted cards with evidence or verified signed records can make "now" in progress.
//   - a decision counts as a valid director decision only when its original matched AND a user
//     confirmation is recorded (TC-DASH-005); otherwise it is shown as a record only and never answers a
//     pending action, closes a task or confirms a baseline.
import { decisionValidity } from './director.mjs';

export const LIVE_WINDOW_MS = 2 * 3600 * 1000;
// TC-DASH-007: a user action counts as needed now only when it sits on a team's newest card of an open task
// and is younger than this; older ones and those of finished tasks are listed as past, unconfirmed records.
// (A later card from ANOTHER team is not evidence that the user action was handled.)
export const USER_ACTION_FRESH_MS = 24 * 3600 * 1000;
// task kinds by directive number: production (TC-VIS-…, TC-00-…, TC-01S-…), control-room work
// (TC-DASH-…, TC-HANDOFF-…) and anything else (e.g. ③'s own Work task ids)
export function taskKind(id) {
  const s = String(id || '');
  if (/^TC-(?:DASH|HANDOFF)-/.test(s)) return 'control';
  if (/^TC-(?:VIS|\d[0-9A-Z]*)-\d/.test(s)) return 'production';
  return 'other';
}
export const PRODUCTION_TEAMS = ['TC-PROD', 'TC-QA', 'TC-WORK'];
export const TEAM_INFO = {
  'TC-PROD': { label: '① TC-PROD 통합 제작팀', duty: 'Houdini 3D · 물리 · 제작 코드', outside: false },
  'TC-QA': { label: '② TC-QA 독립 검증팀', duty: '독립 검증 · 수정·배포 금지', outside: false },
  'TC-WORK': { label: '③ TC-WORK 제작관리팀', duty: 'ChatGPT Work · 서버 밖', outside: true },
  'TC-DASH': { label: '④ 관제실 담당', duty: 'PaleoLab /Houdini/ 개발·운영', outside: false },
};
const WHO = { 'TC-PROD': '① TC-PROD', 'TC-QA': '② TC-QA', 'TC-WORK': '③ TC-WORK', 'TC-DASH': '④ 관제실', director: '총괄 감독', user: '사용자' };

const ev = (grade, source, time, precision = 'time') => ({ grade, source, at: time, at_precision: precision });
const latest = list => list.reduce((a, b) => (!a || b.at >= a.at ? b : a), null);
const byTask = (list, id) => list.filter(x => x.task_id === id);

export const PROVENANCE = {
  confirmed: '직접 작성 · 담당 세션 제출 (작성자 신원 미검증)',
  claim: '직접 작성 · 근거 없음',
  signed: '서명 기록 · 무결성 확인 (작성자 신원 증명 아님)',
  transcribed: '전사 기록 · 다른 기록에서 옮겨 적음',
};
function cardEvidence(c) {
  const src = c.evidence.length ? c.evidence.map(e => e.ref).slice(0, 3).join(' · ') : '근거 없는 카드';
  const a = c.author || { method: 'self' };
  const out = ev(c.grade, `${a.method === 'signed' ? '' : '인계 카드 '}${c.team}/${c.file}${c.evidence.length ? ` → ${src}` : ''}`, c.at, c.at_precision);
  out.method = a.method;
  out.provenance = PROVENANCE[c.grade];
  if (a.method === 'transcribed') out.transcribed = { by: a.transcribed_by, from: a.transcribed_from };
  if (a.method === 'signed') out.signed = a.event;
  return out;
}
function decisionEvidence(d) {
  const g = d.validity === 'valid' ? 'valid_decision' : d.validity === 'content_matched' ? 'content_matched' : 'transcribed';
  const out = ev(g, `판정 기록 ${d.file} (${d.transcribed_by} 기록) → ${d.source.ref}`, d.at, d.at_precision);
  out.method = 'transcribed';
  out.validity = d.validity;
  out.provenance = d.validity_label;
  out.original = d.original;
  return out;
}
const LIVE_GRADES = ['confirmed', 'signed'];
const VALID = d => d.validity === 'valid';

export function nowState(card, now, outside = false) {
  if (!card) return { state: 'unverified', label: outside ? '관측 불가' : '미확인', basis: '인계 카드 없음', ...ev('none', '근거 없음', null) };
  const age = now - Date.parse(card.at);
  if (card.state === 'in_progress' && LIVE_GRADES.includes(card.grade) && age >= 0 && age <= LIVE_WINDOW_MS) {
    return { state: 'in_progress', label: '진행 중', basis: `진행 중 카드 · ${Math.round(age / 60000)}분 전 기록`, ...cardEvidence(card) };
  }
  const basis = card.state === 'in_progress'
    ? (card.grade === 'transcribed' ? '전사 기록은 지금 상태의 근거가 아님' : !LIVE_GRADES.includes(card.grade) ? '진행 중이라는 카드에 근거가 없음' : `진행 중 기록이 ${Math.floor(age / 3600000)}시간 넘게 갱신되지 않음`)
    : '마지막 기록 이후 새 근거 없음';
  return { state: 'unverified', label: outside ? '관측 불가' : '미확인', basis, ...ev('none', '최근 근거 없음', null) };
}

function lastState(card) {
  if (!card) return null;
  return {
    task_id: card.task_id, title: card.title, state: card.state, verdict: card.verdict, verdict_scope: card.verdict_scope,
    done: card.done, next: card.next, to: card.to, to_label: WHO[card.to] || null, candidate: card.candidate, ...cardEvidence(card),
  };
}

function steps(id, cards, decisions) {
  const tc = byTask(cards, id);
  const td = byTask(decisions, id);
  const prod = latest(tc.filter(c => c.team === 'TC-PROD'));
  const qa = latest(tc.filter(c => c.team === 'TC-QA'));
  const directive = latest(td.filter(d => d.kind === 'directive'));
  const judged = latest(td.filter(d => ['approval', 'rejection', 'hold'].includes(d.kind) && VALID(d)));
  const recorded = latest(td.filter(d => ['approval', 'rejection', 'hold'].includes(d.kind) && !VALID(d)));
  const closure = latest(td.filter(d => d.kind === 'closure' && VALID(d)));
  const toDirector = latest(tc.filter(c => c.to === 'director'));
  const none = (why = '근거 없음') => ({ kind: 'state', value: 'none', text: '미확인', ...ev('none', why, null) });
  return [
    { key: 'directive', label: '지시', ...(directive ? { kind: 'state', value: 'issued', text: '확인', ...decisionEvidence(directive) }
      : tc.length ? { kind: 'state', value: 'issued', text: '카드에만 기재', ...ev('claim', '판정 기록에 지시 원문 없음 — 카드의 지시 번호', tc[0].at, tc[0].at_precision) } : none()) },
    { key: 'make', label: '제작', ...(prod ? { kind: 'state', value: prod.state, text: { in_progress: '진행 기록', handed_off: '넘김', blocked: '차단', done: '완료' }[prod.state], ...cardEvidence(prod) } : none()) },
    { key: 'self', label: '자체 검증', ...(prod?.verdict ? { kind: 'verdict', value: prod.verdict, text: prod.verdict, scope: prod.verdict_scope, ...cardEvidence(prod) } : none(prod ? '제작 카드에 자체 검증 판정 없음' : '근거 없음')) },
    { key: 'qa', label: 'QA 독립 검증', ...(qa?.verdict ? { kind: 'verdict', value: qa.verdict, text: qa.verdict, scope: qa.verdict_scope, ...cardEvidence(qa) } : qa ? { kind: 'state', value: qa.state, text: '판정 없음', ...cardEvidence(qa) } : none('QA 카드 없음')) },
    { key: 'director', label: '감독 판정', ...(judged ? { kind: 'decision', value: judged.kind, text: { approval: '승인', rejection: '반려', hold: '보류' }[judged.kind], ...decisionEvidence(judged) }
      : toDirector ? { kind: 'state', value: 'pending', text: recorded ? '대기 (유효하지 않은 기록만 있음)' : '대기', ...cardEvidence(toDirector) }
        : recorded ? { kind: 'state', value: 'recorded', text: '기록만 · 유효 판정 아님', ...decisionEvidence(recorded) } : none()) },
    { key: 'result', label: '결과', ...(closure ? { kind: 'decision', value: 'closure', text: '종료', ...decisionEvidence(closure) } : { kind: 'state', value: 'open', text: '미정', ...ev('none', '종료 기록 없음', null) }) },
  ];
}

export function buildBoard({ cards = [], decisions: rawDecisions = [], originals = null, nas = null, teamLive = null, now = Date.now() } = {}) {
  const decisions = rawDecisions.map(d => { const v = decisionValidity(d, originals); return { ...d, validity: v.validity, validity_label: v.label, original: v.original }; });
  const prodCards = cards.filter(c => PRODUCTION_TEAMS.includes(c.team));

  // baseline & candidates: decision records only
  const base = latest(decisions.filter(d => d.kind === 'baseline'));
  const baseline = base ? { name: base.baseline.name, commit: base.baseline.commit, label: base.baseline.label || base.subject, valid: VALID(base), ...decisionEvidence(base) } : { name: null, valid: false, label: '기준본 판정 기록 없음', ...ev('none', '판정 기록 없음', null) };
  const candStatus = new Map();
  for (const d of decisions.filter(x => x.kind === 'candidate_status')) candStatus.set(d.candidate.name, d);

  // tasks: newest card of each task (any team) decides whether it is still open
  const closedByDecision = new Set(decisions.filter(d => d.kind === 'closure' && VALID(d) && d.task_id).map(d => d.task_id));
  const taskHead = new Map();
  for (const c of cards) taskHead.set(c.task_id, c); // cards are sorted by time → last wins
  const isOpen = id => { const h = taskHead.get(id); return !!h && h.state !== 'done' && !closedByDecision.has(id); };
  const openOf = kind => [...taskHead.values()].filter(c => taskKind(c.task_id) === kind && isOpen(c.task_id)).sort((a, b) => b.at.localeCompare(a.at));

  // current task (TC-DASH-007): the most recently active OPEN production task. Control-room work and
  // finished tasks never take this place; with no open production task the slot stays unverified.
  const view = (c, kind) => {
    const latestProd = latest(cards.filter(x => x.task_id === c.task_id && PRODUCTION_TEAMS.includes(x.team))) || c;
    return { task_id: c.task_id, kind, team: latestProd.team, team_label: TEAM_INFO[latestProd.team].label,
      now: nowState(latestProd, now, TEAM_INFO[latestProd.team].outside), last: lastState(latestProd), steps: steps(c.task_id, cards, decisions) };
  };
  const openProd = openOf('production');
  const current = openProd.length ? { ...view(openProd[0], 'production'), open_count: openProd.length, also_open: openProd.slice(1, 6).map(c => ({ task_id: c.task_id, state: c.state, at: c.at })) }
    : { task_id: null, kind: 'production', open_count: 0, now: { ...nowState(null, now), basis: '열린 제작 작업 기록 없음 — 추정하지 않음' }, last: null, steps: [] };
  const openCtl = openOf('control');
  const control = { open: openCtl.slice(0, 5).map(c => ({ task_id: c.task_id, title: c.title, team: c.team, state: c.state, to_label: WHO[c.to] || null, ...cardEvidence(c) })) };

  // execution: there is no PC link, so the current execution is always unverified
  const runs = (nas?.folders || []).filter(f => f.clue === 'run_preserved');
  const run = runs[0] || null;
  const runCited = run ? cards.find(c => c.evidence.some(e => e.ref.includes(run.name))) : null;
  const execution = {
    now: { state: 'unverified', label: '미확인', basis: 'PC Houdini·Karma 상태 전송 장치 없음 — 세션·프로세스 생존은 실행 근거가 아님', ...ev('none', '근거 없음', null) },
    last_run: run ? { name: run.name, run_lock: run.run_lock, ...(runCited ? { ...cardEvidence(runCited), at: run.mtime, source: `${cardEvidence(runCited).source} (폴더 시각)` } : ev('clue', `NAS 폴더 이름 '${run.clue_label}' · RUN.lock ${run.run_lock ? '있음' : '없음'}`, run.mtime)) } : null,
  };

  // last completed: a production task whose newest card is done (past record, not the current task)
  const done = latest([...taskHead.values()].filter(c => taskKind(c.task_id) === 'production' && c.state === 'done'));
  const closure = latest(decisions.filter(d => d.kind === 'closure' && VALID(d) && taskKind(d.task_id) === 'production'));
  const last_done = closure && (!done || closure.at > done.at)
    ? { task_id: closure.task_id, title: closure.subject, kind: 'closure', ...decisionEvidence(closure) }
    : done ? { task_id: done.task_id, title: done.title, team: done.team, verdict: done.verdict, verdict_scope: done.verdict_scope, ...cardEvidence(done) } : null;

  // latest card per (team, task) — earlier cards of the same pair are history
  const heads = new Map();
  for (const c of cards) heads.set(`${c.team}\0${c.task_id}`, c);
  const headList = [...heads.values()];

  // pending actions: a card handed to a team or the director who has not answered on that task since.
  // User actions (TC-DASH-007): needed now only when on a team's newest card (heads) of an open task and
  // < 24 h old; the rest are past records whose handling is unknown. Same task + same text is listed once.
  const actions = [];
  const actions_past = [];
  const seenUser = new Set();
  for (const c of [...headList].sort((a, b) => b.at.localeCompare(a.at))) {
    const kind = taskKind(c.task_id);
    if (c.to && c.to !== 'user' && ['handed_off', 'blocked'].includes(c.state) && isOpen(c.task_id)) {
      const answered = c.to === 'director'
        ? decisions.some(d => d.task_id === c.task_id && ['approval', 'rejection', 'hold', 'closure'].includes(d.kind) && VALID(d) && d.at >= c.at)
        : cards.some(x => x.team === c.to && x.task_id === c.task_id && x.at >= c.at);
      if (!answered) actions.push({ who: c.to, who_label: WHO[c.to], what: c.next || c.title, task_id: c.task_id, kind, since: c.at, from: c.team, ...cardEvidence(c) });
    }
    const userText = c.user_action || (c.to === 'user' ? (c.next || c.title) : null);
    if (userText) {
      const key = `${c.task_id}\0${userText}`;
      if (seenUser.has(key)) continue;
      seenUser.add(key);
      const age = now - Date.parse(c.at);
      const why = !isOpen(c.task_id) ? '작업이 끝난 뒤 남은 기록 — 처리 여부 미확인' : age > USER_ACTION_FRESH_MS ? '24시간 넘게 지난 기록 — 처리 여부 미확인' : null;
      const a = { who: 'user', who_label: WHO.user, what: userText, task_id: c.task_id, kind, since: c.at, from: c.team, ...cardEvidence(c) };
      if (why) actions_past.push({ ...a, past_reason: why }); else actions.push(a);
    }
  }
  // ② QA R4: a user action that a team's earlier card asked for and its newer card no longer carries is not
  // dropped — it is listed as a past record (handling unknown)
  for (const c of cards) {
    const head = heads.get(`${c.team}\0${c.task_id}`);
    const text = c.user_action || (c.to === 'user' ? (c.next || c.title) : null);
    if (!text || head === c) continue;
    const key = `${c.task_id}\0${text}`;
    if (seenUser.has(key)) continue;
    seenUser.add(key);
    actions_past.push({ who: 'user', who_label: WHO.user, what: text, task_id: c.task_id, kind: taskKind(c.task_id), since: c.at, from: c.team, ...cardEvidence(c), past_reason: '같은 팀의 뒤 카드에 없는 요청 — 처리 여부 미확인' });
  }
  actions.sort((a, b) => b.since.localeCompare(a.since));
  actions_past.sort((a, b) => b.since.localeCompare(a.since));

  // issues, split by scope — candidate failures stay with the candidate
  const issues = { project: [], candidate: [], track: [] };
  for (const c of headList) {
    for (const i of c.issues) {
      if (i.resolved) continue;
      issues[i.scope].push({ ...i, task_id: c.task_id, team: c.team, ...cardEvidence(c) });
    }
  }
  for (const k of Object.keys(issues)) issues[k].sort((a, b) => b.at.localeCompare(a.at));

  // history: one row per task id, newest first
  const ids = [...new Set([...cards.map(c => c.task_id), ...decisions.map(d => d.task_id).filter(Boolean)])];
  const lastAt = id => [...byTask(cards, id), ...byTask(decisions, id)].reduce((m, x) => (x.at > m ? x.at : m), '');
  const row = id => ({ task_id: id, kind: taskKind(id), open: isOpen(id), title: latest(byTask(cards, id))?.title || latest(byTask(decisions, id))?.subject || '', last_at: lastAt(id), steps: steps(id, cards, decisions) });
  const sorted = ids.sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
  const history = sorted.filter(id => taskKind(id) === 'production').slice(0, 30).map(row);
  const history_control = sorted.filter(id => taskKind(id) === 'control').slice(0, 15).map(row);
  const history_other = sorted.filter(id => taskKind(id) === 'other').slice(0, 15).map(row);

  // teams
  const live = new Map((teamLive?.teams || []).map(t => [t.team_id, t]));
  const teams = Object.entries(TEAM_INFO).map(([id, info]) => {
    const c = latest(cards.filter(x => x.team === id));
    const s = live.get(id);
    return {
      id, ...info, now: nowState(c, now, info.outside), last: lastState(c),
      session: info.outside ? { label: '서버 밖에서 일함 — 관측 불가', note: '세션 정보는 작업 상태가 아님' }
        : s ? { label: s.execution?.process_alive ? 'Claude 세션 프로세스 살아 있음' : 'Claude 세션 프로세스 보이지 않음', link: s.link?.label || null, note: '프로세스 생존은 무슨 작업인지 증명하지 않음' }
          : { label: '세션 연결 정보 없음', note: '작업 판정에 쓰지 않음' },
    };
  });

  // review candidates: status from decisions, verdicts from cards, images from cited NAS folders
  const names = new Set([...candStatus.keys(), ...cards.map(c => c.candidate).filter(Boolean)]);
  const candidates = [...names].map(name => {
    const d = candStatus.get(name);
    const cc = cards.filter(c => c.candidate === name && c.verdict);
    const vmap = new Map();
    for (const c of cc) vmap.set(`${c.team}\0${c.verdict_scope}`, c);
    const cited = cards.filter(c => c.candidate === name).flatMap(c => c.evidence.filter(e => e.kind === 'nas').map(e => e.ref));
    const imgs = (nas?.folders || []).filter(f => cited.some(r => r.includes(f.name))).flatMap(f => f.images.filter(i => i.listed).map(i => ({ id: i.id, file: i.file, folder: f.name, ...ev('clue', `NAS 폴더 ${f.name} · SHA 목록 등재`, f.mtime) })));
    return {
      name,
      status: d ? d.candidate.status : 'unapproved',
      status_valid: d ? VALID(d) : false,
      status_label: d ? `${{ baseline: '기준본', backup: '비상 백업', candidate: '후보', rejected: '불채택', stopped: '중단' }[d.candidate.status]}${VALID(d) ? '' : ' · 기록만 (유효 판정 아님)'}` : '판정 기록 없음 · 미승인',
      commit: d?.candidate.commit || null,
      note: d?.candidate.note || '',
      status_evidence: d ? decisionEvidence(d) : ev('none', '판정 기록 없음', null),
      verdicts: [...vmap.values()].map(c => ({ team: c.team, verdict: c.verdict, scope: c.verdict_scope, ...cardEvidence(c) })),
      images: imgs.slice(0, 6),
      last_at: [d?.at, ...cc.map(c => c.at)].filter(Boolean).sort().at(-1) || null,
    };
  }).sort((a, b) => (a.status === 'baseline' ? -1 : b.status === 'baseline' ? 1 : (b.last_at || '').localeCompare(a.last_at || '')));

  // newest NAS folder holding SHA-listed images (a clue: which result exists, not whether it is approved)
  const mf = (nas?.folders || []).find(f => f.images.some(i => i.listed));
  const latest_media = mf ? { name: mf.name, images: mf.images.filter(i => i.listed).map(i => ({ id: i.id, file: i.file })), ...ev('clue', `NAS 폴더 '${mf.clue_label}' · SHA 목록 등재 그림`, mf.mtime) } : null;

  const decision_counts = { valid: decisions.filter(VALID).length, not_valid: decisions.filter(d => !VALID(d)).length };

  return { decision_counts, now: new Date(now).toISOString(), live_window_min: LIVE_WINDOW_MS / 60000, baseline, current, control, execution, last_done, actions, actions_past, issues, history, history_control, history_other, teams, candidates, latest_media };
}
