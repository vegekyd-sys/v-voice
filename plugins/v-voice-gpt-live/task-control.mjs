import {validateVoiceTaskControl} from '../../lib/voice-task-control.mjs';
/** Adapt a direct Voice chat.send owner to the SAME public SDK controller as Talk.
 * No task queue, classifier, runner or core module implementation is copied. */
export function createVoiceTaskControlHandler(controlRealtimeVoiceAgentRun) {
 return async({params,client,context,respond})=>{
  try {
   const {sessionKey,runId,voiceSessionId}=params??{}, {mode,text}=validateVoiceTaskControl(params);
   if(typeof voiceSessionId!=='string'||!/^voice-[0-9a-f-]+-[0-9a-f-]+$/i.test(runId??'')||!runId.startsWith(`voice-${voiceSessionId}-`))throw Error('Invalid Voice task control');
   const runs=context?.chatAbortControllers,entry=runs?.get(runId);
   const current=sessionId=>Boolean(entry&&client?.connId&&runs.get(runId)===entry&&entry.ownerConnId===client.connId&&
    entry.sessionKey===sessionKey&&entry.kind==='chat-send'&&!entry.registrationCleanupRequested&&
    entry.controller?.signal&&!entry.controller.signal.aborted&&(sessionId===undefined||entry.sessionId===sessionId));
   if(!current())throw Error('Voice task requires its exact authenticated run owner');
   const result=await controlRealtimeVoiceAgentRun({sessionKey,mode,text,runTarget:{runId,signal:entry.controller.signal,isCurrent:current}});
   if(['steer','followup'].includes(mode)&&result.queued&&!current()){
    respond(true,{ok:false,runId,mode,queued:false,applied:false,queueAcceptedBeforeOwnerChanged:true,reason:'owner_changed'});return;
   }
   respond(true,{...result,runId,...(result.queued?{applied:false}:{})});
  }catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice control was not accepted by its exact active task owner'});}
 };
}
