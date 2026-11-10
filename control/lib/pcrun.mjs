// PC run records (TC-DASH-008) — read only. The Windows PC launcher writes one result JSON per run into the
// launch folder's results/ when the run ENDS. Nothing is written while a run is going, so this module can
// confirm finished runs only; a placed launcher (.bat) is never taken as a running job.
//
// Allow-list: only job, started, finished, state, all_ok, images_ok, render_sec leave this module. Paths,
// process ids, licence type, host-side hashes and error text are dropped as soon as the file is parsed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './sanitize.mjs';

const RESULT = /^launch_([\w.-]{1,80})_(\d{8})_(\d{6})\.json$/;
const BAT = /^launch_([\w.-]{1,80})\.bat$/;
const JOB = /^[\w.-]{1,80}$/;
const STATES = ['finished', 'failed', 'running'];
const MAX = 400;
const PLACED_WINDOW_MS = 24 * 3600 * 1000;

// launcher times are PC local wall clock (KST) without zone
export function kst(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(v.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}+09:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseResult(doc, file) {
  const m = RESULT.exec(file);
  if (!m || !doc || typeof doc !== 'object') return null;
  const job = typeof doc.job === 'string' && JOB.test(doc.job) ? doc.job : m[1];
  const state = STATES.includes(doc.state) ? doc.state : null;
  const started = kst(doc.started);
  if (!state || !started) return null; // older launcher formats carry no run state — not counted
  return {
    job, state, started,
    finished: state === 'running' ? null : kst(doc.finished),
    all_ok: typeof doc.all_ok === 'boolean' ? doc.all_ok : null,
    images_ok: typeof doc.images_ok === 'boolean' ? doc.images_ok : null,
    render_sec: typeof doc.render_sec === 'number' && Number.isFinite(doc.render_sec) && doc.render_sec >= 0 ? Math.round(doc.render_sec) : null,
  };
}

async function entries(dir) {
  try { return (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && !e.isSymbolicLink()); } catch { return null; }
}

export async function readPcRuns(launchDir, now = Date.now()) {
  const checked_at = new Date(now).toISOString();
  if (!launchDir) return { state: 'missing', message: 'PC 실행 결과 폴더가 설정되지 않음', checked_at, results: [], placed: [] };
  const res = await entries(path.join(launchDir, 'results'));
  if (!res) return { state: 'missing', message: 'PC 실행 결과 폴더 없음', checked_at, results: [], placed: [] };
  const results = [];
  for (const e of res.filter(e => RESULT.test(e.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(-MAX)) {
    let doc;
    try { doc = await readJson(path.join(launchDir, 'results', e.name), 256 * 1024); } catch { continue; }
    const r = parseResult(doc, e.name);
    if (!r) continue;
    // write time of the record file — used only to cut public snapshots at their mark, never published
    try { r.written_at = new Date((await fs.lstat(path.join(launchDir, 'results', e.name))).mtimeMs).toISOString(); } catch { r.written_at = null; }
    results.push(r);
  }
  results.sort((a, b) => (a.finished || a.started).localeCompare(b.finished || b.started));
  // placed launchers: a .bat newer than every result of the same job, placed within 24 h.
  // Shown as "placed — run not confirmed", never as running.
  const placed = [];
  for (const e of (await entries(launchDir)) || []) {
    const m = BAT.exec(e.name);
    if (!m) continue;
    let st;
    try { st = await fs.lstat(path.join(launchDir, e.name)); } catch { continue; }
    if (now - st.mtimeMs > PLACED_WINDOW_MS || st.mtimeMs > now + 60000) continue;
    const placedAt = new Date(st.mtimeMs).toISOString();
    if (results.some(r => r.job === m[1] && r.started >= placedAt)) continue;
    placed.push({ job: m[1], placed_at: placedAt });
  }
  placed.sort((a, b) => a.placed_at.localeCompare(b.placed_at));
  return { state: 'ok', message: '사용자 PC 실행 결과 기록 (실행이 끝날 때만 기록됨)', checked_at, results, placed };
}
