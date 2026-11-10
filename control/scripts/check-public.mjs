// Public exposure check (TC-DASH-008) — read only. Crawls a running service the way any visitor could and
// fails if a response carries anything outside the public vocabulary or matches a private pattern.
//   node scripts/check-public.mjs http://127.0.0.1:18093/Houdini
//   CHECK_LEAK_TERMS=name1,name2  extra private words to look for (never printed)
import { checkPublic, scanText } from '../lib/public.mjs';

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('사용법: node scripts/check-public.mjs <기본 주소>'); process.exit(2); }
const terms = (process.env.CHECK_LEAK_TERMS || '').split(',').map(s => s.trim()).filter(Boolean);
const OK = ['/', '/index.html', '/static/public.js', '/static/board.css', '/static/icon.svg', '/api/session', '/api/board', '/api/live', '/healthz',
  '/api/board?detail=1&sort=at&q=TC', '/api/live?detail=1&team=TC-PROD'];
const CLOSED = ['/legacy.html', '/static/board.js', '/static/app.js', '/static/style.css', '/static/scene-review.json', '/static/scene-review.js', '/static/team-clock.js', '/static/work-clock.js',
  '/api/overview', '/api/reports', '/api/reports/0123456789abcdef', '/api/experiments', '/api/media', '/api/teams', '/api/nas', '/nasimg/0123456789abcdef', '/media/x',
  '/api/board/', '/API/board', '/api/board.json', '/nope', '/static/../server.mjs', '/static/%2e%2e/server.mjs', '/.env'];
let fail = 0;
const bad = (m) => { fail += 1; console.log(`FAIL  ${m}`); };
for (const p of [...OK, ...CLOSED]) {
  for (const method of ['GET', 'HEAD', 'POST']) {
    let r, body;
    try { r = await fetch(base + p, { method, redirect: 'manual' }); body = await r.text(); } catch { bad(`${method} ${p} 연결 실패`); continue; }
    const w = `${method} ${p} → ${r.status}`;
    if (method === 'POST') { if (r.status !== 405) bad(`${w} (405 기대)`); continue; }
    if (OK.includes(p) ? r.status !== 200 : ![400, 404].includes(r.status)) bad(`${w} (${OK.includes(p) ? '200' : '404'} 기대)`);
    for (const [k, v] of r.headers) if (!['date', 'etag'].includes(k)) { const h = scanText(`${k}: ${v}`, terms); if (h.length) bad(`${w} 헤더 ${k}: ${h.join(', ')}`); }
    if (method === 'HEAD' || !body) continue;
    const hits = scanText(body, terms);
    if (hits.length) bad(`${w} 본문: ${hits.join(', ')}`);
    if (/json/.test(r.headers.get('content-type') || '')) { const probs = checkPublic(JSON.parse(body)); if (probs.length) bad(`${w} 공개 어휘 밖: ${probs.slice(0, 5).join(' · ')}`); }
  }
}
console.log(fail ? `공개 노출 검사 실패 ${fail}건` : `공개 노출 검사 통과 — 경로 ${OK.length + CLOSED.length}개 × GET·HEAD·POST`);
process.exit(fail ? 1 : 0);
