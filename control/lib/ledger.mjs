// Read-only view of the production repository checkout (experiment history, reproducibility).
// Only fixed relative files listed in the import manifest are opened; nothing comes from the URL.
import path from 'node:path';
import { clean, hex, readBounded, readJson } from './sanitize.mjs';

const MANIFEST = 'manifests/tc00_import_manifest.json';
const INVENTORY = 'manifests/tc00_source_inventory.json';
const REQUIREMENTS = 'env/requirements-tc00.txt';
const SEG = /^(?!\.{1,2}$)[\w.-]+$/;
const safeRel = p => typeof p === 'string' && p.length < 300 && p.split('/').every(s => SEG.test(s));

const STAGE = { tc00_02: 'TC-00-02', tc00_03: 'TC-00-03', tc00_03R: 'TC-00-03R', runs: 'TC-00 v0' };
const KIND = [
  [/^settle/, '정착(자중) 시험'], [/^pull/, '경계 인장 시험'], [/^unit_contact/, '접촉 단위 시험'], [/^kinematics/, '운동학(미끄럼) 분석'],
  [/^unit_bpm/, 'BPM 단위 시험'], [/^smoke/, '연기 시험(짧은 실행)'], [/^batch/, '판정 배치'],
  [/^diag_v2/, 'V2 진단 · 마찰/에너지 장부'], [/^diag_v3/, 'V3 진단 · 신장 전 결합 파괴'], [/^diag_v5/, 'V5 진단 · 파편 운동/굴림'],
];

function groupOf(rel) {
  const p = rel.split('/');
  if (p[0] === 'runs') return 'runs';
  if (p[0] === 'tc00_03R' && p[1] === 'out' && p[2]) return `tc00_03R/out/${p[2]}`;
  if ((p[0] === 'tc00_02' || p[0] === 'tc00_03') && p[1] && p.length > 2) return `${p[0]}/${p[1]}`;
  return null;
}

// code_sha256 in real results is either a hex string (one file, name unknown) or an object
// { "<file>.py": "<hex>" }. Each reference becomes match / mismatch / unverifiable.
// Results written by Python's json module may contain bare NaN / Infinity, which JSON.parse rejects.
// Read them as null (outside strings only) — the file itself is never changed. Returns the count too.
export function parsePyJson(text) {
  let nonstandard = 0;
  const fixed = text.replace(/"(?:\\.|[^"\\])*"|-?Infinity\b|\bNaN\b/g, m => (m[0] === '"' ? m : (nonstandard += 1, 'null')));
  return { value: JSON.parse(fixed), nonstandard };
}

export function codeRefs(v, preserved, allPreserved) {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') {
    const h = hex(v, 64);
    if (!h) return [{ file: null, hash: null, status: 'unverifiable', preserved: [] }];
    return [{ file: null, hash: h, status: allPreserved.has(h) ? 'match' : 'mismatch', preserved: [] }];
  }
  if (typeof v !== 'object' || Array.isArray(v)) return [{ file: null, hash: null, status: 'unverifiable', preserved: [] }];
  return Object.entries(v).slice(0, 20).map(([name, val]) => {
    const file = /^[\w.-]{1,80}$/.test(name) ? name : null;
    const h = hex(val, 64);
    if (!file || !h) return { file, hash: h, status: 'unverifiable', preserved: [] };
    const set = preserved.get(file);
    if (!set) return { file, hash: h, status: 'unverifiable', preserved: [] };
    return { file, hash: h, status: set.has(h) ? 'match' : 'mismatch', preserved: [...set] };
  });
}

function timeOf(name) {
  const m = /_(\d{2})(\d{2})(\d{2})$/.exec(name);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : null;
}

export async function ledgerView(dir) {
  const out = { provenance: 'repository', source: '제작 저장소 manifest (읽기 전용)', state: 'missing', message: '', revision: null, experiments: [], tools: [], reports: [], environment: null, totals: null };
  if (!dir) return { ...out, message: '제작 저장소 경로가 설정되지 않음' };
  let man, inv;
  try {
    man = await readJson(path.join(dir, MANIFEST), 2 * 1024 * 1024);
  } catch (e) {
    return { ...out, state: e.code === 'ENOENT' ? 'missing' : 'error', message: e.code === 'ENOENT' ? '이전 manifest 없음' : 'manifest를 읽을 수 없음' };
  }
  if (!man || !Array.isArray(man.files)) return { ...out, state: 'error', message: 'manifest 형식 오류' };
  try { inv = await readJson(path.join(dir, INVENTORY), 4 * 1024 * 1024); } catch { inv = null; }

  const files = man.files.filter(f => f && safeRel(f.path) && safeRel(f.source_rel) && hex(f.sha256, 64));
  const superseded = new Set((inv?.files || []).filter(f => typeof f.path === 'string' && /NOTE_superseded\.txt$/.test(f.path)).map(f => groupOf(f.path)));
  const untracked = (inv?.files || []).filter(f => f && f.tracked === false);

  // F2: preserved code by file name, to check the code_sha256 each result recorded
  const preserved = new Map();
  for (const f of files.filter(f => f.kind === 'code')) {
    const b = path.posix.basename(f.source_rel);
    if (!preserved.has(b)) preserved.set(b, new Set());
    preserved.get(b).add(f.sha256);
  }
  const allPreserved = new Set([...preserved.values()].flatMap(x => [...x]));

  const groups = new Map();
  for (const f of files.filter(f => f.kind === 'result_json')) {
    const g = groupOf(f.source_rel);
    if (!g) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  const experiments = [];
  for (const [g, list] of groups) {
    const top = g.split('/')[0];
    const name = g.split('/').pop();
    const refs = { match: 0, mismatch: 0, unverifiable: 0 };
    const json = { with_hash: 0, without_hash: 0, unreadable: 0, with_mismatch: 0, nonstandard_values: 0 };
    const codes = new Set();
    const mismatches = [];
    for (const f of list.slice(0, 80)) {
      let j;
      try {
        const r = parsePyJson((await readBounded(path.join(dir, f.path), 256 * 1024)).toString('utf8'));
        j = r.value;
        json.nonstandard_values += r.nonstandard;
      } catch { json.unreadable += 1; continue; }
      const r = codeRefs(j?.code_sha256, preserved, allPreserved);
      if (!r.length) { json.without_hash += 1; continue; }
      json.with_hash += 1;
      let bad = false;
      for (const x of r) {
        refs[x.status] += 1;
        if (x.hash) codes.add(x.hash.slice(0, 16));
        if (x.status === 'mismatch') {
          bad = true;
          if (mismatches.length < 12) mismatches.push({ result: f.source_rel, file: x.file, recorded: x.hash.slice(0, 16), preserved: x.preserved.map(h => h.slice(0, 16)) });
        }
      }
      if (bad) json.with_mismatch += 1;
    }
    const code_status = refs.mismatch ? 'mismatch' : (refs.unverifiable || json.unreadable) ? 'unverifiable' : refs.match && json.without_hash ? 'partial' : refs.match ? 'match' : 'none';
    const left = untracked.filter(u => typeof u.path === 'string' && groupOf(u.path) === g);
    experiments.push({
      id: g,
      stage: STAGE[top] || null,
      kind: g === 'runs' ? 'v0 2D 대리 DEM 실행' : (KIND.find(([re]) => re.test(name))?.[1] || '기타'),
      time_kst: timeOf(name) ? `2026-10-30 ${timeOf(name)}` : null,
      time_note: timeOf(name) ? '폴더 이름의 시각' : '시각 기록 없음',
      results: list.length,
      result_sha256: list.map(f => f.sha256.slice(0, 12)).slice(0, 3),
      code_sha256: [...codes],
      code_status,
      code_refs: refs,
      code_json: json,
      code_mismatches: mismatches,
      reproducibility: code_status === 'match' ? 'secured' : code_status === 'mismatch' ? 'not_secured' : 'unknown',
      reproducibility_note: {
        secured: '결과에 기록된 코드 해시가 보존 코드와 모두 일치',
        not_secured: '재현성 미확보 — 결과를 만든 코드 판이 보존되지 않음(기록된 해시와 보존 코드가 다름)',
        unknown: code_status === 'none' ? '결과에 코드 해시 기록 없음 — 재현성 확인 불가' : code_status === 'partial' ? `일부 결과(${json.without_hash}개)에 코드 해시 기록 없음 — 기록된 것은 보존 코드와 일치` : '검증 불가 — 해시 형식 이상, 보존 목록에 없는 파일, 또는 읽을 수 없는 결과',
      }[code_status === 'match' ? 'secured' : code_status === 'mismatch' ? 'not_secured' : 'unknown'],
      untracked_files: left.length,
      validity: g === 'runs' ? 'invalid' : superseded.has(g) ? 'superseded' : 'kept',
      validity_note: g === 'runs' ? '접촉 법선력 부호 오류 — 해석 금지(실패 기록 보존)' : superseded.has(g) ? '같은 시험의 다음 판으로 대체됨(원본 표시)' : '',
    });
  }
  experiments.sort((a, b) => (a.stage || '').localeCompare(b.stage || '') || (a.time_kst || '').localeCompare(b.time_kst || ''));

  const tools = files.filter(f => f.kind === 'code').map(f => ({
    // repo-relative names are public in the repository itself; validated by safeRel, so not passed through clean()
    name: path.posix.basename(f.source_rel),
    folder: path.posix.dirname(f.source_rel),
    sha256: f.sha256.slice(0, 16),
    role: /proxy2d_dem\.py$/.test(f.source_rel) ? 'v0 · 무효(이력용)' : f.source_rel.startsWith('tc00_03R/') ? 'TC-00-03R 진단' : 'v1 판정 도구',
  }));
  const reports = files.filter(f => f.kind === 'report').map(f => ({
    file: path.posix.basename(f.path), sha256: f.sha256.slice(0, 16), source_sha256: hex(f.source_sha256, 64)?.slice(0, 16) || null,
    redacted: f.identical === false, _path: f.path,
  }));

  let environment = null;
  try {
    const txt = (await readBounded(path.join(dir, REQUIREMENTS), 16 * 1024)).toString('utf8');
    const pins = [...txt.matchAll(/^([A-Za-z0-9_.-]+)==([\w.+-]+)\s*$/gm)].map(m => ({ name: m[1], version: m[2] }));
    const py = /CPython\s+(\d+\.\d+\.\d+)/.exec(txt)?.[1] || null;
    environment = { python: py, packages: pins.slice(0, 40) };
  } catch { environment = null; }

  const sum = k => experiments.reduce((a, e) => a + e.code_refs[k], 0);
  const code_check = {
    refs_match: sum('match'), refs_mismatch: sum('mismatch'), refs_unverifiable: sum('unverifiable'),
    json_with_mismatch: experiments.reduce((a, e) => a + e.code_json.with_mismatch, 0),
    json_without_hash: experiments.reduce((a, e) => a + e.code_json.without_hash, 0),
    json_unreadable: experiments.reduce((a, e) => a + e.code_json.unreadable, 0),
    nonstandard_values: experiments.reduce((a, e) => a + e.code_json.nonstandard_values, 0),
    experiments_not_secured: experiments.filter(e => e.reproducibility === 'not_secured').map(e => e.id),
    note: 'NaN·Infinity 는 읽을 때만 null 로 취급(원본 그대로). 결과 JSON 의 code_sha256(문자열 또는 {파일 이름: 해시})를 이전된 보존 코드와 대조 — 결과 수치와 원본 JSON 은 바꾸지 않음',
  };
  const bytes = (inv?.files || []).reduce((s, f) => s + (Number.isSafeInteger(f.bytes) ? f.bytes : 0), 0);
  return {
    ...out,
    state: 'ok',
    message: '이전 manifest 기준 — 계산을 다시 돌린 결과가 아님',
    revision: clean(process.env.HPC_LEDGER_REV || '', 40) || null,
    experiments,
    code_check,
    tools,
    reports,
    environment,
    totals: { tracked: files.length, inventory: inv?.files?.length ?? null, untracked: untracked.length, inventory_bytes: bytes || null },
  };
}

export async function ledgerReport(dir, view, file) {
  const r = view.reports.find(x => x.file === file);
  if (!dir || !r) return null;
  try {
    return (await readBounded(path.join(dir, r._path), 400 * 1024)).toString('utf8');
  } catch {
    return null;
  }
}

export function publicLedger(v) {
  return { ...v, reports: v.reports.map(({ _path, ...r }) => r) };
}
