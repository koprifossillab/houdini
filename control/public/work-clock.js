// Work evidence time only. No process or session liveness is inferred.
(() => {
 function measure(w,now=Date.now(),offline=false){
  const at=w?.verified?Date.parse(w.occurred_at):NaN;
  const age=Number.isFinite(at)&&at<=now+30000?Math.max(0,Math.floor((now-at)/1000)):null;
  const completed=w?.verified&&w.last_completion;
  const seconds=completed?.duration_s;
  return {result:completed?'마지막 작업 완료':'완료 기록 없음',
   execution:'실행 상태 확인 불가',ageSeconds:age,
   activity:offline?'데이터 연결 끊김 · 현재 활동 확인 불가':age!==null&&age<=900?'최근 기록 확인':'새 활동 미확인',
   durationSeconds:Number.isSafeInteger(seconds)&&seconds>=0?seconds:null};
 }
 globalThis.TCWorkClock=Object.freeze({measure});
})();
