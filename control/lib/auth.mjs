// Access control — every research view requires credentials (2026-11-02 F4); only /healthz is open.
//   HPC_AUTH=basic (default): HTTP Basic, checked against HPC_USERS. No users configured = locked.
//   HPC_AUTH=off            : allowed only when the server listens on loopback (local development).
// HPC_USERS = "name:scrypt:<salt b64>:<hash b64>[;...]" — create entries with scripts/hash-password.mjs.
//
// F3 (2026-11-02): scrypt runs asynchronously on the libuv pool, never on the event loop.
//   - at most MAX_ACTIVE hashes run at once (the pool has 4 threads; the rest stay free for file reads),
//     at most MAX_QUEUE wait; beyond that the request gets 429 immediately;
//   - failures are limited per client and globally; a limited client gets 429 without any hashing;
//   - a successful credential is cached as sha256(header) -> user for CACHE_MS, so the page's polling
//     does not hash on every request. The header itself is never stored, logged or echoed.
import crypto from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scryptAsync = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, PARAMS, (e, k) => (e ? no(e) : ok(k))));

export const LIMITS = { MAX_ACTIVE: 2, MAX_QUEUE: 4, FAIL_PER_CLIENT: 8, FAIL_WINDOW_MS: 5 * 60 * 1000, FAIL_GLOBAL_PER_MIN: 60, CACHE_MS: 10 * 60 * 1000, CACHE_MAX: 200 };

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const h = crypto.scryptSync(password, salt, 32, PARAMS); // CLI only (scripts/hash-password.mjs), never in the server
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

export function createAuth({ mode = 'basic', users = new Map(), loopbackOnly = false, limits = {} } = {}) {
  if (mode === 'off' && !loopbackOnly) throw Error('HPC_AUTH=off 은 루프백 개발 서버에서만 허용됨');
  if (!['basic', 'off'].includes(mode)) throw Error('HPC_AUTH 는 basic 또는 off');
  const L = { ...LIMITS, ...limits };
  const dummy = { salt: Buffer.alloc(16), hash: Buffer.alloc(32) };
  const cache = new Map();          // sha256(header) -> { user, exp }
  const fails = new Map();          // client -> { n, reset }
  let globalFails = { n: 0, reset: Date.now() + 60000 };
  let active = 0;
  const waiting = [];
  const stats = { hashed: 0, rejected_busy: 0, rejected_limited: 0 };

  const key = h => crypto.createHash('sha256').update(h).digest('hex');
  const limited = client => {
    const now = Date.now();
    if (now > globalFails.reset) globalFails = { n: 0, reset: now + 60000 };
    const f = fails.get(client);
    if (f && now > f.reset) fails.delete(client);
    const cf = fails.get(client);
    if (cf && cf.n >= L.FAIL_PER_CLIENT) return Math.ceil((cf.reset - now) / 1000);
    if (globalFails.n >= L.FAIL_GLOBAL_PER_MIN) return Math.ceil((globalFails.reset - now) / 1000);
    return 0;
  };
  const fail = client => {
    const now = Date.now();
    const f = fails.get(client) || { n: 0, reset: now + L.FAIL_WINDOW_MS };
    f.n += 1;
    fails.set(client, f);
    if (fails.size > 5000) fails.delete(fails.keys().next().value);
    globalFails.n += 1;
  };
  async function slot() {
    if (active < L.MAX_ACTIVE) { active += 1; return true; }
    if (waiting.length >= L.MAX_QUEUE) return false;
    await new Promise(r => waiting.push(r));
    active += 1;
    return true;
  }
  const release = () => { active -= 1; const next = waiting.shift(); if (next) next(); };

  return {
    mode,
    configured: mode === 'off' || users.size > 0,
    stats,
    // -> { ok: true, user } | { ok: false, status: 401 | 429, retryAfter? }
    async check(header, client = 'unknown') {
      if (mode === 'off') return { ok: true, user: 'local-dev' };
      const m = /^Basic ([A-Za-z0-9+/=]{1,512})$/.exec(header || '');
      if (!m) return { ok: false, status: 401 };
      const k = key(m[1]);
      const hit = cache.get(k);
      if (hit && hit.exp > Date.now()) return { ok: true, user: hit.user };
      if (hit) cache.delete(k);
      const wait = limited(client);
      if (wait > 0) { stats.rejected_limited += 1; return { ok: false, status: 429, retryAfter: wait }; }
      const raw = Buffer.from(m[1], 'base64').toString('utf8');
      const i = raw.indexOf(':');
      if (i < 1) { fail(client); return { ok: false, status: 401 }; }
      const name = raw.slice(0, i);
      if (!(await slot())) { stats.rejected_busy += 1; return { ok: false, status: 429, retryAfter: 2 }; }
      let ok = false;
      try {
        const u = users.get(name) || dummy; // same work for unknown users
        const h = await scryptAsync(raw.slice(i + 1), u.salt);
        stats.hashed += 1;
        ok = users.has(name) && crypto.timingSafeEqual(h, u.hash);
      } finally {
        release();
      }
      if (!ok) { fail(client); return { ok: false, status: 401 }; }
      cache.set(k, { user: name, exp: Date.now() + L.CACHE_MS });
      if (cache.size > L.CACHE_MAX) cache.delete(cache.keys().next().value);
      return { ok: true, user: name };
    },
  };
}
