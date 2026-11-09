// Handoff cards (tc-handoff/1) and decision records (tc-decision/1) — read only.
// Teams write a card at the end of each report (the same four lines: done / next / to / user action).
// Decisions are the ONLY source that confirms an approval, a rejection, a hold, a closure or the baseline.
// The control room never writes either kind (no write API until an authentication method is approved).
import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, hex, iso, readBounded } from './sanitize.mjs';

export const TEAMS = ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH'];
export const CARD_STATES = ['in_progress', 'handed_off', 'blocked', 'done'];
export const VERDICTS = ['PASS', 'FAIL', 'REVIEW', 'UNVERIFIED'];
export const VERDICT_SCOPES = ['technical', 'visual', 'physics', 'selfcheck', 'run'];
export const TARGETS = ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH', 'director', 'user'];
export const ISSUE_SCOPES = ['project', 'candidate', 'track'];
export const SEVERITIES = ['blocking', 'fail', 'review', 'known'];
export const DECISION_KINDS = ['directive', 'approval', 'rejection', 'hold', 'closure', 'baseline', 'candidate_status'];
export const CANDIDATE_STATUS = ['baseline', 'backup', 'candidate', 'rejected', 'stopped'];
const EVIDENCE_KINDS = ['report', 'verdict', 'file', 'nas', 'decision', 'commit'];
const FILE = /^[\w.-]{1,120}\.json$/;
const TASK = /^TC-[0-9A-Z]{2,5}-\d{3}[A-Za-z0-9]{0,3}$/;
const CARD_LIMIT = 64 * 1024;
const MAX_FILES = 400;

const pick = (v, list) => (list.includes(v) ? v : null);
const at = v => iso(v);
const precision = v => (v === 'date' ? 'date' : 'time');

// "<root folder>/<TC… folder>[/<sub>…]/<file>" → "<TC… folder> › <file>": readable without exposing the
// root (the generic path mask would otherwise hide the whole reference). Anything else goes through clean().
const NAS_REF = /^[\w-]{1,40}\/(TC[0-9A-Za-z_-]{2,120})(?:\/(?:[\w.-]+\/)*([\w.-]{1,120}))?(\s.*)?$/;
export function refText(ref) {
  const m = NAS_REF.exec(String(ref || ''));
  return m ? clean(`${m[1]}${m[2] ? ` › ${m[2]}` : ''}${m[3] || ''}`, 200) : clean(ref, 200);
}

function evidence(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map(e => (e && typeof e === 'object' ? {
    kind: pick(e.kind, EVIDENCE_KINDS) || 'file',
    ref: refText(e.ref),
    sha256: hex(e.sha256, 64)?.slice(0, 16) || null,
    at: at(e.at),
  } : null)).filter(e => e && e.ref);
}

function issues(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).map(i => (i && typeof i === 'object' && i.id && i.title ? {
    id: clean(String(i.id), 60),
    title: clean(i.title, 200),
    scope: pick(i.scope, ISSUE_SCOPES) || 'project',
    candidate: clean(i.candidate, 60) || null,
    severity: pick(i.severity, SEVERITIES) || 'review',
    resolved: i.resolved === true,
    note: clean(i.note, 200),
  } : null)).filter(Boolean);
}

export function parseCard(doc, team, file) {
  if (!doc || doc.schema !== 'tc-handoff/1') return null;
  if (doc.team !== team || !TASK.test(String(doc.task_id || ''))) return null;
  const state = pick(doc.state, CARD_STATES);
  const when = at(doc.at);
  if (!state || !when) return null;
  const ev = evidence(doc.evidence);
  return {
    file,
    team,
    task_id: doc.task_id,
    title: clean(doc.title, 200),
    state,
    verdict: pick(doc.verdict, VERDICTS),
    verdict_scope: pick(doc.verdict_scope, VERDICT_SCOPES),
    candidate: clean(doc.candidate, 60) || null,
    done: clean(doc.done, 300),
    next: clean(doc.next, 300),
    to: pick(doc.to, TARGETS),
    user_action: clean(doc.user_action, 300) || null,
    evidence: ev,
    issues: issues(doc.issues),
    at: when,
    at_precision: precision(doc.at_precision),
    transcribed_by: pick(doc.transcribed_by, TEAMS),
    // a card with no evidence is shown as an unsupported claim, never as confirmed
    grade: ev.length ? 'confirmed' : 'claim',
  };
}

export function parseDecision(doc, file) {
  if (!doc || doc.schema !== 'tc-decision/1') return null;
  const kind = pick(doc.kind, DECISION_KINDS);
  const when = at(doc.at);
  const src = doc.source && typeof doc.source === 'object' ? { ref: refText(doc.source.ref), sha256: hex(doc.source.sha256, 64)?.slice(0, 16) || null } : null;
  // a decision without a cited source is not accepted at all
  if (!kind || !when || !src?.ref) return null;
  if (doc.task_id && !TASK.test(String(doc.task_id))) return null;
  const out = {
    file,
    id: clean(String(doc.id || file), 80),
    task_id: doc.task_id || null,
    kind,
    subject: clean(doc.subject, 300),
    by: doc.by === 'owner' ? 'owner' : 'director',
    at: when,
    at_precision: precision(doc.at_precision),
    source: src,
    transcribed_by: pick(doc.transcribed_by, TEAMS),
    grade: 'confirmed',
  };
  if (kind === 'baseline') {
    const b = doc.baseline || {};
    if (!b.name) return null;
    out.baseline = { name: clean(b.name, 60), commit: /^[a-f0-9]{7,40}$/.test(String(b.commit || '')) ? b.commit.slice(0, 12) : null, label: clean(b.label, 120) };
  }
  if (kind === 'candidate_status') {
    const c = doc.candidate || {};
    const status = pick(c.status, CANDIDATE_STATUS);
    if (!c.name || !status) return null;
    out.candidate = { name: clean(c.name, 60), status, commit: /^[a-f0-9]{7,40}$/.test(String(c.commit || '')) ? c.commit.slice(0, 12) : null, note: clean(c.note, 200) };
  }
  return out;
}

async function jsonFiles(dir) {
  let list;
  try { list = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { return { missing: e.code === 'ENOENT', files: [] }; }
  return { missing: false, files: list.filter(e => e.isFile() && !e.isSymbolicLink() && FILE.test(e.name)).map(e => e.name).sort().slice(-MAX_FILES) };
}

async function readDoc(p) {
  try { return JSON.parse((await readBounded(p, CARD_LIMIT)).toString('utf8')); } catch { return undefined; }
}

export async function readCards(dir) {
  if (!dir) return { state: 'missing', message: '인계 카드 폴더가 설정되지 않음', items: [], invalid: 0 };
  let found = false;
  const items = [];
  let invalid = 0;
  for (const team of TEAMS) {
    const { missing, files } = await jsonFiles(path.join(dir, team));
    if (!missing) found = true;
    for (const f of files) {
      const c = parseCard(await readDoc(path.join(dir, team, f)), team, f);
      if (c) items.push(c); else invalid += 1;
    }
  }
  if (!found) return { state: 'missing', message: '인계 카드 폴더 없음', items: [], invalid: 0 };
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { state: 'ok', message: invalid ? `형식에 맞지 않는 카드 ${invalid}건은 표시하지 않음` : '인계 카드', items, invalid, newest_at: items.at(-1)?.at || null };
}

export async function readDecisions(dir) {
  if (!dir) return { state: 'missing', message: '판정 기록 폴더가 설정되지 않음', items: [], invalid: 0 };
  const { missing, files } = await jsonFiles(dir);
  if (missing) return { state: 'missing', message: '판정 기록 폴더 없음', items: [], invalid: 0 };
  const items = [];
  let invalid = 0;
  for (const f of files) {
    const d = parseDecision(await readDoc(path.join(dir, f)), f);
    if (d) items.push(d); else invalid += 1;
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { state: 'ok', message: invalid ? `근거가 없거나 형식이 틀린 기록 ${invalid}건은 표시하지 않음` : '판정 기록', items, invalid, newest_at: items.at(-1)?.at || null };
}
