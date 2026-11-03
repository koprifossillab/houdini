// Time arithmetic only; ticking never fetches data, proves liveness or creates activity.
(() => {
  const stamp = value => {const n=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(n)?n:null;};
  const delta = (end,start) => start===null||end===null||end<start?null:Math.floor((end-start)/1000);
  const format = seconds => seconds===null?'미확인':`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')} · ${String(seconds%60).padStart(2,'0')}초`;
  function measure(team, feed, now=Date.now()) {
    const ex=team.execution||{}, generated=stamp(feed?.generated_at);
    const age=delta(now,generated), fresh=age!==null&&age<=180&&feed?.state==='live';
    const stopped=ex.state==='STOPPED'&&!team.session;
    const session=team.session||(stopped?team.previous_session:null);
    const begin=stamp(session?.started_at), end=stopped?stamp(session?.stopped_at):now;
    const activity=stamp(session?.last_activity_at), activityAge=delta(now,activity);
    const recent=fresh&&activityAge!==null&&activityAge<=(ex.recent_window_s??600);
    let state=ex.state||'UNKNOWN';
    if(!fresh&&['RUNNING','IDLE'].includes(state))state='STALE';
    if(state==='RUNNING'&&(!recent||ex.observed_process_alive!==true))state='STALE';
    const process=!fresh?'마지막 관측 이후 현재 생존 미확인':ex.process_alive===true?'생존 확인 (마지막 서버 수집 기준)':ex.process_alive===false?'종료 확인':'생존 여부 미확인';
    return {state,sessionSeconds:delta(end,begin),activitySeconds:activityAge,collectorAgeSeconds:age,
      elapsed:format(delta(end,begin)),lastActivity:format(activityAge),frozen:stopped,
      durationBasis:begin===null?'확인된 시작 시각 없음':stopped?(end===null?'종료 확인 시각 미확인':'종료 확인 시각 기준 고정'):fresh?'시작 시각 기준 경과':'시작 후 경과 · 현재 실행 미확인',
      process,activity:activityAge===null?'최근 활동 미확인':recent?'최근 활동 근거 있음 (마지막 수집 기준)':'최근 활동 미확인',
      fresh,now};
  }
  globalThis.TCTeamClock=Object.freeze({measure,format});
})();
