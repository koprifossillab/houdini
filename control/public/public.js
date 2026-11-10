// Houdini 제작 관제실 — public page (TC-DASH-008 운영 공개 정책). The server sends only fixed words and
// small counts (server public projection); this page only lays them out. Text only through textContent.
'use strict';
(() => {
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const TONE = { producing: 'ok', verifying: 'ok', done: 'ok', waiting_result: 'info', waiting_user: 'wait', unverified: 'unk',
  confirmed: 'ok', unconfirmed: 'unk', not_connected: 'unk', not_collected: 'unk', in_progress: 'ok', waiting: 'info', open: 'unk', fresh: 'ok', partial: 'wait', missing: 'bad' };
const badge = p => h('span', { class: `b lv lv-${TONE[p.key] || 'unk'}`, text: p.label });
const gradeTag = p => h('span', { class: `g g-${{ confirmed: 'confirmed', reported: 'claim', estimated: 'clue' }[p.key] || 'none'}`, text: p.label });

let board = null, live = null, liveEtag = null, refreshedAt = null, failed = false;
// the browser's own clock: when this page last received data (the server publishes no times)
const clock = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

async function getBoard() {
  const r = await fetch('api/board', { cache: 'no-store', credentials: 'same-origin' });
  if (!r.ok) throw Error(String(r.status));
  board = await r.json();
}
async function getLive() {
  const r = await fetch('api/live', { cache: 'no-store', credentials: 'same-origin', headers: liveEtag ? { 'If-None-Match': liveEtag } : {} });
  if (r.status === 200) { live = await r.json(); liveEtag = r.headers.get('ETag'); } else if (r.status !== 304) throw Error(String(r.status));
}
async function load(withBoard) {
  if (document.hidden) return;
  try { await Promise.all([getLive(), withBoard || !board ? getBoard() : null]); failed = false; refreshedAt = new Date(); } catch { failed = true; }
  render();
}

function render() {
  const ban = $('banner');
  ban.hidden = !failed;
  ban.textContent = failed ? '서버 연결 실패 — 마지막으로 받은 값을 보여 줍니다. 지금 값이 아닐 수 있습니다.' : '';
  $('served').textContent = refreshedAt ? `화면 갱신 ${clock.format(refreshedAt)} (이 브라우저 기준) · 20초마다` : '자료 없음';
  const v = $('view');
  v.replaceChildren();
  if (!live || !board) { v.append(h('div', { class: 'empty', text: '자료를 불러오지 못했습니다.' })); return; }
  v.append(
    h('section', { class: 'card live' },
      h('div', { class: 'row' }, h('h2', { text: '지금 · 팀별 상태' }), badge(live.freshness)),
      h('div', { class: 'g4' }, live.teams.map(t => h('article', { class: 'tile' },
        h('b', { text: t.label }),
        h('div', { class: 'stack' }, h('span', { class: 'lbl', text: '작업 상태' }), h('span', {}, badge(t.status), ' ', gradeTag(t.grade))),
        h('div', { class: 'stack split' }, h('span', { class: 'lbl', text: '실행' }), h('span', {}, badge(t.execution))))))),
    h('section', { class: 'card' },
      h('div', { class: 'stack' }, h('span', { class: 'lbl', text: '프로젝트 · 진행 단계' }), h('h1', { text: board.project.label })),
      h('div', { class: 'steps' }, board.project.stage.map(s => h('div', { class: 'step' }, h('span', { class: 'lbl', text: s.label }), h('span', {}, badge(s.state)), h('span', {}, gradeTag(s.grade))))),
      h('span', { class: 'ev', text: `열린 제작 작업 ${board.project.open_tasks}건 · 진행 단계는 가장 최근 제작 작업 기준` })),
    h('section', { class: 'card' }, h('h2', { text: '대기 중인 행동 (건수만)' }),
      h('div', { class: 'g5' }, board.pending.map(p => h('div', { class: 'step' }, h('span', { class: 'lbl', text: p.label }), h('span', { class: 'n', text: String(p.count) }))))),
    h('section', { class: 'legend' }, h('span', { class: 'lbl', text: '근거 등급' }),
      h('span', {}, gradeTag({ key: 'confirmed', label: '확인' }), ' 근거가 붙은 기록·서명 기록·실행 기록'),
      h('span', {}, gradeTag({ key: 'reported', label: '보고' }), ' 팀이 적었으나 근거 없음'),
      h('span', {}, gradeTag({ key: 'estimated', label: '추정' }), ' 폴더·파일 단서')),
    h('p', { class: 'ev', text: live.note }));
}

fetch('api/session', { cache: 'no-store' }).then(r => r.json()).then(s => { $('version').textContent = `판 ${s.version}`; }).catch(() => {});
load(true);
let n = 0;
setInterval(() => { n += 1; load(n % 3 === 0); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
})();
