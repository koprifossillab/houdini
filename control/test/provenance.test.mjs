// TC-DASH-004 D-1 / TC-DASH-005 — provenance (self / signed / transcribed), director originals check,
// exclusion of the originals folder from the NAS clue search, and blocking of source-less approvals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tmp, serve } from './helpers.mjs';
import { buildBoard, nowState } from '../lib/board.mjs';
import { parseCard, parseDecision, readSignedWork, refText } from '../lib/handoff.mjs';
import { directorOriginals, decisionValidity } from '../lib/director.mjs';
import { nasClues, nasImage, publicNas, clearNasCache } from '../lib/nas.mjs';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const put = async (p, body) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, body); };
const NOW = Date.parse('2026-11-10T10:00:00+09:00');
const iso = ms => new Date(ms).toISOString();
const card = (team, extra) => parseCard({ schema: 'tc-handoff/1', team, task_id: 'TC-VIS-030', title: '작업', state: 'in_progress', at: iso(NOW - 60000), evidence: [{ kind: 'file', ref: '근거' }], ...extra }, team, 'c.json');
const dec = extra => parseDecision({ schema: 'tc-decision/1', source: { ref: '감독 지시 원문' }, at: '2026-11-10T09:00:00+09:00', ...extra }, `${extra.id || extra.kind}.json`);

// a real ed25519 key pair and a valid tc-work-event/1 envelope
function workKey() { return crypto.generateKeyPairSync('ed25519'); }
function envelope(priv, over = {}) {
  const p = { schema: 'tc-work-event/1', team_id: 'TC-WORK', event_id: crypto.randomUUID(), sequence: 3, previous_hash: null, event_type: 'progress', task_id: 'TC-WORK-REVIEW-20261110', occurred_at: iso(NOW - 120000), summary: '시각 검토 진행', commit: null, next: ['감독 보고'], artifacts: [], validation: 'not_reviewed', handoff_sha256: 'cd'.repeat(32), ...over };
  const bytes = Buffer.from(JSON.stringify(p));
  return { payload_b64: bytes.toString('base64'), signature_b64: crypto.sign(null, bytes, priv).toString('base64') };
}

test('three kinds of provenance are kept apart; a file cannot declare itself signed', () => {
  const self = card('TC-PROD', { author: { method: 'self', session: 'TC-PROD-20261110' } });
  assert.equal(self.author.method, 'self');
  assert.equal(self.grade, 'confirmed');
  assert.equal(self.author.identity_verified, false);
  const fake = card('TC-WORK', { author: { method: 'signed' } });
  assert.equal(fake.author.method, 'self', 'claimed signature is not trusted');
  assert.equal(fake.author.signed_claim_ignored, true);
  assert.notEqual(fake.grade, 'signed');
  const tr = card('TC-PROD', { author: { method: 'transcribed', transcribed_by: 'TC-DASH', transcribed_from: { ref: 'film/TC3D_X/REPORT_KO.md', at: '2026-11-09T14:44:58+09:00' } } });
  assert.equal(tr.grade, 'transcribed');
  assert.equal(tr.author.transcribed_from.ref, 'TC3D_X › REPORT_KO.md');
  assert.equal(card('TC-PROD', { author: { method: 'transcribed' }, evidence: [] }), null, 'transcription without a source is rejected');
  const legacy = card('TC-PROD', { transcribed_by: 'TC-DASH', evidence: [{ kind: 'nas', ref: 'film/TC3D_Y/DEFECT_KO.md', at: '2026-11-09T14:44:58+09:00' }] });
  assert.equal(legacy.grade, 'transcribed', 'legacy cards with transcribed_by are transcriptions');
  assert.equal(legacy.author.transcribed_from.ref, 'TC3D_Y › DEFECT_KO.md');
  assert.equal(legacy.author.transcribed_from.at, new Date('2026-11-09T14:44:58+09:00').toISOString());
  const b = buildBoard({ cards: [self, tr], now: NOW });
  const ev = b.current.last;
  assert.ok(['직접 작성', '전사'].some(w => ev.provenance.includes(w)));
  assert.match(buildBoard({ cards: [self], now: NOW }).current.last.provenance, /신원 미검증/);
  assert.match(buildBoard({ cards: [tr], now: NOW }).current.last.provenance, /전사/);
});

test('transcribed cards never make "now" in progress; signed ones can, labelled as integrity only', async t => {
  const tr = card('TC-PROD', { author: { method: 'transcribed', transcribed_by: 'TC-DASH', transcribed_from: { ref: 'x', at: iso(NOW - 60000) } } });
  assert.equal(nowState(tr, NOW).state, 'unverified');
  assert.match(nowState(tr, NOW).basis, /전사/);
  const dir = await tmp(t);
  const { publicKey, privateKey } = workKey();
  const keyfile = path.join(dir, 'key.pem');
  await fs.writeFile(keyfile, publicKey.export({ type: 'spki', format: 'pem' }));
  await put(path.join(dir, 'w', 'latest.json'), JSON.stringify(envelope(privateKey)));
  const before = sha(await fs.readFile(path.join(dir, 'w', 'latest.json')));
  const r = await readSignedWork(path.join(dir, 'w'), keyfile);
  assert.equal(r.items.length, 1);
  const s = r.items[0];
  assert.equal(s.grade, 'signed');
  assert.equal(s.author.identity_verified, false);
  assert.equal(nowState(s, NOW).state, 'in_progress');
  const b = buildBoard({ cards: r.items, now: NOW });
  assert.match(b.teams.find(x => x.id === 'TC-WORK').last.provenance, /무결성.*신원 증명 아님/);
  assert.ok(b.teams.find(x => x.id === 'TC-WORK').last.source.includes('서명 Work 기록 #3'), 'original event sequence kept as source');
  assert.equal(sha(await fs.readFile(path.join(dir, 'w', 'latest.json'))), before, 'signed originals are only read');
  // the original event identity is kept in full (TC-HANDOFF-002)
  const env = JSON.parse(await fs.readFile(path.join(dir, 'w', 'latest.json'), 'utf8'));
  const payload = JSON.parse(Buffer.from(env.payload_b64, 'base64').toString());
  assert.equal(s.author.event.event_hash, sha(Buffer.from(env.payload_b64, 'base64')), 'full SHA-256 of the signed payload');
  assert.equal(s.author.event.sequence, payload.sequence);
  assert.equal(s.author.event.previous_hash, payload.previous_hash);
  assert.equal(s.author.event.event_id, payload.event_id);
  assert.equal(b.teams.find(x => x.id === 'TC-WORK').last.signed.event_hash.length, 64, 'exposed through the board API');
});

test('tampered or foreign-key Work events produce no card', async t => {
  const dir = await tmp(t);
  const { publicKey, privateKey } = workKey();
  const other = workKey();
  const keyfile = path.join(dir, 'key.pem');
  await fs.writeFile(keyfile, publicKey.export({ type: 'spki', format: 'pem' }));
  const env = envelope(privateKey);
  const p = JSON.parse(Buffer.from(env.payload_b64, 'base64').toString());
  p.summary = '바꿔치기';
  await put(path.join(dir, 'w', 'latest.json'), JSON.stringify({ ...env, payload_b64: Buffer.from(JSON.stringify(p)).toString('base64') }));
  await put(path.join(dir, 'w', 'task-start.json'), JSON.stringify(envelope(other.privateKey, { event_type: 'start', sequence: 2 })));
  const r = await readSignedWork(path.join(dir, 'w'), keyfile);
  assert.equal(r.items.length, 0);
  assert.equal(r.invalid, 2);
});

test('director decisions: valid only with a matched original AND a user confirmation', () => {
  const d = dec({ id: 'hold', kind: 'hold', task_id: 'TC-VIS-030', directive_id: 'TC-VIS-030', subject: '보류' });
  const o = (content, method, checked = '2026-11-10T09:30:00+09:00') => ({ byDirective: new Map([['TC-VIS-030', { content, check_method: method, checked_at: checked, sha256: 'ab'.repeat(8) }]]) });
  assert.equal(decisionValidity(d, null).validity, 'source_unverified');
  assert.equal(decisionValidity({ ...d, directive_id: null }, o('matched', 'user_confirmed')).validity, 'source_unverified');
  assert.equal(decisionValidity(d, o('mismatch', 'user_confirmed')).validity, 'source_mismatch');
  assert.equal(decisionValidity(d, o('missing', 'user_confirmed')).validity, 'source_unverified');
  assert.equal(decisionValidity(d, o('matched', 'transcribed')).validity, 'content_matched', 'hash match alone is not a valid decision');
  assert.equal(decisionValidity(d, o('matched', 'user_confirmed', null)).validity, 'content_matched');
  const v = decisionValidity(d, o('matched', 'user_confirmed'));
  assert.equal(v.validity, 'valid');
  assert.match(v.label, /신원·권한 증명 아님/);

  const toDirector = card('TC-PROD', { state: 'handed_off', to: 'director', next: '결정 요청', at: '2026-11-10T08:00:00+09:00' });
  const closure = dec({ id: 'close', kind: 'closure', task_id: 'TC-VIS-030', directive_id: 'TC-VIS-030', subject: '종료' });
  for (const [orig, pending] of [[null, true], [o('matched', 'transcribed'), true], [o('matched', 'user_confirmed'), false]]) {
    const b = buildBoard({ cards: [toDirector], decisions: [d, closure], originals: orig, now: NOW });
    assert.equal(b.actions.some(a => a.who === 'director'), pending, `pending=${pending}`);
    // TC-DASH-007: a validly closed task is no longer the current task; its steps stay in the history
    const row = pending ? b.current : b.history.find(r => r.task_id === 'TC-VIS-030');
    if (!pending) assert.equal(b.current.task_id, null, 'a closed task never stays current');
    const step = row.steps.find(s => s.key === 'director');
    assert.equal(step.kind === 'decision', !pending);
    assert.equal(!!b.last_done && b.last_done.kind === 'closure', !pending, 'only a valid closure closes a task');
  }
});

test('approvals without a cited source are refused; baselines from unchecked records are not valid', () => {
  assert.equal(parseDecision({ schema: 'tc-decision/1', kind: 'approval', task_id: 'TC-VIS-030', at: '2026-11-10T09:00:00+09:00' }, 'a.json'), null);
  assert.equal(parseDecision({ schema: 'tc-decision/1', kind: 'approval', task_id: 'TC-VIS-030', at: '2026-11-10T09:00:00+09:00', source: {} }, 'a.json'), null);
  const base = dec({ kind: 'baseline', baseline: { name: 'v6.5h', commit: 'f8e2818' }, directive_id: 'TC-066-09' });
  const b = buildBoard({ decisions: [base], now: NOW });
  assert.equal(b.baseline.name, 'v6.5h');
  assert.equal(b.baseline.valid, false);
  assert.equal(b.baseline.validity, 'source_unverified');
  const cs = buildBoard({ decisions: [dec({ kind: 'candidate_status', candidate: { name: 'v6.6c', status: 'candidate' } })], now: NOW }).candidates[0];
  assert.equal(cs.status_valid, false);
  assert.match(cs.status_label, /유효 판정 아님/);
});

async function originalsFixture(t) {
  const root = await tmp(t);
  const film = path.join(root, 'film');
  const dir = path.join(film, 'TC3D_DIRECTOR_DECISIONS');
  const text = '【총괄 감독 지시: TC-DASH-005】 비공개 원문 본문 SECRET-BODY-TEXT\n';
  const png = Buffer.from('89504e470d0a1a0a00', 'hex');
  await put(path.join(dir, 'TC-DASH-005.md'), text);
  await put(path.join(dir, 'TC-DASH-006.md'), '다른 원문');
  await put(path.join(dir, 'UNLISTED_TC-VIS-777.md'), '# 목록에 없는 파일 TC-VIS-777');
  await put(path.join(dir, 'scan.png'), png);
  await put(path.join(dir, 'SHA256SUMS.txt'), `${sha(png)}  scan.png\n`);
  await put(path.join(root, 'outside.md'), 'OUTSIDE-SECRET');
  await fs.symlink(path.join(root, 'outside.md'), path.join(dir, 'TC-DASH-007.md'));
  await put(path.join(dir, 'INDEX.json'), JSON.stringify({ schema: 'tc-director-index/1', entries: [
    { directive_id: 'TC-DASH-005', file: 'TC-DASH-005.md', sha256: sha(text), source: '감독 대화 원문', written_at: '2026-11-09T18:00:00+09:00', checked_at: '2026-11-10T09:00:00+09:00', check_method: 'user_confirmed' },
    { directive_id: 'TC-DASH-006', file: 'TC-DASH-006.md', sha256: '00'.repeat(32), check_method: 'user_confirmed', checked_at: '2026-11-10T09:00:00+09:00' },
    { directive_id: 'TC-DASH-007', file: 'TC-DASH-007.md', sha256: sha('OUTSIDE-SECRET'), check_method: 'user_confirmed', checked_at: '2026-11-10T09:00:00+09:00' },
    { directive_id: 'TC-DASH-008', file: '../outside.md', sha256: sha('OUTSIDE-SECRET') },
  ] }));
  await put(path.join(film, 'TC3D_X_RESULT_20261110_RAW_PRESERVED', 'README_KO.md'), '# 일반 결과 TC-VIS-030');
  await put(path.join(film, 'TC_COPY_OF_DIRECTOR_DECISIONS', 'README_KO.md'), '# 사본 TC-DASH-005');
  clearNasCache();
  return { root, film, dir, png };
}

test('originals module reads listed files only and returns results without text, names or paths', async t => {
  const fx = await originalsFixture(t);
  const o = await directorOriginals(fx.dir);
  assert.equal(o.byDirective.get('TC-DASH-005').content, 'matched');
  assert.equal(o.byDirective.get('TC-DASH-006').content, 'mismatch');
  assert.equal(o.byDirective.get('TC-DASH-007').content, 'refused', 'symlink to a file outside');
  assert.ok(!o.byDirective.has('TC-DASH-008'), 'path-like file name not accepted');
  const out = JSON.stringify([...o.byDirective.values()]);
  for (const leak of ['SECRET-BODY-TEXT', 'OUTSIDE-SECRET', 'TC-DASH-005.md', 'UNLISTED', 'TC-VIS-777', fx.root, 'DIRECTOR_DECISIONS']) assert.ok(!out.includes(leak), leak);
  assert.equal((await directorOriginals(path.join(fx.root, 'nope'))).state, 'missing');
});

test('the originals folder never appears in the NAS clue search and cannot be fetched directly', async t => {
  const fx = await originalsFixture(t);
  for (const cfg of [{ film: fx.film }, { film: fx.film, directorDir: fx.dir }]) {
    clearNasCache();
    const v = await nasClues(cfg);
    const names = v.folders.map(f => f.name);
    assert.deepEqual(names, ['TC3D_X_RESULT_20261110_RAW_PRESERVED'], 'originals folder and any *DIRECTOR_DECISIONS* folder excluded');
    const pub = JSON.stringify(publicNas(v));
    for (const leak of ['DIRECTOR', 'TC-DASH-005', 'SECRET-BODY-TEXT', 'scan.png']) assert.ok(!pub.includes(leak), leak);
    // the id the image would have had if the folder were listed
    const guess = crypto.createHash('sha256').update(`${fx.film}\0TC3D_DIRECTOR_DECISIONS/scan.png`).digest('hex').slice(0, 16);
    assert.equal((await nasImage(v, guess)).status, 404);
  }
  assert.equal(refText('film/TC3D_DIRECTOR_DECISIONS/TC-DASH-005.md'), '감독 원문 보관 기록 (위치 비공개)');
});

test('HTTP: no originals text, folder name or path in any response; direct requests refused', async t => {
  const fx = await originalsFixture(t);
  const hand = await tmp(t);
  const decs = await tmp(t);
  await put(path.join(decs, 'd5.json'), JSON.stringify({ schema: 'tc-decision/1', kind: 'directive', task_id: 'TC-VIS-030', directive_id: 'TC-DASH-005', subject: '원문 보관 체계', at: '2026-11-09T18:00:00+09:00', source: { ref: 'film/TC3D_DIRECTOR_DECISIONS/TC-DASH-005.md' } }));
  await put(path.join(decs, 'nosource.json'), JSON.stringify({ schema: 'tc-decision/1', kind: 'approval', task_id: 'TC-VIS-030', subject: '출처 없는 승인', at: '2026-11-10T09:00:00+09:00' }));
  await put(path.join(hand, 'TC-PROD', 'a.json'), JSON.stringify({ schema: 'tc-handoff/1', team: 'TC-PROD', task_id: 'TC-VIS-030', title: '결정 요청', state: 'handed_off', to: 'director', at: '2026-11-10T08:00:00+09:00', evidence: [{ kind: 'nas', ref: 'film/TC3D_DIRECTOR_DECISIONS/TC-DASH-005.md' }] }));
  const base = await serve(t, { handoffDir: hand, decisionsDir: decs, directorDir: fx.dir, nas: { film: fx.film, directorDir: fx.dir, exclude: [] } });
  const b = await (await fetch(base + '/Houdini/api/board')).json();
  assert.equal(b.sources.decisions.invalid, 1, 'source-less approval refused');
  assert.ok(b.actions.some(a => a.who === 'director' && a.task_id === 'TC-VIS-030'), 'still pending');
  assert.equal(b.sources.director.entries, 3);
  for (const route of ['api/board', 'api/nas', 'api/overview', 'healthz']) {
    const text = await (await fetch(base + '/Houdini/' + route)).text();
    for (const leak of ['SECRET-BODY-TEXT', 'OUTSIDE-SECRET', 'TC3D_DIRECTOR_DECISIONS', 'TC-DASH-005.md', 'UNLISTED', fx.root]) assert.ok(!text.includes(leak), `${route} leaks ${leak}`);
  }
  for (const p of ['api/director', 'director/TC-DASH-005', 'nasimg/' + crypto.createHash('sha256').update(`${fx.film}\0TC3D_DIRECTOR_DECISIONS/scan.png`).digest('hex').slice(0, 16), 'media/TC-DASH-005', 'api/reports/' + 'a'.repeat(16)]) {
    assert.ok([400, 404].includes((await fetch(base + '/Houdini/' + p)).status), p);
  }
});

test('a run cited by a transcribed card keeps the transcription grade', () => {
  const nas = { folders: [{ name: 'TC3D_X_RESULT_20261109_125858_RAW_PRESERVED', clue: 'run_preserved', clue_label: '실행 원본 보존 표지', run_lock: true, mtime: '2026-11-09T04:06:17.000Z', images: [] }] };
  const tr = card('TC-PROD', { state: 'handed_off', author: { method: 'transcribed', transcribed_by: 'TC-DASH', transcribed_from: { ref: 'film/TC3D_X_RESULT_20261109_125858_RAW_PRESERVED', at: '2026-11-09T13:06:17+09:00' } }, evidence: [{ kind: 'nas', ref: 'film/TC3D_X_RESULT_20261109_125858_RAW_PRESERVED' }] });
  assert.equal(buildBoard({ cards: [tr], nas, now: NOW }).execution.last_run.grade, 'transcribed');
  assert.equal(buildBoard({ cards: [], nas, now: NOW }).execution.last_run.grade, 'clue');
});

// QA F1 (QA_TC-DASH-004_D1_REVIEW_KO.md §2): transcriptions without an explicit original location and time
test('F1: a transcription is refused unless the original location and its own time are given', async t => {
  const base = { schema: 'tc-handoff/1', team: 'TC-WORK', task_id: 'TC-VIS-030', title: 't', state: 'in_progress', at: '2026-11-10T10:00:00+09:00' };
  const tr = { method: 'transcribed', transcribed_by: 'TC-DASH' };
  const refused = {
    'new format, no transcribed_from, evidence without time': { ...base, author: tr, evidence: [{ kind: 'report', ref: '③ 보고' }] },
    'new format, no transcribed_from, evidence with time': { ...base, author: tr, evidence: [{ kind: 'report', ref: '③ 보고', at: '2026-11-10T09:00:00+09:00' }] },
    'new format, no transcribed_from, no evidence': { ...base, author: tr },
    'new format, transcribed_from without time': { ...base, author: { ...tr, transcribed_from: { ref: 'r' } } },
    'new format, transcribed_from without location': { ...base, author: { ...tr, transcribed_from: { at: '2026-11-10T09:00:00+09:00' } } },
    'legacy, evidence without time': { ...base, transcribed_by: 'TC-DASH', evidence: [{ kind: 'report', ref: 'x' }] },
    'legacy, no evidence': { ...base, transcribed_by: 'TC-DASH' },
  };
  for (const [k, doc] of Object.entries(refused)) assert.equal(parseCard(doc, 'TC-WORK', 'a.json'), null, k);
  const ok = parseCard({ ...base, author: { ...tr, transcribed_from: { ref: 'r', at: '2026-11-10T09:00:00+09:00' } } }, 'TC-WORK', 'a.json');
  assert.equal(ok.author.transcribed_from.at, new Date('2026-11-10T09:00:00+09:00').toISOString());
  assert.notEqual(ok.author.transcribed_from.at, new Date(base.at).toISOString(), 'never the card time');
  const legacyOk = parseCard({ ...base, transcribed_by: 'TC-DASH', evidence: [{ kind: 'report', ref: 'x', at: '2026-11-09T13:06:17+09:00' }] }, 'TC-WORK', 'a.json');
  assert.equal(legacyOk.author.transcribed_from.at, new Date('2026-11-09T13:06:17+09:00').toISOString());
  // the card checker agrees with the reader (Q12)
  const { execFile } = await import('node:child_process');
  const dir = await tmp(t);
  const f = path.join(dir, 'TC-WORK', '20261110-1000_TC-VIS-030.json');
  await put(f, JSON.stringify(refused['new format, no transcribed_from, evidence without time']));
  const code = await new Promise(r => execFile(process.execPath, [new URL('../scripts/check-card.mjs', import.meta.url).pathname, f], e => r(e ? e.code : 0)));
  assert.equal(code, 1, 'check-card refuses it too');
});

// every /api/board source key has a label on the home screen (production 0.2.0 printed "undefined ok (2)")
test('home source strip labels every board source; cost panel reads USD and KRW', async () => {
  const js = await fs.readFile(new URL('../public/board.js', import.meta.url), 'utf8');
  const m = /const SOURCE_LABEL = (\{[^}]+\})/.exec(js);
  assert.ok(m, 'SOURCE_LABEL defined');
  const labels = Function(`return ${m[1]}`)();
  for (const k of ['handoff', 'decisions', 'signed_work', 'director', 'nas', 'team_live']) assert.ok(labels[k], k);
  assert.ok(!('provenance' in labels), 'the provenance tally is not listed as a source');
  const server = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  for (const k of ['handoff:', 'decisions:', 'signed_work:', 'director:', 'nas:', 'team_live:']) assert.ok(server.includes(k), `server emits ${k}`);
  for (const f of ['cost_krw', 'krw_per_hour', 'cost_usd', 'today_kst', 'last_60m']) assert.ok(js.includes(f), `cost panel uses ${f}`);
  assert.match(js, /실제 청구액 아님/);
});
