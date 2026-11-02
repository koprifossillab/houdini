// Example data for HPC_DEMO=1 (UI review and tests only). Every value here is invented and every
// response built from it carries provenance "example"; the UI shows a fixed banner.
// variant (HPC_DEMO_STATE): live | stale | error — "missing" is handled by the server (no document).
export function exampleCollector(now = Date.now(), variant = 'live') {
  const t = s => new Date(now - s * 1000).toISOString();
  if (variant === 'error') return { schema: 'example-broken', teams: 'x' };
  return {
    schema: 'tc-dash/1',
    generated_at: t(variant === 'stale' ? 900 : 42),
    stage: 'EX-01',
    teams: [
      { key: 'houdini', state: 'running', task: '예시 · 가상의 계산 배치', progress: { total: 12, done: 7, running: 2, failed: 1, waiting: 2 }, evidence: ['예시 근거 — 실제 아님', '계산 프로세스 2개 실행 중'], next: '예시 다음 단계', last_activity: t(70), report: { id: 'eeeeeeeeeeee0001', team: 'houdini', title: '예시 보고서 (실제 아님)', file: 'EXAMPLE_REPORT.md', mtime: t(3600) } },
      { key: 'verify', state: 'waiting', task: '예시 · 검증 대기', progress: null, evidence: ['예시'], next: '', last_activity: t(900), report: null },
      { key: 'blender', state: 'error', task: '예시 · 오류 상태 표시', progress: null, evidence: ['PC 워커 큐 — 대기 3 · 실행 1 · 실패 1', '예시 오류'], next: '', last_activity: t(5000), report: null },
      { key: 'work', state: 'outside', task: '예시 · 서버 밖', progress: null, evidence: [], next: '', last_activity: null, report: null },
    ],
    reports: [{ id: 'eeeeeeeeeeee0001', team: 'houdini', title: '예시 보고서 (실제 아님)', file: 'EXAMPLE_REPORT.md', mtime: t(3600) }],
  };
}
export const EXAMPLE_REPORT = '# 예시 보고서\n\n이 문서는 화면 검토용 예시입니다. 실제 계산·검증 결과가 아닙니다.\n';
