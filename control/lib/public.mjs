// Public projection (TC-DASH-008 운영 공개 정책, owner decision 2026-11-10).
// The control room stays an unauthenticated public page, so whenever the service runs without
// authentication every response is built HERE from fixed vocabularies — never by hiding text in the browser.
//
// Allowed: team (① PROD · ② QA · ③ WORK · ④ DASH), a coarse work state, the evidence grade, the project's
// coarse stage, small counts. Not allowed: task names/numbers, times of any activity, commands, paths,
// names, PIDs, credentials, check details, failure text, SHA or other identifiers, anything detailed enough
// to infer a person's working pattern. Freshness is checked inside and published as a state word only.
//
// Every string a public response may carry is listed in VOCAB below; checkPublic() rejects anything else,
// so a field added by mistake fails the test suite instead of reaching viewers.

export const PUBLIC_TEAMS = [['TC-PROD', '① PROD'], ['TC-QA', '② QA'], ['TC-WORK', '③ WORK'], ['TC-DASH', '④ DASH']];

export const STATUS = {
  producing: '제작 중', verifying: '검증 중', waiting_result: '결과 대기', waiting_user: '사용자 조치 대기', done: '완료', unverified: '미확인',
};
export const GRADE = { confirmed: '확인', reported: '보고', estimated: '추정', none: '근거 없음' };
export const EXECUTION = {
  confirmed: '실행 확인됨', unconfirmed: '실행 미확인', not_connected: '미연결 — 별도 Windows 환경, 활동 연결 없음', not_collected: '실행 수집 대상 아님',
};
export const STEP_STATE = { done: '완료', in_progress: '진행 중', waiting: '결과 대기', open: '미정', unverified: '미확인' };
export const STEPS = [['directive', '지시'], ['make', '제작'], ['self', '자체 검증'], ['qa', 'QA 독립 검증'], ['director', '감독 판정'], ['result', '결과']];
export const PENDING = [['director', '감독 결정'], ['qa', '② QA 검증'], ['prod', '① PROD 작업'], ['work', '③ WORK 검토'], ['user', '사용자 조치']];
export const FRESHNESS = { fresh: '자료 최신', partial: '일부 자료 지연', missing: '자료 없음' };
export const PROJECT_LABEL = 'Thermal Collapse · Houdini 제작';
export const NOTE = '공개 화면입니다. 작업 이름·번호, 활동 시각, 세부 검사 내용은 공개하지 않습니다. 근거가 없으면 미확인으로 표시하고, ③ WORK 는 별도 Windows 환경이라 활동 연결이 없으며 이것은 휴식이나 중단을 뜻하지 않습니다.';

// ── live (/api/live) ───────────────────────────────────────────────────────────────────────────────
const statusOf = (team, key) => {
  if (['working', 'working_claim'].includes(key)) return team === 'TC-QA' ? 'verifying' : 'producing';
  if (key === 'wait_user') return 'waiting_user';
  if (['wait_qa', 'wait_prod', 'wait_work', 'wait_dash', 'wait_director', 'handed_off', 'handed_answered', 'blocked', 'fail', 'review'].includes(key)) return 'waiting_result';
  if (['pass', 'done'].includes(key)) return 'done';
  return 'unverified';
};
export const gradeOf = g => (['confirmed', 'signed', 'valid_decision'].includes(g) ? 'confirmed' : ['claim', 'transcribed', 'content_matched'].includes(g) ? 'reported' : g === 'clue' ? 'estimated' : 'none');
const execOf = (team, sessionKey, pcKey) => {
  if (team === 'TC-WORK') return 'not_connected';
  if (team === 'TC-DASH') return 'not_collected';
  return sessionKey === 'session_active' || pcKey === 'pc_run_recorded' ? 'confirmed' : 'unconfirmed';
};
const pair = (map, key) => ({ key, label: map[key] });

export function publicTeams(live) {
  return PUBLIC_TEAMS.map(([id, label]) => {
    const t = live.teams.find(x => x.team === id);
    const st = t ? statusOf(id, t.report.key) : 'unverified';
    // a coarse state with no current evidence carries no grade of its own
    const g = t && st !== 'unverified' ? gradeOf(t.report.grade) : 'none';
    return { team: id, label, status: pair(STATUS, st), grade: pair(GRADE, g), execution: pair(EXECUTION, execOf(id, t?.session.key, t?.pc?.key)) };
  });
}

export function freshnessOf(sources) {
  if (!sources || sources.handoff?.state !== 'ok') return 'missing';
  return sources.team_live?.state === 'live' && sources.pc_runs?.state === 'ok' ? 'fresh' : 'partial';
}

export function publicLive(live, sources) {
  return { schema: 'tc-live-public/1', public: true, teams: publicTeams(live), freshness: pair(FRESHNESS, freshnessOf(sources)), note: NOTE };
}

// ── board (/api/board) ─────────────────────────────────────────────────────────────────────────────
const stepState = s => {
  if (!s) return 'unverified';
  if (s.kind === 'verdict') return s.value === 'PASS' ? 'done' : 'waiting';
  if (s.kind === 'decision') return ['approval', 'closure'].includes(s.value) ? 'done' : 'waiting';
  return { issued: 'done', done: 'done', handed_off: 'done', in_progress: 'in_progress', blocked: 'waiting', pending: 'waiting', open: 'open' }[s.value] || 'unverified';
};
const ACTION_KEY = { director: 'director', 'TC-QA': 'qa', 'TC-PROD': 'prod', 'TC-WORK': 'work', user: 'user' };

export function publicBoard(board, live, sources) {
  const steps = board.current?.steps || [];
  const pending = Object.fromEntries(PENDING.map(([k]) => [k, 0]));
  for (const a of board.actions || []) if (a.kind === 'production' && ACTION_KEY[a.who]) pending[ACTION_KEY[a.who]] += 1;
  return {
    schema: 'tc-board-public/1', public: true,
    project: {
      label: PROJECT_LABEL,
      stage: STEPS.map(([key, label]) => { const s = steps.find(x => x.key === key); const st = stepState(s); return { key, label, state: pair(STEP_STATE, st), grade: pair(GRADE, st === 'unverified' || st === 'open' ? 'none' : gradeOf(s?.grade)) }; }),
      open_tasks: Math.min(board.current?.open_count || 0, 99),
    },
    pending: PENDING.map(([key, label]) => ({ key, label, count: Math.min(pending[key], 99) })),
    teams: publicTeams(live),
    freshness: pair(FRESHNESS, freshnessOf(sources)),
    note: NOTE,
  };
}

// ── session / errors ───────────────────────────────────────────────────────────────────────────────
export const publicSession = version => ({ public: true, auth: 'off', version });

// ── closed-vocabulary check ────────────────────────────────────────────────────────────────────────
const VOCAB = new Set([
  ...PUBLIC_TEAMS.flat(), ...Object.keys(STATUS), ...Object.values(STATUS), ...Object.keys(GRADE), ...Object.values(GRADE),
  ...Object.keys(EXECUTION), ...Object.values(EXECUTION), ...Object.keys(STEP_STATE), ...Object.values(STEP_STATE),
  ...STEPS.flat(), ...PENDING.flat(), ...Object.keys(FRESHNESS), ...Object.values(FRESHNESS), PROJECT_LABEL, NOTE,
  'tc-live-public/1', 'tc-board-public/1', 'off', 'ok', 'houdini-production-control', '없음', '조회 전용 서비스', '잘못된 주소', '허용되지 않은 호스트', '조회 실패 — 내부 상세 정보는 제공하지 않음',
]);
const KEYS = new Set(['schema', 'public', 'teams', 'team', 'label', 'status', 'grade', 'execution', 'key', 'freshness', 'note', 'project', 'stage', 'state', 'open_tasks', 'pending', 'count', 'auth', 'version', 'service', 'error']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]{1,20})?$/;

// returns a list of problems (empty = clean): unknown keys, strings outside the vocabulary, numbers > 99
export function checkPublic(value, where = '$', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => checkPublic(v, `${where}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!KEYS.has(k)) out.push(`${where}.${k}: 허용 목록에 없는 필드`);
      checkPublic(v, `${where}.${k}`, out);
    }
  } else if (typeof value === 'string') {
    if (!VOCAB.has(value) && !(where.endsWith('.version') && SEMVER.test(value))) out.push(`${where}: 허용 어휘 밖 문자열`);
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 99) out.push(`${where}: 허용 범위 밖 숫자`);
  } else if (!(typeof value === 'boolean' || value === null)) out.push(`${where}: 허용되지 않는 값`);
  return out;
}

// text bodies (HTML / JS / CSS) and headers: patterns that must never appear in anything served publicly
export const LEAK_PATTERNS = [
  ['작업 번호', /\bTC-(?!PROD\b|QA\b|WORK\b|DASH\b)[0-9A-Z]{2,8}-\d{2,}/],
  ['ISO 시각', /\b20\d\d-\d\d-\d\dT\d\d:\d\d/],
  ['시:분', /(?<![\d.])(?:[01]?\d|2[0-3]):[0-5]\d(?![\d])/],
  ['내부 경로', /(?:\/(?:home|srv|nfs|mnt|tmp|volume\d|Users)\/|[A-Z]:\\|\\\\[\w.-]+\\)/],
  ['긴 16진 식별자', /\b[a-f0-9]{12,}\b/],
  ['PID', /\bpid\b/i],
  ['파일 이름', /\b[\w.-]+\.(?:bat|json|md|log|py|sh|mjs|png|mp4)\b(?!\()/], // r.json() in page code is a call, not a file
];
export function scanText(text, extraTerms = []) {
  const hits = LEAK_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);
  for (const t of extraTerms) if (t && t.length >= 3 && text.toLowerCase().includes(t.toLowerCase())) hits.push(`비공개 이름(${t.length}자)`);
  return hits;
}
