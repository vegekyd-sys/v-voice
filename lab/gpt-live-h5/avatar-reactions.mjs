// Cosmetic transport deadline; never awaited by speech or tool execution.
export const AVATAR_REQUEST_TIMEOUT_MS = 3500;
export const ASSISTANT_BEAT_INTERVAL_MS = 6000;
const sentence = text => {const chunks=text.match(/[^。！？.!?\n]+[。！？.!?\n]+/g);return chunks?.join('').trim()??'';};
export function createAvatarReactions({request,apply,attend=()=>{},current=()=>({}),isCurrent=()=>true,isVisible=()=>true,now=Date.now,observe=()=>{}}) {
 let closed=false,busy=false,timer=null,latest=null,epoch='',revision=0,controller;
 let lastUser='',lastTask='',lastAssistantKey='',lastAssistantText='',lastAssistantAt=-Infinity;
 const schedule=(wait=400)=>{
  if(closed||busy||!latest||!isVisible())return;
  clearTimeout(timer);timer=setTimeout(run,wait);
 };
 function candidate(){
  if(!latest)return null;
  const {user,assistant,task,context}=latest;
  const userSignature=JSON.stringify(user?{key:user.key,text:user.text}:null);
  // ASR must settle. Streaming text never forces an incomplete meaning through.
  if(user&&userSignature!==lastUser)return {kind:'user_meaning',signature:userSignature,text:user.text,context};
  if(task!==lastTask)return {kind:'task_change',signature:task,text:'',context};
  if(!assistant)return null;
  const text=assistant.complete?assistant.text:sentence(assistant.text);
  if(!text||text===lastAssistantText&&assistant.key===lastAssistantKey)return null;
  const first=assistant.key!==lastAssistantKey;
  if(!first&&now()-lastAssistantAt<ASSISTANT_BEAT_INTERVAL_MS)return null;
  // Only complete phrases enter a visual beat; no token-by-token reactions.
  return {kind:first?'assistant_start':assistant.complete?'assistant_end':'assistant_progress',signature:assistant.key,text,context};
 }
 async function run(){
  timer=null;if(closed||!isCurrent()||!isVisible()||busy)return;
  const beat=candidate();if(!beat)return;
  const ownEpoch=epoch,ownUser=JSON.stringify(latest.user?{key:latest.user.key,text:latest.user.text}:null);
  // Don't call the model just to replay the same sentence on a later update.
  if(beat.kind==='user_meaning'){lastUser=beat.signature;
   if(latest.assistant?.complete){lastAssistantKey=latest.assistant.key;lastAssistantText=latest.assistant.text;lastAssistantAt=now();}
  }
  if(beat.kind==='task_change')lastTask=beat.signature;
  if(beat.kind.startsWith('assistant')){lastAssistantKey=beat.signature;lastAssistantText=beat.text;lastAssistantAt=now();}
  const payload={...beat.context,...current(),beat:{kind:beat.kind,text:beat.text.slice(-600)}};
  // The newest assistant may still be streaming; truncate to a stable phrase.
  if(beat.kind.startsWith('assistant'))payload.turns=payload.turns.map((r,i)=>i===payload.turns.length-1&&r.role==='assistant'?{...r,text:beat.text.slice(-600)}:r);
  busy=true;const ownController=controller=new AbortController(),started=now(),ownRevision=++revision;
  const record=(type,extra={})=>observe({type,revision:ownRevision,at:now(),userTurn:ownEpoch,beat:beat.kind,durationMs:now()-started,...extra});
  const timeout=setTimeout(()=>ownController.abort('timeout'),AVATAR_REQUEST_TIMEOUT_MS);
  try{
   record('requested');const result=await request({...payload,revision:ownRevision},{signal:ownController.signal});
   const valid=!closed&&!ownController.signal.aborted&&isCurrent()&&epoch===ownEpoch&&ownUser===JSON.stringify(latest?.user?{key:latest.user.key,text:latest.user.text}:null);
   if(valid&&result?.picture){apply({...result,beat:beat.kind});record('applied',{picture:result.picture,continuations:result.continuations??[],reason:result.reason??'selected'});}
   else record(valid?'unavailable':'superseded',{reason:valid?(result?.reason??'no_picture'):closed?'call_closed':ownController.signal.aborted?ownController.signal.reason:!isCurrent()?'owner_changed':'caption_revised'});
  }catch{record(ownController.signal.aborted?'aborted':'failed',{reason:ownController.signal.aborted?ownController.signal.reason:'request_failed'});}finally{
   clearTimeout(timeout);busy=false;
   if(!closed&&candidate())schedule();
  }
 }
 return {
  update({snapshot,activity='idle',taskOutcome='none'}){
   if(closed)return;
   const rows=[...(snapshot?.history??[]).map(r=>({...r,complete:r.complete??true})),...(snapshot?.current??[])].filter(r=>['user','assistant'].includes(r.role)&&r.speaker!=='V · 完整方案'&&typeof r.text==='string'&&r.text.trim());
   rows.sort((a,b)=>{const na=/^turn-(\d+)$/.exec(a.key),nb=/^turn-(\d+)$/.exec(b.key);return na&&nb?Number(na[1])-Number(nb[1]):Number.isFinite(a.at)&&Number.isFinite(b.at)?a.at-b.at:0;});
   const user=rows.filter(r=>r.role==='user').at(-1),nextEpoch=user?.key??'';
   const previousUser=latest?.user;
   if(nextEpoch!==epoch){controller?.abort('new_user_turn');lastAssistantKey='';lastAssistantText='';lastAssistantAt=-Infinity;if(user)attend();}
   else if(user&&previousUser?.text!==user.text)controller?.abort('caption_revised');
   epoch=nextEpoch;
   const assistant=rows.at(-1)?.role==='assistant'?rows.at(-1):null;
   const context={turns:rows.slice(-6).map(r=>({role:r.role,text:r.text.slice(-600)})),activity,taskOutcome,speaker:rows.at(-1)?.role??null};
   const task=JSON.stringify({activity,taskOutcome});if(lastTask==='')lastTask=task;
   const unchanged=JSON.stringify(context)===JSON.stringify(latest?.context)&&assistant?.complete===latest?.assistant?.complete;
   latest={user,assistant,task,context};if(unchanged)return;
   if(candidate())schedule();
   else if(assistant?.complete&&assistant.key===lastAssistantKey&&assistant.text!==lastAssistantText){
    schedule(Math.max(400,ASSISTANT_BEAT_INTERVAL_MS-(now()-lastAssistantAt)));
   }
  },
  resume(){if(candidate())schedule();},
  dispose(){closed=true;clearTimeout(timer);controller?.abort('call_closed');latest=null;},
 };
}
