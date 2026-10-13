import {randomUUID} from 'node:crypto';
import {createJevEvaluator} from '../voice-decision-router.mjs';
export function callControlEvaluatorFromEnv(env=process.env){
 if(env.VOICE_HOST_CALL_CONTROL!=='1')return null;
 const apiKey=env.VOICE_CALL_CONTROL_API_KEY??env.VOICE_JEV_API_KEY??env.OPENROUTER_API_KEY;
 if(!apiKey)return null;
 return createJevEvaluator({apiKey,model:env.VOICE_CALL_CONTROL_MODEL??'openai/gpt-6-luna-decisions',timeoutMs:1800});
}
// Native USER terminals can be delayed by Agent work. A stable streamed
// utterance may propose ending; the browser must separately confirm matching
// native captions and live microphone silence before delivery is retired.
export function createVoiceCallControl({evaluate,onAccepted=()=>{},audit=()=>{},isCurrent=()=>true,stableMs=1200}={}){
 let revision=0,closed=false,pending,timer,current,candidate;const history=[],retiredTurns=new Set();
 const valid=own=>!closed&&isCurrent()&&revision===own;
 const remember=(role,text)=>{history.push({role,text:text.slice(-800)});if(history.length>6)history.shift();};
 const decide=async own=>{
  if(!evaluate||!valid(own)||candidate)return;
  const controller=pending=new AbortController(),text=current.text;
  try{
   const answer=await evaluate({purpose:'仅判断结束这次电话，不判断或取消任何后台工作。',request:text,history:[...history],callActive:true},
    {endIntent:{type:'noul',instructions:'最新用户话语是否明确要现在结束电话？输入可能是停顿后的流式转录，残缺句子和条件句必须NO。自然道别是YES；否定挂断、引用别人道别、讨论功能、只取消任务、先完成事情再挂断、谢谢后继续提问都是NO。只判断当前完整意思，不按关键词。'}},controller.signal);
   if(!valid(own)||controller.signal.aborted)return;
   const end=answer?.answers?.endIntent,selected=end?.type==='noul'&&Number.isFinite(end.noul)&&end.noul>=.97&&end.noul<=1;
   audit({type:'voice.call-control.decision',revision:own,selected,streamed:!current.final});
   if(!selected)return;
   candidate={type:'voice.end.proposed',source:'voice_host_control',requestId:randomUUID(),decisionRevision:own,userText:text,closeAfterPlayback:true};
   await onAccepted(candidate);
  }catch{if(valid(own))audit({type:'voice.call-control.unavailable',revision:own});}
  finally{if(pending===controller)pending=null;}
 };
 return{
  async observe({role,text,final,turnId}){
   if(closed||!isCurrent()||!['user','assistant'].includes(role)||typeof text!=='string'||!text.trim())return;
   if(role==='assistant'){if(final)remember(role,text.trim());return;}
   if(!final&&(typeof turnId!=='string'||!turnId))return;
   if(turnId&&retiredTurns.has(turnId))return;
   if(current?.turnId&&turnId!==current.turnId)retiredTurns.add(current.turnId);
   // Normalized transcript.delta contains a fragment; done contains the body.
   const next=final?text.trim():((current&&current.turnId===turnId&&!current.final?current.text:'')+text).trim();
   if(next===current?.text&&turnId===current?.turnId){if(final){current.final=true;clearTimeout(timer);if(!candidate&&!pending)return decide(revision);}return;}
   if(current?.final)remember('user',current.text);
   current={turnId,text:next.slice(-2400),final:Boolean(final)};
   const own=++revision;candidate=null;pending?.abort();pending=null;clearTimeout(timer);
   if(final)return decide(own);
   timer=setTimeout(()=>{timer=null;void decide(own);},stableMs);timer.unref?.();
  },
  matches(value){return Boolean(candidate&&valid(candidate.decisionRevision)&&value?.requestId===candidate.requestId&&value?.decisionRevision===candidate.decisionRevision&&value?.userText===candidate.userText);},
  close(){closed=true;++revision;clearTimeout(timer);pending?.abort();candidate=null;},
 };
}
