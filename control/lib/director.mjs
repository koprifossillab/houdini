// Director originals check (TC-DASH-005). Compare-only module — never part of the NAS clue search.
//
//   <HPC_DIRECTOR_DIR>/INDEX.json   tc-director-index/1 — the list of approved original files:
//     { "schema": "tc-director-index/1", "entries": [ { "directive_id": "TC-DASH-005", "file": "TC-DASH-005.md",
//       "sha256": "<64 hex>", "source": "총괄 감독 대화 원문", "written_at": "…", "checked_at": "…",
//       "check_method": "user_confirmed" | "transcribed" } ] }
//
// Rules:
//   - only files named in INDEX.json are opened (plain names, .md/.txt, ≤ 256 KB, no symlinks, inside the
//     folder by real path); nothing else in the folder is listed or read
//   - the output carries, per directive id, only the comparison result, the recorded times and the check
//     method — never the text, the file name or any path
//   - a SHA-256 match proves that the stored text is the text that was recorded, nothing more: not who wrote
//     it and not that its author had authority to decide. 'user_confirmed' is what the index says; the
//     account that wrote the index is not verified either.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, hex, iso, readBounded } from './sanitize.mjs';
import { DIRECTIVE } from './handoff.mjs';

const FILE = /^[A-Za-z0-9][\w.-]{0,119}\.(?:md|txt)$/;
const LIMIT = 256 * 1024;
const METHODS = ['user_confirmed', 'transcribed'];

async function inside(root, p) {
  try { const [r, x] = await Promise.all([fs.realpath(root), fs.realpath(p)]); return x.startsWith(r + path.sep); } catch { return false; }
}

export async function directorOriginals(dir) {
  if (!dir) return { state: 'missing', message: '감독 원문 보관 위치가 설정되지 않음', byDirective: new Map() };
  let index;
  try { index = JSON.parse((await readBounded(path.join(dir, 'INDEX.json'), LIMIT)).toString('utf8')); } catch (e) {
    return { state: 'missing', message: '감독 원문 목록 없음 — 모든 판정 기록은 원문 미확인', byDirective: new Map() };
  }
  if (!index || index.schema !== 'tc-director-index/1' || !Array.isArray(index.entries)) return { state: 'error', message: '감독 원문 목록 형식 오류', byDirective: new Map() };
  const byDirective = new Map();
  let refused = 0;
  for (const e of index.entries.slice(0, 500)) {
    const id = String(e?.directive_id || '');
    const want = hex(e?.sha256, 64);
    if (!DIRECTIVE.test(id) || !FILE.test(String(e?.file || '')) || !want) { refused += 1; continue; }
    const p = path.join(dir, e.file);
    let content = 'missing';
    try {
      const st = await fs.lstat(p);
      if (!st.isFile() || st.isSymbolicLink() || !(await inside(dir, p))) content = 'refused';
      else content = crypto.createHash('sha256').update(await readBounded(p, LIMIT)).digest('hex') === want ? 'matched' : 'mismatch';
    } catch (err) { content = err.code === 'ENOENT' ? 'missing' : 'unreadable'; }
    byDirective.set(id, {
      directive_id: id,
      content,
      check_method: METHODS.includes(e.check_method) ? e.check_method : 'transcribed',
      written_at: iso(e.written_at),
      checked_at: iso(e.checked_at),
      source: clean(e.source, 120),
      sha256: want.slice(0, 16),
    });
  }
  return { state: 'ok', message: refused ? `목록 항목 ${refused}건은 형식 오류로 무시` : '감독 원문 대조', byDirective, entries: byDirective.size, refused };
}

// validity of one decision record against the originals
//   valid            — original matched AND a user confirmation is recorded  → shown as a valid decision
//   content_matched  — original matched, no user confirmation               → not a valid decision yet
//   source_mismatch  — original exists but its hash differs                 → not valid
//   source_unverified— no directive id, no index entry, or original missing  → not valid
export function decisionValidity(d, originals) {
  const o = d.directive_id ? originals?.byDirective?.get(d.directive_id) : null;
  if (!o) return { validity: 'source_unverified', label: '전사 · 원문 미확인', original: null };
  const original = { content: o.content, check_method: o.check_method, checked_at: o.checked_at, written_at: o.written_at, sha256: o.sha256 };
  if (o.content === 'mismatch') return { validity: 'source_mismatch', label: '전사 · 원문과 내용 불일치', original };
  if (o.content !== 'matched') return { validity: 'source_unverified', label: '전사 · 원문 미확인', original };
  if (o.check_method !== 'user_confirmed' || !o.checked_at) return { validity: 'content_matched', label: '원문 내용 일치 · 사용자 확인 전', original };
  return { validity: 'valid', label: '유효한 감독 판정 (원문 일치 + 사용자 확인 · 신원·권한 증명 아님)', original };
}
