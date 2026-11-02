// Text and value sanitising for anything that leaves the server.
// clean() comes from the Work prototype (dashboard/server.mjs, 2026-11-02).
// Changes against the prototype (found with real reports, 2026-11-02):
//   - host-like names (`<word>server…`, `<word>-server…`) are masked by a generic rule, so no real
//     host name has to be written into this public source;
//   - a path segment glued in front of a masked path is absorbed into the mask;
//   - extra literal terms (private names that must not appear in this public source) come from
//     HPC_REDACT_TERMS at runtime, comma separated.
import fs from 'node:fs/promises';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let TERMS = null;
export function setRedactTerms(list) {
  const t = (list || []).map(s => String(s).trim()).filter(s => s.length >= 3).slice(0, 50);
  TERMS = t.length ? new RegExp(t.map(esc).join('|'), 'gi') : null;
}
setRedactTerms((process.env.HPC_REDACT_TERMS || '').split(','));

export function clean(value, max = 350) {
  if (typeof value !== 'string') return '';
  let v = value;
  if (TERMS) v = v.replace(TERMS, '[내부 정보 숨김]');
  return v
    .replace(/(?:https?:\/\/[^\s<>"']+|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|\b[\w.-]+@[\w.-]+\b|\b(?!(?:ob|pre|de)server)[a-z][a-z0-9]+-?server[\w.-]*\b)/gi, '[내부 정보 숨김]')
    .replace(/(?:[A-Z]:[\\/][^\s<>"'`]*|\\\\[^\s<>"'`]+|~\/[^\s<>"'`]*|\/(?:[\w.-]+\/)+[^\s<>"'`]*|\b[\w.-]+\/[\w.-]+\.(?:md|json|py|log|png|mp4)\b)/gi, '[경로 숨김]')
    .replace(/[\w.-]+(?=\[경로 숨김\])/g, '')
    .replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{8,}|(?:token|password|secret|api[_ -]?key)\s*[:=]\s*\S+)/gi, '[비밀값 숨김]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, max);
}

export const count = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);
export const iso = v => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
export const hex = (v, n) => (typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v) ? v : null);

// Bounded read of a regular file (no symlinks, no directories, size cap). From the Work prototype.
export async function readBounded(p, limit = 1024 * 1024) {
  const stat = await fs.lstat(p);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw Object.assign(Error('unreadable'), { code: 'EUNREADABLE' });
  const handle = await fs.open(p, 'r');
  try {
    const b = Buffer.alloc(Math.min(limit, stat.size) + 1);
    const { bytesRead } = await handle.read(b, 0, b.length, 0);
    if (bytesRead > limit) throw Object.assign(Error('oversize'), { code: 'EOVERSIZE' });
    return b.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function readJson(p, limit) {
  return JSON.parse((await readBounded(p, limit)).toString('utf8'));
}
