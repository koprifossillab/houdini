// Read-only view of the team session collector output (team_live.json, written on the host by
// scripts/team_live_collect.py). The web service never sees /proc, the Claude registry or transcripts;
// it only re-validates this one summary, whitelists its fields and re-applies the freshness rule:
// when the collector itself is late, no team is shown as RUNNING or IDLE.
import path from 'node:path';
import { clean, count, iso, readJson } from './sanitize.mjs';

export const TEAM_IDS = ['TC-PROD', 'TC-QA', 'TC-WORK'];
export const EXEC_STATES = ['RUNNING', 'IDLE', 'STOPPED', 'STALE', 'UNKNOWN'];
export const TEAM_LIVE_STALE_S = 180;

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const sid = v => (typeof v === 'string' && /^[0-9a-f]{8}$/.test(v) ? v : null);
const name = v => (typeof v === 'string' && /^[\w .()-]{1,60}$/.test(v) ? v : null);
const commit = v => (typeof v === 'string' && /^[a-f0-9]{7,40}$/.test(v) ? v : null);
const TOK = ['input', 'output', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'total_tokens', 'requests', 'unpriced_requests'];

function tokens(t) {
  if (!t || typeof t !== 'object') return null;
  const o = {};
  for (const k of TOK) o[k] = count(t[k]) ?? 0;
  o.cost_usd = num(t.cost_usd); o.cost_krw = num(t.cost_krw);
  return o;
}
const windows = w => (w && typeof w === 'object' ? Object.fromEntries(['last_5m', 'last_60m', 'today_kst', 'all'].map(k => [k, tokens(w[k])])) : null);
const rate = r => (r && typeof r === 'object' ? { tokens_per_min: num(r.tokens_per_min), output_per_min: num(r.output_per_min), usd_per_hour: num(r.usd_per_hour), krw_per_hour: num(r.krw_per_hour) } : null);
const decision = d => (d && typeof d === 'object' ? { state: clean(d.state, 30) || 'unknown', basis: clean(d.basis, 200) || null, evidence_ref: clean(d.evidence_ref, 200) || null, recorded_at: iso(d.recorded_at) } : null);
const prevSession = p => (p && typeof p === 'object' ? { id: sid(p.id), name: name(p.name), bound_at: iso(p.bound_at), stopped_at: iso(p.stopped_at), stop_basis: clean(p.stop_basis, 160) || null, last_activity_at: iso(p.last_activity_at) } : null);

function team(t, collectorFresh) {
  const ex = t.execution || {};
  let state = EXEC_STATES.includes(ex.state) ? ex.state : 'UNKNOWN';
  let basis = clean(ex.basis, 200) || '근거 없음';
  if (!collectorFresh && (state === 'RUNNING' || state === 'IDLE')) {
    basis = `수집기 갱신 지연 — 마지막 수집 때 ${state === 'RUNNING' ? '실행 중' : '대기'}였으나 지금 상태는 확인할 수 없음`;
    state = 'STALE';
  }
  const s = t.session && typeof t.session === 'object' ? t.session : null;
  const h = t.handoff && typeof t.handoff === 'object' ? t.handoff : {};
  return {
    team_id: t.team_id, label: clean(t.label, 60) || t.team_id, duty: clean(t.duty, 120) || null,
    execution: { state, basis, reported_state: ex.state, duplicate_live_sessions: count(ex.duplicate_live_sessions) ?? 0 },
    session: s ? { id: sid(s.id), name: name(s.name), kind: clean(s.kind, 20), start: clean(s.start, 40), binding: ['verified', 'name_only', 'conflict'].includes(s.binding) ? s.binding : 'name_only', started_at: iso(s.started_at), last_activity_at: iso(s.last_activity_at), reported_status: clean(s.reported_status, 12) } : null,
    connected_since: iso(t.connected_since),
    previous_session: prevSession(t.previous_session),
    handoff: h.available ? {
      available: true, owner_submitted: !!h.owner_submitted, placeholder: !!h.placeholder, recorded_at: iso(h.recorded_at),
      task_id: clean(h.task_id, 120) || null, commit: commit(h.commit), last_confirmed_state: clean(h.last_confirmed_state, 300) || null,
      next: (Array.isArray(h.next) ? h.next : []).slice(0, 5).map(x => clean(String(x), 200)).filter(Boolean),
      technical_completion: decision(h.technical_completion), independent_physics: decision(h.independent_physics), director_decision: decision(h.director_decision),
      source: clean(h.source, 80),
    } : { available: false, label: clean(h.label, 120) || '팀 기록 없음' },
    tokens: windows(t.tokens), rate: rate(t.rate),
  };
}

export async function teamLiveView(dir, now = Date.now()) {
  const base = { checked_at: new Date(now).toISOString(), source: '팀 세션 수집기 (호스트 · 읽기 전용)' };
  const unknownTeams = why => TEAM_IDS.map(id => ({ team_id: id, label: id, execution: { state: 'UNKNOWN', basis: why }, session: null, handoff: { available: false, label: why }, tokens: null }));
  if (!dir) return { ...base, state: 'missing', message: '팀 세션 수집 경로가 설정되지 않음', teams: unknownTeams('팀 세션 수집기 미연결') };
  let doc;
  try { doc = await readJson(path.join(dir, 'team_live.json'), 2 * 1024 * 1024); } catch (e) {
    const missing = e.code === 'ENOENT';
    return { ...base, state: missing ? 'missing' : 'error', message: missing ? '팀 세션 수집 파일 없음' : '팀 세션 수집 파일을 읽을 수 없음', teams: unknownTeams('팀 세션 수집 자료 없음') };
  }
  const gen = iso(doc?.generated_at);
  if (!doc || doc.schema !== 'tc-team-live/1' || !gen || !Array.isArray(doc.teams)) {
    return { ...base, state: 'error', message: '팀 세션 수집 파일 형식 오류', teams: unknownTeams('형식 오류') };
  }
  const age = Math.max(0, Math.floor((now - Date.parse(gen)) / 1000));
  const fresh = age <= TEAM_LIVE_STALE_S;
  const teams = TEAM_IDS.map(id => doc.teams.find(t => t?.team_id === id)).map((t, i) => (t ? team(t, fresh) : unknownTeams('수집 자료에 팀 없음')[i]));
  const tk = doc.tokens || {};
  const fx = tk.fx || {};
  return {
    ...base, state: fresh ? 'live' : 'stale', generated_at: gen, age_s: age,
    message: fresh ? '정상 수집' : `수집기 갱신 지연 (${age}초 전 자료)`,
    teams,
    pc_houdini: { state: 'UNKNOWN', basis: clean(doc.pc_houdini?.basis, 200) || '사용자 PC Houdini 연결 없음' },
    unbound_live_sessions: count(doc.unbound_live_sessions) ?? 0,
    events: (Array.isArray(doc.events) ? doc.events : []).slice(-12).map(e => ({ at: iso(e.at), team: TEAM_IDS.includes(e.team) ? e.team : null, event: ['connected', 'stopped', 'state'].includes(e.event) ? e.event : null, session: sid(e.session), name: name(e.name), from: EXEC_STATES.includes(e.frm) ? e.frm : null, to: EXEC_STATES.includes(e.to) ? e.to : null, basis: clean(e.basis, 160) || null })).filter(e => e.at && e.team && e.event),
    tokens: {
      server: windows(tk.server), server_rate: rate(tk.server?.rate), houdini: windows(tk.houdini), houdini_rate: rate(tk.houdini?.rate), unassigned_houdini: windows(tk.unassigned_houdini),
      sessions: (Array.isArray(tk.sessions) ? tk.sessions : []).slice(0, 12).map(s => ({ id: sid(s.id), name: name(s.name), team: TEAM_IDS.includes(s.team) ? s.team : null, houdini: !!s.houdini, first_at: iso(s.first_at), last_at: iso(s.last_at), ...tokens(s) })),
      models: Object.fromEntries(Object.entries(tk.models || {}).filter(([m]) => /^[\w.-]{1,40}$/.test(m)).slice(0, 8).map(([m, v]) => [m, tokens(v)])),
      pricing: { basis: clean(tk.pricing?.basis, 200), checked: clean(tk.pricing?.checked, 20), fast_mode: clean(tk.pricing?.fast_mode, 20),
        table: Object.fromEntries(Object.entries(tk.pricing?.table || {}).filter(([m]) => /^[\w.-]{1,40}$/.test(m)).map(([m, p]) => [m, { input: num(p.input), output: num(p.output), cache_read: num(p.cache_read), cache_write_5m: num(p.cache_write_5m), cache_write_1h: num(p.cache_write_1h) }])) },
      fx: { krw_per_usd: num(fx.krw_per_usd), basis: clean(fx.basis, 200), as_of: clean(fx.as_of, 20) },
      scope: clean(tk.scope, 160),
    },
  };
}
