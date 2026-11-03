#!/usr/bin/env python3
"""Team-bound Claude Code launcher (interactive).

  python3 -I team_session.py --config <config.json> --team TC-QA [--dry-run] [-- <extra claude args>]

1. The team must exist in the config; its FIRST start_path is the start folder (never the shared repository).
2. Identity is checked by the Work continuity tool, unchanged: team_start.py restore --team T --entrypoint <ledger>/entrypoints/T
   (explicit team == entrypoint team.json == CLAUDE.md header == ledger record team_id). Any mismatch stops here.
3. The restored record (task, commit, last confirmed state, next) is printed — restoration is NOT permission to resume.
4. claude is started in the start folder with an explicit session name <prefix>-<YYYYmmdd-HHMM>, which is what the
   team session collector binds to. Shared-memory role sentences are never consulted.

Difference from a plain `claude` in the shared repository: a plain session has no team name (the collector shows it
as "unbound" and never attributes it to a team), starts in the shared folder (shared project memory) and gets no
verified record restore.
"""
import argparse, json, os, shutil, subprocess, sys, time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--team', required=True, choices=['TC-PROD', 'TC-QA', 'TC-WORK'])
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--claude', default=shutil.which('claude') or os.path.expanduser('~/.local/bin/claude'))
    ap.add_argument('extra', nargs='*')
    a = ap.parse_args()
    cfg = json.load(open(a.config, encoding='utf8'))
    t = cfg['teams'][a.team]
    if t.get('observable') is False:
        sys.exit(f'{a.team}: 이 팀은 서버 Claude 세션으로 운영하지 않음 (설정 observable=false)')
    start = os.path.realpath(t['start_paths'][0])
    if any(start == os.path.realpath(p) for p in cfg.get('shared_paths', [])):
        sys.exit('시작 폴더가 공용 저장소로 설정됨 — 팀 전용 폴더가 필요함')
    if not os.path.isdir(start):
        sys.exit('팀 시작 폴더 없음')
    ledger = cfg['ledger_root']
    r = subprocess.run([sys.executable, '-B', os.path.join(ledger, 'tools', 'team_start.py'), 'restore', '--team', a.team,
                        '--entrypoint', os.path.join(ledger, 'entrypoints', a.team)], capture_output=True, text=True,
                       env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    if r.returncode != 0:
        sys.exit(f'{a.team}: 신원·기록 대조 실패 — 시작하지 않음')
    rec = json.loads(r.stdout)
    if rec.get('team_id') != a.team:
        sys.exit('복원 기록의 team_id 불일치 — 시작하지 않음')
    prefix = t.get('name_prefixes', [a.team])[0]
    name = f'{prefix}-{time.strftime("%Y%m%d-%H%M")}'
    print(f'【{a.team}】 {t.get("label", "")} — 세션 이름 {name}')
    print(f'  마지막 기록: {rec.get("recorded_at")} · 작업 {rec.get("task_id")} · 커밋 {rec.get("commit")}')
    print(f'  확인된 상태: {rec.get("last_confirmed_state")}')
    for i, n in enumerate(rec.get('next') or [], 1):
        print(f'  다음 {i}: {n}')
    print('  (복원은 작업 재개 허가가 아님 — 실행 상태는 관제실의 세션 판정을 따름)')
    cmd = [a.claude, '-n', name] + a.extra
    if a.dry_run:
        print('dry-run:', ' '.join(cmd), '@', 'team start folder')
        return
    os.chdir(start)
    os.execv(a.claude, cmd)


if __name__ == '__main__':
    main()
