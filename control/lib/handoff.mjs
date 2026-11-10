// Handoff cards (tc-handoff/1), decision records (tc-decision/1) and signed Work events — read only.
// Teams write a card at the start of a task, at every state change, at completion / verdict request and
// when a long task gains new evidence. The control room never writes cards or decisions.
//
// Provenance (TC-DASH-004 D-1) — three kinds, never merged:
//   self        — submitted by the responsible session into its team folder. The folder and the author
//                 fields are a convention only: all sessions share one server account, so the writer's
//                 identity is NOT verified and is never shown as verified.
//   signed      — produced here from a ③ Work event whose signature verified against the configured
//                 public key. Proves the record's integrity since signing, not who the signer is.
//                 A card FILE that merely claims "signed" is not trusted: it is read as self.
//   transcribed — copied by a person from another record. Needs transcribed_from (source ref + time);
//                 never shown as confirmed. Without a source it is rejected.
import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, hex, iso, readBounded } from './sanitize.mjs';
import { verifyEvent } from './work-event.mjs';

export const TEAMS = ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH'];
export const CARD_STATES = ['in_progress', 'handed_off', 'blocked', 'done'];
export const VERDICTS = ['PASS', 'FAIL', 'REVIEW', 'UNVERIFIED'];
export const VERDICT_SCOPES = ['technical', 'visual', 'physics', 'selfcheck', 'run'];
export const TARGETS = ['TC-PROD', 'TC-QA', 'TC-WORK', 'TC-DASH', 'director', 'user'];
export const ISSUE_SCOPES = ['project', 'candidate', 'track'];
export const SEVERITIES = ['blocking', 'fail', 'review', 'known'];
export const DECISION_KINDS = ['directive', 'approval', 'rejection', 'hold', 'closure', 'baseline', 'candidate_status'];
export const CANDIDATE_STATUS = ['baseline', 'backup', 'candidate', 'rejected', 'stopped'];
export const METHODS = ['self', 'signed', 'transcribed'];
const EVIDENCE_KINDS = ['report', 'verdict', 'file', 'nas', 'decision', 'commit', 'work_event'];
const FILE = /^[\w.-]{1,120}\.json$/;
const TASK = /^TC-[0-9A-Z]{2,5}-\d{3}[A-Za-z0-9]{0,3}$/;
export const DIRECTIVE = /^TC-[0-9A-Z]{2,8}(?:-[0-9A-Z]{1,8}){0,3}$/;
const CARD_LIMIT = 64 * 1024;
const MAX_FILES = 400;
// the director originals folder never appears by name in any output (TC-DASH-005)
export const DIRECTOR_FOLDER = 'TC3D_DIRECTOR_DECISIONS';

const pick = (v, list) => (list.includes(v) ? v : null);
const at = v => iso(v);
const precision = v => (v === 'date' ? 'date' : 'time');

// "<root folder>/<TC… folder>[/<sub>…]/<file>" → "<TC… folder> › <file>": readable without exposing the
// root (the generic path mask would otherwise hide the whole reference). References into the director
// originals folder are reduced to a fixed phrase — no folder or file name leaves the server.
const NAS_REF = /^[\w-]{1,40}\/(TC[0-9A-Za-z_-]{2,120})(?:\/(?:[\w.-]+\/)*([\w.-]{1,120}))?(\s.*)?$/;
export function refText(ref) {
  const s = String(ref || '');
  if (/DIRECTOR_DECISIONS/i.test(s)) return '감독 원문 보관 기록 (위치 비공개)';
  const m = NAS_REF.exec(s);
  return m ? clean(`${m[1]}${m[2] ? ` › ${m[2]}` : ''}${m[3] || ''}`, 200) : clean(s, 200);
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

const source = (s, fallbackPrecision) => (s && typeof s === 'object' && s.ref ? { ref: refText(s.ref), at: at(s.at), at_precision: s.at ? precision(s.at_precision) : fallbackPrecision, sha256: hex(s.sha256, 64)?.slice(0, 16) || null } : null);

// author block. Legacy cards (no author block) that carry transcribed_by are read as transcribed.
function author(doc) {
  const a = doc.author && typeof doc.author === 'object' ? doc.author : {};
  let method = pick(a.method, METHODS) || (doc.transcribed_by ? 'transcribed' : 'self');
  const claimedSigned = method === 'signed';
  if (claimedSigned) method = 'self'; // a file cannot make itself "signed"
  return {
    method,
    session: clean(a.session, 80) || null,
    transcribed_by: method === 'transcribed' ? (pick(a.transcribed_by || doc.transcribed_by, TEAMS) || null) : null,
    transcribed_from: method === 'transcribed' ? source(a.transcribed_from || doc.transcribed_from, 'time') : null,
    signed_claim_ignored: claimedSigned,
    identity_verified: false,
  };
}

export function gradeOf(method, ev) {
  if (method === 'signed') return 'signed';
  if (method === 'transcribed') return 'transcribed';
  return ev.length ? 'confirmed' : 'claim';
}

export function parseCard(doc, team, file) {
  if (!doc || doc.schema !== 'tc-handoff/1') return null;
  if (doc.team !== team || !TASK.test(String(doc.task_id || ''))) return null;
  const state = pick(doc.state, CARD_STATES);
  const when = at(doc.at);
  if (!state || !when) return null;
  const au = author(doc);
  // A transcription must say where it was copied from and when the original was recorded (D-1 ②, QA F1).
  //   - cards with an author block: transcribed_from {ref, at} must be written explicitly — no fallback.
  //   - legacy cards (no author block, top-level transcribed_by): the first evidence entry may stand in,
  //     but only when that entry carries its own time. The card's own time is never used as the original's.
  if (au.method === 'transcribed' && !au.transcribed_from && !(doc.author && typeof doc.author === 'object')) {
    const ev0 = Array.isArray(doc.evidence) ? doc.evidence[0] : null;
    if (ev0 && typeof ev0 === 'object' && at(ev0.at)) au.transcribed_from = source(ev0, 'time');
  }
  if (au.method === 'transcribed' && (!au.transcribed_from?.ref || !au.transcribed_from.at)) return null;
  const ev = evidence(doc.evidence);
  return {
    file, team, task_id: doc.task_id,
    title: clean(doc.title, 200), state,
    verdict: pick(doc.verdict, VERDICTS), verdict_scope: pick(doc.verdict_scope, VERDICT_SCOPES),
    candidate: clean(doc.candidate, 60) || null,
    done: clean(doc.done, 300), next: clean(doc.next, 300), to: pick(doc.to, TARGETS), user_action: clean(doc.user_action, 300) || null,
    evidence: ev, issues: issues(doc.issues),
    at: when, at_precision: precision(doc.at_precision),
    author: au,
    grade: gradeOf(au.method, ev),
  };
}

// Decisions are written by ④ from the director's text (the director works outside the server), so they
// are always transcriptions. Their validity is decided against the originals (lib/director.mjs).
export function parseDecision(doc, file) {
  if (!doc || doc.schema !== 'tc-decision/1') return null;
  const kind = pick(doc.kind, DECISION_KINDS);
  const when = at(doc.at);
  const src = doc.source && typeof doc.source === 'object' ? { ref: refText(doc.source.ref), sha256: hex(doc.source.sha256, 64)?.slice(0, 16) || null } : null;
  if (!kind || !when || !src?.ref) return null; // no cited source → not accepted at all
  if (doc.task_id && !TASK.test(String(doc.task_id))) return null;
  const out = {
    file, id: clean(String(doc.id || file), 80), task_id: doc.task_id || null,
    directive_id: DIRECTIVE.test(String(doc.directive_id || '')) ? doc.directive_id : null,
    kind, subject: clean(doc.subject, 300), by: doc.by === 'owner' ? 'owner' : 'director',
    at: when, at_precision: precision(doc.at_precision), source: src,
    transcribed_by: pick(doc.transcribed_by, TEAMS) || 'TC-DASH',
    grade: 'transcribed',
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

// opts.writtenAt (TC-DASH-008 /api/live only): also record the file's modification time, so a card whose
// written `at` lies ahead of when the file was actually written cannot jump ahead in the order.
// /api/board does not pass it, so its output is unchanged.
export async function readCards(dir, opts = {}) {
  if (!dir) return { state: 'missing', message: '인계 카드 폴더가 설정되지 않음', items: [], invalid: 0 };
  let found = false;
  const items = [];
  let invalid = 0;
  for (const team of TEAMS) {
    const { missing, files } = await jsonFiles(path.join(dir, team));
    if (!missing) found = true;
    for (const f of files) {
      const c = parseCard(await readDoc(path.join(dir, team, f)), team, f);
      if (c && opts.writtenAt) { try { c.written_at = new Date((await fs.lstat(path.join(dir, team, f))).mtimeMs).toISOString(); } catch { c.written_at = null; } }
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

// ③ signed Work events → cards (method 'signed'). Read-only conversion: the envelope files are never written,
// and the card keeps the original event identity in full — event_hash (SHA-256 of the signed payload bytes, as
// the intake reports it), sequence, previous_hash and event_id — so it can be traced back to the original.
// A failed verification produces no card.
const SIGNED_FILES = ['task-start.json', 'last-complete-start.json', 'last-complete.json', 'latest.json'];
export function cardFromEvent(p, hash) {
  const state = p.event_type === 'complete' ? 'done' : 'in_progress';
  const when = iso(p.occurred_at);
  return {
    file: `서명 Work 기록 #${p.sequence}`,
    team: 'TC-WORK',
    task_id: clean(p.task_id, 100),
    title: clean(p.summary, 200),
    state,
    verdict: p.validation === 'technical_pass' ? 'PASS' : p.validation === 'technical_fail' ? 'FAIL' : null,
    verdict_scope: p.validation === 'technical_pass' || p.validation === 'technical_fail' ? 'technical' : null,
    candidate: null,
    done: state === 'done' ? clean(p.summary, 300) : '',
    next: clean((p.next || [])[0] || '', 300),
    to: null, user_action: null,
    evidence: [{ kind: 'work_event', ref: `서명 Work 기록 #${p.sequence} · ${p.event_type} · ${hash.slice(0, 16)}`, sha256: hash.slice(0, 16), at: when },
      ...(p.artifacts || []).slice(0, 5).map(a => ({ kind: 'file', ref: clean(a.label, 120), sha256: a.sha256.slice(0, 16), at: null }))],
    issues: [],
    at: when, at_precision: 'time',
    author: { method: 'signed', session: null, transcribed_by: null, transcribed_from: null, signed_claim_ignored: false, identity_verified: false, event: { schema: 'tc-work-event/1', sequence: p.sequence, event_hash: hash, previous_hash: p.previous_hash, event_id: p.event_id, type: p.event_type, occurred_at: when } },
    grade: 'signed',
  };
}

export async function readSignedWork(dir, keyfile) {
  if (!dir || !keyfile) return { state: 'missing', message: '서명 Work 기록이 연결되지 않음', items: [], invalid: 0 };
  let key;
  try { key = await fs.readFile(keyfile); } catch { return { state: 'error', message: '서명 확인 키를 읽을 수 없음', items: [], invalid: 0 }; }
  const seen = new Map();
  let invalid = 0;
  for (const f of SIGNED_FILES) {
    let raw;
    try { raw = (await readBounded(path.join(dir, f), 40000)).toString('utf8'); } catch { continue; }
    try {
      const { payload, hash } = verifyEvent(JSON.parse(raw), key);
      if (!seen.has(hash)) seen.set(hash, cardFromEvent(payload, hash));
    } catch { invalid += 1; }
  }
  const items = [...seen.values()].filter(c => c.at).sort((a, b) => a.at.localeCompare(b.at));
  return { state: 'ok', message: invalid ? `서명 검증 실패 ${invalid}건은 표시하지 않음` : '서명 Work 기록 — 무결성 확인 · 신원 증명 아님', items, invalid, newest_at: items.at(-1)?.at || null };
}
