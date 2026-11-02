// Read-only view of the existing one-minute collector output (status.json + reports/<id>.md).
// The collector, its cron and its directory are never written. Structure follows the Work prototype's
// snapshot(); this version also keeps the report file basename (server-side only) so a missing
// collector copy can fall back to the production ledger's redacted report of the same name.
import path from 'node:path';
import { clean, count, iso, hex, readBounded, readJson } from './sanitize.mjs';

export const STALE_AFTER_S = 180;
const STATES = new Set(['running', 'waiting', 'done', 'error', 'unknown', 'outside']);
export const TEAM_KEYS = ['houdini', 'verify', 'blender', 'work'];

function reportRef(r) {
  if (!r || !hex(r.id, 16)) return null;
  const file = typeof r.file === 'string' && /^[\w.-]{1,120}\.md$/.test(r.file) ? r.file : null;
  return { id: r.id, title: clean(r.title, 180), team: TEAM_KEYS.includes(r.team) ? r.team : 'unknown', mtime: iso(r.mtime), stage: clean(r.stage, 20) || null, _file: file };
}

export async function collectorSnapshot(dir, now = Date.now(), example = null) {
  const checked_at = new Date(now).toISOString();
  const base = example
    ? { provenance: 'example', source: '예시 데이터 — 실제 수집 자료 아님', checked_at, generated_at: null, age_s: null, stage: null, teams: [], reports: [], relay: null }
    : { provenance: 'collected', source: '기존 1분 수집기 (읽기 전용)', checked_at, generated_at: null, age_s: null, stage: null, teams: [], reports: [], relay: null };
  if (!dir && !example) return { ...base, state: 'missing', message: '수집 데이터 경로가 설정되지 않음' };
  let doc = example;
  if (!doc) {
    try {
      doc = await readJson(path.join(dir, 'status.json'));
    } catch (e) {
      return { ...base, state: e.code === 'ENOENT' ? 'missing' : 'error', message: e.code === 'ENOENT' ? '수집 데이터 파일 없음' : '수집 데이터를 읽을 수 없음 (형식·크기 오류)' };
    }
  }
  if (!doc || doc.schema !== 'tc-dash/1' || !Array.isArray(doc.teams) || !iso(doc.generated_at)) {
    return { ...base, state: 'error', message: '수집 데이터 형식 또는 생성 시각 오류' };
  }
  const delta = now - Date.parse(doc.generated_at);
  if (delta < -60000) return { ...base, state: 'error', message: '수집 시각이 미래임 — 서버 시각 확인 필요' };
  const age = Math.max(0, Math.floor(delta / 1000));
  const stale = age > STALE_AFTER_S;
  const reports = Array.isArray(doc.reports) ? doc.reports.slice(0, 40).map(reportRef).filter(Boolean) : [];
  const teams = doc.teams
    .filter(t => t && TEAM_KEYS.includes(t.key))
    .slice(0, 8)
    .map(t => {
      const p = t.progress && typeof t.progress === 'object'
        ? { total: count(t.progress.total), done: count(t.progress.done), running: stale ? null : count(t.progress.running), failed: count(t.progress.failed), waiting: count(t.progress.waiting) }
        : null;
      return {
        key: t.key,
        state: stale ? 'unknown' : STATES.has(t.state) ? t.state : 'unknown',
        reported_state: STATES.has(t.state) ? t.state : 'unknown',
        task: clean(t.task),
        next: clean(t.next),
        stage: clean(t.stage, 20) || null,
        evidence: Array.isArray(t.evidence) ? t.evidence.slice(0, 8).map(x => clean(x, 200)) : [],
        last_activity: iso(t.last_activity),
        progress: p,
        report: reportRef(t.report),
      };
    });
  const relay = doc.relay && typeof doc.relay === 'object' ? { at: TEAM_KEYS.includes(doc.relay.at) ? doc.relay.at : null, why: clean(doc.relay.why, 200) } : null;
  return {
    ...base,
    state: stale ? 'stale' : 'live',
    message: stale ? `${STALE_AFTER_S / 60}분 넘게 갱신되지 않음 — 현재 활동 확인 불가` : '1분 단위 수집 자료 · 초 단위 실시간 중계 아님',
    generated_at: iso(doc.generated_at),
    age_s: age,
    stage: clean(doc.stage, 30) || null,
    teams,
    reports,
    relay,
  };
}

// Collector copy of a report, or null. Only ids present in the snapshot are readable.
export async function collectorReport(dir, snap, id) {
  if (!dir || !hex(id, 16)) return null;
  const known = snap.reports.some(r => r.id === id) || snap.teams.some(t => t.report?.id === id);
  if (!known) return null;
  try {
    return (await readBounded(path.join(dir, 'reports', `${id}.md`), 400 * 1024)).toString('utf8');
  } catch {
    return null;
  }
}

// Strip server-only fields before sending.
export function publicSnapshot(s) {
  const strip = r => (r ? { id: r.id, title: r.title, team: r.team, mtime: r.mtime, stage: r.stage } : null);
  return { ...s, reports: s.reports.map(strip), teams: s.teams.map(t => ({ ...t, report: strip(t.report) })) };
}
