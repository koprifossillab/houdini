import fs from 'node:fs/promises';
import path from 'node:path';
import {verifyEvent,activityStatus} from './work-event.mjs';
export async function attachWorkActivity(view,dir,keyfile,now=Date.now()){
 let activity={state:'UNCONFIRMED',label:'활동 미확인',verified:false,basis:'서명된 Work 기록 미연결'};
 if(dir)try{
  const file=await fs.open(path.join(dir,'latest.json'),'r');let raw;try{const stat=await file.stat();if(stat.size>40000)throw Error('too large');raw=await file.readFile('utf8');}finally{await file.close();}
  const key=await fs.readFile(keyfile);const {payload:p}=verifyEvent(JSON.parse(raw),key);
  activity={...activityStatus(p,now),verified:true,basis:'로컬 Work 서명 검증 · SSH로 제출된 작업 기록 (프로세스 관측 아님)',
   task_id:p.task_id,event_type:p.event_type,occurred_at:p.occurred_at,summary:p.summary,commit:p.commit,next:p.next,artifacts:p.artifacts,validation:p.validation,sequence:p.sequence,
   last_result:p.event_type==='complete'?'작업 완료 기록':'진행 기록'};
 }catch{activity={state:'UNCONFIRMED',label:'활동 미확인',verified:false,basis:'Work 기록 누락 또는 서명·형식 검증 실패'};}
 return {...view,teams:view.teams.map(t=>t.team_id!=='TC-WORK'?t:{...t,work_activity:activity,
  execution:{...t.execution,state:'UNKNOWN',process_alive:null,observed_process_alive:null,basis:'Work는 서명된 작업 기록으로 연결 · 서버 프로세스 관측 대상 아님'}})};
}
