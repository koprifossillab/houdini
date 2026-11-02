// Houdini Production Control — browser side. All text goes through textContent; no HTML from data.
'use strict';
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
const STALE_S = 180;
const TEAM_ORDER = ['houdini', 'verify', 'blender', 'work'];
const STATE = {
  running: ['관련 프로세스 감지', 'info'], waiting: ['대기', 'info'], done: ['완료 문서 근거', 'info'], error: ['오류 근거', 'bad'],
  unknown: ['현재 확인 불가', 'warn'], outside: ['서버 밖 · 관측 불가', 'locked'],
};
const FEED = { live: ['수집 자료 연결', 'live'], stale: ['갱신 지연', 'warn'], missing: ['데이터 없음', 'bad'], error: ['데이터 오류', 'bad'], offline: ['서버 연결 실패', 'bad'] };
const SRC_STATE = { live: ['정상', 'good'], ok: ['정상', 'good'], stale: ['갱신 지연', 'warn'], partial: ['일부 누락', 'warn'], missing: ['없음', 'bad'], error: ['오류', 'bad'] };
const PROV = { collected: '수집', recorded: '기록', repository: '저장소', manifest: '목록', example: '예시' };
const REPORT_SRC = { collector: '수집기 사본', repository: '저장소 사본', none: '사본 없음' };
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const parts = v => Object.fromEntries(FMT.formatToParts(new Date(v)).map(p => [p.type, p.value]));
const kst = v => { if (!v) return '시각 미제공'; const p = parts(v); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} KST`; };
const kstTime = v => { const p = parts(v); return `${p.hour}:${p.minute}:${p.second}`; };
const ago = s => (s === null || s === undefined ? '—' : s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`);
const tag = (text, tone = '') => h('span', { class: `tag ${tone}`, text });
const prov = p => h('span', { class: `prov ${p}`, text: PROV[p] || p });

let session = { authorized: false, auth: 'basic', configured: false, demo: false };
let overview = null;
let lastOk = 0;

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (r.status === 401) { const e = new Error('401'); e.status = 401; throw e; }
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function banners(o, offline) {
  const list = [];
  if (session.demo || o?.mode === 'example') list.push(h('div', { class: 'banner example', role: 'alert', text: '예시 데이터 모드 — 아래 값은 화면 검토용으로 만든 가짜 값이며 실제 계산·검증·승인이 아닙니다.' }));
  if (offline) list.push(h('div', { class: 'banner bad', role: 'alert', text: '서버 연결 실패 — 화면의 값은 마지막으로 받은 것이며 현재 상태가 아닙니다.' }));
  const c = o?.collector;
  if (c && c.state === 'stale') list.push(h('div', { class: 'banner warn', text: `수집 자료가 ${ago(c.age_s)} 것입니다(3분 넘게 갱신 안 됨) — 현재 활동과 계산 실행 여부는 확인할 수 없습니다.` }));
  if (c && (c.state === 'missing' || c.state === 'error')) list.push(h('div', { class: 'banner bad', text: `수집 자료 ${c.state === 'missing' ? '없음' : '오류'} — ${c.message}` }));
  $('banners').replaceChildren(...list);
}

function renderClock() {
  const c = overview?.collector;
  const offline = Date.now() - lastOk > 95000 && lastOk > 0;
  let state = c?.state || 'missing';
  let age = c?.age_s ?? null;
  if (c?.generated_at) {
    age = Math.max(0, Math.floor((Date.now() - Date.parse(c.generated_at)) / 1000));
    if (state === 'live' && age > STALE_S) state = 'stale';
  }
  if (offline) state = 'offline';
  const [label, tone] = FEED[state] || ['확인 불가', 'warn'];
  $('feed').textContent = label;
  $('feed').className = `pill ${tone}`;
  $('age').textContent = c?.generated_at ? `수집 ${kstTime(c.generated_at)} KST · ${ago(age)}` : '수집 시각 없음';
}

// F1: never "a computation is running" — the physics line is always unverified; process activity and
// the Blender queue are shown as what they are, and as unknown when the data is not current.
function renderCompute(o) {
  const c = o.compute;
  $('compute').className = 'compute unknown';
  $('compute-label').textContent = c.physics.label;
  const act = c.activity, q = c.blender_queue;
  const teamName = { houdini: 'Houdini', verify: '검증' };
  $('compute-basis').replaceChildren(
    h('span', { text: c.physics.basis }),
    h('span', { class: 'line' }, h('b', { text: '관련 프로세스 ' }), `${act.label}${act.teams?.length ? ` (${act.teams.map(k => teamName[k] || k).join('·')})` : ''} — ${act.basis}`),
    h('span', { class: 'line' }, h('b', { text: 'Blender 큐 ' }), q.state === 'missing' ? '기록 없음' : `대기 ${q.inbox ?? '—'} · 실행 기록 ${q.running ?? '확인 불가'} · 실패 ${q.failed ?? '—'}${q.state === 'unknown' ? ' (지금 값 아님)' : ''} — 큐 폴더 기준`),
    h('span', { class: 'line', text: `관측 ${kst(c.observed_at)}` }));
}

function renderStages(r) {
  $('stage-note').textContent = r.stage_note || '';
  $('stages').replaceChildren(...(r.stages || []).map(s => {
    const steps = (s.steps || []).map(st => {
      const tone = /완료|인정/.test(st.state) ? 'done' : /대기/.test(st.state) ? 'wait' : /미승인/.test(st.state) ? 'lock' : '';
      return h('div', { class: `step ${tone}` }, h('b', { text: st.id }), h('div', { text: st.label }), h('div', { text: st.state }));
    });
    return h('li', { class: `stage ${s.tone || ''}`, 'aria-current': s.tone === 'current' ? 'step' : null },
      h('span', { class: 'code', text: s.id }), h('b', { text: s.label }),
      s.tone === 'locked' ? tag(`🔒 ${s.state}`, 'locked') : tag(s.state, s.tone === 'current' ? 'warn' : ''),
      steps.length ? h('div', { class: 'steps' }, steps) : null);
  }));
}

function progressBar(p) {
  if (!p || !p.total) return null;
  // widths via CSSOM — style attributes would be blocked by the CSP
  const seg = (cls, v) => { const i = h('i', { class: cls }); i.style.width = `${Math.max(0, Math.min(100, ((v || 0) / p.total) * 100))}%`; return i; };
  return h('div', {},
    h('div', { class: 'progress', role: 'img', 'aria-label': `결과 ${p.done ?? '—'}/${p.total}` }, seg('d', p.done), seg('r', p.running), seg('f', p.failed)),
    h('div', { class: 'counts' }, h('span', { text: `결과 ${p.done ?? '—'}/${p.total}` }), h('span', { text: `진행 표시 ${p.running ?? '확인 불가'}`, title: '수집기가 이 조건 이름이 든 프로세스를 본 수 — 계산 여부는 미확인' }), h('span', { text: `실패 ${p.failed ?? '—'}` }), p.waiting !== null && p.waiting !== undefined ? h('span', { text: `대기 ${p.waiting}` }) : null));
}

function renderTeams(o) {
  const c = o.collector, notes = o.records.teams || {};
  $('teams-source').replaceChildren(prov(c.provenance), document.createTextNode(` ${c.source}`));
  const cards = TEAM_ORDER.map(key => {
    const t = c.teams.find(x => x.key === key);
    const note = notes[key];
    const [label, tone] = t ? STATE[t.state] || STATE.unknown : ['수집 자료 없음', 'warn'];
    return h('div', { class: 'team' },
      h('div', { class: 'team-head' }, h('h3', { text: note?.label || key }), tag(label, tone)),
      h('p', { class: 'task', text: t?.task || '현재 작업 근거 없음' }),
      t && t.state === 'unknown' && t.reported_state !== 'unknown' ? h('small', { text: `수집기 마지막 값: ${STATE[t.reported_state]?.[0] || t.reported_state} (지금 상태 아님)` }) : null,
      progressBar(t?.progress),
      ...(t?.evidence || []).slice(0, 3).map(e => h('div', { class: 'ev', text: `· ${e}` })),
      note?.note ? h('div', { class: 'note', text: note.note }) : null,
      h('div', { class: 'meta' }, h('span', { text: `최근 파일 활동 ${kst(t?.last_activity)}` }), t?.next ? h('span', { text: `다음: ${t.next}` }) : null));
  });
  const d = notes.director;
  if (d) cards.push(h('div', { class: 'team' }, h('div', { class: 'team-head' }, h('h3', { text: d.label }), tag('서버 밖 · 관측 불가', 'locked')), h('p', { class: 'task', text: '승인·반려·보류 판정은 「검증·승인」의 수동 기록으로만 표시' }), h('div', { class: 'note', text: d.note })));
  $('teams').replaceChildren(...cards);
}

function renderIssues(r) {
  $('issues-mini').replaceChildren(...r.issues.map(i => h('div', { class: 'mini-row' }, h('span', {}, h('span', { class: 'code-chip', text: i.id }), ` ${i.title}`), tag(i.status, 'warn'))));
  $('issues').replaceChildren(...r.issues.map(i => h('div', { class: 'issue' },
    h('h3', {}, h('span', { class: 'code-chip', text: i.id }), i.title, tag(i.status, 'warn')),
    h('dl', {}, h('dt', { text: '진단' }), h('dd', { text: i.diagnosis }), h('dt', { text: '독립 검증' }), h('dd', { text: i.independent }), h('dt', { text: '남은 문제' }), h('dd', { text: i.unresolved }), h('dt', { text: '근거' }), h('dd', { text: i.evidence || '—' })))));
}

function renderDecisions(r) {
  const tone = d => ({ approved: 'good', hold: 'warn', locked: 'locked', info: 'info' }[d.tone] || '');
  $('decisions').replaceChildren(...[...r.decisions].reverse().map(d => h('li', { class: d.tone || '' },
    h('div', { class: 'row' }, h('h3', { text: d.scope }), tag(d.decision, tone(d))),
    h('p', { text: d.evidence }), h('small', { text: `${d.by} · ${d.date}` }))));
  $('decisions-mini').replaceChildren(...[...r.decisions].reverse().slice(0, 5).map(d => h('div', { class: 'mini-row' }, h('span', { text: `${d.date} · ${d.scope}` }), tag(d.decision, tone(d)))));
}

function renderSources(o) {
  const rows = o.sources.map(s => {
    const [label, tone] = SRC_STATE[s.state] || ['확인 불가', 'warn'];
    return { s, label, tone };
  });
  $('sources-mini').replaceChildren(...rows.map(({ s, label, tone }) => h('div', { class: 'mini-row' }, h('span', {}, prov(s.provenance), ` ${s.label}`), tag(label, tone))));
  $('sources').replaceChildren(
    h('thead', {}, h('tr', {}, ['출처', '종류', '상태', '내용', '관측·기록 시각'].map(t => h('th', { text: t })))),
    h('tbody', {}, rows.map(({ s, label, tone }) => h('tr', {}, h('td', { text: s.label }), h('td', {}, prov(s.provenance)), h('td', {}, tag(label, tone)), h('td', { text: s.detail || '' }), h('td', { class: 'mono', text: s.observed_at ? `${kst(s.observed_at)}${s.age_s !== null && s.age_s !== undefined ? ` (${ago(s.age_s)})` : ''}` : '—' })))));
}

// F4: the whole page needs credentials, so this only appears when a session expires or is refused.
function lockedBox(what) {
  return h('div', { class: 'locked-box' }, h('span', { text: `${what}: 인증이 만료되었거나 거부되었습니다 — 페이지를 다시 열어 주세요.` }));
}

async function renderMedia() {
  try {
    const d = await getJson('api/media');
    if (!d.items.length) return $('media').replaceChildren(h('div', { class: 'empty', text: d.state === 'ok' ? '등록된 미리보기가 없습니다.' : '미리보기 목록이 설정되지 않았습니다.' }));
    $('media').replaceChildren(...d.items.map(m => {
      const media = !m.present ? h('div', { class: 'empty', text: '파일 없음 — 목록에는 있으나 서버에서 찾지 못함' })
        : m.kind === 'video' ? h('video', { src: `media/${m.id}`, controls: true, preload: 'metadata', muted: true, playsinline: true })
        : h('img', { src: `media/${m.id}`, alt: m.title, loading: 'lazy' });
      if (media.tagName !== 'DIV') media.addEventListener('error', () => media.replaceWith(h('div', { class: 'empty' },
        m.kind === 'video' ? '이 브라우저에서 재생하지 못함 — H.264 코덱이 없거나 파일 확인 실패. ' : '표시하지 못함 — 파일 확인 실패. ',
        h('a', { href: `media/${m.id}`, target: '_blank', rel: 'noopener', text: '파일 직접 열기' }))));
      const s = m.sampling;
      return h('figure', {}, media, h('figcaption', {},
        h('b', { text: m.title }),
        h('span', {}, tag(m.origin_label, m.origin === 'physics' ? 'info' : m.origin === 'example' ? 'warn' : ''), ' ', m.stage ? tag(m.stage) : null),
        m.model ? h('span', { text: m.model }) : null,
        s ? h('span', { class: 'mono', text: `${s.frames ?? '—'}프레임 · 재생 ${s.playback_fps ?? '—'} fps${s.sim_interval_s ? ` · 계산 시간 간격 ${s.sim_interval_s} s` : ''}` }) : null,
        m.caveat ? h('span', { class: 'caveat', text: `⚠ ${m.caveat}` }) : null,
        h('span', { class: 'mono', text: `sha256 ${m.sha256}…` })));
    }));
  } catch (e) {
    $('media').replaceChildren(e.status === 401 ? lockedBox('시뮬레이션 미리보기') : h('div', { class: 'empty', text: '미리보기 목록을 불러오지 못했습니다.' }));
  }
}

async function renderReports() {
  try {
    const d = await getJson('api/reports');
    const team = { houdini: 'Houdini 제작', verify: '독립 검증', blender: 'Blender', work: 'Work' };
    if (!d.items.length) return $('reports').replaceChildren(h('div', { class: 'empty', text: '보고서 목록이 없습니다.' }));
    $('reports').replaceChildren(...d.items.map(r => h('div', { class: 'report-row' },
      h('div', {}, h('h3', { text: r.title }), h('small', { text: `${team[r.team] || r.team}${r.stage ? ` · ${r.stage}` : ''} · ${kst(r.mtime)} · ${REPORT_SRC[r.source]}${r.redacted ? ' (공개용 가림 적용)' : ''}` })),
      h('button', { class: 'btn', disabled: r.source === 'none' ? true : null, title: r.source === 'none' ? '수집기 사본도 저장소 사본도 없음' : null, onclick: () => openReport(r), text: r.source === 'none' ? '사본 없음' : '열기' }))));
  } catch {
    $('reports').replaceChildren(h('div', { class: 'empty', text: '보고서 목록을 불러오지 못했습니다.' }));
  }
}

async function openReport(r) {
  $('viewer').hidden = false;
  $('viewer-title').textContent = r.title;
  $('viewer-meta').textContent = `${REPORT_SRC[r.source]} · 경로·접속 정보 필터 적용 — 원문과 일부 표시가 다를 수 있음`;
  $('viewer-body').textContent = '불러오는 중…';
  try {
    const res = await fetch(`api/reports/${r.id}`, { cache: 'no-store', credentials: 'same-origin' });
    $('viewer-body').textContent = res.ok ? await res.text() : res.status === 401 ? '열람 권한이 필요합니다.' : '보고서 사본을 읽을 수 없습니다.';
  } catch { $('viewer-body').textContent = '보고서를 불러오지 못했습니다.'; }
  $('viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderLab() {
  try {
    const d = await getJson('api/experiments');
    $('lab-note').replaceChildren(prov('repository'), document.createTextNode(` ${d.message || ''}`));
    if (d.state !== 'ok') {
      $('experiments').replaceChildren(h('tbody', {}, h('tr', {}, h('td', { text: `제작 저장소 자료 ${d.state === 'missing' ? '없음' : '오류'} — ${d.message}` }))));
      $('env').replaceChildren(h('div', { class: 'empty', text: '재현 정보 없음' }));
      $('tools').replaceChildren();
      return;
    }
    // a fresh node per row — reusing one node would move it to the last row
    const V = { kept: () => tag('보존', 'good'), superseded: () => tag('대체됨', 'locked'), invalid: () => tag('무효 · 해석 금지', 'bad') };
    const CS = { match: ['보존 코드와 일치', 'good'], partial: ['일부 해시 없음', 'warn'], mismatch: ['불일치 · 재현성 미확보', 'bad'], unverifiable: ['검증 불가', 'warn'], none: ['코드 해시 없음', 'locked'] };
    const codeCell = e => {
      const [label, tone] = CS[e.code_status] || ['검증 불가', 'warn'];
      return h('td', { title: e.reproducibility_note },
        tag(label, tone),
        h('div', { class: 'mono small', text: `참조 일치 ${e.code_refs.match} · 불일치 ${e.code_refs.mismatch}${e.code_refs.unverifiable ? ` · 검증 불가 ${e.code_refs.unverifiable}` : ''}${e.code_json.without_hash ? ` · 해시 없는 결과 ${e.code_json.without_hash}` : ''}` }),
        ...e.code_mismatches.slice(0, 3).map(m => h('div', { class: 'mono small bad-text', text: `${m.file || '(이름 없음)'} 기록 ${m.recorded}… ≠ 보존 ${m.preserved.map(x => `${x}…`).join(', ') || '없음'}` })));
    };
    const cc = d.code_check;
    $('code-check').replaceChildren(
      h('div', { class: 'kv' },
        h('span', { text: '해시 참조 일치' }), h('span', { text: String(cc.refs_match) }),
        h('span', { text: '해시 참조 불일치' }), h('span', { class: cc.refs_mismatch ? 'bad-text' : '', text: String(cc.refs_mismatch) }),
        h('span', { text: '불일치가 있는 결과 JSON' }), h('span', { text: String(cc.json_with_mismatch) }),
        h('span', { text: '코드 해시 없는 결과 JSON' }), h('span', { text: String(cc.json_without_hash) }),
        h('span', { text: '검증 불가 참조 · 읽기 실패' }), h('span', { text: `${cc.refs_unverifiable} · ${cc.json_unreadable}` }),
        h('span', { text: 'NaN·Infinity 값(읽기만 null 처리)' }), h('span', { text: String(cc.nonstandard_values) })),
      cc.experiments_not_secured.length ? h('p', { class: 'bad-text', text: `재현성 미확보: ${cc.experiments_not_secured.map(x => x.split('/').pop()).join(', ')}` }) : null,
      h('p', { class: 'muted', text: cc.note }));
    $('experiments').replaceChildren(
      h('thead', {}, h('tr', {}, ['단계', '종류', '실험', '시각(KST)', '결과', '코드 해시 대조', '상태'].map(t => h('th', { text: t })))),
      h('tbody', {}, d.experiments.map(e => h('tr', { class: e.validity },
        h('td', { class: 'mono', text: e.stage || '—' }), h('td', { text: e.kind }), h('td', { class: 'mono', text: e.id.split('/').pop() }),
        h('td', { class: 'mono', text: e.time_kst || '—', title: e.time_note }), h('td', { class: 'mono', text: `${e.results}건${e.untracked_files ? ` · 원본만 ${e.untracked_files}` : ''}` }),
        codeCell(e), h('td', { title: e.validity_note || null }, V[e.validity] ? V[e.validity]() : e.validity)))));
    const env = d.environment;
    $('env').replaceChildren(env ? h('div', { class: 'kv' }, h('span', { text: 'Python' }), h('span', { text: env.python || '기록 없음' }), ...env.packages.flatMap(p => [h('span', { text: p.name }), h('span', { text: p.version })])) : h('div', { class: 'empty', text: '고정 환경 파일 없음' }),
      h('p', { class: 'muted', text: `추적 ${d.totals.tracked}개 · 원본 목록 ${d.totals.inventory ?? '—'}개(큰 파일 ${d.totals.untracked}개는 원본에만)${d.revision ? ` · 저장소 판 ${d.revision}` : ''}` }));
    $('tools').replaceChildren(...d.tools.map(t => h('div', { class: 'mini-row' }, h('span', { class: 'mono', text: `${t.folder}/${t.name}` }), h('span', { class: 'mono', text: t.sha256, title: t.role }))));
  } catch {
    $('experiments').replaceChildren(h('tbody', {}, h('tr', {}, h('td', { text: '실험 이력을 불러오지 못했습니다.' }))));
  }
}

async function refresh() {
  try {
    overview = await getJson('api/overview');
    lastOk = Date.now();
    banners(overview, false);
    renderCompute(overview);
    renderStages(overview.records);
    renderTeams(overview);
    renderIssues(overview.records);
    renderDecisions(overview.records);
    renderSources(overview);
  } catch {
    banners(overview, true);
    if (overview) {
      const unknown = { state: 'unknown', label: '확인 불가', basis: '서버 연결 실패 — 이전 값은 현재 상태가 아님' };
      overview.compute = { ...overview.compute, activity: unknown, blender_queue: { ...overview.compute.blender_queue, state: 'unknown', running: null } };
      renderCompute(overview);
    }
  }
  renderClock();
}

async function init() {
  try { session = await getJson('api/session'); } catch { /* keep defaults */ }
  $('access').textContent = session.auth === 'off' ? (session.user ? `로그인 없음 · ${session.user}` : '로그인 없음 · 사내망 공개') : session.user ? `인증됨 · ${session.user}` : '인증 상태 확인 불가';
  $('access').className = `pill ${session.auth === 'off' ? 'dim' : session.user ? 'ok' : 'dim'}`;
  $('version').textContent = `v${session.version || '?'}${session.demo ? ' · 예시 모드' : ''}`;
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.tab').forEach(x => { x.hidden = x.id !== `tab-${b.dataset.tab}`; });
    try { history.replaceState(null, '', `#${b.dataset.tab}`); } catch { /* ignore */ }
  }));
  $('viewer-close').addEventListener('click', () => { $('viewer').hidden = true; });
  const start = location.hash.slice(1);
  if (start) document.querySelector(`[data-tab="${CSS.escape(start)}"]`)?.click();
  await refresh();
  renderReports();
  renderLab();
  renderMedia();
  setInterval(refresh, 30000);
  setInterval(renderClock, 1000);
}
init();
