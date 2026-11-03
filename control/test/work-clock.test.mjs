import test from 'node:test';import assert from 'node:assert/strict';import '../public/work-clock.js';
test('Work completion persists beyond freshness; age ticks; duration fixed; execution never inferred',()=>{
 const now=Date.now(),w={verified:true,occurred_at:new Date(now-3600000).toISOString(),last_completion:{duration_s:122}};
 const a=TCWorkClock.measure(w,now),b=TCWorkClock.measure(w,now+1000);
 assert.equal(a.result,'마지막 작업 완료');assert.equal(a.execution,'실행 상태 확인 불가');assert.equal(a.activity,'새 활동 미확인');assert.equal(b.ageSeconds,a.ageSeconds+1);assert.equal(b.durationSeconds,122);
 assert.match(TCWorkClock.measure(w,now,true).activity,/연결 끊김/);
 assert.equal(TCWorkClock.measure({verified:false},now).durationSeconds,null);
 assert.equal(TCWorkClock.measure({verified:true,last_completion:{}},now).durationSeconds,null);
});

import fs from 'node:fs/promises';
test('Work clock asset is explicitly routed and loaded before app',async()=>{const server=await fs.readFile(new URL('../server.mjs',import.meta.url),'utf8'),html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(server.includes("'/static/work-clock.js':"));assert.ok(html.indexOf('static/work-clock.js')<html.indexOf('static/app.js'));});
