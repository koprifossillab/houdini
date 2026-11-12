// Thermal Collapse LIVE (감독 결정 22·23) — read-only state for the /live/ page of the control room.
//   - frame meshes: <HPC_TCLIVE_MESH_DIR>/index.json (tc-live-frames/1) + fNNNN.bin (TCM1, lib/tclive-mesh.mjs)
//   - ① progress:   HPC_TCLIVE_STATUS_FILE (tc-live-status/1), written by ① 's runner; may be absent
//   - ② QA:         confirmed verdicts on TC-QA handoff cards of the same candidate (the existing card reader)
// Rule (결정 22 4항): a frame is "① 계산 완료" only when ① 's status file lists it for the SAME model hash.
// Frames the viewer computed are "뷰어 계산", test frames "테스트 데이터"; nothing here is shown as ①'s otherwise.
// No path, file name or model code ever leaves this module: the API carries frame numbers, hashes and labels only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkMesh } from './tclive-mesh.mjs';

const SHA = /^[a-f0-9]{64}$/;
const TASK = /^TC-[0-9A-Z]{2,12}-\d{3}[A-Za-z0-9]{0,3}$/;
const STAGES = { idle: '대기', computing: '형상 계산 중', checking: '기술 검사 중', done: '완료', failed: '실패', stopped: '중단' };
export const SOURCES = { production: '① 계산 완료', viewer: '④ 격리 계산기 생성 — ① 계산 완료 아님', test: '테스트 데이터 — 실제 모델 아님', unconfirmed: '① 완료 목록과 맞지 않음 — 미확인' };
export const STALE_MS = 10 * 60 * 1000;
const MAX_MESH = 120 * 1024 * 1024;
const txt = (v, n = 160) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : '');
const int = v => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : null);
const iso = v => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);

async function readSmallJson(file, limit = 256 * 1024) {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.size > limit) return null;
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch { return null; }
}

// 감독 결정 33 2항: ① 's time must carry its zone (Z or ±hh:mm). A time without a zone, or one that does not parse,
// is not guessed in the server's zone: it is 'time_ok: false' and confirms nothing (the screen says 미확인).
const ZONED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/;
// ② QA 02e89a1 REVIEW 1: a calendar-impossible value (02-30, 24:00, offset +99:00) must not roll over into a real
// time — every field is range-checked and the local wall time must survive a round trip unchanged
export function zonedTime(v) {
  const m = typeof v === 'string' ? ZONED.exec(v) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s = '0'] = m.slice(1, 7).map(Number);
  const oh = m[7] === 'Z' ? 0 : Number(m[8]), om = m[7] === 'Z' ? 0 : Number(m[9]);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59 || oh > 14 || om > 59) return null;
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function parseStatus(d, now = Date.now()) {
  if (!d || d.schema !== 'tc-live-status/1' || !SHA.test(String(d.model_sha256 || ''))) return null;
  const updated = zonedTime(d.updated_at);
  const items = d.checks && typeof d.checks.items === 'object' && d.checks.items ? d.checks.items : {};
  return {
    task_id: TASK.test(String(d.task_id || '')) ? d.task_id : null,
    candidate: txt(d.candidate, 60) || null,
    model_sha256: d.model_sha256,
    stage: Object.hasOwn(STAGES, d.stage) ? d.stage : 'idle', stage_label: STAGES[d.stage] || STAGES.idle,
    frames_total: int(d.frames_total), last_completed_frame: int(d.last_completed_frame), current_frame: int(d.current_frame),
    completed: Array.isArray(d.completed_frames) ? d.completed_frames.filter(f => int(f) !== null).slice(0, 5000) : [],
    updated_at: updated,
    time_ok: !!updated,
    stale: !updated || now - Date.parse(updated) > STALE_MS,
    future: !!updated && Date.parse(updated) > now + 60000,
    checks: {
      source: txt(d.checks?.source, 40) || null,
      state: ['running', 'done', 'none'].includes(d.checks?.state) ? d.checks.state : 'none',
      items: Object.entries(items).slice(0, 20).filter(([k]) => /^[A-Z][A-Za-z0-9_-]{0,15}$/.test(k)).map(([k, v]) => ({
        name: k, value: typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : null,
        limit: typeof v?.limit === 'number' && Number.isFinite(v.limit) ? v.limit : null,
        result: ['PASS', 'FAIL', 'pending'].includes(v?.result) ? v.result : 'pending', frame: int(v?.frame) })),
    },
  };
}

export async function readFrames(meshDir) {
  if (!meshDir) return null;
  const idx = await readSmallJson(path.join(meshDir, 'index.json'));
  if (!idx || idx.schema !== 'tc-live-frames/1' || !SHA.test(String(idx.model_sha256 || ''))) return null;
  const frames = (Array.isArray(idx.frames) ? idx.frames : []).slice(0, 5000)
    .filter(f => int(f?.frame) !== null && /^f\d{4}\.bin$/.test(String(f.file || '')) && ['production', 'viewer', 'test'].includes(f.source))
    .sort((a, b) => a.frame - b.frame);
  // 감독 결정 29 2항: what the shown model is, said on screen (e.g. '제작 중 — 최종 승인 모델 아님'); up to 6 short lines
  const notes = (Array.isArray(idx.notes) ? idx.notes : []).slice(0, 6).map(x => txt(x, 120)).filter(Boolean);
  const tech = idx.tech && typeof idx.tech === 'object' ? { result: ['PASS', 'FAIL', 'REVIEW', 'pending'].includes(idx.tech.result) ? idx.tech.result : 'pending', text: txt(idx.tech.text, 120) } : null;
  return { model_sha256: idx.model_sha256, label: txt(idx.label, 80), notes, tech, frames };
}

export function frameView(frames, status) {
  const done = new Set(status ? status.completed : []);
  return frames.frames.map(f => {
    // ② QA TC-DASH-012 REVIEW 1: a status file dated in the future is not trusted to confirm anything
    const prod = f.source === 'production' && status && status.time_ok && !status.future && status.model_sha256 === frames.model_sha256 && done.has(f.frame);
    const source = f.source === 'production' && !prod ? 'unconfirmed' : f.source;
    return { frame: f.frame, source, source_label: SOURCES[source] };
  });
}

export async function readStatus(file, now = Date.now()) {
  if (!file) return { state: 'not_configured', status: null };
  const d = await readSmallJson(file);
  const status = parseStatus(d, now);
  return { state: !status ? 'missing' : !status.time_ok ? 'time_unknown' : status.future ? 'future' : status.stale ? 'stale' : 'live', status };
}

// 감독 결정 29 3항: ① writes one status file per task and candidate (~/tc_live/status/<task>-<candidate>.json).
// The one shown is the file whose model_sha256 equals the shown shapes' model (newest update wins); none = 'missing'.
export async function readStatusDir(dir, modelSha, now = Date.now()) {
  if (!dir) return { state: 'not_configured', status: null };
  let names;
  try { names = (await fs.readdir(dir, { withFileTypes: true })).filter(d => d.isFile() && /^[\w.-]{1,120}\.json$/.test(d.name)).map(d => d.name).sort().slice(-50); } catch { return { state: 'missing', status: null }; }
  let best = null;
  for (const n of names) {
    const s = parseStatus(await readSmallJson(path.join(dir, n)), now);
    // ② QA 02e89a1 REVIEW 2: a file with a valid time always wins over one without; among valid ones the newest
    if (s && modelSha && s.model_sha256 === modelSha && (!best || (s.time_ok && !best.time_ok) || (s.time_ok === best.time_ok && String(s.updated_at) > String(best.updated_at)))) best = s;
  }
  return { state: !best ? 'missing' : !best.time_ok ? 'time_unknown' : best.future ? 'future' : best.stale ? 'stale' : 'live', status: best };
}

// 감독 결정 27 3항: a QA verdict is linked to what is on screen by the MODEL SHA-256 and the task, never by a part
// of the candidate name. A ② card counts when it is the same task AND it names this model: a full sha256 in its
// evidence (as kept by the card reader, 8–64 hex prefix), or "모델 <hex ≥ 8>" / "model <hex>" in its candidate text that is a prefix of this model's hash.
// Anything else — other model, no model named, no status file — is not linked (the screen says "QA 미확인").
const MODEL_REF = /(?:모델|model)\s*[:=]?\s*([0-9a-f]{8,64})\b/gi;
export function namesModel(card, sha) {
  if (!SHA.test(String(sha || ''))) return false;
  // the card reader keeps evidence hashes shortened (16 hex): a hash of 8+ hex that starts this model's hash counts
  if ((card.evidence || []).some(e => e && /^[0-9a-f]{8,64}$/.test(String(e.sha256 || '')) && sha.startsWith(e.sha256))) return true;
  for (const m of String(card.candidate || '').matchAll(MODEL_REF)) if (sha.startsWith(m[1].toLowerCase())) return true;
  return false;
}
export function qaFor(cards, status) {
  if (!status || !status.task_id) return [];
  return cards.filter(c => c.team === 'TC-QA' && c.verdict && c.task_id === status.task_id && namesModel(c, status.model_sha256))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
    .map(c => ({ verdict: c.verdict, scope: c.verdict_scope || null, at: c.at, title: txt(c.title, 140), task_id: c.task_id }));
}

export async function tcliveState({ meshDir, statusFile, statusDir, cards = [] }, now = Date.now()) {
  const frames = await readFrames(meshDir);
  const { state, status } = statusDir ? await readStatusDir(statusDir, frames?.model_sha256, now) : await readStatus(statusFile, now);
  return {
    notice: '형상 확인용 화면입니다. Karma 렌더가 아니며, 시각 승인 근거가 아닙니다.',
    status_state: state, status,
    mesh: frames ? { model_sha256: frames.model_sha256, label: frames.label, notes: frames.notes, tech: frames.tech, frames: frameView(frames, status), latest_completed: status ? status.last_completed_frame : null } : null,
    qa: qaFor(cards, status),
    qa_state: !status ? 'no_status' : qaFor(cards, status).length ? 'linked' : 'unverified',
  };
}

// one frame's bytes, checked; null when absent or malformed (the caller answers 404 / 422)
export async function tcliveFrame(meshDir, n) {
  const frames = await readFrames(meshDir);
  const f = frames?.frames.find(x => x.frame === n);
  if (!f) return { status: 404 };
  const file = path.join(meshDir, f.file);
  const st = await fs.lstat(file).catch(() => null);
  if (!st || !st.isFile() || st.size > MAX_MESH) return { status: 404 };
  const buf = await fs.readFile(file);
  if (!checkMesh(buf)) return { status: 422 };
  return { status: 200, body: buf, model_sha256: frames.model_sha256 };
}
