import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmp} from './helpers.mjs';
import {teamLiveView} from '../lib/teamlive.mjs';
import '../public/team-clock.js';
const {measure,format}=globalThis.TCTeamClock;
const now=Date.parse('2026-11-03T03:00:00Z');
const iso=t=>new Date(t).toISOString();
const feed={state:'live',generated_at:iso(now-1000)};
const live={team_id:'TC-PROD',execution:{state:'RUNNING',process_alive:true,observed_process_alive:true,recent_window_s:600},session:{started_at:iso(now-7327000),last_activity_at:iso(now-10000)}};
test('timer increments seconds without changing source timestamps or needing a fetch',()=>{
 const before=JSON.stringify(live),a=measure(live,feed,now),b=measure(live,feed,now+1000);
 assert.equal(a.elapsed,'02:02 · 07초');assert.equal(b.sessionSeconds-a.sessionSeconds,1);assert.equal(b.activitySeconds-a.activitySeconds,1);assert.equal(JSON.stringify(live),before);
});
test('STOPPED freezes at confirmed end, retains start, and activity age continues',()=>{
 const stopped={execution:{state:'STOPPED',process_alive:false},previous_session:{started_at:iso(now-7200000),stopped_at:iso(now-30000),last_activity_at:iso(now-60000)}};
 const a=measure(stopped,feed,now),b=measure(stopped,feed,now+900000);
 assert.equal(a.elapsed,b.elapsed);assert.equal(a.sessionSeconds,7170);assert.equal(b.activitySeconds-a.activitySeconds,900);assert.equal(a.frozen,true);
});
test('new activity resets only activity timer; unchanged start survives refresh',()=>{
 const a=measure(live,feed,now),b=measure({...live,session:{...live.session,last_activity_at:iso(now)}},feed,now);
 assert.equal(b.activitySeconds,0);assert.equal(a.sessionSeconds,b.sessionSeconds);
});
test('live process with old activity is STALE, not RUNNING',()=>{
 const v=measure({...live,session:{...live.session,last_activity_at:iso(now-900000)}},feed,now);
 assert.equal(v.state,'STALE');assert.match(v.process,/생존 확인/);assert.equal(v.activity,'최근 활동 미확인');
});
test('late/offline collector never keeps a fresh liveness claim',()=>{
 for(const f of [{...feed,generated_at:iso(now-181000)},{...feed,state:'offline'}]){
  const v=measure(live,f,now);assert.equal(v.state,'STALE');assert.match(v.process,/현재 생존 미확인/);
 }
});
test('missing or future start/end is unknown, never fabricated zero runtime',()=>{
 assert.equal(measure({execution:{state:'UNKNOWN'}},feed,now).elapsed,'미확인');
 assert.equal(measure({...live,session:{...live.session,started_at:iso(now+1000)}},feed,now).sessionSeconds,null);
 assert.equal(format(360000),'100:00 · 00초');
});
test('API preserves confirmed start/end and separates stale process observation',async t=>{
 const dir=await tmp(t);
 const document={schema:'tc-team-live/1',generated_at:iso(now-1000),teams:[{team_id:'TC-PROD',execution:{state:'STOPPED',process_alive:false,observed_at:iso(now-1000)},previous_session:{id:'aaaaaaaa',started_at:iso(now-7200000),stopped_at:iso(now-30000),last_activity_at:iso(now-60000)}}]};
 await fs.writeFile(path.join(dir,'team_live.json'),JSON.stringify(document));
 const view=await teamLiveView(dir,now);assert.equal(view.teams[0].previous_session.started_at,iso(now-7200000));
 assert.equal(view.teams[0].execution.process_alive,false);assert.equal(measure(view.teams[0],view,now).sessionSeconds,7170);
 const stale=await teamLiveView(dir,now+190000);assert.equal(stale.teams[0].execution.process_alive,null);
});
