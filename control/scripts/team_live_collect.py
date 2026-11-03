#!/usr/bin/env python3
"""Thermal Collapse — team session collector (host side, read-only on every input).

Writes ONE public-safe summary, <out>/team_live.json, for the Houdini Production Control web service:
  * per fixed team (TC-PROD / TC-QA / TC-WORK): the bound Claude Code session, its execution state
    (RUNNING / IDLE / STOPPED / STALE / UNKNOWN) and the evidence behind it, the last hash-verified handoff
    record of the team (Work continuity ledger), and the token usage / API-price estimate of its sessions;
  * server-wide Claude Code token totals (all projects) and recent rates.

Inputs (all read-only):
  <claude_home>/sessions/<pid>.json   Claude Code's live-session registry (pid, sessionId, procStart, name, status)
  /proc/<pid>/stat                     process start time (field 22) — guards against PID reuse
  <claude_home>/projects/**.jsonl      transcripts: mtime (activity) and message usage (tokens) — content is never read out
  <ledger_root>/teams/<team>/...       Work continuity ledger, through its own records.py / dev_link.py (reused, unchanged)

Identity: a session belongs to a team only through its explicit user-set session name (`claude -n TC-QA-...`),
compared with the team's start directories. Shared Claude memory text is never used.

Never written to the output: paths, command lines, prompts, transcript text, raw logs, account names.
Own state (seen sessions, token cache, transition events) lives in <state_dir> (default: sibling 'state' of <out>), never inside <out>.

usage: python3 -I team_live_collect.py --config <config.json> [--out DIR] [--now EPOCH_S]
"""
import argparse, glob, hashlib, importlib.util, json, os, re, sys, time
from datetime import datetime, timezone, timedelta

SCHEMA = 'tc-team-live/1'
TEAMS = ('TC-PROD', 'TC-QA', 'TC-WORK')
KST = timezone(timedelta(hours=9))
CLK = os.sysconf('SC_CLK_TCK') if hasattr(os, 'sysconf') else 100

# USD per million tokens (Anthropic first-party list prices; checked 2026-11-03 against the bundled
# claude-api reference: Opus 5.5 $4 in / $20 out, cache read $0.20; cache write = 1.25x (5 min) / 2x (1 h) input).
# Fast mode doubles every rate. Unknown models are priced as None (shown as "단가 미등록").
PRICES = {
    'claude-opus-5-5': dict(input=4.0, output=20.0, cache_read=0.20),
    'claude-opus-5': dict(input=5.0, output=25.0, cache_read=0.50),
    'claude-opus-4-8': dict(input=5.0, output=25.0, cache_read=0.50),
    'claude-sonnet-5-5': dict(input=2.0, output=10.0, cache_read=0.20),
    'claude-sonnet-5': dict(input=2.0, output=10.0, cache_read=0.20),
    'claude-haiku-5-5': dict(input=0.10, output=0.50, cache_read=0.01),
    'claude-fable-5-1': dict(input=10.0, output=50.0, cache_read=0.25),
}
TOKEN_KEYS = ('input', 'output', 'cache_write_5m', 'cache_write_1h', 'cache_read')


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec='seconds') if ts else None


def read_json(p, limit=4 << 20):
    with open(p, 'rb') as f:
        b = f.read(limit + 1)
    if len(b) > limit:
        raise ValueError('too large')
    return json.loads(b)


def atomic_write(p, obj):
    tmp = f'{p}.{os.getpid()}.tmp'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, p)


def short(sid):
    return sid[:8] if isinstance(sid, str) and re.fullmatch(r'[0-9a-f-]{8,64}', sid) else None


def safe_name(n):
    return n[:60] if isinstance(n, str) and re.fullmatch(r'[\w .()\-]{1,60}', n) else None


# ---------------------------------------------------------------- processes
def proc_start(pid):
    """process start time in clock ticks since boot (string, as Claude Code stores procStart), or None"""
    try:
        with open(f'/proc/{int(pid)}/stat', 'rb') as f:
            s = f.read().decode('utf8', 'replace')
        return s[s.rindex(')') + 2:].split()[19]          # field 22 overall; fields after "(comm)" start at 3
    except (OSError, ValueError, IndexError):
        return None


def team_of_name(name, cfg):
    if not name:
        return None
    for team, t in cfg['teams'].items():
        for pre in t.get('name_prefixes', [team]):
            if name == pre or name.startswith(pre + '-'):
                return team
    return None


def start_class(cwd, team, cfg):
    real = os.path.realpath(cwd) if isinstance(cwd, str) else None
    if not real:
        return 'unknown'
    own = [os.path.realpath(p) for p in cfg['teams'].get(team, {}).get('start_paths', [])]
    if any(real == p or real.startswith(p + os.sep) for p in own):
        return 'team_start'
    for other, t in cfg['teams'].items():
        if other != team and any(real == os.path.realpath(p) or real.startswith(os.path.realpath(p) + os.sep) for p in t.get('start_paths', [])):
            return 'other_team_start'
    if any(real == os.path.realpath(p) for p in cfg.get('shared_paths', [])):
        return 'shared_repo'
    return 'other'


def transcript_index(claude_home):
    """sessionId -> list of transcript files (main + subagents)"""
    idx = {}
    for p in glob.glob(os.path.join(claude_home, 'projects', '*', '*.jsonl')) + glob.glob(os.path.join(claude_home, 'projects', '*', '*', 'subagents', '*.jsonl')):
        rel = os.path.relpath(p, os.path.join(claude_home, 'projects')).split(os.sep)
        sid = rel[1][:-6] if len(rel) == 2 else rel[1]
        idx.setdefault(sid, []).append(p)
    return idx


def live_sessions(cfg, now, tindex):
    out = []
    for f in sorted(glob.glob(os.path.join(cfg['claude_home'], 'sessions', '*.json'))):
        try:
            d = read_json(f, 64 << 10)
        except (OSError, ValueError):
            continue
        sid, pid = d.get('sessionId'), d.get('pid')
        if not short(sid) or not isinstance(pid, int):
            continue
        ps = proc_start(pid)
        alive = ps is not None and str(d.get('procStart')) == ps
        mt = [os.path.getmtime(p) for p in tindex.get(sid, []) if os.path.exists(p)]
        name = safe_name(d.get('name')) if d.get('nameSource') == 'user' else None
        team = team_of_name(name, cfg)
        out.append(dict(session_id=sid, pid=pid, proc_start=str(d.get('procStart')), alive=alive,
                        pid_reused=ps is not None and not alive, name=name, team=team,
                        start_class=start_class(d.get('cwd'), team, cfg) if team else None,
                        status=d.get('status') if d.get('status') in ('busy', 'idle', 'waiting') else 'other',
                        started_at=(d.get('startedAt') or 0) / 1000,
                        registry_updated_at=max((d.get('updatedAt') or 0), (d.get('statusUpdatedAt') or 0)) / 1000,
                        transcript_mtime=max(mt) if mt else None, kind=d.get('kind') if d.get('kind') in ('interactive', 'print', 'sdk') else 'other'))
    return out


# ---------------------------------------------------------------- tokens
def usage_of(u):
    cc = u.get('cache_creation') or {}
    w1h = int(cc.get('ephemeral_1h_input_tokens') or 0)
    w5m = int(cc.get('ephemeral_5m_input_tokens') or 0)
    total_w = int(u.get('cache_creation_input_tokens') or 0)
    if w1h + w5m != total_w:                      # no TTL split recorded: count as 5-minute writes
        w5m, w1h = total_w, 0
    return dict(input=int(u.get('input_tokens') or 0), output=int(u.get('output_tokens') or 0),
                cache_write_5m=w5m, cache_write_1h=w1h, cache_read=int(u.get('cache_read_input_tokens') or 0))


def cost_of(model, speed, t):
    p = PRICES.get(model)
    if not p:
        return None
    k = 2.0 if speed == 'fast' else 1.0
    return k * (t['input'] * p['input'] + t['output'] * p['output'] + t['cache_write_5m'] * p['input'] * 1.25
                + t['cache_write_1h'] * p['input'] * 2.0 + t['cache_read'] * p['cache_read']) / 1e6


def scan_tokens(claude_home, cache):
    """incremental, append-only parse of every transcript; dedupe by message id. Returns list of
    (session_id, project_key, ts, model, speed, tokens) for every NEW message plus updates cache."""
    files = cache.setdefault('files', {})
    # message ids are deduplicated ACROSS files: a resumed / forked session and some subagent transcripts copy
    # earlier assistant messages (same id, same usage) into a new file — counting them per file double counts.
    gseen = set(cache.setdefault('seen', []))
    new = []
    root = os.path.join(claude_home, 'projects')
    paths = glob.glob(os.path.join(root, '*', '*.jsonl')) + glob.glob(os.path.join(root, '*', '*', 'subagents', '*.jsonl'))
    def mtime(q):
        try:
            return os.path.getmtime(q)
        except OSError:
            return 0
    for p in sorted(paths, key=mtime):                 # oldest file first: a copied message stays with its original session
        rel = os.path.relpath(p, root).split(os.sep)
        proj, sid = rel[0], (rel[1][:-6] if len(rel) == 2 else rel[1])
        try:
            st = os.stat(p)
        except OSError:
            continue
        ent = files.get(p)
        if ent is None or st.st_size < ent['offset'] or st.st_ino != ent.get('ino'):
            ent = files[p] = dict(offset=0, ino=st.st_ino, title=None)
        if st.st_size == ent['offset']:
            continue
        with open(p, 'rb') as f:
            f.seek(ent['offset'])
            data = f.read()
        end = data.rfind(b'\n') + 1               # only complete lines; a partial last line is re-read next time
        for line in data[:end].splitlines():
            if b'"custom-title"' in line:
                try:
                    o = json.loads(line)
                    if o.get('type') == 'custom-title':
                        ent['title'] = safe_name(o.get('customTitle'))
                except ValueError:
                    pass
                continue
            if b'"usage"' not in line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            m = o.get('message') or {}
            u = m.get('usage')
            if o.get('type') != 'assistant' or not isinstance(u, dict):
                continue
            mid = m.get('id') or o.get('requestId') or o.get('uuid')
            if not mid or mid in gseen:
                continue
            gseen.add(mid); cache['seen'].append(mid)
            try:
                ts = datetime.fromisoformat(o['timestamp'].replace('Z', '+00:00')).timestamp()
            except (KeyError, ValueError, AttributeError):
                ts = st.st_mtime
            new.append((sid, proj, ts, str(m.get('model') or 'unknown')[:40], u.get('speed') if u.get('speed') == 'fast' else 'standard', usage_of(u)))
        ent['offset'] += end
        ent['sid'], ent['proj'] = sid, proj
    return new


def add(acc, model, speed, t):
    for k in TOKEN_KEYS:
        acc[k] = acc.get(k, 0) + t[k]
    acc['requests'] = acc.get('requests', 0) + 1
    c = cost_of(model, speed, t)
    if c is None:
        acc['unpriced_requests'] = acc.get('unpriced_requests', 0) + 1
    else:
        acc['cost_usd'] = acc.get('cost_usd', 0.0) + c


def empty():
    return dict({k: 0 for k in TOKEN_KEYS}, requests=0, cost_usd=0.0, unpriced_requests=0)


def finish(acc, krw):
    a = dict(empty(), **acc)
    a['total_tokens'] = sum(a[k] for k in TOKEN_KEYS)
    a['cost_usd'] = round(a['cost_usd'], 4)
    a['cost_krw'] = round(a['cost_usd'] * krw) if krw else None
    return a


# ---------------------------------------------------------------- ledger (Work continuity, reused unchanged)
def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def ledger_teams(root):
    """the Work dev_link.snapshot() team list (hash-verified records, sanitised) — None when unavailable"""
    if not root:
        return None
    tools = os.path.join(root, 'tools')
    try:
        sys.path.insert(0, tools)
        load_module('records', os.path.join(tools, 'records.py'))
        dl = load_module('dev_link', os.path.join(tools, 'dev_link.py'))
        from pathlib import Path
        return {t['team_id']: t for t in dl.snapshot(Path(root))['teams']}
    except Exception:
        return None
    finally:
        if sys.path and sys.path[0] == tools:
            sys.path.pop(0)


PLACEHOLDER = re.compile(r'placeholder|자리표시|미등록|initial', re.I)


def handoff_view(rec):
    if not rec or not rec.get('record_available'):
        return dict(available=False, label='팀 기록을 읽을 수 없음 (없음 · 해시 불일치 · 팀 ID 불일치)')
    owner = bool(rec.get('owner_attested'))
    state = rec.get('last_confirmed_state')
    return dict(available=True, owner_submitted=owner,
                placeholder=(not owner) or bool(PLACEHOLDER.search(str(state or ''))),
                recorded_at=rec.get('last_handoff_at'), task_id=rec.get('task_id'), commit=rec.get('commit'),
                last_confirmed_state=state, next=rec.get('next') or [],
                technical_completion=rec.get('separate_records', {}).get('technical_completion'),
                independent_physics=rec.get('separate_records', {}).get('independent_physics'),
                director_decision=rec.get('separate_records', {}).get('director_decision'),
                source='Work 연속성 기록 (해시 검증된 팀별 HEAD)')


# ---------------------------------------------------------------- state machine
def team_state(team, sess, prev, now, fresh_s):
    """returns (state, basis, session_view) for one team"""
    bound = [s for s in sess if s['team'] == team and s['alive']]
    if bound:
        s = max(bound, key=lambda x: max(x['registry_updated_at'], x['transcript_mtime'] or 0))
        last = max(s['registry_updated_at'], s['transcript_mtime'] or 0)
        age = now - last
        if s['status'] == 'busy' and age <= fresh_s:
            st, basis = 'RUNNING', f'프로세스 생존(시작 시각 일치) · 세션 상태 busy · 최근 활동 {int(age)}초 전'
        elif s['status'] in ('idle', 'waiting'):
            st, basis = 'IDLE', '프로세스 생존(시작 시각 일치) · 세션이 입력 대기(idle)로 보고함'
        elif s['status'] == 'busy':
            st, basis = 'STALE', f'프로세스는 살아 있으나 busy 표시 뒤 {int(age // 60)}분 동안 활동 근거 없음'
        else:
            st, basis = 'UNKNOWN', '프로세스는 살아 있으나 세션 상태를 해석할 수 없음'
        return st, basis, s, len(bound)
    if prev:
        # a session was bound before and is no longer a live process with the same start time
        return 'STOPPED', prev.get('stop_basis') or '이전 연결 세션의 프로세스 종료 확인', None, 0
    return 'UNKNOWN', '이 팀에 연결된(이름이 지정된) 세션을 본 적 없음 — 실행 여부 확인 불가', None, 0


def session_public(s, cfg):
    if not s:
        return None
    return dict(id=short(s['session_id']), name=s['name'], kind=s['kind'],
                start=dict(team_start='팀 전용 시작 폴더', shared_repo='공용 저장소 폴더 (분리 안 됨)',
                           other_team_start='다른 팀 시작 폴더 (충돌)', other='기타 폴더', unknown='확인 불가').get(s['start_class'], '확인 불가'),
                binding='verified' if s['start_class'] == 'team_start' else 'conflict' if s['start_class'] == 'other_team_start' else 'name_only',
                started_at=iso(s['started_at']), last_activity_at=iso(max(s['registry_updated_at'], s['transcript_mtime'] or 0)),
                reported_status=s['status'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--out')
    ap.add_argument('--now', type=float)
    a = ap.parse_args()
    cfg = read_json(a.config, 256 << 10)
    out_dir = a.out or cfg['out_dir']
    # private state (transcript paths, message ids, session titles) must live OUTSIDE the folder the web container mounts
    state_dir = cfg.get('state_dir') or os.path.join(os.path.dirname(os.path.abspath(out_dir)), 'state')
    if os.path.realpath(state_dir).startswith(os.path.realpath(out_dir) + os.sep) or os.path.realpath(state_dir) == os.path.realpath(out_dir):
        sys.exit('state_dir must not be inside out_dir')
    os.makedirs(out_dir, exist_ok=True); os.makedirs(state_dir, mode=0o700, exist_ok=True)
    now = a.now or time.time()
    fresh_s = int(cfg.get('fresh_s', 600))
    krw = cfg.get('fx', {}).get('krw_per_usd')

    st_path = os.path.join(state_dir, 'sessions.json')
    tk_path = os.path.join(state_dir, 'tokens.json')
    try:
        state = read_json(st_path)
    except (OSError, ValueError):
        state = dict(teams={}, events=[], titles={})
    try:
        tcache = read_json(tk_path, 64 << 20)
    except (OSError, ValueError):
        tcache = dict(files={}, msgs=[])

    tindex = transcript_index(cfg['claude_home'])
    sess = live_sessions(cfg, now, tindex)

    # ---- tokens (incremental). msgs: compact rows [sid, proj, ts, model, speed, in, out, w5, w1, rd]
    for sid, proj, ts, model, speed, t in scan_tokens(cfg['claude_home'], tcache):
        tcache['msgs'].append([sid, proj, round(ts, 1), model, speed] + [t[k] for k in TOKEN_KEYS])
    titles = {e.get('sid'): e.get('title') for e in tcache['files'].values() if e.get('title')}
    for s in sess:
        if s['name']:
            titles[s['session_id']] = s['name']
    state['titles'].update({k: v for k, v in titles.items() if k})
    sid_team = {sid: team_of_name(n, cfg) for sid, n in state['titles'].items()}

    proj_key = cfg.get('project_key')          # Claude Code project folder name of the Houdini repository (config only)
    day0 = datetime.fromtimestamp(now, KST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    windows = dict(last_5m=now - 300, last_60m=now - 3600, today_kst=day0, all=0)
    agg = {g: {w: {} for w in windows} for g in ('server', 'houdini', 'unassigned_houdini') + TEAMS}
    per_session = {}
    models = {}
    for sid, proj, ts, model, speed, *vals in tcache['msgs']:
        t = dict(zip(TOKEN_KEYS, vals))
        groups = ['server']
        team = sid_team.get(sid)
        if proj == proj_key:
            groups.append('houdini')
            groups.append(team if team else 'unassigned_houdini')
        elif team:
            groups.append(team)
        for w, since in windows.items():
            if ts >= since:
                for g in groups:
                    add(agg[g][w], model, speed, t)
        ps = per_session.setdefault(sid, dict(acc={}, last=0, first=ts, team=team, proj=proj))
        add(ps['acc'], model, speed, t); ps['last'] = max(ps['last'], ts); ps['first'] = min(ps['first'], ts)
        mm = models.setdefault(model, {}); add(mm, model, speed, t)

    tokens = {g: {w: finish(v, krw) for w, v in ws.items()} for g, ws in agg.items()}
    for g in tokens:
        r5 = tokens[g]['last_5m']
        tokens[g]['rate'] = dict(tokens_per_min=round(r5['total_tokens'] / 5), output_per_min=round(r5['output'] / 5),
                                 usd_per_hour=round(r5['cost_usd'] * 12, 3), krw_per_hour=round(r5['cost_usd'] * 12 * krw) if krw else None)
    sessions_tok = sorted(({'id': short(s), 'name': state['titles'].get(s), 'team': v['team'], 'houdini': v['proj'] == proj_key,
                            'first_at': iso(v['first']), 'last_at': iso(v['last']), **finish(v['acc'], krw)} for s, v in per_session.items() if v['proj'] == proj_key),
                          key=lambda x: x['last_at'] or '', reverse=True)[:int(cfg.get('max_sessions', 12))]

    # ---- team states + transitions
    teams_out, events = [], state['events']
    led = ledger_teams(cfg.get('ledger_root'))
    for team in TEAMS:
        tcfg = cfg['teams'][team]
        prev = state['teams'].get(team)
        # 1) the previously bound session: confirm its end (registry gone / process gone / PID reused)
        if prev and not prev.get('stopped_at'):
            same = [x for x in sess if x['session_id'] == prev['session_id']]
            if not (same and same[0]['alive']):
                why = ('PID 재사용 감지 — 같은 PID 의 다른 프로세스(시작 시각 불일치)' if same and same[0]['pid_reused']
                       else '등록 파일은 남았으나 프로세스 없음' if same else '세션 등록 파일 삭제 · 프로세스 없음')
                prev.update(stopped_at=iso(now), stop_basis=f'종료 확인: {why}')
        # 2) current state
        if not tcfg.get('observable', True):
            st, basis, s, n_alive = 'UNKNOWN', tcfg.get('unobservable_basis', '이 팀의 실행 환경은 서버에서 관측할 수 없음'), None, 0
        else:
            st, basis, s, n_alive = team_state(team, sess, prev if prev and prev.get('stopped_at') else None, now, fresh_s)
        # 3) record + transitions
        if s:
            if not prev or prev['session_id'] != s['session_id']:
                if prev and not prev.get('stopped_at'):
                    prev.update(stopped_at=iso(now), stop_basis='다른 세션이 이 팀으로 새로 연결됨 (이전 세션은 아직 살아 있을 수 있음)')
                rec = dict(session_id=s['session_id'], pid=s['pid'], proc_start=s['proc_start'], name=s['name'], bound_at=iso(now),
                           previous=({k: prev.get(k) for k in ('session_id', 'name', 'bound_at', 'stopped_at', 'stop_basis', 'last_activity_at')} if prev else None))
                events.append(dict(at=iso(now), team=team, event='connected', session=short(s['session_id']), name=s['name']))
            else:
                rec = prev
                if prev.get('last_state') != st:
                    events.append(dict(at=iso(now), team=team, event='state', session=short(s['session_id']), frm=prev.get('last_state'), to=st))
            rec.update(last_state=st, last_activity_at=iso(max(s['registry_updated_at'], s['transcript_mtime'] or 0)))
            state['teams'][team] = rec
        elif prev and prev.get('stopped_at') and prev.get('last_state') != 'STOPPED':
            events.append(dict(at=iso(now), team=team, event='stopped', session=short(prev['session_id']), name=prev.get('name'), basis=prev.get('stop_basis')))
            prev['last_state'] = 'STOPPED'
        cur = state['teams'].get(team)
        if s:
            pv = cur.get('previous')
        else:
            pv = cur
        previous_session = (dict(id=short(pv['session_id']), name=pv.get('name'), bound_at=pv.get('bound_at'), stopped_at=pv.get('stopped_at'),
                                 stop_basis=pv.get('stop_basis'), last_activity_at=pv.get('last_activity_at')) if pv else None)
        teams_out.append(dict(team_id=team, label=tcfg.get('label', team), duty=tcfg.get('duty'),
                              execution=dict(state=st, basis=basis, duplicate_live_sessions=max(0, n_alive - 1)),
                              session=session_public(s, cfg), connected_since=cur.get('bound_at') if s and cur else None,
                              previous_session=previous_session,
                              handoff=handoff_view((led or {}).get(team)),
                              tokens={w: tokens[team][w] for w in ('last_5m', 'last_60m', 'today_kst', 'all')}, rate=tokens[team]['rate']))
    state['events'] = events[-int(cfg.get('max_events', 40)):]

    unbound = sum(1 for x in sess if x['alive'] and not x['team'])
    doc = dict(schema=SCHEMA, generated_at=iso(now), collector=dict(fresh_after_s=fresh_s, interval_s=int(cfg.get('interval_s', 60))),
               teams=teams_out,
               pc_houdini=dict(state='UNKNOWN', basis='사용자 Windows PC 의 Houdini 프로세스를 직접 확인할 연결이 없음 — 서버 Claude 세션과 별개'),
               unbound_live_sessions=unbound,
               events=state['events'][-12:],
               tokens=dict(server=tokens['server'], houdini=tokens['houdini'], unassigned_houdini=tokens['unassigned_houdini'],
                           models={m: finish(v, krw) for m, v in models.items()}, sessions=sessions_tok,
                           pricing=dict(basis='Anthropic API 정가(백만 토큰당 USD) 환산 추정 — 실제 청구액 아님. 구독 요금제 사용분은 청구와 무관',
                                        checked=cfg.get('pricing_checked', '2026-11-03'),
                                        table={m: dict(p, cache_write_5m=round(p['input'] * 1.25, 3), cache_write_1h=p['input'] * 2) for m, p in PRICES.items() if m in models},
                                        fast_mode='2배'),
                           fx=dict(krw_per_usd=krw, basis=cfg.get('fx', {}).get('basis'), as_of=cfg.get('fx', {}).get('as_of')),
                           scope='이 서버의 Claude Code 기록만 집계 (ChatGPT Work · 다른 PC 세션 제외)'))
    atomic_write(os.path.join(out_dir, 'team_live.json'), doc)
    atomic_write(st_path, state)
    atomic_write(tk_path, tcache)


if __name__ == '__main__':
    main()
