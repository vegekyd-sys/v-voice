import {mkdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeAvatarEvent} from './avatar-telemetry.mjs';
export function createAvatarTelemetryLog({directory,now=Date.now,maxPending=128,onError=()=>{}}) {
 if(!path.isAbsolute(directory??''))throw Error('Private avatar directory required');
 const captureId=randomUUID();let tail=Promise.resolve(),pending=0,sequence=0,closed=false;
 return {
  write({owner,clientCaptureId,events}){
   if(closed||pending>=maxPending)return Promise.reject(Error('Avatar writer unavailable'));
   pending++;
   const run=async()=>{
    const normalized=events.map(normalizeAvatarEvent);
    const prior=owner.avatarSequences.get(clientCaptureId)??0;
    const fresh=normalized.filter(e=>e.sequence>prior);
    if(!fresh.length)return {accepted:events.length,replayed:true};
    for(let i=1;i<normalized.length;i++)if(normalized[i].sequence<=normalized[i-1].sequence)throw Error('Avatar sequence out of order');
    await mkdir(directory,{recursive:true,mode:0o700});
    const at=now(),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
    const rows=fresh.map(e=>({schema:'voice-avatar-audit-v1',captureId,serverSequence:++sequence,at,
     voiceSessionId:owner.voiceSessionId,sessionKey:owner.sessionKey,provider:owner.provider,model:owner.model,modelSource:'voice_reservation',
     clientCaptureId,reportedBy:'browser',...e}));
    const file=await open(path.join(directory,day+'.jsonl'),constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try{const s=await file.stat();if(!s.isFile()||(s.mode&0o077)!==0)throw Error('Avatar file must be private');await file.writeFile(rows.map(r=>JSON.stringify(r)+'\n').join(''));}finally{await file.close();}
    owner.avatarSequences.set(clientCaptureId,fresh.at(-1).sequence);return {accepted:events.length};
   };
   const result=tail.then(run);tail=result.catch(e=>{try{onError({code:e.code??'avatar_write_failed'});}catch{}}).finally(()=>pending--);return result;
  },
  async close(){closed=true;await tail;},
 };
}
