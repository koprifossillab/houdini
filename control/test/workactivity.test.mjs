import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {tmp} from './helpers.mjs';
import {verifyEvent,digest,activityStatus} from '../lib/work-event.mjs';
import {intake} from '../scripts/work-intake.mjs';
import {attachWorkActivity} from '../lib/workactivity.mjs';
const keys=crypto.generateKeyPairSync('ed25519');
function payload(overrides={}){return {schema:'tc-work-event/1',team_id:'TC-WORK',event_id:crypto.randomUUID(),sequence:1,previous_hash:null,event_type:'start',task_id:'TC-WORK-TEST',occurred_at:new Date().toISOString(),summary:'격리된 Work 활동 시험',commit:'a'.repeat(40),next:['다음 검수'],artifacts:[],validation:'not_reviewed',handoff_sha256:'b'.repeat(64),...overrides};}
function envelope(p,key=keys.privateKey){const b=Buffer.from(JSON.stringify(p));return {payload_b64:b.toString('base64'),signature_b64:crypto.sign(null,b,key).toString('base64')};}
async function setup(t){const root=await tmp(t),ledger=path.join(root,'handoff');for(const d of ['private/history','out','handoff/history'])await fs.mkdir(path.join(root,d),{recursive:true});const b=Buffer.from(JSON.stringify({team_id:'TC-WORK',author:'TC-WORK',task_id:'OLD',next:[],technical_completion:{state:'complete'},independent_physics:{state:'PASS'},director_decision:{state:'approved'}}));await fs.writeFile(path.join(ledger,'history','initial.json'),b);await fs.writeFile(path.join(ledger,'HEAD.json'),JSON.stringify({revision:'initial.json',sha256:digest(b)}));return {root,ledger,sha:digest(b)};}
test('Work signature and strict safe schema reject wrong key, modified payload, paths and other team',()=>{
 const p=payload(),e=envelope(p);assert.equal(verifyEvent(e,keys.publicKey).payload.team_id,'TC-WORK');
 const other=crypto.generateKeyPairSync('ed25519');assert.throws(()=>verifyEvent(envelope(p,other.privateKey),keys.publicKey));
 const changed={...e,payload_b64:Buffer.from(JSON.stringify({...p,summary:'tampered'})).toString('base64')};assert.throws(()=>verifyEvent(changed,keys.publicKey));
 for(const v of [{team_id:'TC-PROD'},{summary:'/home/research/private'},{summary:'secret token value'},{event_type:'complete',artifacts:[]}])assert.throws(()=>verifyEvent(envelope({...p,...v}),keys.publicKey));
});
test('authenticated intake submits atomically, updates only Work ledger, and dedupes exact retries',async t=>{
 const {root,ledger,sha}=await setup(t),p=payload({handoff_sha256:sha}),e=envelope(p);
 const a=await intake(root,ledger,keys.publicKey,{command:'submit',envelope:e});assert.equal(a.accepted,true);assert.equal(a.duplicate,false);
 const retry=await intake(root,ledger,keys.publicKey,{command:'submit',envelope:e});assert.equal(retry.duplicate,true);
 assert.equal((await fs.readdir(path.join(root,'private/history'))).length,1);
 const h=JSON.parse(await fs.readFile(path.join(ledger,'HEAD.json')));const record=JSON.parse(await fs.readFile(path.join(ledger,'history',h.revision)));
 assert.equal(record.team_id,'TC-WORK');assert.equal(record.work_event_hash,a.event_hash);assert.equal(record.task_id,p.task_id);assert.equal(record.technical_completion.state,'unknown');assert.equal(record.independent_physics.state,'unknown');assert.equal(record.director_decision.state,'unknown');
 assert.equal((await fs.stat(path.join(root,'out/latest.json'))).mode&0o777,0o644);
});
test('replay, out-of-order, stale timestamp and stale handoff are rejected',async t=>{
 const {root,ledger,sha}=await setup(t),p=payload({handoff_sha256:sha});await intake(root,ledger,keys.publicKey,{command:'submit',envelope:envelope(p)});
 await assert.rejects(()=>intake(root,ledger,keys.publicKey,{command:'submit',envelope:envelope({...p,event_id:crypto.randomUUID()})}),/replay/);
 const head=await intake(root,ledger,keys.publicKey,{command:'status'}),base={...p,event_id:crypto.randomUUID(),sequence:2,previous_hash:digest(Buffer.from(envelope(p).payload_b64,'base64')),event_type:'progress',handoff_sha256:head.handoff_sha256};
 await assert.rejects(()=>intake(root,ledger,keys.publicKey,{command:'submit',envelope:envelope({...base,handoff_sha256:'f'.repeat(64)})}),/handoff changed/);
 await assert.rejects(()=>intake(root,ledger,keys.publicKey,{command:'submit',envelope:envelope({...base,occurred_at:new Date(Date.now()-3600000).toISOString()})}),/submission window/);
});
test('start progress complete and expiry retain historical completion without claiming RUNNING',async t=>{
 const {root,ledger,sha}=await setup(t);let p=payload({handoff_sha256:sha});await intake(root,ledger,keys.publicKey,{command:'submit',envelope:envelope(p)});
 for(const type of ['progress','complete']){const head=await intake(root,ledger,keys.publicKey,{command:'status'});p={...p,event_id:crypto.randomUUID(),sequence:p.sequence+1,previous_hash:digest(Buffer.from(envelope(p).payload_b64,'base64')),event_type:type,handoff_sha256:head.handoff_sha256,artifacts:type==='complete'?[{id:'TEST',label:'검수 증거',sha256:'c'.repeat(64)}]:[]};await intake(root,ledger,keys.publicKey,{command:'submit',envelope:envelope(p)});}
 assert.equal(activityStatus(p).state,'COMPLETED');const late=activityStatus(p,Date.now()+901000);assert.equal(late.state,'UNCONFIRMED');assert.equal(late.completed,true);
 const keyfile=path.join(root,'public.pem');await fs.writeFile(keyfile,keys.publicKey.export({type:'spki',format:'pem'}));
 const prod={team_id:'TC-PROD',execution:{state:'RUNNING'}},qa={team_id:'TC-QA',execution:{state:'IDLE'}};
 const result=await attachWorkActivity({teams:[prod,qa,{team_id:'TC-WORK',execution:{state:'UNKNOWN'}}]},path.join(root,'out'),keyfile);
 assert.deepEqual(result.teams[0],prod);assert.deepEqual(result.teams[1],qa);assert.equal(result.teams[2].execution.state,'UNKNOWN');assert.equal(result.teams[2].work_activity.label,'작업 완료');
 await fs.writeFile(path.join(root,'out/latest.json'),'{}');const bad=await attachWorkActivity({teams:[prod,qa,{team_id:'TC-WORK'}]},path.join(root,'out'),keyfile);assert.equal(bad.teams[2].work_activity.state,'UNCONFIRMED');
});
