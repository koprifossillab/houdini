// Houdini 제작 관제실 (TC-DASH-003) — browser side. Text only through textContent; no HTML from data.
'use strict';
(() => {
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = v => Object.fromEntries(FMT.formatToParts(new Date(v)).map(p => [p.type, p.value]));
function when(v, precision) {
  if (!v) return '시각 없음';
  const p = parts(v);
  return precision === 'date' ? `${p.month}/${p.day} (시각 미기록)` : `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}
// provenance / evidence grades (D-1): never merged into one 'confirmed' label
const GRADE = { confirmed: '직접 작성', claim: '근거 없는 카드', signed: '서명 확인', transcribed: '전사', valid_decision: '유효 판정', content_matched: '원문 일치·확인 전', clue: '단서', none: '근거 없음' };
const grade = g => h('span', { class: `g g-${g || 'none'}`, text: GRADE[g] || '근거 없음' });
// short evidence line on screen, the full chain in the tooltip
function shortSource(src) {
  if (!src) return '근거 없음';
  const [head, rest] = src.split(' → ');
  const kind = head.startsWith('판정 기록') ? '판정 기록' : head.startsWith('인계 카드') ? `${head.split(' ')[2]?.split('/')[0] || ''} 카드` : '';
  if (!rest) return head;
  const refs = rest.split(' · ');
  const first = refs[0].includes('›') ? refs[0].split('›').pop().trim() : refs[0];
  return `${kind} · ${first}${refs.length > 1 ? ` 외 ${refs.length - 1}` : ''}`;
}
const fromText = x => (x?.transcribed?.from ? ` · 원문 ${x.transcribed.from.ref.split('›').pop().trim()} ${when(x.transcribed.from.at, x.transcribed.from.at_precision)}` : '');
const evl = x => h('span', { class: 'ev', title: [x?.provenance, x?.source].filter(Boolean).join('\n') }, grade(x?.grade), `${shortSource(x?.source)} · ${x?.at ? when(x.at, x.at_precision) : '시각 없음'}${fromText(x)}`);
const VSYM = { PASS: '✓', FAIL: '✕', REVIEW: '!', UNVERIFIED: '◇' };
const VSCOPE = { technical: '기술', visual: '시각', physics: '물리', selfcheck: '자체 검사', run: '실행' };
const verdict = (v, scope) => h('span', { class: `b verdict v-${v}`, text: `${VSYM[v] || ''} ${v}${scope ? ` · ${VSCOPE[scope] || scope}` : ''}` });
const SSYM = { recorded: '◌', in_progress: '▶', pending: '…', handed_off: '→', issued: '✓', blocked: '■', done: '✓', closure: '✓', approval: '✓', rejection: '✕', hold: '‖', unverified: '?', none: '?', open: '—', unapproved: '?' };
const SLABEL = { in_progress: '진행 중', handed_off: '넘김', blocked: '차단', done: '완료', pending: '대기', unverified: '미확인', none: '미확인', open: '미정' };
const state = (s, label) => h('span', { class: `b s-${s}`, text: `${SSYM[s] || ''} ${label || SLABEL[s] || s}` });
const SEV = { blocking: '✕ 차단', fail: '✕ FAIL', review: '! REVIEW', known: '■ 알려진 결함' };
const sev = s => h('span', { class: `b sev-${s}`, text: SEV[s] || s });
const stepBadge = st => (st.kind === 'verdict' ? verdict(st.value, st.scope) : state(st.value, st.text));
// state and verdict are always two separate badges (a FAIL verdict is not a work state)
const lastCard = l => (l ? h('span', { class: 'badges' }, state(l.state), l.verdict ? verdict(l.verdict, l.verdict_scope) : null) : state('none'));
const empty = text => h('div', { class: 'empty', text });

let board = null, teamsApi = null, overview = null, nas = null, roadmapApi = null, picked = null, failed = false;
async function getJson(url) { const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) throw Error(String(r.status)); return r.json(); }

async function load() {
  try {
    const route = currentRoute();
    board = await getJson('api/board');
    // token use / cost (USD · KRW) is shown on home and tech, so the team API is read on every refresh
    teamsApi = await getJson('api/teams').catch(() => teamsApi);
    if (route === 'roadmap') roadmapApi = await getJson('api/roadmap').catch(() => roadmapApi);
    if (route === 'tech' || route === 'data') {
      [overview, nas] = await Promise.all([getJson('api/overview').catch(() => null), getJson('api/nas').catch(() => null)]);
    }
    failed = false;
  } catch { failed = true; }
  render();
}

const currentRoute = () => (['home', 'roadmap', 'teams', 'issues', 'review', 'tech', 'data'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home');
function render() {
  const route = currentRoute();
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('on', a.dataset.route === route));
  const ban = $('banner');
  ban.hidden = !failed;
  ban.textContent = failed ? (board ? `서버 연결 실패 — 마지막으로 받은 자료(${when(board.served_at)})를 보여 줍니다. 지금 값이 아닙니다.` : '서버 연결 실패 — 표시할 자료가 없습니다.') : '';
  $('served').textContent = board ? `자료 받은 시각 ${when(board.served_at)} · 30초마다 갱신` : '자료 없음';
  const v = $('view');
  v.replaceChildren();
  if (!board) { v.append(empty('자료를 불러오지 못했습니다.')); return; }
  ({ home, roadmap, teams, issues, review, tech, data })[route](v);
  if (route !== 'home') window.scrollTo(0, 0);
}

const SOURCE_LABEL = { handoff: '인계 카드', decisions: '판정 기록', signed_work: '서명 Work 기록', director: '감독 원문 대조', nas: 'NAS 단서', team_live: '팀 세션' };
// ── TC-DASH-008 "지금" — /api/live every 20 s (paused while the tab is hidden; 304 when nothing changed) ──
let live = null, liveEtag = null, liveFetchedAt = null, liveCheckedAt = null, liveFailed = false;
const FMTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const hms = v => (v ? FMTS.format(new Date(v)) : '—');
const ago = v => { const m = Math.max(0, Math.round((Date.now() - Date.parse(v)) / 60000)); return m < 1 ? '방금' : m < 120 ? `${m}분 전` : m < 2880 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const TONE = { blocked: 'bad', fail: 'bad', pc_last_fail: 'bad', wait_qa: 'wait', wait_prod: 'wait', wait_work: 'wait', wait_dash: 'wait', wait_director: 'wait', wait_user: 'wait', review: 'wait', working_claim: 'wait',
  working: 'ok', pass: 'ok', done: 'ok', handed_answered: 'info', handed_off: 'info', session_active: 'ok', pc_last_ok: 'ok', pc_run_recorded: 'ok', session_idle: 'info' };
const lv = (key, label) => h('span', { class: `b lv lv-${TONE[key] || 'unk'}`, text: label });
const BUCKET = { none: '기록 없음', within_2h: '2시간 이내', within_24h: '24시간 이내', older: '24시간보다 오래됨' };
const FLAG = { future: '미래 시각 기록', ahead_of_write: '기록 시각이 실제 작성보다 늦음 — 작성 시각으로 정렬', corrected: '기록 시각 정정 기록 있음', multiple_corrections: '정정 기록 여러 건 — 가장 최근 정정 적용', not_current: '미래 시각이라 현재 상태 판정에서 제외' };
async function loadLive() {
  if (document.hidden || currentRoute() !== 'home') return;
  try {
    const r = await fetch('api/live', { cache: 'no-store', credentials: 'same-origin', headers: liveEtag ? { 'If-None-Match': liveEtag } : {} });
    if (r.status === 200) { live = await r.json(); liveEtag = r.headers.get('ETag'); } else if (r.status !== 304) throw Error(String(r.status));
    liveCheckedAt = r.headers.get('X-Live-Checked-At') || liveCheckedAt;
    liveFetchedAt = new Date().toISOString();
    liveFailed = false;
  } catch { liveFailed = true; }
  const n = $('live');
  if (n) n.replaceWith(liveSection());
}
function liveTile(t, detail) {
  const r = t.report;
  return h('article', { class: 'tile' },
    h('div', { class: 'row' }, h('b', { text: t.label }), h('span', { class: 'ev', text: detail ? (t.last ? `마지막 근거 ${ago(t.last.at)} · ${t.last.source}` : '근거 없음') : `마지막 근거 ${BUCKET[t.last_bucket] || '—'}` })),
    h('div', { class: 'stack' }, h('span', { class: 'lbl', text: '보고된 상태 (인계 카드·서명 기록)' }),
      h('span', {}, lv(r.key, r.label), ' ', grade(r.grade)),
      r.last ? h('span', { class: 'ev', text: `마지막 보고 내용: ${r.last.label} — 지금 상태로 보지 않음` }) : null,
      detail && r.task_id ? h('span', {}, h('span', { class: 'mono', text: r.task_id }), ` ${r.title}`) : null,
      detail && r.at ? h('span', { class: 'ev', text: `${when(r.at)} 기록${r.to ? ` → ${r.to}` : ''}` }) : null,
      detail && r.flags?.length ? h('span', { class: 'ev warnline', text: r.flags.map(f => FLAG[f] || f).join(' · ') }) : null,
      detail && t.open_tasks?.length ? h('span', { class: 'ev', text: `그 밖에 진행·차단으로 보고된 작업: ${t.open_tasks.join(' · ')}` }) : null),
    h('div', { class: 'stack split' }, h('span', { class: 'lbl', text: '실제 실행 확인' }),
      h('span', {}, lv(t.session.key, t.session.label)), h('span', { class: 'ev', text: `${t.session.basis}${detail && t.session.observed_at ? ` · 수집 ${hms(t.session.observed_at)}` : ''}` }),
      detail && t.pc ? h('span', {}, lv(t.pc.key, t.pc.label)) : null,
      detail && t.pc?.last ? h('span', { class: 'ev', text: `${t.pc.last.job} · ${t.pc.last.finished ? `종료 ${when(t.pc.last.finished)}` : `시작 ${when(t.pc.last.started)}`}${t.pc.last.render_sec !== null ? ` · ${Math.round(t.pc.last.render_sec / 60)}분` : ''}` }) : null,
      detail && t.pc ? h('span', { class: 'ev', text: `실행 파일 배치 후 결과 없음 ${t.pc.placed}건 — ${t.pc.placed_note}` }) : null));
}
function liveSection() {
  const sec = h('section', { id: 'live', class: 'card live' },
    h('div', { class: 'row' }, h('h2', { text: '지금 · 팀별 상태' }),
      h('span', { class: 'ev', text: `화면 갱신 ${hms(liveFetchedAt)} (브라우저) · 자료 확인 ${hms(liveCheckedAt)} (서버) · 20초마다` })));
  if (liveFailed) sec.append(h('div', { class: 'ev warnline', text: `실시간 자료를 받지 못함 — ${live ? '아래는 마지막으로 받은 값이며 지금 값이 아닙니다' : '표시할 자료가 없습니다'}` }));
  if (!live) { sec.append(empty('불러오는 중')); return sec; }
  sec.append(h('div', { class: 'g4' }, live.teams.map(t => liveTile(t, live.detail))));
  if (!live.detail) sec.append(h('span', { class: 'ev', text: live.detail_note }));
  else {
    sec.append(h('div', { class: 'scroll' }, h('table', { class: 'feed' }, h('thead', {}, h('tr', {}, ['시각', '팀', '출처', '내용'].map(x => h('th', { text: x })))),
      h('tbody', {}, live.feed.map(f => h('tr', {}, h('td', { class: 'mono', text: when(f.at) }), h('td', { text: f.team }), h('td', { text: f.source }),
        h('td', {}, f.task_id ? h('span', { class: 'mono', text: `${f.task_id} ` }) : null, f.text, f.flags?.length ? h('span', { class: 'ev warnline', text: ` · ${f.flags.map(x => FLAG[x] || x).join(' · ')}` }) : null)))))));
    const k = live.checks;
    sec.append(h('span', { class: 'ev', text: `기록 시각 검사 — 미래 시각 ${k.future} · 실제 작성보다 늦은 기록 ${k.ahead_of_write} · 정정 기록 적용 ${k.corrected}${live.corrections?.length ? ` (${live.corrections.map(c => `${c.team} ${c.target_file}: ${when(c.recorded_value)} → ${when(c.corrected_value)}`).join(' · ')})` : ''}` }));
  }
  sec.append(h('span', { class: 'ev', text: '보고된 상태는 팀이 적은 것이고, 실제 실행 확인은 세션 수집기와 PC 실행 결과 기록으로 본 것입니다. 실행 파일(BAT) 배치는 실행 증거가 아닙니다. 2시간 안에 새 기록이 없으면 미확인입니다. ③ WORK 는 별도 Windows 환경이라 실시간 활동 연결이 없습니다.' }));
  return sec;
}

function home(v) {
  const b = board, c = b.current;
  v.append(liveSection());
  v.append(
    h('section', { class: 'row' },
      h('div', { class: 'stack' }, h('span', { class: 'lbl', text: '현재 프로젝트 · 기준본' }), h('h1', { text: 'Thermal Collapse · Houdini 제작' }),
        h('span', {}, b.baseline.name ? `${b.baseline.valid ? '기준본' : '기준본 기록'} ${b.baseline.name}${b.baseline.commit ? ` ${b.baseline.commit}` : ''} · ${b.baseline.label}` : b.baseline.label), b.baseline.name && !b.baseline.valid ? h('span', { class: 'ev', text: `유효한 감독 판정 아님 — ${b.baseline.provenance || '원문 미확인'}` }) : null, evl(b.baseline))),
    h('section', { class: 'legend' }, h('span', { class: 'lbl', text: '출처' }),
      h('span', {}, grade('confirmed'), '담당 세션 제출 (작성자 신원 미검증)'), h('span', {}, grade('signed'), '③ 서명 검증 — 무결성만, 신원 증명 아님'), h('span', {}, grade('transcribed'), '다른 기록에서 옮겨 적음 — 확정 아님'),
      h('span', {}, grade('valid_decision'), '감독 원문 일치 + 사용자 확인'), h('span', {}, grade('clue'), '폴더 이름·파일 존재 — 상태·승인 확정 안 함'), h('span', {}, grade('claim'), '근거 없는 카드')),
  );
  // TC-DASH-007: home counts production actions that are needed now; control-room work and past user records
  // are listed apart (issues screen)
  // ② QA R1: only production work is counted here; control-room and other work are listed apart
  const acts = b.actions.filter(a => a.kind === 'production');
  const ctlActs = b.actions.filter(a => a.kind === 'control');
  const otherActs = b.actions.filter(a => a.kind === 'other');
  const count = who => acts.filter(a => a.who === who).length;
  v.append(h('section', { class: 'g4' },
    h('article', { class: 'card' }, h('span', { class: 'lbl', text: `1 · 현재 진행 중인 제작 작업${c.open_count > 1 ? ` (열린 작업 ${c.open_count})` : ''}` }),
      h('div', { class: 'row' }, h('b', { text: '실제 작업 상태 · 지금' }), state(c.now.state, c.now.label)), h('span', { class: 'ev', text: c.now.basis }),
      c.last ? h('div', { class: 'split' }, h('span', { class: 'lbl', text: `마지막 확인된 상태 · ${when(c.last.at, c.last.at_precision)}` }),
        h('div', { class: 'row' }, h('span', { class: 'big mono', text: c.task_id }), h('span', { class: 'ev', text: c.team_label })),
        h('span', { text: c.last.title }), h('span', {}, lastCard(c.last), c.last.to_label ? h('span', { class: 'ev', text: `  → ${c.last.to_label}` }) : null), evl(c.last),
        c.also_open?.length ? h('span', { class: 'ev', text: `다른 열린 제작 작업: ${c.also_open.map(x => x.task_id).join(' · ')}` }) : null) : empty('열린 제작 작업 기록 없음 — 미확인')),
    h('article', { class: 'card' }, h('span', { class: 'lbl', text: '2 · 실제 실행 상태' }),
      h('div', { class: 'row' }, h('b', { text: 'PC Houdini·Karma · 지금' }), state('unverified')), h('span', { class: 'ev', text: b.execution.now.basis }),
      b.execution.last_run ? h('div', { class: 'split' }, h('span', { class: 'lbl', text: '마지막으로 확인된 실행' }), h('span', { class: 'mono ev', text: b.execution.last_run.name }), evl(b.execution.last_run)) : empty('실행 기록 단서 없음')),
    h('article', { class: 'card' }, h('span', { class: 'lbl', text: '3 · 마지막 완료 작업' }),
      b.last_done ? [h('span', { class: 'big mono', text: b.last_done.task_id || '' }), h('span', { text: b.last_done.title }), b.last_done.verdict ? h('span', {}, verdict(b.last_done.verdict, b.last_done.verdict_scope)) : null, evl(b.last_done), h('span', { class: 'ev', text: '과거 완료 기록 — 현재 작업 아님' })] : empty('완료 근거가 확인된 제작 작업 없음 — 미확인'),
      b.done_unverified?.length ? h('span', { class: 'ev', text: `완료 미확인 ${b.done_unverified.length}: ${b.done_unverified.map(x => `${x.task_id} (${x.reason})`).join(' · ')}` }) : null),
    h('article', { class: 'card focus' }, h('span', { class: 'lbl', text: '4 · 다음 행동' }),
      ...[['director', '감독 결정'], ['TC-WORK', '③ WORK 검토'], ['TC-QA', '② QA 검증'], ['TC-PROD', '① PROD 작업'], ['user', '사용자 조치']].map(([k, l]) => h('div', { class: 'row' }, h('span', { text: l }), h('span', { class: 'n', text: String(count(k)) }))),
      h('span', { class: 'ev', text: `제작 작업에서 지금 필요한 것만 셉니다 (받는 쪽이 아직 답하지 않음 · 사용자 조치는 24시간 이내). 관제실 작업 ${ctlActs.length}건 · 기타 ${otherActs.length}건 · 지난 사용자 기록 ${b.actions_past.length}건은 따로` }), h('a', { href: '#issues', text: '승인 대기 목록 →' })),
  ));
  if (b.control?.open?.length) v.append(h('section', { class: 'card dash' }, h('span', { class: 'lbl', text: '관제실 개발 작업 (제작 작업과 별도)' }),
    h('span', { class: 'ev', text: b.control.open.map(x => `${x.task_id} · ${x.team} · ${{ in_progress: '진행 기록', handed_off: '넘김', blocked: '차단' }[x.state] || x.state}${x.to_label ? ` → ${x.to_label}` : ''} · ${when(x.at)}`).join('   |   ') })));
  if (c.steps.length) v.append(h('section', { class: 'card' }, h('h2', {}, '진행 단계 · ', h('span', { class: 'mono', text: c.task_id })),
    h('div', { class: 'steps' }, c.steps.map((s, i) => h('div', { class: 'step' }, h('span', { class: 'lbl', text: `${i + 1} · ${s.label}` }), h('span', {}, stepBadge(s)), evl(s))))));
  const proj = b.issues.project;
  v.append(h('section', { class: 'g2' },
    h('article', { class: 'card' }, h('div', { class: 'row' }, h('h2', { text: '프로젝트 전체 문제' }), h('a', { href: '#issues', text: '전체 보기' })),
      proj.length ? proj.slice(0, 5).map(i => h('div', { class: 'item' }, sev(i.severity), h('div', { class: 'stack' }, h('b', { text: i.title }), i.note ? h('span', { class: 'ev', text: i.note }) : null, evl(i)))) : empty('프로젝트 전체를 막는 문제 기록 없음'),
      h('div', { class: 'ev', text: `후보 한정 문제 ${b.issues.candidate.length}건은 해당 후보에만 붙습니다 — 기준본 판정에 영향 없음` })),
    h('article', { class: 'card' }, h('h2', { text: '다음 승인 · 검토 · 실행 (제작 작업)' }),
      acts.length ? acts.slice(0, 5).map(a => h('div', { class: 'item' }, h('span', { class: 'who', text: a.who_label }), h('div', { class: 'stack' }, h('b', { text: a.what }), h('span', { class: 'ev', text: `${a.task_id} · ${when(a.since)} 부터` }), evl(a)))) : empty('대기 중인 행동 없음'),
      h('div', { class: 'ev', text: `사용자 PC 실행 요청: ${acts.some(a => a.who === 'user') ? '있음' : '없음'} — BAT 가 배치돼 있어도 감독 승인 기록과 카드가 없으면 올리지 않습니다` })),
  ));
  const m = b.latest_media;
  if (m) v.append(h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, '최신 결과물 · ', h('span', { class: 'mono', text: m.name })), h('a', { href: '#review', text: '검수 화면 →' })),
    h('div', { class: 'shots' }, m.images.slice(0, 3).map(i => h('figure', {}, h('img', { src: `nasimg/${i.id}`, alt: i.file, loading: 'lazy' }), h('figcaption', { class: 'ev', text: i.file })))), evl(m),
    h('span', { class: 'ev', text: '폴더의 SHA 목록에 있고 해시가 맞는 그림만 표시 · 시각 승인 여부는 프리뷰 검수 화면' })));
  v.append(costSummary(teamsApi?.tokens, true));
  v.append(h('section', { class: 'card dash' }, h('span', { class: 'lbl', text: '수집 장치 상태 (작업 상태 아님)' }),
    // every source has a label; the provenance tally is not a source (it was printed as "undefined …")
    h('span', { class: 'ev', text: Object.entries(b.sources).filter(([k]) => SOURCE_LABEL[k]).map(([k, s]) => `${SOURCE_LABEL[k]} ${s.state}${s.count !== undefined ? ` (${s.count})` : ''}`).join(' · ') }),
    h('a', { href: '#tech', text: '기술 상세 →' })));
}

// ── TC-DASH-010 프로젝트 로드맵 — 단계·작업 상태는 감독 승인 로드맵 파일에서만, 카드는 옆에 근거로만 ─────────
const RTONE = { done: 'ok', in_progress: 'info', waiting: 'unk', planned: 'unk', team_wait: 'unk', qa_wait: 'wait', director_wait: 'wait', user_wait: 'wait', blocked: 'bad', on_hold: 'unk' };
const rb = (key, label) => h('span', { class: `b lv lv-${RTONE[key] || 'unk'}`, text: label });
function evLine(e) {
  if (!e || e.state === 'none') return h('span', { class: 'ev', text: e?.label || '근거 없음' });
  const l = e.last;
  return h('span', { class: 'stack' },
    h('span', { class: 'ev' }, grade(e.grade), ` ${l.team} 카드 · ${when(l.at)}${l.verdict ? ` · ${l.verdict}${l.scope_label ? `(${l.scope_label})` : ''}` : ''}${l.to ? ` → ${l.to}` : ''}`),
    e.state === 'stale' || e.state === 'future' ? h('span', { class: 'ev warnline', text: e.state === 'future' ? `미래 시각 카드 — 지금 상태 미확인 (${when(l.at)})` : `최근 2시간 안에 새 카드 없음 — 지금 상태 미확인 (마지막 근거 ${when(l.at)})` }) : null,
    e.newer_than_roadmap ? h('span', { class: 'ev warnline', text: '이 로드맵 판이 기록된 뒤의 카드 있음 — 로드맵 갱신 검토 필요 (자동 반영 안 함)' }) : null);
}
function verdictCell(t) {
  const e = t.evidence;
  const vs = e?.verdicts || [];
  return h('span', { class: 'stack' },
    t.verdicts?.length ? h('span', {}, h('span', { class: 'lbl', text: '로드맵 기재 ' }), t.verdicts.map(x => `${x.scope_label} ${x.value_label}`).join(' · ')) : null,
    h('span', { class: 'lbl', text: '카드 판정' }),
    vs.length ? h('span', {}, vs.map(x => verdict(x.verdict, null)).flatMap((b, i) => [b, ` ${vs[i].scope_label} `])) : h('span', { class: 'ev', text: '판정 카드 없음' }),
    vs.some(x => x.scope === 'technical' && x.verdict === 'PASS') && !e.visual_verdict ? h('span', { class: 'ev', text: '카드에 시각 판정 없음 — 기술 검증 결과일 뿐, 완료 아님' }) : null,
    e?.fails?.length ? h('span', { class: 'ev', text: `FAIL 기록 ${e.fails.length}건 보존: ${e.fails.map(f => `${f.scope_label} · ${f.title}`).join(' / ')}` }) : null);
}
function taskRow(t) {
  return h('tr', {},
    h('td', {}, h('b', { text: t.id }), ` ${t.name}`, t.kind ? h('div', { class: 'ev', text: t.kind }) : null, t.links.task_ids.length ? h('div', { class: 'ev mono', text: [...t.links.task_ids, ...t.links.candidates].join(' · ') }) : null),
    h('td', { class: 'nw', text: t.team_label || '—' }),
    h('td', {}, h('span', { class: 'stack' }, rb(t.status, t.status_label), t.resolution_label ? h('span', { class: 'ev', text: `해결 여부: ${t.resolution_label}` }) : null,
      t.hold ? h('span', { class: 'ev', text: `보류 사유: ${t.hold.reason} · 재개: ${t.hold.resume}` }) : null,
      ...(t.decisions || []).map(d => h('span', { class: 'ev' }, h('b', { text: `${d.item} ` }), `감독 ${d.decision_label} — 작업: ${d.work}`,
        d.card_evidence ? (d.card_evidence.missing ? ' · 근거 카드 없음' : [' · 근거 ', grade(d.card_evidence.grade), ` ${d.card_evidence.team} ${when(d.card_evidence.at)}`]) : null)))),
    h('td', { text: t.result || '—' }), h('td', {}, verdictCell(t)),
    h('td', { text: t.next || '—' }), h('td', { text: t.done_when.join(' / ') || '—' }), h('td', { text: t.depends_on.join(', ') || '—' }),
    h('td', {}, evLine(t.evidence), t.schedule ? h('span', { class: 'ev', text: `일정 ${t.schedule.text} (근거: ${t.schedule.basis})` }) : null));
}
function roadmap(v) {
  if (!roadmapApi) { v.append(empty('로드맵을 불러오는 중이거나 불러오지 못했습니다.')); return; }
  if (roadmapApi.state !== 'ok' || !roadmapApi.projects.length) { v.append(h('h1', { text: '프로젝트 로드맵' }), empty(roadmapApi.message || '등록된 로드맵 없음')); return; }
  for (const p of roadmapApi.projects) {
    const c = p.counts;
    v.append(
      h('section', { class: 'card' }, h('span', { class: 'lbl', text: '프로젝트 · 목표' }), h('h1', { text: p.project.name }), h('p', { class: 'lead', text: p.project.goal }),
        h('span', { class: 'ev', text: `로드맵 v${p.version} · 감독 승인 ${p.approved.directive} · 승인 시각 ${p.approved.at ? when(p.approved.at, p.approved.at_precision) : '미기록'}${p.approved.transcribed_by ? ` · ${p.approved.transcribed_by} 전사 ${when(p.approved.transcribed_at)}` : ''} · ${p.approved.original?.label || '원문 대조 전'} · 근거 ${p.approved.source.ref}` })),
      p.phases?.length ? h('section', { class: 'card' }, h('h2', { text: '프로젝트 상위 단계' }),
        h('div', { class: 'g2' }, p.phases.map(ph => h('div', { class: `step${p.current_phase?.id === ph.id ? ' cur' : ''}` },
          h('span', { class: 'lbl', text: `${ph.id}단계${p.current_phase?.id === ph.id ? ' · 현재' : ''}` }), h('b', { text: ph.name }), h('span', {}, rb(ph.status, ph.status_label)),
          h('span', { class: 'ev', text: [ph.stage_count ? `세부 로드맵 ${ph.stage_count}단계 (아래)` : '세부 로드맵 미등록', ph.depends_on ? `${ph.depends_on}단계 완료 후` : '', ph.note].filter(Boolean).join(' · ') }))))) : null,
      h('section', { class: 'g4' },
        h('article', { class: 'card' }, h('span', { class: 'lbl', text: p.current_phase ? `${p.current_phase.id}단계 세부 단계` : '전체 단계' }), h('span', { class: 'n', text: String(c.total) }), h('span', { class: 'ev', text: p.current_stage ? `현재 ${p.current_stage.no}단계 · ${p.current_stage.name}` : '진행 중인 단계 없음' })),
        h('article', { class: 'card' }, h('span', { class: 'lbl', text: '완료' }), h('span', { class: 'n', text: String(c.done) }), h('span', { class: 'ev', text: '감독 승인 로드맵 기준' })),
        h('article', { class: 'card' }, h('span', { class: 'lbl', text: '진행' }), h('span', { class: 'n', text: String(c.in_progress) })),
        h('article', { class: 'card' }, h('span', { class: 'lbl', text: '대기' }), h('span', { class: 'n', text: String(c.waiting) }), h('span', { class: 'ev', text: '완료율은 계산하지 않음' }))),
      h('section', { class: 'card' }, h('h2', { text: '단계별 진행' }),
        h('div', { class: 'steps' }, p.stages.map(s => h('div', { class: `step${p.current_stage?.no === s.no ? ' cur' : ''}` }, h('span', { class: 'lbl', text: `${s.no}${p.current_stage?.no === s.no ? ' · 현재' : ''}` }), h('b', { text: s.name }), h('span', {}, rb(s.status, s.status_label)), h('span', { class: 'ev', text: `세부 ${s.task_count} · 완료 ${s.task_done}` })))),
        h('span', { class: 'ev', text: '단계 상태는 감독이 승인한 로드맵 판에서만 바뀝니다. 인계 카드로 자동 완료하지 않습니다.' })),
      h('section', { class: 'g2' },
        h('article', { class: 'card' }, h('h2', { text: '현재 우선 작업' }), p.priority.length ? p.priority.map(t => h('div', { class: 'item' }, rb(t.status, t.status_label), h('div', { class: 'stack' }, h('b', { text: `${t.id} ${t.name}` }), h('span', { class: 'ev', text: t.result }), verdictCell(t)))) : empty('지정 없음')),
        h('article', { class: 'card' }, h('h2', { text: '다음에 할 일' }), p.next_steps.length ? h('ol', {}, p.next_steps.map(x => h('li', { text: x }))) : empty('기재 없음')),
        h('article', { class: 'card' }, h('h2', { text: '감독 승인 대기' }), p.waiting_director.length ? p.waiting_director.map(t => h('div', { class: 'item' }, rb(t.status, t.status_label), h('div', { class: 'stack' }, h('b', { text: `${t.id} ${t.name}` }), h('span', { class: 'ev', text: t.next })))) : empty('없음')),
        h('article', { class: 'card' }, h('h2', { text: '최근 단계 변경과 근거' }),
          p.changes.length ? p.changes.slice(-5).reverse().map(x => h('div', { class: 'ev', text: `v${x.version ?? '?'} · ${x.at ? when(x.at) : '시각 없음'} · ${x.what} — 근거 ${x.basis}` })) : empty('변경 기록 없음'),
          p.review_needed.length ? h('span', { class: 'ev warnline', text: `로드맵보다 새 카드가 있는 작업: ${p.review_needed.join(', ')} — 감독 확인 전에는 반영하지 않음` }) : null,
          h('span', { class: 'ev', text: `보존된 판: ${p.history.map(x => `v${x.version}`).join(' · ')}` }))),
      h('section', { class: 'stack' }, h('h2', { text: '단계 · 세부 작업' }),
        p.stages.map(s => {
          const tasks = p.tasks.filter(t => t.stage === s.no);
          const d = h('details', { class: 'card', open: p.current_stage?.no === s.no },
            h('summary', {}, h('b', { text: `${s.no} · ${s.name} ` }), rb(s.status, s.status_label), h('span', { class: 'ev', text: `  세부 ${tasks.length}${s.exit.length ? ` · 완료 조건: ${s.exit.join(' / ')}` : ''}` })),
            tasks.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['작업', '담당', '상태', '현재 결과', '판정(범위별)', '다음 작업', '완료 조건', '선행', '마지막 근거 · 등급'].map(x => h('th', { text: x })))), h('tbody', {}, tasks.map(taskRow)))) : empty('세부 작업 없음'));
          return d;
        })));
  }
}

function teamCard(t) {
  return h('article', { class: 'card' },
    h('div', { class: 'stack' }, h('h2', { text: t.label }), h('span', { class: 'ev', text: t.duty })),
    h('div', { class: 'kv now' }, h('span', { class: 'lbl', text: '실제 작업 상태 · 지금' }), h('span', { class: 'stack' }, h('span', {}, state(t.now.state, t.now.label)), h('span', { class: 'ev', text: t.now.basis }))),
    h('div', { class: 'kv' }, h('span', { class: 'lbl', text: '마지막 확인된 상태' }), h('span', {}, lastCard(t.last))),
    h('div', { class: 'kv' }, h('span', { class: 'lbl', text: '마지막 확인된 작업' }), h('span', { text: t.last ? `${t.last.task_id} · ${t.last.title}` : '기록 없음' })),
    h('div', { class: 'kv' }, h('span', { class: 'lbl', text: '마지막 확인된 결과' }), h('span', { text: t.last?.done || '—' })),
    h('div', { class: 'kv' }, h('span', { class: 'lbl', text: '근거 · 기록 시각' }), t.last ? evl(t.last) : h('span', { class: 'ev', text: '근거 없음' })),
    h('div', { class: 'kv' }, h('span', { class: 'lbl', text: '다음 인계 대상' }), h('b', { text: t.last?.to_label ? `${t.last.to_label} — ${t.last.next || ''}` : '—' })),
    h('div', { class: 'card dash' }, h('span', { class: 'lbl', text: '세션 연결 · 작업 상태 아님' }), h('span', { class: 'ev', text: `${t.session.label}${t.session.link ? ` · ${t.session.link}` : ''} — ${t.session.note}` })));
}
function teams(v) {
  v.append(h('h1', { text: '팀별 작업 현황' }),
    h('p', { class: 'lead', text: `'실제 작업 상태 · 지금'은 근거가 붙은 진행 중 카드가 ${board.live_window_min / 60}시간 안에 있을 때만 '진행 중'이고, 아니면 미확인입니다. '마지막 확인된 상태'는 그 시각의 기록일 뿐입니다. 세션·프로세스 생존은 맨 아래 줄에만 적습니다.` }),
    h('section', { class: 'g2' }, board.teams.map(teamCard)));
}

function stepsRow(r) { return h('tr', {}, h('td', {}, h('span', { class: 'mono tid', text: r.task_id }), h('br'), h('span', { class: 'ev', text: `${when(r.last_at)}${{ closed: ' · 완료', open: ' · 열림', done_unverified: ' · 완료 미확인' }[r.status] || ''}` })), h('td', { text: r.title }), r.steps.map(s => h('td', {}, stepBadge(s), h('br'), evl(s)))); }
function issueList(list, none) { return list.length ? list.map(i => h('div', { class: 'item' }, sev(i.severity), h('div', { class: 'stack' }, h('b', { text: i.title }), i.candidate ? h('span', { class: 'ev', text: `후보 ${i.candidate} 에만 해당` }) : null, i.note ? h('span', { class: 'ev', text: i.note }) : null, evl(i)))) : empty(none); }
function actionList(list, none) { return list.length ? list.map(a => h('div', { class: 'item' }, h('span', { class: 'who', text: a.who_label }), h('div', { class: 'stack' }, h('b', { text: a.what }), h('span', { class: 'ev', text: `${a.task_id} · ${when(a.since)} 부터 · 보낸 쪽 ${a.from}` }), evl(a)))) : empty(none); }
function histTable(rows) { return h('div', { class: 'scroll' }, h('table', { class: 'hist' }, h('thead', {}, h('tr', {}, ['지시', '내용', '지시 근거', '제작', '자체 검증', 'QA 독립 검증', '감독 판정', '결과'].map(t => h('th', { text: t })))), h('tbody', {}, rows.map(stepsRow)))); }
function issues(v) {
  const b = board;
  const prodActs = b.actions.filter(a => a.kind === 'production');
  const ctlActs = b.actions.filter(a => a.kind === 'control');
  const otherActs = b.actions.filter(a => a.kind === 'other');
  v.append(h('h1', { text: '문제 · 승인 대기 · 지시 이력' }),
    h('section', { class: 'g2' },
      h('article', { class: 'card' }, h('h2', { text: `지금 필요한 승인 · 결정 · 검토 · 조치 — 제작 ${prodActs.length}` }), actionList(prodActs, '대기 없음'),
        h('h3', { text: `관제실 개발 작업 ${ctlActs.length}` }), actionList(ctlActs, '대기 없음'),
        otherActs.length ? [h('h3', { text: `기타 작업 ${otherActs.length} (지시 번호 형식 밖)` }), actionList(otherActs, '대기 없음')] : null,
        h('h3', { text: `지난 사용자 조치 기록 ${b.actions_past.length} — 처리 여부 미확인, 홈에서 세지 않음` }),
        b.actions_past.length ? b.actions_past.map(a => h('div', { class: 'item' }, h('span', { class: 'who', text: a.who_label }), h('div', { class: 'stack' }, h('span', { text: a.what }), h('span', { class: 'ev', text: `${a.task_id} · ${when(a.since)} · ${a.past_reason}` }), evl(a)))) : empty('없음'),
        h('div', { class: 'ev', text: '승인·반려 버튼은 없습니다. 결정은 판정 기록 파일이 들어오면 반영됩니다.' })),
      h('article', { class: 'card' }, h('h2', { text: '프로젝트 전체 문제' }), issueList(b.issues.project, '기록 없음'),
        h('h3', { text: '후보 한정 문제 — 기준본과 무관' }), issueList(b.issues.candidate, '기록 없음'),
        h('h3', { text: '별도 트랙 (물리 등)' }), issueList(b.issues.track, '기록 없음'))),
    h('section', { class: 'card' }, h('h2', { text: '제작 작업 지시별 진행 이력' }), b.history.length ? histTable(b.history) : empty('기록 없음')),
    h('section', { class: 'card' }, h('h2', { text: '관제실 개발 작업 이력 (TC-DASH · TC-HANDOFF)' }), b.history_control?.length ? histTable(b.history_control) : empty('기록 없음')),
    b.history_other?.length ? h('section', { class: 'card' }, h('h2', { text: '기타 기록 (지시 번호 형식 밖 — 예: ③ 자체 Work 작업)' }), histTable(b.history_other)) : null,
    h('section', { class: 'card' }, h('h2', { text: '기호의 뜻 · 서로 바꿔 쓰지 않음' }),
      h('div', { class: 'legend' }, h('span', { class: 'lbl', text: '판정' }), verdict('PASS'), '정한 기준 충족(그 범위만)', verdict('FAIL'), '기준 미달 확인', verdict('REVIEW'), '사람 판단 필요', verdict('UNVERIFIED'), '공식 판정 — 증거 부족'),
      h('div', { class: 'legend' }, h('span', { class: 'lbl', text: '상태' }), state('in_progress'), state('pending'), state('blocked'), state('done'), state('unverified'), '관제실이 최신 근거를 못 찾음 (UNVERIFIED 와 다름)'),
      h('div', { class: 'legend' }, h('span', { class: 'lbl', text: '문제' }), sev('blocking'), sev('fail'), sev('review'), sev('known'))));
}

function review(v) {
  const list = board.candidates;
  if (!picked || !list.some(c => c.name === picked)) picked = (list.find(c => c.images.length) || list[0])?.name || null;
  const sel = list.find(c => c.name === picked);
  v.append(h('h1', { text: '영상 프리뷰 · 검수' }), h('p', { class: 'lead', text: '판의 지위(기준본·후보)는 판정 기록에서만, 판정은 범위(기술·시각·물리)를 붙여 따로 표시합니다. 기술 PASS 는 시각 승인이 아닙니다.' }));
  const lay = h('div', { class: 'lay' });
  lay.append(h('aside', { class: 'side', 'aria-label': '후보 목록' }, h('span', { class: 'lbl', text: '후보 · 결과물' }),
    list.length ? list.map(c => h('button', { type: 'button', class: `cand${c.name === picked ? ' on' : ''}`, onclick: () => { picked = c.name; render(); } },
      h('span', { class: 'row' }, h('b', { text: c.name }), c.commit ? h('span', { class: 'mono ev', text: c.commit }) : null),
      h('span', {}, h('span', { class: `b st-${c.status} s-${c.status}`, text: c.status_label }), ' ', c.verdicts.map(x => verdict(x.verdict, x.scope))),
      h('span', { class: 'ev', text: c.last_at ? `마지막 기록 ${when(c.last_at)}` : '' }))) : empty('후보 기록 없음')));
  const main = h('section', { class: 'card mainc' });
  if (sel) {
    main.append(h('h2', { text: sel.name }), h('div', {}, h('span', { class: `b st-${sel.status} s-${sel.status}`, text: sel.status_label }), sel.note ? h('span', { class: 'ev', text: `  ${sel.note}` }) : null), evl(sel.status_evidence),
      h('h3', { text: '판정 (범위별)' }), ...(sel.verdicts.length ? sel.verdicts.map(x => h('div', { class: 'item' }, verdict(x.verdict, x.scope), h('div', { class: 'stack' }, h('span', { text: x.team }), evl(x)))) : [empty('판정 카드 없음 — 미확인')]),
      h('h3', { text: '화면' }), sel.images.length ? h('div', { class: 'shots' }, sel.images.map(i => h('figure', {}, h('img', { src: `nasimg/${i.id}`, alt: i.file, loading: 'lazy' }), h('figcaption', { class: 'ev', text: i.file })))) : h('div', { class: 'ph', text: '카드가 가리키는 NAS 폴더에 SHA 목록 등재 그림이 없음' }),
      h('div', { class: 'card dash' }, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: true, text: '승인' }), h('button', { class: 'btn', type: 'button', disabled: true, text: '반려' }), h('button', { class: 'btn', type: 'button', disabled: true, text: '코멘트' })),
        h('span', { class: 'ev', text: '쓰기 잠금 — 로그인 없는 운영 상태라 쓰기 기능과 쓰기 API 가 없습니다 (TC-DASH-002/003). 판정은 판정 기록 파일로만 반영됩니다.' })));
  } else main.append(empty('후보를 고르세요'));
  lay.append(main);
  v.append(lay);
}

// ── token use · cost (Anthropic API list-price estimate, not a bill) ─────────────────────────────
const INT = new Intl.NumberFormat('ko-KR');
const usd = v => (v === null || v === undefined ? '—' : `$${v < 10 ? v.toFixed(2) : INT.format(Math.round(v))}`);
const krw = v => (v === null || v === undefined ? '—' : `₩${INT.format(Math.round(v))}`);
const tok = v => (v === null || v === undefined ? '—' : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v));
const WINDOWS = [['today_kst', '오늘 (KST)'], ['last_60m', '최근 60분'], ['last_5m', '최근 5분'], ['all', '누적']];
function costNote(tk) {
  const fx = tk?.fx || {};
  return `API 정가 환산 추정 — 실제 청구액 아님 · 구독 요금제 사용분은 청구와 무관 · 원화 환산 1 USD = ₩${fx.krw_per_usd ? INT.format(fx.krw_per_usd) : '—'} (${fx.as_of || '기준일 없음'}, 고정 환율)`;
}
function costSummary(tk, compact) {
  if (!tk?.server) return h('section', { class: 'card dash' }, h('span', { class: 'lbl', text: 'Claude 사용량 · 비용' }), empty('팀 세션 수집기 자료가 없어 표시할 수 없음'));
  const w = tk.server, r = tk.server_rate || {};
  const tiles = (compact ? WINDOWS.filter(([k]) => k !== 'last_5m') : WINDOWS).map(([k, label]) => h('div', { class: 'step' },
    h('span', { class: 'lbl', text: label }), h('span', { class: 'n', text: krw(w[k]?.cost_krw) }), h('span', { class: 'ev', text: `${usd(w[k]?.cost_usd)} · ${tok(w[k]?.total_tokens)} 토큰 · 요청 ${INT.format(w[k]?.requests ?? 0)}` })));
  tiles.push(h('div', { class: 'step' }, h('span', { class: 'lbl', text: '현재 속도 (최근 5분 기준)' }), h('span', { class: 'n', text: `${krw(r.krw_per_hour)}/시간` }), h('span', { class: 'ev', text: `${usd(r.usd_per_hour)}/시간 · ${tok(r.tokens_per_min)} 토큰/분` })));
  return h('section', { class: 'card' },
    h('div', { class: 'row' }, h('h2', { text: 'Claude 사용량 · 비용 (원화 환산)' }), compact ? h('a', { href: '#tech', text: '세션별 보기 →' }) : null),
    h('div', { class: 'g4' }, tiles),
    h('span', { class: 'ev', text: `${costNote(tk)} · 범위: ${tk.scope || '서버 전체'}` }));
}
function costSessions(tk) {
  const ss = (tk?.sessions || []).slice().sort((a, b) => (b.last_at || '').localeCompare(a.last_at || ''));
  return h('section', { class: 'card' }, h('h2', { text: '세션별 사용량 · 비용' }),
    ss.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['세션', '팀', '마지막 활동', '토큰', '요청', '달러', '원화'].map(t => h('th', { text: t })))),
      h('tbody', {}, ss.map(x => h('tr', {}, h('td', { class: 'mono', text: x.name || x.id }), h('td', { text: x.team || '팀 미지정' }), h('td', { text: x.last_at ? when(x.last_at) : '—' }),
        h('td', { text: tok(x.total_tokens) }), h('td', { text: INT.format(x.requests ?? 0) }), h('td', { text: usd(x.cost_usd) }), h('td', { text: krw(x.cost_krw) })))))) : empty('세션 기록 없음'),
    h('span', { class: 'ev', text: costNote(tk) }));
}

function tech(v) {
  const tk = teamsApi?.tokens;
  v.append(h('h1', { text: '기술 · 검증 상세' }), h('p', { class: 'lead', text: '이 화면의 값은 홈의 작업 상태 판정에 쓰지 않습니다. 이전 관제 화면(18개 섹션)은 바뀌지 않은 채 그대로 열립니다.' }),
    h('section', { class: 'card focus' }, h('div', { class: 'row' }, h('h2', { text: '이전 관제 화면 · 기술 기록 18개 섹션' }), h('a', { href: 'legacy.html', text: '이전 화면 열기 →' })),
      h('span', { class: 'ev', text: '제작 단계 · 팀 실시간 현황 · 토큰 사용량·비용 환산 · 부서별 상태 · 미해결 문제 · 최근 판정 기록 · 데이터 출처 · 검증 항목 V2 V3 V5 · 감독 판정 기록 · 기존 실험 미리보기 · 보고서 이력 · 보고서 보기 · 실험 이력 · 코드 해시 대조 · 재현 정보 · 판정 도구 코드 · 데이터 상태 · 장면 검토' })),
    h('section', { class: 'g3' },
      h('article', { class: 'card' }, h('span', { class: 'lbl', text: '서버 Claude 사용량 · 최근 5분' }), h('span', { class: 'n', text: tk?.server_rate ? `${tk.server_rate.tokens_per_min.toLocaleString('ko-KR')} 토큰/분` : '—' }), h('span', { class: 'ev', text: tk?.server_rate ? `출력 ${tk.server_rate.output_per_min.toLocaleString('ko-KR')}/분` : '팀 세션 수집기 없음' })),
      h('article', { class: 'card' }, h('span', { class: 'lbl', text: '비용 환산 · 추정' }), h('span', { class: 'n', text: tk?.server_rate ? `${krw(tk.server_rate.krw_per_hour)}/시간` : '—' }), h('span', { class: 'ev', text: tk?.server_rate ? `${usd(tk.server_rate.usd_per_hour)}/시간 · API 정가 환산 · 실제 청구액 아님` : 'API 정가 환산 · 실제 청구액 아님' })),
      h('article', { class: 'card' }, h('span', { class: 'lbl', text: '세션 · 프로세스' }), h('span', { text: teamsApi ? `팀 미지정 세션 ${teamsApi.unbound_live_sessions ?? '—'}` : '—' }), h('span', { class: 'ev', text: '프로세스 생존 ≠ 작업 진행' }))),
    costSummary(tk, false), costSessions(tk),
    h('section', { class: 'card' }, h('h2', { text: '자료 출처 상태' }), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['출처', '상태', '설명', '마지막 시각'].map(t => h('th', { text: t })))),
      h('tbody', {}, [
        ...Object.entries(board.sources).filter(([k]) => !['team_live', 'provenance'].includes(k)).map(([k, s]) => h('tr', {}, h('td', { text: { handoff: '인계 카드', decisions: '판정 기록 (④ 전사)', signed_work: '서명 Work 기록 (③)', director: '감독 원문 대조', nas: 'NAS 단서' }[k] || k }), h('td', { text: s.state }), h('td', { text: s.message || '' }), h('td', { text: s.newest_at ? when(s.newest_at) : s.checked_at ? when(s.checked_at) : s.observed_at ? when(s.observed_at) : '—' }))),
        board.sources.provenance ? h('tr', {}, h('td', { text: '출처 구분 집계' }), h('td', { text: 'ok' }), h('td', { text: `직접 작성 ${board.sources.provenance.self} · 서명 ${board.sources.provenance.signed} · 전사 ${board.sources.provenance.transcribed} · 유효 판정 ${board.sources.provenance.decisions_valid} / 유효하지 않은 판정 기록 ${board.sources.provenance.decisions_not_valid}` }), h('td', { text: '—' })) : null,
        ...(overview?.sources || []).map(s => h('tr', {}, h('td', { text: s.label }), h('td', { text: s.state }), h('td', { text: s.detail || '' }), h('td', { text: s.observed_at ? when(s.observed_at) : '—' }))),
      ])))),
    h('section', { class: 'card dash' }, h('span', { class: 'lbl', text: '운영판 보존 기준' }), h('span', { class: 'mono', text: '0.1.6-rc.2 · 5dac91d' }), h('span', { class: 'ev', text: '이 판은 그 커밋에서 갈라진 스테이징 브랜치입니다. 운영 컨테이너·이미지·데이터는 바뀌지 않았습니다.' })));
}

const DATA_ROWS = [
  ['홈 · 현재 작업', '인계 카드 (생산 팀의 최신 카드) · ③ 서명 Work 기록', '직접 작성 / 서명 확인 / 전사 / 근거 없는 카드'],
  ['홈 · 실제 작업 상태', '진행 중 카드 + 근거 + 2시간 이내 (직접 작성 또는 서명 기록만)', '전사·근거 없음·오래됨 → 미확인'],
  ['홈 · 실행 상태', 'PC 전송 장치 없음 → 늘 미확인 · 마지막 실행은 NAS 보존 폴더', '단서 (카드가 인용하면 그 카드의 등급)'],
  ['홈 · 기준본', '판정 기록 kind=baseline + 감독 원문 대조', '원문 일치 + 사용자 확인일 때만 유효 · 후보 FAIL 과 무관'],
  ['감독 판정 (승인·보류·종료)', '④ 전사 판정 기록 ↔ 원문 목록(INDEX)의 SHA256', '유효 = 원문 일치 + 사용자 확인 · SHA 일치는 내용 일치일 뿐 신원·권한 증명 아님'],
  ['감독 원문', '대조 전용 · 목록에 있는 파일만 읽음', '본문·파일 이름·위치는 화면·API 에 나오지 않음 · NAS 단서 검색에서 제외'],
  ['진행 단계 · 이력', '판정 기록 + 팀별 인계 카드', '칸마다 등급·시각'],
  ['다음 행동', '카드의 to · user_action — 받는 쪽 카드나 유효한 감독 판정이 없을 때', '유효하지 않은 판정 기록은 답으로 치지 않음'],
  ['문제', '카드 issues (scope: project · candidate · track)', '후보 문제는 후보에만'],
  ['프리뷰 검수', '후보 지위 = 판정 기록 · 판정 = 카드 · 그림 = 카드가 가리키는 NAS 폴더', '그림은 SHA 목록 등재·해시 일치만'],
  ['팀 현황 · 세션 줄', '/api/teams (기존)', '작업 상태에 쓰지 않음'],
  ['기술 상세', '기존 API 그대로 + 이전 화면', '—'],
];
function data(v) {
  v.append(h('h1', { text: '데이터 근거표' }), h('p', { class: 'lead', text: '화면 항목마다 어디서 읽는지와 근거 등급을 적었습니다. NAS 폴더 이름은 단서일 뿐이고, 승인은 판정 기록으로만 확정합니다.' }),
    h('section', { class: 'card' }, h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['화면 · 항목', '출처', '등급 · 규칙'].map(t => h('th', { text: t })))), h('tbody', {}, DATA_ROWS.map(r => h('tr', {}, r.map(x => h('td', { text: x })))))))),
    h('section', { class: 'card' }, h('h2', { text: 'NAS 단서 · 최근 폴더' }), h('span', { class: 'ev', text: nas ? `${nas.message} · 확인 ${when(nas.checked_at)}` : 'NAS 단서 없음' }),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['폴더', '이름이 가리키는 후보', '본문의 작업 번호', 'RUN.lock', '폴더 시각', '등급'].map(t => h('th', { text: t })))),
        h('tbody', {}, (nas?.folders || []).slice(0, 30).map(f => h('tr', {}, h('td', { class: 'mono', text: f.name }), h('td', { text: f.clue_label }), h('td', { text: f.task_ids.join(', ') || '—' }), h('td', { text: f.run_lock ? '있음' : '—' }), h('td', { text: when(f.mtime) }), h('td', {}, grade('clue')))))))),
    h('section', { class: 'card' }, h('h2', { text: '인계 카드 · 판정 기록 형식' }),
      h('pre', { class: 'card mono', text: '<인계 카드 폴더>/<팀>/<YYYYMMDD-HHMM>_<작업번호>.json   (덧붙이기만 · 고치거나 지우지 않음)\n{ "schema": "tc-handoff/1", "team": "TC-PROD | TC-QA | TC-WORK | TC-DASH", "task_id": "TC-VIS-030",\n  "title": "…", "state": "in_progress | handed_off | blocked | done",\n  "verdict": "PASS | FAIL | REVIEW | UNVERIFIED | null", "verdict_scope": "technical | visual | physics | selfcheck | run | null",\n  "candidate": "후보 이름 | null", "done": "완료한 작업", "next": "다음 작업", "to": "TC-PROD | TC-QA | TC-WORK | TC-DASH | director | user",\n  "user_action": "사용자 직접 조치 | null",\n  "evidence": [{ "kind": "report | nas | file | commit", "ref": "…", "sha256": "…(선택)", "at": "…(선택)" }],\n  "issues": [{ "id": "…", "title": "…", "scope": "project | candidate | track", "candidate": "…", "severity": "blocking | fail | review | known" }],\n  "author": { "method": "self | transcribed", "session": "세션 이름(선택)",\n              "transcribed_by": "전사한 팀", "transcribed_from": { "ref": "원문 위치", "at": "원문 시각" } },\n  "at": "2026-11-10T10:00:00+09:00" }\n  ※ "signed" 는 파일에 쓸 수 없음 — ③ 서명 Work 기록에서만 생김\n\n<판정 기록 폴더>/<id>.json  (④ 가 감독 지시문에서 전사 · source.ref 없으면 받지 않음)\n{ "schema": "tc-decision/1", "kind": "directive | approval | rejection | hold | closure | baseline | candidate_status",\n  "task_id": "…", "directive_id": "TC-DASH-005", "subject": "…", "at": "…", "source": { "ref": "감독 지시 번호 · 원문 보관 기록" } }\n\n감독 원문 목록 INDEX.json (대조 전용 · 화면에 내용 없음)\n{ "schema": "tc-director-index/1", "entries": [{ "directive_id": "TC-DASH-005", "file": "TC-DASH-005.md", "sha256": "…",\n  "source": "…", "written_at": "…", "checked_at": "…", "check_method": "user_confirmed | transcribed" }] }' })));
}

window.addEventListener('hashchange', () => { if ((['tech', 'data'].includes(currentRoute()) && !overview) || (currentRoute() === 'roadmap' && !roadmapApi)) load(); else render(); });
fetch('api/session', { cache: 'no-store' }).then(r => r.json()).then(s => { $('version').textContent = s.local_detail ? `판 ${s.version} · 이 컴퓨터에서만 보이는 상세 화면` : `판 ${s.version}`; }).catch(() => {});
load();
setInterval(load, 30000);
loadLive();
setInterval(loadLive, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLive(); });
window.addEventListener('hashchange', () => { if (currentRoute() === 'home') loadLive(); });
})();
