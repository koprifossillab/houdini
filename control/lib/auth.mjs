// Report/media access control.
//   HPC_AUTH=basic (default): protected endpoints need HTTP Basic credentials matching HPC_USERS.
//                             With no users configured, protected endpoints stay locked (deny by default).
//   HPC_AUTH=off            : allowed only when the server listens on loopback (local development).
// HPC_USERS = "name:scrypt:<salt b64>:<hash b64>[;...]" — create entries with scripts/hash-password.mjs.
import crypto from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const h = crypto.scryptSync(password, salt, 32, PARAMS);
  return `scrypt:${salt.toString('base64')}:${h.toString('base64')}`;
}

export function parseUsers(spec = '') {
  const users = new Map();
  for (const entry of spec.split(';').map(s => s.trim()).filter(Boolean)) {
    const m = /^([a-z0-9_.-]{1,40}):scrypt:([A-Za-z0-9+/=]{8,}):([A-Za-z0-9+/=]{40,})$/.exec(entry);
    if (m) users.set(m[1], { salt: Buffer.from(m[2], 'base64'), hash: Buffer.from(m[3], 'base64') });
  }
  return users;
}

export function createAuth({ mode = 'basic', users = new Map(), loopbackOnly = false } = {}) {
  if (mode === 'off' && !loopbackOnly) throw Error('HPC_AUTH=off 은 루프백 개발 서버에서만 허용됨');
  if (!['basic', 'off'].includes(mode)) throw Error('HPC_AUTH 는 basic 또는 off');
  const dummy = { salt: Buffer.alloc(16), hash: Buffer.alloc(32) };
  return {
    mode,
    configured: mode === 'off' || users.size > 0,
    check(header) {
      if (mode === 'off') return { ok: true, user: 'local-dev' };
      const m = /^Basic ([A-Za-z0-9+/=]{1,512})$/.exec(header || '');
      if (!m) return { ok: false };
      const raw = Buffer.from(m[1], 'base64').toString('utf8');
      const i = raw.indexOf(':');
      if (i < 1) return { ok: false };
      const name = raw.slice(0, i);
      const u = users.get(name) || dummy; // same work for unknown users
      const h = crypto.scryptSync(raw.slice(i + 1), u.salt, 32, PARAMS);
      const ok = users.has(name) && crypto.timingSafeEqual(h, u.hash);
      return ok ? { ok: true, user: name } : { ok: false };
    },
  };
}
