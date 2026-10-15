import {randomUUID} from 'node:crypto';
import {VOICE_RESULT_DELIVERY_INSTRUCTIONS} from '../../lab/gpt-live-h5/result-presentation.mjs';
export function readVoiceTaskResult(reservations,params,connId){
 const row=typeof params?.clientSecret==='string'?reservations.get(params.clientSecret):null;
 if(!row||!connId||row.ownerConnId!==connId||typeof params?.runId!=='string')throw Error('Voice result requires its authenticated reservation owner');
 const task=row.taskResults.get(params.runId);
 if(!task)throw Error('Task is not owned by this Voice reservation');
 if(row.expiresAt<Date.now()&&task.status!=='running'){reservations.delete(params.clientSecret);throw Error('Voice result expired');}
 return {...task};
}
// Only delivery is retired on new caller speech. Real Agent work and its
// original permission/confirmation context are never cancelled or replaced.
export function createVoiceDeliveryOwner({onTranscript,onBackendResult}={}){
 let revision=0,closed=false,closing=false,userActive=false;const runs=new Map();
 return {
  transcript(role,text,final){
   if(role==='user'){
    if(!userActive){++revision;closing=false;userActive=true;}
    if(final)userActive=false;
   }
   return onTranscript?.(role,text,final);
  },
  begin(params){
   if(closed)throw Error('Voice delivery owner closed');
   const id=params.continuationIdentity?.delegationItemId;
   if(typeof id!=='string'||!id)throw Error('Voice delivery requires the real native delegation identity');
   const row={revision};runs.set(id,row);
   return {...params,...(typeof params.question==='string'?{question:params.question+'\n\n'+VOICE_RESULT_DELIVERY_INSTRUCTIONS}:{}),onProgress:progress=>{if(!closed&&!closing&&row.revision===revision)params.onProgress?.(progress);}};
  },
  result({delegationId,text}){
   const row=runs.get(delegationId);runs.delete(delegationId);
   if(!row)throw Error('Voice result is not owned by a registered native delegation');
   // Admitted work outlives the media owner. Never call the closed host's
   // document/speech callback; its assertOpen would turn a real result into failure.
   if(closed)return {spokenText:text.slice(0,300),channel:'commentary'};
   const spoken=onBackendResult?.({delegationId,text});
   if(closed||closing||row.revision!==revision)return {spokenText:typeof spoken==='string'?spoken:text.slice(0,300),channel:'commentary'};
   return spoken;
  },
  end(){if(closed)throw Error('Voice delivery owner closed');closing=true;return {ok:true,receipt:randomUUID()};},
  close(){closed=true;},
 };
}
