// Project roadmap (TC-DASH-010) — read only.
//
// A roadmap is the director-approved plan of a project: its stages, the tasks of each stage, what "done" means,
// and who is waiting for whom. It lives apart from the handoff cards, one file per approved version:
//   <handoff dir>/ROADMAP/<project id>/v001.json, v002.json, …   (never edited; a change is a new version)
// The card readers only read the team folders, so these files never reach the card views or the card checker.
//
// Rules (director, TC-DASH-010):
//   - stage and task states come ONLY from the newest roadmap version. Cards never move a stage or close a task;
//     a card newer than the roadmap is shown next to it and flagged "로드맵 갱신 검토 필요".
//   - verdicts are shown with their scope (technical / visual / …); a technical PASS is never shown as done.
//   - no completion percentage and no schedule unless the roadmap itself gives one with a basis.
//   - when the linked cards are missing or older than the live window, the task's live evidence is "미확인"
//     with the time of the last evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, iso, readBounded } from './sanitize.mjs';

export const STAGE_STATES = { done: '완료', in_progress: '진행', waiting: '대기' };
export const TASK_STATES = { planned: '예정', in_progress: '진행', qa_wait: 'QA 대기', director_wait: '감독 대기', user_wait: '사용자 대기', blocked: '차단', done: '완료', on_hold: '보류' };
export const RESOLUTION = { unresolved: '미해결', resolved: '해결' };
// verdicts the ROADMAP itself records (the director's judgement), kept apart from verdicts found on cards
export const RM_VERDICTS = { PASS: 'PASS', FAIL: 'FAIL', REVIEW: 'REVIEW', pending: '판정 전' };
const TEAMS = { 'TC-PROD': '① PROD', 'TC-QA': '② QA', 'TC-WORK': '③ WORK', 'TC-DASH': '④ DASH', director: '감독', user: '사용자' };
const SCOPES = { technical: '기술', visual: '시각', physics: '물리', selfcheck: '자체 검사', run: '실행' };
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const VFILE = /^v(\d{3})\.json$/;
const TASK_ID = /^[A-Za-z0-9][\w.-]{0,40}$/;
const LIVE_MS = 2 * 3600 * 1000;
const MAX_VERSIONS = 200;

const pick = (v, map) => (Object.hasOwn(map, v) ? v : null);
const list = (v, n, f) => (Array.isArray(v) ? v.slice(0, n).map(f).filter(x => x !== null && x !== '') : []);
const text = (v, n = 300) => clean(typeof v === 'string' ? v : '', n);

function parseTask(t) {
  if (!t || typeof t !== 'object' || !TASK_ID.test(String(t.id || ''))) return null;
  const status = pick(t.status, TASK_STATES);
  if (!status) return null;
  const links = t.links && typeof t.links === 'object' ? t.links : {};
  return {
    id: t.id, name: text(t.name, 120), stage: Number.isInteger(t.stage) ? t.stage : null,
    team: pick(t.team, TEAMS), team_label: TEAMS[t.team] || null,
    status, status_label: TASK_STATES[status],
    resolution: pick(t.resolution, RESOLUTION), resolution_label: RESOLUTION[t.resolution] || null,
    hold: status === 'on_hold' && t.hold && typeof t.hold === 'object' ? { reason: text(t.hold.reason, 200), resume: text(t.hold.resume, 200) } : null,
    result: text(t.result), next: text(t.next),
    done_when: list(t.done_when, 8, x => text(x, 160)),
    depends_on: list(t.depends_on, 8, x => (TASK_ID.test(String(x)) ? x : null)),
    links: { task_ids: list(links.task_ids, 6, x => (/^TC-[0-9A-Z]{2,5}-\d{3}[A-Za-z0-9]{0,3}$/.test(String(x)) ? x : null)), candidates: list(links.candidates, 6, x => text(x, 60)) },
    // a schedule is shown only together with its basis
    schedule: t.schedule && typeof t.schedule === 'object' && t.schedule.basis ? { text: text(t.schedule.text, 80), basis: text(t.schedule.basis, 160) } : null,
    kind: text(t.kind, 40) || null,
    verdicts: list(t.verdicts, 6, v => (v && typeof v === 'object' && Object.hasOwn(SCOPES, v.scope) && Object.hasOwn(RM_VERDICTS, v.value)
      ? { scope: v.scope, scope_label: SCOPES[v.scope], value: v.value, value_label: RM_VERDICTS[v.value], basis: text(v.basis, 160) } : null)),
    basis: text(t.basis, 200),
  };
}

export function parseRoadmap(doc, project, file) {
  const m = VFILE.exec(file);
  if (!m || !doc || doc.schema !== 'tc-roadmap/1' || !doc.project || doc.project.id !== project) return null;
  if (doc.version !== Number(m[1])) return null; // the file name and the version inside must agree
  const ap = doc.approved && typeof doc.approved === 'object' ? doc.approved : null;
  const approvedAt = iso(ap?.at);
  // only a director-approved plan that cites where the approval is (② QA REVIEW 1: source.ref required)
  if (!ap || !approvedAt || ap.by !== 'director' || !(ap.source && typeof ap.source === 'object' && text(ap.source.ref, 160).trim())) return null;
  // ② QA REVIEW 2: the director's approval time and ④'s transcription time are different facts. A file written
  // before this rule has only `at`, written at transcription: it is read as the transcription time and the
  // approval time is "not recorded".
  const transcribedAt = iso(ap.transcribed_at) || (ap.transcribed_by ? approvedAt : null);
  const approvalAt = ap.transcribed_at || !ap.transcribed_by ? approvedAt : null;
  const sha = /^[a-f0-9]{64}$/.test(String(ap.source.sha256 || '')) ? ap.source.sha256.slice(0, 16) : null;
  const tasks = list(doc.tasks, 120, parseTask);
  const stages = list(doc.stages, 20, s => {
    if (!s || typeof s !== 'object' || !Number.isInteger(s.no)) return null;
    const status = pick(s.status, STAGE_STATES);
    if (!status) return null;
    return { no: s.no, id: ID.test(String(s.id || '')) ? s.id : `stage-${s.no}`, phase: /^[A-Z]$/.test(String(s.phase || '')) ? s.phase : null, name: text(s.name, 80), status, status_label: STAGE_STATES[status],
      exit: list(s.exit, 8, x => text(x, 200)), note: text(s.note, 200), tasks: tasks.filter(t => t.stage === s.no).map(t => t.id) };
  }).sort((a, b) => a.no - b.no);
  if (!stages.length) return null;
  // top-level phases (e.g. A: Houdini effect test, B: Blender geologic map); the stages are the detail of one phase
  const phases = list(doc.phases, 10, ph => {
    if (!ph || typeof ph !== 'object' || !/^[A-Z]$/.test(String(ph.id || ''))) return null;
    const status = pick(ph.status, STAGE_STATES);
    return status ? { id: ph.id, name: text(ph.name, 80), status, status_label: STAGE_STATES[status], note: text(ph.note, 200), depends_on: /^[A-Z]$/.test(String(ph.depends_on || '')) ? ph.depends_on : null } : null;
  });
  return {
    phases,
    file, version: doc.version, previous: Number.isInteger(doc.previous) ? doc.previous : null,
    project: { id: project, name: text(doc.project.name, 80), goal: text(doc.project.goal, 400) },
    // at = the director's approval (null = not recorded); recorded_at = when this version's content was fixed;
    // original_checked = false means the screen says the original was not matched yet
    approved: { by: 'director', directive: text(ap.directive, 40),
      at: approvalAt, at_precision: ap.at_precision === 'date' ? 'date' : 'time',
      transcribed_by: text(ap.transcribed_by, 20) || null, transcribed_at: transcribedAt,
      recorded_at: transcribedAt || approvedAt,
      source: { ref: text(ap.source.ref, 160).trim(), sha256: sha },
      // set by buildRoadmapView against the director originals list (INDEX); a SHA written here is only a claim
      original: { state: sha ? 'unchecked' : 'not_recorded' }, original_checked: false },
    stages, tasks,
    priority: list(doc.priority, 6, x => (TASK_ID.test(String(x)) ? x : null)),
    next_steps: list(doc.next_steps, 8, x => text(x, 200)),
    changes: list(doc.changes, 50, c => (c && typeof c === 'object' ? { version: Number.isInteger(c.version) ? c.version : null, at: iso(c.at), what: text(c.what, 200), basis: text(c.basis, 160) } : null)),
  };
}

export async function readRoadmaps(handoffDir) {
  const root = handoffDir ? path.join(handoffDir, 'ROADMAP') : null;
  if (!root) return { state: 'missing', message: '로드맵 폴더가 설정되지 않음', projects: [] };
  let dirs;
  try { dirs = (await fs.readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && !d.isSymbolicLink() && ID.test(d.name)); } catch { return { state: 'missing', message: '등록된 로드맵 없음', projects: [] }; }
  const projects = [];
  let invalid = 0;
  for (const d of dirs.slice(0, 20)) {
    let files;
    try { files = (await fs.readdir(path.join(root, d.name), { withFileTypes: true })).filter(f => f.isFile() && !f.isSymbolicLink() && VFILE.test(f.name)).map(f => f.name).sort().slice(-MAX_VERSIONS); } catch { continue; }
    const versions = [];
    for (const f of files) {
      let doc;
      try { doc = JSON.parse((await readBounded(path.join(root, d.name, f), 256 * 1024)).toString('utf8')); } catch { doc = null; }
      const r = parseRoadmap(doc, d.name, f);
      if (r) versions.push(r); else invalid += 1;
    }
    if (versions.length) projects.push({ id: d.name, versions });
  }
  return { state: projects.length ? 'ok' : 'missing', message: invalid ? `형식이 맞지 않거나 승인 기록이 없는 로드맵 파일 ${invalid}건은 쓰지 않음` : '감독 승인 로드맵', projects, invalid };
}

// ── cards → per-task evidence (shown beside the roadmap state, never replacing it) ──────────────────────
function evidenceFor(task, cards, recordedAt, now) {
  const { task_ids: ids, candidates: cands } = task.links;
  if (!ids.length) return { state: 'none', label: '연결된 인계 카드 없음 — 로드맵 기재 내용만', grade: 'claim' };
  // a card's candidate may carry a commit after the name ("p0r-A2 c3a97df"): match on the name only
  const candOf = c => String(c.candidate || '').split(/\s+/)[0];
  const mine = cards.filter(c => ids.includes(c.task_id) && (!cands.length || cands.includes(candOf(c)))).sort((a, b) => a.at.localeCompare(b.at));
  if (!mine.length) return { state: 'none', label: '연결된 카드 없음 — 미확인', grade: 'none' };
  const last = mine.at(-1);
  // newest verdict per scope, and every FAIL kept separately (never merged into a PASS)
  const byScope = {};
  for (const c of mine) if (c.verdict && c.verdict_scope) byScope[c.verdict_scope] = { verdict: c.verdict, scope: c.verdict_scope, scope_label: SCOPES[c.verdict_scope] || c.verdict_scope, team: TEAMS[c.team] || c.team, at: c.at, title: c.title };
  const fails = mine.filter(c => c.verdict === 'FAIL').slice(-5).map(c => ({ scope_label: SCOPES[c.verdict_scope] || c.verdict_scope || '범위 없음', team: TEAMS[c.team] || c.team, at: c.at, title: c.title }));
  const future = Date.parse(last.at) > now + 60000;
  const stale = now - Date.parse(last.at) > LIVE_MS;
  return {
    state: future ? 'future' : stale ? 'stale' : 'live',
    label: future ? `미래 시각 카드 — 지금 상태 미확인 (${last.at})` : stale ? `최근 2시간 안에 새 카드 없음 — 지금 상태 미확인 (마지막 근거 ${last.at})` : '최근 카드 있음',
    last: { team: TEAMS[last.team] || last.team, at: last.at, state: last.state, verdict: last.verdict, scope_label: last.verdict_scope ? SCOPES[last.verdict_scope] : null, title: last.title, to: TEAMS[last.to] || null, grade: last.grade },
    verdicts: Object.values(byScope),
    visual_verdict: byScope.visual?.verdict || null,
    fails,
    grade: last.grade,
    newer_than_roadmap: last.at > recordedAt, // newer than this roadmap version's content
  };
}

// ② QA 재확인(c445b25) 잔여 1: "원문 대조됨" only when the director originals list has this directive, its file
// content matched the list, and the roadmap's SHA equals the listed one (SHA match proves content, not identity).
export const ORIGINAL_LABEL = { not_recorded: '원문 SHA 미기재 — 원문 대조 전', not_in_index: '원문 SHA 기재 · 원문 목록에 없음 — 대조 전', mismatch: '원문 SHA 불일치 — 대조 실패', matched: '원문 목록과 SHA 일치 (내용 일치 · 신원 증명 아님)', unchecked: '원문 대조 전' };
function originalOf(approved, originals) {
  if (!approved.source.sha256) return 'not_recorded';
  const o = originals?.byDirective?.get?.(approved.directive);
  if (!o) return 'not_in_index';
  return o.content === 'matched' && o.sha256 === approved.source.sha256 ? 'matched' : 'mismatch';
}

export function buildRoadmapView(read, cards = [], now = Date.now(), originals = null) {
  if (read.state !== 'ok') return { state: read.state, message: read.message, projects: [] };
  const projects = read.projects.map(p => {
    const versions = p.versions.slice().sort((a, b) => a.version - b.version);
    const cur0 = versions.at(-1);
    const ost = originalOf(cur0.approved, originals);
    const cur = { ...cur0, approved: { ...cur0.approved, original: { state: ost, label: ORIGINAL_LABEL[ost] }, original_checked: ost === 'matched' } };
    const count = s => cur.stages.filter(x => x.status === s).length;
    const current = cur.stages.find(s => s.status === 'in_progress') || null;
    const tasks = cur.tasks.map(t => ({ ...t, evidence: evidenceFor(t, cards, cur.approved.recorded_at, now) }));
    const curPhase = cur.phases.find(x => x.status === 'in_progress') || null;
    return {
      id: p.id, project: cur.project, version: cur.version, approved: cur.approved,
      phases: cur.phases.map(ph => ({ ...ph, stage_count: cur.stages.filter(s => s.phase === ph.id).length })),
      current_phase: curPhase ? { id: curPhase.id, name: curPhase.name } : null,
      counts: { total: cur.stages.length, done: count('done'), in_progress: count('in_progress'), waiting: count('waiting') },
      current_stage: current ? { no: current.no, name: current.name } : null,
      stages: cur.stages.map(s => ({ ...s, task_count: s.tasks.length, task_done: tasks.filter(t => t.stage === s.no && t.status === 'done').length })),
      tasks,
      priority: cur.priority.map(id => tasks.find(t => t.id === id)).filter(Boolean),
      waiting_director: tasks.filter(t => t.status === 'director_wait'),
      next_steps: cur.next_steps,
      review_needed: tasks.filter(t => t.evidence.newer_than_roadmap).map(t => t.id),
      changes: cur.changes,
      history: versions.map(v => ({ version: v.version, file: v.file, approved_at: v.approved.at, recorded_at: v.approved.recorded_at, directive: v.approved.directive })),
    };
  });
  return { state: 'ok', message: read.message, projects };
}
