// Allowlisted preview media. The manifest lives outside Git (runtime config); each entry names a
// basename inside the media directory plus its SHA-256. Bytes are served only after the hash matches.
// Manifest validation and hash check come from the Work prototype; added: honest provenance fields,
// byte-range support for video seeking, and a hash cache keyed on (size, mtime).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, count, hex, readBounded, readJson } from './sanitize.mjs';

export const MEDIA_LIMIT = 25 * 1024 * 1024;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
const ORIGINS = { physics: '물리 계산 출력', procedural: '절차적 연출', render: '렌더', example: '예시' };
const verified = new Map();

export async function mediaItems(root, manifest) {
  if (!root || !manifest) return { state: 'missing', items: [] };
  let d;
  try { d = await readJson(manifest, 65536); } catch { return { state: 'error', items: [] }; }
  if (!Array.isArray(d)) return { state: 'error', items: [] };
  const items = [];
  for (const x of d.slice(0, 30)) {
    if (!x || !/^[a-z0-9_-]{1,60}$/.test(x.id) || typeof x.file !== 'string' || x.file !== path.basename(x.file) || !TYPES[path.extname(x.file)] || !hex(x.sha256, 64)) continue;
    let present = false;
    try { const s = await fs.lstat(path.join(root, x.file)); present = s.isFile() && !s.isSymbolicLink() && s.size <= MEDIA_LIMIT; } catch { present = false; }
    items.push({
      id: x.id,
      kind: x.file.endsWith('.mp4') ? 'video' : 'image',
      title: clean(x.title, 120),
      stage: clean(x.stage, 20) || null,
      origin: ORIGINS[x.origin] ? x.origin : 'unknown',
      origin_label: ORIGINS[x.origin] || '출처 미기재',
      model: clean(x.model, 160),
      sampling: x.sampling && typeof x.sampling === 'object' ? { frames: count(x.sampling.frames), playback_fps: count(x.sampling.playback_fps), sim_interval_s: typeof x.sampling.sim_interval_s === 'number' ? x.sampling.sim_interval_s : null } : null,
      caveat: clean(x.caveat, 240),
      sha256: x.sha256.slice(0, 16),
      present,
      _file: x.file,
      _sha: x.sha256,
    });
  }
  return { state: 'ok', items };
}

export const publicMedia = items => items.map(({ _file, _sha, ...m }) => m);

// Returns {status, headers, body}. Never exposes the file name or directory.
export async function mediaResponse(root, item, rangeHeader) {
  const p = path.join(root, item._file);
  const st = await fs.lstat(p);
  if (!st.isFile() || st.isSymbolicLink() || st.size > MEDIA_LIMIT) return { status: 404, body: '미디어 없음' };
  const key = `${item.id}:${st.size}:${st.mtimeMs}`;
  let buf;
  if (!verified.has(key)) {
    buf = await readBounded(p, MEDIA_LIMIT);
    const ok = crypto.createHash('sha256').update(buf).digest('hex') === item._sha;
    if (!ok) return { status: 409, body: '미디어 해시 확인 실패 — 기록된 파일과 다름' };
    verified.set(key, true);
  }
  buf ||= await readBounded(p, MEDIA_LIMIT);
  const type = TYPES[path.extname(item._file)];
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : buf.length - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : buf.length - 1;
    if (!m[1]) end = buf.length - 1;
    if (start < 0) start = 0;
    if (start >= buf.length || end < start) return { status: 416, headers: { 'Content-Range': `bytes */${buf.length}` }, body: '' };
    end = Math.min(end, buf.length - 1);
    return { status: 206, type, headers: { 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Accept-Ranges': 'bytes' }, body: buf.subarray(start, end + 1) };
  }
  return { status: 200, type, headers: { 'Accept-Ranges': 'bytes' }, body: buf };
}
