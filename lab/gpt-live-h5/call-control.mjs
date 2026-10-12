import {randomUUID} from 'node:crypto';
import {createJevEvaluator} from '../voice-decision-router.mjs';
// A dedicated, fail-closed call action. It never selects business tools or
// touches Agent jobs. Only finalized provider transcripts enter this controller.
export function callControlEvaluatorFromEnv(env=process.env){
 if(env.VOICE_HOST_CALL_CONTROL!=='1')return null;
 const apiKey=env.VOICE_CALL_CONTROL_API_KEY??env.VOICE_JEV_API_KEY??env.OPENROUTER_API_KEY;
 if(!apiKey)return null;
 return createJevEvaluator({apiKey,model:env.VOICE_CALL_CONTROL_MODEL??'openai/gpt-6-luna-decisions',timeoutMs:1800});
}
export function createVoiceCallControl({evaluate,onAccepted=()=>{},audit=()=>{},isCurrent=()=>true}={}){
 let revision=0,closed=false,pending,accepted=false;const history=[];
 return {
  async observe({role,text,final}){
   if(closed||!isCurrent()||!final||!['user','assistant'].includes(role)||typeof text!=='string'||!text.trim())return;
   history.push({role,text:text.trim().slice(-800)});if(history.length>6)history.shift();
   if(role!=='user')return;
   const own=++revision;pending?.abort();pending=new AbortController();accepted=false;
   if(!evaluate)return;
   const controller=pending;
   try {
    const answer=await evaluate({purpose:'仅判断结束这次电话，不判断或取消任何后台工作。',request:text,history:history.slice(0,-1),callActive:true},
     {endIntent:{type:'noul',instructions:'完整最新用户话语是否明确要现在结束电话？自然道别是YES；否定挂断、引用别人道别、讨论功能、只取消任务、先完成事情再挂断、谢谢后继续提问都是NO。只判断当前完整意思，不按关键词。'}},controller.signal);
    if(closed||!isCurrent()||revision!==own||controller.signal.aborted)return;
    const end=answer?.answers?.endIntent;
    audit({type:'voice.call-control.decision',revision:own,selected:end?.type==='noul'&&Number.isFinite(end.noul)&&end.noul>=.97&&end.noul<=1});
    if(end?.type!=='noul'||!Number.isFinite(end.noul)||end.noul<.97||end.noul>1||accepted)return;
    accepted=true;onAccepted({type:'voice.end.accepted',source:'voice_host_control',requestId:randomUUID(),revision:own,userText:text.trim(),closeAfterPlayback:true});
   }catch{audit({type:'voice.call-control.unavailable',revision:own});}
  },
  close(){closed=true;++revision;pending?.abort();},
 };
}
