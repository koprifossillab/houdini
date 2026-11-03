import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {verifyEvent,digest} from '../lib/work-event.mjs';
const APP=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function read(p){return JSON.parse(await fs.readFile(p,'utf8'));}
async function atomic(p,data,mode=0o600){const t=p+'.'+crypto.randomUUID()+'.tmp';const f=await fs.open(t,'wx',mode);try{await f.chmod(mode);await f.writeFile(JSON.stringify(data));await f.sync();}finally{await f.close();}await fs.rename(t,p);}
async function handoffHead(dir){const h=await read(path.join(dir,'HEAD.json'));if(!/^[a-zA-Z0-9-]+\.json$/.test(h.revision))throw Error('bad handoff revision');const bytes=await fs.readFile(path.join(dir,'history',h.revision));if(digest(bytes)!==h.sha256||JSON.parse(bytes).team_id!=='TC-WORK')throw Error('handoff integrity');return {h,data:JSON.parse(bytes)};}
export async function intake(root,handoff,key,request){
 const statePath=path.join(root,'private','latest.json');
 let head=null;try{head=await read(statePath);verifyEvent(head,key);}catch(e){if(e.code!=='ENOENT')throw e;}
 const owned=await handoffHead(handoff);
 if(request.command==='status')return {head,handoff_sha256:owned.h.sha256};
 if(request.command!=='submit')throw Error('unsupported request');
 const verified=verifyEvent(request.envelope,key),p=verified.payload;
 const prev=head?verifyEvent(head,key):null;
 const duplicate=!!prev&&p.sequence===prev.payload.sequence&&verified.hash===prev.hash;
 if(!duplicate){
  if(p.sequence!==(prev?.payload.sequence||0)+1||p.previous_hash!==(prev?.hash||null))throw Error('replay/out-of-order');
  const age=Date.now()-Date.parse(p.occurred_at);if(age>300000||age< -30000)throw Error('event time outside submission window');
  if(p.event_type!=='start'&&(!prev||prev.payload.task_id!==p.task_id||prev.payload.event_type==='complete'))throw Error('invalid task transition');
  if(p.handoff_sha256!==owned.h.sha256)throw Error('handoff changed; refresh checkpoint');
 }
 const history=path.join(root,'private','history',`${String(p.sequence).padStart(10,'0')}-${verified.hash}.json`);
 try{await fs.writeFile(history,JSON.stringify(request.envelope),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 if(owned.data.work_event_hash!==verified.hash){
  const updated={...owned.data,team_id:'TC-WORK',author:'TC-WORK',attestation:'verified local Work event signature',
   task_id:p.task_id,commit:p.commit,last_confirmed_state:p.summary,next:p.next,artifacts:p.artifacts,evidence_time:p.occurred_at,
   work_event_hash:verified.hash,work_event_type:p.event_type,recorded_at:p.occurred_at,previous:owned.h};
  const bytes=Buffer.from(JSON.stringify(updated));const revision=crypto.randomUUID().replaceAll('-','')+'.json';
  const file=await fs.open(path.join(handoff,'history',revision),'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await atomic(path.join(handoff,'HEAD.json'),{revision,sha256:digest(bytes)});
 }
 await atomic(statePath,request.envelope);
 await atomic(path.join(root,'out','latest.json'),request.envelope,0o644);
 return {accepted:true,duplicate,sequence:p.sequence,event_hash:verified.hash};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=process.env.TC_WORK_EVENT_ROOT;
 const handoff=process.env.TC_WORK_HANDOFF_DIR;
 if(!root||!handoff)throw Error('private receiver configuration required');
 let lock;
 try{
  let input='';for await(const b of process.stdin){input+=b;if(input.length>65536)throw Error('request too large');}
  const request=JSON.parse(input);if(request.command==='submit')lock=await fs.open(path.join(root,'private','.submit-lock'),'wx',0o600);
  const key=await fs.readFile(path.join(APP,'data','work-public.pem'));
  console.log(JSON.stringify(await intake(root,handoff,key,request)));
 }catch(e){console.error(e.message);process.exitCode=1;}
 finally{if(lock){await lock.close();await fs.unlink(path.join(root,'private','.submit-lock'));}}
}
