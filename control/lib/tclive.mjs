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
export const SOURCES = { production: '① 계산 완료', viewer: '뷰어 계산 — ① 계산 완료 아님', test: '테스트 데이터 — 실제 모델 아님', unconfirmed: '① 완료 목록과 맞지 않음 — 미확인' };
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

export function parseStatus(d, now = Date.now()) {
  if (!d || d.schema !== 'tc-live-status/1' || !SHA.test(String(d.model_sha256 || ''))) return null;
  const updated = iso(d.updated_at);
  const items = d.checks && typeof d.checks.items === 'object' && d.checks.items ? d.checks.items : {};
  return {
    task_id: TASK.test(String(d.task_id || '')) ? d.task_id : null,
    candidate: txt(d.candidate, 60) || null,
    model_sha256: d.model_sha256,
    stage: Object.hasOwn(STAGES, d.stage) ? d.stage : 'idle', stage_label: STAGES[d.stage] || STAGES.idle,
    frames_total: int(d.frames_total), last_completed_frame: int(d.last_completed_frame), current_frame: int(d.current_frame),
    completed: Array.isArray(d.completed_frames) ? d.completed_frames.filter(f => int(f) !== null).slice(0, 5000) : [],
    updated_at: updated,
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
  return { model_sha256: idx.model_sha256, label: txt(idx.label, 80), frames };
}

export function frameView(frames, status) {
  const done = new Set(status ? status.completed : []);
  return frames.frames.map(f => {
    const prod = f.source === 'production' && status && status.model_sha256 === frames.model_sha256 && done.has(f.frame);
    const source = f.source === 'production' && !prod ? 'unconfirmed' : f.source;
    return { frame: f.frame, source, source_label: SOURCES[source] };
  });
}

export async function readStatus(file, now = Date.now()) {
  if (!file) return { state: 'not_configured', status: null };
  const d = await readSmallJson(file);
  const status = parseStatus(d, now);
  return { state: !status ? 'missing' : status.future ? 'future' : status.stale ? 'stale' : 'live', status };
}

// cards: the items of readCards() — only TC-QA cards with a verdict, for the status file's candidate
export function qaFor(cards, candidate) {
  if (!candidate) return [];
  const name = candidate.split(/\s+/)[0];
  return cards.filter(c => c.team === 'TC-QA' && c.verdict && String(c.candidate || '').split(/\s+/)[0] === name)
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
    .map(c => ({ verdict: c.verdict, scope: c.verdict_scope || null, at: c.at, title: txt(c.title, 140), task_id: c.task_id }));
}

export async function tcliveState({ meshDir, statusFile, cards = [] }, now = Date.now()) {
  const [{ state, status }, frames] = await Promise.all([readStatus(statusFile, now), readFrames(meshDir)]);
  return {
    notice: '형상 확인용 화면입니다. Karma 렌더가 아니며, 시각 승인 근거가 아닙니다.',
    status_state: state, status,
    mesh: frames ? { model_sha256: frames.model_sha256, label: frames.label, frames: frameView(frames, status), latest_completed: status ? status.last_completed_frame : null } : null,
    qa: qaFor(cards, status?.candidate),
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
