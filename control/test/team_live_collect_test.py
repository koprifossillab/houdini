"""Synthetic state-machine tests for scripts/team_live_collect.py (no Claude process, no real home).
A fake claude_home holds hand-made registry files; liveness uses real `sleep` processes so the /proc
start-time check is exercised for real.   run: python3 -I -B test/team_live_collect_test.py
"""
import json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
COLLECT = os.path.join(HERE, '..', 'scripts', 'team_live_collect.py')
FAILS = []


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''))
    if not ok:
        FAILS.append(name)


def proc_start(pid):
    s = open(f'/proc/{pid}/stat').read()
    return s[s.rindex(')') + 2:].split()[19]


class Env:
    def __init__(self):
        self.root = tempfile.mkdtemp(prefix='tl-test-')
        self.home = os.path.join(self.root, 'claude')
        os.makedirs(os.path.join(self.home, 'sessions'))
        os.makedirs(os.path.join(self.home, 'projects', 'proj'))
        self.start = {t: os.path.join(self.root, 'start', t) for t in ('TC-PROD', 'TC-QA')}
        for p in self.start.values():
            os.makedirs(p)
        self.shared = os.path.join(self.root, 'shared'); os.makedirs(self.shared)
        self.cfg = os.path.join(self.root, 'config.json')
        json.dump(dict(claude_home=self.home, ledger_root=None, out_dir=os.path.join(self.root, 'out'), state_dir=os.path.join(self.root, 'state'), project_key='proj',
                       shared_paths=[self.shared], fresh_s=600, fx=dict(krw_per_usd=1000),
                       teams={'TC-PROD': dict(label='P', name_prefixes=['TC-PROD'], start_paths=[self.start['TC-PROD']]),
                              'TC-QA': dict(label='Q', name_prefixes=['TC-QA'], start_paths=[self.start['TC-QA']]),
                              'TC-WORK': dict(label='W', name_prefixes=['TC-WORK'], observable=False, start_paths=[])}),
                  open(self.cfg, 'w'))
        self.procs = []

    def sleeper(self):
        p = subprocess.Popen(['sleep', '300']); self.procs.append(p); time.sleep(0.05); return p

    def register(self, pid, sid, name, cwd, status='idle', updated=None, proc=None):
        now_ms = int(time.time() * 1000)
        d = dict(pid=pid, sessionId=sid, cwd=cwd, startedAt=now_ms, procStart=proc if proc is not None else proc_start(pid),
                 name=name, nameSource='user', status=status, updatedAt=updated if updated is not None else now_ms, kind='interactive')
        json.dump(d, open(os.path.join(self.home, 'sessions', f'{pid}.json'), 'w'))

    def unregister(self, pid):
        os.remove(os.path.join(self.home, 'sessions', f'{pid}.json'))

    def transcript(self, sid, msgs):
        with open(os.path.join(self.home, 'projects', 'proj', f'{sid}.jsonl'), 'a') as f:
            for i, (model, out) in enumerate(msgs):
                f.write(json.dumps(dict(type='assistant', timestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                        message=dict(id=f'{sid}-{i}', model=model, usage=dict(input_tokens=10, output_tokens=out,
                                        cache_creation_input_tokens=1000, cache_read_input_tokens=100000,
                                        cache_creation=dict(ephemeral_1h_input_tokens=1000, ephemeral_5m_input_tokens=0))))) + '\n')
                f.write(json.dumps(dict(type='assistant', message=dict(id=f'{sid}-{i}', model=model, usage=dict(output_tokens=out)))) + '\n')  # duplicate line, same id

    def run(self, now=None):
        cmd = [sys.executable, '-I', '-B', COLLECT, '--config', self.cfg] + (['--now', str(now)] if now else [])
        subprocess.run(cmd, check=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
        d = json.load(open(os.path.join(self.root, 'out', 'team_live.json')))
        return {t['team_id']: t for t in d['teams']}, d

    def close(self):
        for p in self.procs:
            p.kill()
        shutil.rmtree(self.root, ignore_errors=True)


def main():
    e = Env()
    try:
        sid_p, sid_q, sid_q2 = 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003'
        t, d = e.run()
        check('T0 no sessions -> UNKNOWN for all', all(t[x]['execution']['state'] == 'UNKNOWN' for x in t), str({x: t[x]['execution']['state'] for x in t}))

        pp, pq = e.sleeper(), e.sleeper()
        e.register(pp.pid, sid_p, 'TC-PROD-T', e.start['TC-PROD'], 'busy')
        e.register(pq.pid, sid_q, 'TC-QA-T', e.start['TC-QA'], 'idle')
        e.transcript(sid_p, [('claude-opus-5-5', 500)])
        t, d = e.run()
        check('T1 PROD busy+fresh -> RUNNING', t['TC-PROD']['execution']['state'] == 'RUNNING')
        check('T1 QA idle -> IDLE', t['TC-QA']['execution']['state'] == 'IDLE')
        check('T1 concurrent sessions bound to own team only', t['TC-PROD']['session']['name'] == 'TC-PROD-T' and t['TC-QA']['session']['name'] == 'TC-QA-T')
        check('T1 binding verified by start folder', t['TC-PROD']['session']['binding'] == 'verified' and t['TC-QA']['session']['binding'] == 'verified')
        check('T1 WORK unobservable -> UNKNOWN', t['TC-WORK']['execution']['state'] == 'UNKNOWN')
        tk = t['TC-PROD']['tokens']['all']
        # 1 message: 10*4 + 500*20 + 1000*8 + 100000*0.2 = 38040 / 1e6 USD
        check('T1 tokens deduped by message id and priced', tk['requests'] == 1 and tk['output'] == 500 and abs(tk['cost_usd'] - 0.038) < 1e-3 and tk['cost_krw'] == 38, json.dumps(tk))

        # the same message copied into another session file (resume / fork) is counted once
        with open(os.path.join(e.home, 'projects', 'proj', 'copy-of-p.jsonl'), 'w') as f:
            f.write(open(os.path.join(e.home, 'projects', 'proj', f'{sid_p}.jsonl')).read())
        t, d = e.run()
        check('T1b message copied into another file counted once', d['tokens']['server']['all']['requests'] == 1, str(d['tokens']['server']['all']['requests']))
        os.remove(os.path.join(e.home, 'projects', 'proj', 'copy-of-p.jsonl'))

        # busy but evidence old -> STALE
        e.register(pp.pid, sid_p, 'TC-PROD-T', e.start['TC-PROD'], 'busy', updated=int((time.time() - 3600) * 1000))
        os.utime(os.path.join(e.home, 'projects', 'proj', f'{sid_p}.jsonl'), (time.time() - 3600, time.time() - 3600))
        t, d = e.run()
        check('T2 busy without fresh evidence -> STALE (not RUNNING)', t['TC-PROD']['execution']['state'] == 'STALE', t['TC-PROD']['execution']['basis'])

        # QA exits normally: registry removed, process gone -> STOPPED; PROD unaffected
        pq.kill(); pq.wait(); e.unregister(pq.pid)
        t, d = e.run()
        check('T3 QA ended -> STOPPED', t['TC-QA']['execution']['state'] == 'STOPPED', t['TC-QA']['execution']['basis'])
        check('T3 stopped event recorded', any(x['event'] == 'stopped' and x['team'] == 'TC-QA' for x in d['events']))
        check('T3 PROD not affected', t['TC-PROD']['execution']['state'] == 'STALE')

        # registry left behind for a dead pid (crash) and PID reuse (same pid, other start time)
        fake = e.sleeper(); fake_pid = fake.pid; fake.kill(); fake.wait()
        e.register(fake_pid, 'dddddddd-0000-0000-0000-000000000004', 'TC-QA-GHOST', e.start['TC-QA'], 'busy', proc='1')
        reuse = e.sleeper()
        e.register(reuse.pid, 'eeeeeeee-0000-0000-0000-000000000005', 'TC-QA-REUSED', e.start['TC-QA'], 'busy', proc='12345')
        t, d = e.run()
        check('T4 nonexistent / reused PID never RUNNING', t['TC-QA']['execution']['state'] == 'STOPPED' and t['TC-QA']['session'] is None, json.dumps(t['TC-QA']['execution']))
        os.remove(os.path.join(e.home, 'sessions', f'{fake_pid}.json')); e.unregister(reuse.pid)

        # QA restarts as a new session: new id, previous session kept with its stop time
        pq2 = e.sleeper()
        e.register(pq2.pid, sid_q2, 'TC-QA-T2', e.start['TC-QA'], 'busy')
        e.transcript(sid_q2, [('claude-opus-5-5', 100)])
        t, d = e.run()
        q = t['TC-QA']
        check('T5 restart -> RUNNING with new session', q['execution']['state'] == 'RUNNING' and q['session']['id'] == sid_q2[:8])
        check('T5 previous session shown with stop time', (q['previous_session'] or {}).get('id') == sid_q[:8] and q['previous_session'].get('stopped_at'))

        # same team name in the PROD start folder -> conflict; name in shared folder -> name_only
        e.register(pq2.pid, sid_q2, 'TC-QA-T2', e.start['TC-PROD'], 'busy')
        t, d = e.run()
        check('T6 QA name in PROD start folder -> conflict binding', t['TC-QA']['session']['binding'] == 'conflict')
        e.register(pq2.pid, sid_q2, 'TC-QA-T2', e.shared, 'busy')
        t, d = e.run()
        check('T6 shared folder -> name_only binding', t['TC-QA']['session']['binding'] == 'name_only')

        # duplicate live sessions for one team
        dup = e.sleeper()
        e.register(dup.pid, 'ffffffff-0000-0000-0000-000000000006', 'TC-QA-DUP', e.start['TC-QA'], 'idle')
        t, d = e.run()
        check('T7 duplicate live sessions flagged', t['TC-QA']['execution']['duplicate_live_sessions'] == 1)

        # unnamed session is never attributed to a team
        un = e.sleeper()
        d0 = dict(pid=un.pid, sessionId='99999999-0000-0000-0000-000000000009', cwd=e.start['TC-PROD'], startedAt=0, procStart=proc_start(un.pid), status='busy', updatedAt=int(time.time() * 1000))
        json.dump(d0, open(os.path.join(e.home, 'sessions', f'{un.pid}.json'), 'w'))
        t, d = e.run()
        check('T8 unnamed session in PROD folder is not PROD', t['TC-PROD']['session']['name'] == 'TC-PROD-T' and d['unbound_live_sessions'] >= 1)

        # output hygiene: no absolute paths, no pids in the public file
        raw = open(os.path.join(e.root, 'out', 'team_live.json')).read()
        check('T9 public output carries no paths', e.root not in raw and '/home/' not in raw and '/proc' not in raw)
        check('T10 public folder holds only team_live.json (state kept outside)', sorted(os.listdir(os.path.join(e.root, 'out'))) == ['team_live.json'], str(os.listdir(os.path.join(e.root, 'out'))))
    finally:
        e.close()
    print(f'{len(FAILS)} failed')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
