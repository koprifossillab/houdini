// Read-only, restricted view of the NAS production folders (TC-DASH-002 ⑤ / TC-DASH-003 ②-⑤).
// Everything returned here is a CLUE (grade 'clue'): a folder name or the existence of a file never
// confirms a task state or an approval. Confirmation comes only from handoff cards and decision records.
//
// Restrictions (all enforced here, tested in test/board.test.mjs):
//   - only the configured roots; nothing comes from the URL except an opaque 16-hex id
//   - top-level folder names must match NAME; at most MAX_DEPTH levels are looked at
//   - symbolic links, '..', absolute names and anything whose real path leaves the root are refused
//   - file kinds by extension allowlist; documents ≤ DOC_LIMIT, images ≤ IMG_LIMIT
//   - .hip / .bgeo / .py / .bat contents are never opened
//   - responses carry no server path; names go through clean() (HPC_REDACT_TERMS applies)
//   - an image is served only when a SHA-256 list inside the same folder names it and the bytes match
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, readBounded } from './sanitize.mjs';
import { TASK_SRC } from './handoff.mjs';

// TC-DASH-005: the director originals folder is never part of the clue search, whatever its name pattern.
// Excluded by fixed name, by any name containing DIRECTOR_DECISIONS, by extra names from the config, and by
// real path when the originals folder is configured. Excluded folders get no id, so no image or document in
// them can be requested either.
export const ALWAYS_EXCLUDED = ['TC3D_DIRECTOR_DECISIONS'];
export function excludedName(name, extra = []) {
  return ALWAYS_EXCLUDED.includes(name) || /DIRECTOR_DECISIONS/i.test(name) || extra.includes(name);
}

export const NAME = /^TC[0-9A-Za-z_-]{2,120}$/;
const LAUNCH_NAME = /^launch_[\w-]{1,80}\.bat$/;
const SEG = /^[\w.-]{1,120}$/;
export const MAX_DEPTH = 2;
export const DOC_LIMIT = 256 * 1024;
export const IMG_LIMIT = 25 * 1024 * 1024;
const MAX_FOLDERS = 80;
const MAX_ENTRIES = 300;
const CACHE_MS = 60000;
const DOC_EXT = new Set(['.md', '.txt']);
const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const SHA_LIST = /^(?:RAW_)?SHA256(?:SUMS|_FILES)?\.txt$|^RAW_SHA256(?:_FILES)?\.txt$/;
const TASK_ID = new RegExp(`\\b${TASK_SRC}\\b`, 'g');

// Order matters: the most specific suffix wins. Labels say what the name SUGGESTS, never what is proven.
export const CLUES = [
  [/_SELFCHECK_FAIL/, 'selfcheck_fail', '자체 검사 FAIL 표지'],
  [/_WORK_REVIEW_REQUEST$/, 'review_request', '③ 검토 요청 표지'],
  [/_RAW_PRESERVED$/, 'run_preserved', '실행 원본 보존 표지'],
  [/_DIAGNOSIS$/, 'diagnosis', '진단 표지'],
  [/_JUDGE(?:_AND_ANALYSIS)?$/, 'judged', '판정기 적용 표지'],
  [/_CLOSURE$/, 'closure', '종료 표지'],
  [/_STAGING_NOT_APPROVED$/, 'staging', '스테이징 표지 (미승인 이름)'],
  [/_NOT_APPROVED$/, 'prototype', '시제품·설계 표지 (미승인 이름)'],
  [/_DEFECT_/, 'defect', '결함 기록 표지'],
];
export function clueOf(name) {
  const hit = CLUES.find(([re]) => re.test(name));
  return hit ? { clue: hit[1], clue_label: hit[2] } : { clue: 'unclassified', clue_label: '분류 안 됨 (이름 규칙 밖)' };
}

const idOf = (root, rel) => crypto.createHash('sha256').update(`${root}\0${rel}`).digest('hex').slice(0, 16);

async function realInside(root, p) {
  try {
    const [r, x] = await Promise.all([fs.realpath(root), fs.realpath(p)]);
    return x === r || x.startsWith(r + path.sep);
  } catch { return false; }
}

async function entries(dir) {
  try { return (await fs.readdir(dir, { withFileTypes: true })).slice(0, MAX_ENTRIES); } catch { return []; }
}

function dateOf(name) {
  const m = /_(\d{4})(\d{2})(\d{2})(?:_(\d{2})(\d{2})(\d{2}))?(?=_|$)/.exec(name);
  if (!m) return null;
  return m[4] ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : `${m[1]}-${m[2]}-${m[3]}`;
}

async function shaList(dir) {
  const map = new Map();
  for (const e of await entries(dir)) {
    if (!e.isFile() || !SHA_LIST.test(e.name)) continue;
    let text;
    try { text = (await readBounded(path.join(dir, e.name), DOC_LIMIT)).toString('utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/.exec(line);
      if (m && m[2].split('/').every(s => SEG.test(s) && s !== '..') && m[2].split('/').length <= MAX_DEPTH) map.set(m[2], m[1]);
    }
  }
  return map;
}

async function folderView(root, name) {
  const dir = path.join(root, name);
  let st;
  try { st = await fs.lstat(dir); } catch { return null; }
  if (!st.isDirectory() || st.isSymbolicLink() || !(await realInside(root, dir))) return null;
  const sums = await shaList(dir);
  const tasks = new Set();
  let title = null;
  let runLock = false;
  const images = [];
  let skipped = 0;
  const scan = async (rel, depth) => {
    for (const e of await entries(path.join(dir, rel))) {
      if (!SEG.test(e.name) || e.name === '..' || e.name === '.') { skipped += 1; continue; }
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(dir, r);
      if (e.isSymbolicLink()) { skipped += 1; continue; }
      if (e.isDirectory()) { if (depth < MAX_DEPTH) await scan(r, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (e.name === 'RUN.lock') { runLock = true; continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (DOC_EXT.has(ext) && depth === 1 && !SHA_LIST.test(e.name)) {
        let text;
        try { text = (await readBounded(full, DOC_LIMIT)).toString('utf8'); } catch { skipped += 1; continue; }
        for (const m of text.matchAll(TASK_ID)) tasks.add(m[0]);
        if (!title) { const h = /^#\s+(.+)$/m.exec(text); if (h) title = clean(h[1], 160); }
      } else if (IMG_EXT[ext] && images.length < 12) {
        let s;
        try { s = await fs.lstat(full); } catch { continue; }
        if (s.size > IMG_LIMIT) { skipped += 1; continue; }
        images.push({ id: idOf(root, `${name}/${r}`), file: clean(e.name, 120), listed: sums.has(r), _rel: r, _sha: sums.get(r) || null, _type: IMG_EXT[ext] });
      }
      // other kinds (.hip, .bgeo, .py, .bat, .json …) are not opened
    }
  };
  await scan('', 1);
  return {
    id: idOf(root, name),
    name: clean(name, 160),
    ...clueOf(name),
    name_date: dateOf(name),
    mtime: new Date(st.mtimeMs).toISOString(),
    task_ids: [...tasks].slice(0, 12),
    title,
    run_lock: runLock,
    images,
    skipped,
    grade: 'clue',
    _name: name,
  };
}

const cache = new Map();
export async function nasClues(cfg, now = Date.now()) {
  const root = cfg?.film || null;
  if (!root) return { state: 'missing', message: 'NAS 영상 작업 폴더가 설정되지 않음', folders: [], launchers: [] };
  const key = `${root}\0${cfg.launch || ''}\0${cfg.directorDir || ''}\0${(cfg.exclude || []).join(',')}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  let rootOk = false;
  try { rootOk = (await fs.lstat(root)).isDirectory(); } catch { rootOk = false; }
  if (!rootOk) return { state: 'error', message: 'NAS 영상 작업 폴더를 읽을 수 없음', folders: [], launchers: [] };
  const names = [];
  const extra = Array.isArray(cfg.exclude) ? cfg.exclude : [];
  let directorReal = null;
  if (cfg.directorDir) { try { directorReal = await fs.realpath(cfg.directorDir); } catch { directorReal = null; } }
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.isSymbolicLink() || !NAME.test(e.name) || excludedName(e.name, extra)) continue;
    if (directorReal) { try { if ((await fs.realpath(path.join(root, e.name))) === directorReal) continue; } catch { continue; } }
    names.push(e.name);
  }
  const stats = await Promise.all(names.map(async n => { try { return [n, (await fs.lstat(path.join(root, n))).mtimeMs]; } catch { return [n, 0]; } }));
  stats.sort((a, b) => b[1] - a[1]);
  const folders = (await Promise.all(stats.slice(0, MAX_FOLDERS).map(([n]) => folderView(root, n)))).filter(Boolean);
  const launchers = [];
  if (cfg.launch) {
    for (const e of await entries(cfg.launch)) {
      if (!e.isFile() || e.isSymbolicLink() || !LAUNCH_NAME.test(e.name)) continue;
      try { const s = await fs.lstat(path.join(cfg.launch, e.name)); launchers.push({ name: clean(e.name, 100), mtime: new Date(s.mtimeMs).toISOString(), grade: 'clue' }); } catch { /* gone */ }
    }
    launchers.sort((a, b) => b.mtime.localeCompare(a.mtime));
  }
  const value = { state: 'ok', message: '폴더 이름·파일 존재는 단서일 뿐 — 상태·승인은 인계 카드와 판정 기록으로만 확정', checked_at: new Date(now).toISOString(), folders, launchers: launchers.slice(0, 40), _root: root };
  cache.set(key, { at: now, value });
  return value;
}
export function clearNasCache() { cache.clear(); }

export function publicNas(v, limit = 60) {
  const strip = f => ({ ...Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_'))), images: f.images.map(i => ({ id: i.id, file: i.file, listed: i.listed })) });
  return { state: v.state, message: v.message, checked_at: v.checked_at || null, folders: v.folders.slice(0, limit).map(strip), launchers: v.launchers };
}

// Image bytes by opaque id. 404 unless listed in the folder's SHA list and the hash matches.
export async function nasImage(v, id) {
  if (!/^[a-f0-9]{16}$/.test(id) || v.state !== 'ok') return { status: 404, body: '없음' };
  for (const f of v.folders) {
    const img = f.images.find(i => i.id === id);
    if (!img) continue;
    if (!img._sha) return { status: 404, body: 'SHA 목록에 없는 파일 — 표시하지 않음' };
    const p = path.join(v._root, f._name, img._rel);
    if (!(await realInside(v._root, p))) return { status: 404, body: '없음' };
    let buf;
    try { buf = await readBounded(p, IMG_LIMIT); } catch { return { status: 404, body: '없음' }; }
    if (crypto.createHash('sha256').update(buf).digest('hex') !== img._sha) return { status: 409, body: '해시 불일치 — 기록된 파일과 다름' };
    return { status: 200, type: img._type, body: buf };
  }
  return { status: 404, body: '없음' };
}
