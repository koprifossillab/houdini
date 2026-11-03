import crypto from 'node:crypto';
export const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const fields=['schema','team_id','event_id','sequence','previous_hash','event_type','task_id','occurred_at','summary','commit','next','artifacts','validation','handoff_sha256'];
const forbidden=/(?:[A-Za-z]:[\\/]|\/(?:home|nfs|srv|tmp|Users)\/|https?:|\b(?:password|secret|api_key|bearer)\b|-----BEGIN|[\w.+-]+@[\w.-]+|(?:\d{1,3}\.){3}\d{1,3})/i;
export function safeText(v,max=240){if(typeof v!=='string'||!v.length||v.length>max||forbidden.test(v)||/[\x00-\x1f]/.test(v))throw Error('unsafe summary field');return v;}
export function verifyEvent(envelope,key){
 if(!envelope||Object.keys(envelope).sort().join()!=='payload_b64,signature_b64'||typeof envelope.payload_b64!=='string'||envelope.payload_b64.length>32768)throw Error('bad envelope');
 const bytes=Buffer.from(envelope.payload_b64,'base64');
 if(bytes.toString('base64')!==envelope.payload_b64||!crypto.verify(null,bytes,key,Buffer.from(envelope.signature_b64,'base64')))throw Error('invalid signature');
 const p=JSON.parse(bytes.toString('utf8'));
 if(Object.keys(p).sort().join()!==fields.slice().sort().join()||p.schema!=='tc-work-event/1'||p.team_id!=='TC-WORK')throw Error('bad event schema/team');
 if(!/^[0-9a-f-]{36}$/.test(p.event_id)||!Number.isSafeInteger(p.sequence)||p.sequence<1||!['start','progress','complete'].includes(p.event_type))throw Error('bad event identity');
 if(p.previous_hash!==null&&!/^[a-f0-9]{64}$/.test(p.previous_hash))throw Error('bad previous hash');
 if(!/^[A-Z0-9_-]{1,100}$/.test(p.task_id)||!Number.isFinite(Date.parse(p.occurred_at))||p.commit!==null&&!/^[a-f0-9]{40}$/.test(p.commit)||!/^[a-f0-9]{64}$/.test(p.handoff_sha256))throw Error('bad evidence');
 safeText(p.summary);if(!Array.isArray(p.next)||p.next.length>5)throw Error('bad next');p.next.forEach(x=>safeText(x,160));
 if(!Array.isArray(p.artifacts)||p.artifacts.length>12||!['not_reviewed','technical_pass','technical_fail'].includes(p.validation))throw Error('bad validation');
 for(const a of p.artifacts){if(Object.keys(a).sort().join()!=='id,label,sha256'||!/^[A-Z0-9_-]{1,80}$/.test(a.id)||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('bad artifact');safeText(a.label,80);}
 if(p.event_type==='complete'&&p.artifacts.length===0)throw Error('completion needs checked artifact');
 return {payload:p,hash:digest(bytes)};
}
export function activityStatus(payload,now=Date.now()){
 const age=Math.floor((now-Date.parse(payload.occurred_at))/1000),fresh=age>=-30&&age<=900;
 return {state:payload.event_type==='complete'?'COMPLETED':!fresh?'UNCONFIRMED':'RECENT_ACTIVITY',
 label:payload.event_type==='complete'?'마지막 작업 완료':!fresh?'활동 미확인':'최근 활동 확인',
 age_s:Math.max(0,age),fresh,completed:payload.event_type==='complete',fresh_window_s:900};
}
