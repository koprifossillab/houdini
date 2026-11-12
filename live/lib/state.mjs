// Read-only state for the viewer: the production status file written by ① (tc-live-status/1), the frame index of
// the mesh cache, and the confirmed QA verdicts on handoff cards. Nothing here writes.
//
// Rule (감독 결정 22 4항): a frame counts as "① 계산 완료" only when ① 's status file lists it as completed for the
// SAME model hash. Frames the viewer computed itself are "뷰어 계산", test frames are "테스트 데이터" — never shown as ①'s.
import fs from 'node:fs/promises';
import path from 'node:path';

const SHA = /^[a-f0-9]{64}$/;
const TASK = /^TC-[0-9A-Z]{2,12}-\d{3}[A-Za-z0-9]{0,3}$/;
const STAGES = { idle: '대기', computing: '형상 계산 중', checking: '기술 검사 중', done: '완료', failed: '실패', stopped: '중단' };
const SOURCES = { production: '① 계산 완료', viewer: '뷰어 계산 — ① 계산 완료 아님', test: '테스트 데이터 — 실제 모델 아님', unconfirmed: '① 완료 목록과 맞지 않음 — 미확인' };
const CHECK_STATES = { running: '진행 중', done: '완료', none: '없음' };
export const STALE_MS = 10 * 60 * 1000;
const txt = (v, n = 160) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : '');
const int = v => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : null);
const iso = v => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);

async function readJson(file, limit = 256 * 1024) {
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
  const checks = Object.entries(items).slice(0, 20).filter(([k]) => /^[A-Z][A-Za-z0-9_-]{0,15}$/.test(k)).map(([k, v]) => ({
    name: k, value: typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : null,
    limit: typeof v?.limit === 'number' && Number.isFinite(v.limit) ? v.limit : null,
    result: ['PASS', 'FAIL', 'pending'].includes(v?.result) ? v.result : 'pending', frame: int(v?.frame),
  }));
  return {
    task_id: TASK.test(String(d.task_id || '')) ? d.task_id : null,
    candidate: txt(d.candidate, 60) || null,
    model_sha256: d.model_sha256,
    stage: Object.hasOwn(STAGES, d.stage) ? d.stage : 'idle', stage_label: STAGES[d.stage] || STAGES.idle,
    frames_total: int(d.frames_total),
    last_completed_frame: int(d.last_completed_frame),
    current_frame: int(d.current_frame),
    completed: Array.isArray(d.completed_frames) ? d.completed_frames.filter(f => int(f) !== null).slice(0, 5000) : [],
    updated_at: updated,
    stale: !updated || now - Date.parse(updated) > STALE_MS,
    future: !!updated && Date.parse(updated) > now + 60000,
    checks: { source: txt(d.checks?.source, 40) || null, state: Object.hasOwn(CHECK_STATES, d.checks?.state) ? d.checks.state : 'none', items: checks },
  };
}

export async function readFrames(meshDir) {
  const idx = await readJson(path.join(meshDir, 'index.json'));
  if (!idx || idx.schema !== 'tc-live-frames/1' || !SHA.test(String(idx.model_sha256 || ''))) return null;
  const frames = (Array.isArray(idx.frames) ? idx.frames : []).slice(0, 5000)
    .filter(f => int(f?.frame) !== null && /^f\d{4}\.bin$/.test(String(f.file || '')) && ['production', 'viewer', 'test'].includes(f.source))
    .map(f => ({ frame: f.frame, file: f.file, source: f.source, sha256: SHA.test(String(f.sha256 || '')) ? f.sha256 : null }));
  return { model_sha256: idx.model_sha256, label: txt(idx.label, 80), frames };
}

// confirmed QA verdicts: TC-QA cards whose candidate name matches, newest first (read only)
export async function readQa(handoffDir, candidate) {
  if (!handoffDir || !candidate) return [];
  const name = candidate.split(/\s+/)[0];
  let files;
  try { files = (await fs.readdir(path.join(handoffDir, 'TC-QA'))).filter(f => /^[\w.-]{1,120}\.json$/.test(f)).sort().slice(-400); } catch { return []; }
  const out = [];
  for (const f of files) {
    const c = await readJson(path.join(handoffDir, 'TC-QA', f), 64 * 1024);
    if (!c || c.team !== 'TC-QA' || !c.verdict || String(c.candidate || '').split(/\s+/)[0] !== name) continue;
    out.push({ verdict: txt(c.verdict, 12), scope: txt(c.verdict_scope, 12) || null, at: iso(c.at), title: txt(c.title, 140), card: `TC-QA/${f}` });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
}

// the label each frame gets on screen
export function frameView(frames, status) {
  const done = status ? new Set(status.completed) : new Set();
  return frames.frames.map(f => {
    // a production frame must also be listed by ① for the same model; otherwise it is not called ①'s
    const prod = f.source === 'production' && status && status.model_sha256 === frames.model_sha256 && done.has(f.frame);
    const source = f.source === 'production' && !prod ? 'unconfirmed' : f.source;
    return { frame: f.frame, source, source_label: SOURCES[source] };
  });
}
