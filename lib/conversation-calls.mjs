import {SUMMARY_PROMPT,parseSummary,summaryText,minutesCard} from './call-summary.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const scope=b=>createHash('sha256').update(JSON.stringify([b.id,b.sessionKey,b.accountId,b.callerId])).digest('hex');
export const callIdValid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/u.test(id);
export const callDuration=ms=>{const s=Math.max(0,Math.floor(ms/1000));return s<60?`${s} 秒`:`${Math.floor(s/60)} 分 ${s%60} 秒`;};
export const callElapsed=ms=>{const s=Math.max(0,Math.floor(ms/1000)),m=Math.floor(s/60),h=Math.floor(m/60);return h?`${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
export function callStatusCard(ended=false,durationMs=0){
 return {schema:'2.0',config:{width_mode:'compact',update_multi:true},body:{padding:'8px 12px 8px 12px',elements:[
  {tag:'markdown',text_size:'notation',content:`<font color='grey'>${ended?`V电话通话已结束 · ${callDuration(durationMs)}`:`V正在电话通话 · ${callElapsed(durationMs)}`}</font>`},
 ]}};
}
export const callSummaryCard=minutesCard;

export function summaryFailureCode(error) {
 const message=error?.message??'';
 if(['TimeoutError','AbortError'].includes(error?.name))return 'summary-timeout';
 if(/^summary-(?:http-\d{3}|invalid|context-limit|unavailable|timeout|network)$/u.test(message))return message;
 return 'summary-network';
}

// Single-purpose text request: no tools, conversation writes or external actions.
export function callSummarizerFromEnv(env=process.env,{fetchImpl=fetch,wait=sleep}={}){
 const key=env.VOICE_CALL_SUMMARY_API_KEY??env.XAI_API_KEY;
 const model=env.VOICE_CALL_SUMMARY_MODEL;
 const effort=env.VOICE_CALL_SUMMARY_REASONING_EFFORT??(/^grok-4\.7(?:-|$)/u.test(model??'')?'low':undefined);
 if(effort&&!['low','medium','high','xhigh'].includes(effort))throw Error('Invalid summary reasoning effort');
 if(!key||!model)return null;
 return async report=>{
  const text=report.turns.map(t=>`${t.role==='user'?'用户':'V'}${t.interrupted?'（被打断）':''}：${t.text}`).join('\n');
  // Never silently summarize only the beginning of a long call.
  if(text.length>100000)throw Error('summary-context-limit');
  // Brief minutes do not need the model's default high reasoning effort.
  // Retry transient/truncated responses once, outside the audio teardown path.
  let failure;
  for(let attempt=0;attempt<2;attempt++){
   try{
  const response=await fetchImpl(env.VOICE_CALL_SUMMARY_URL??'https://api.x.ai/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(45000),headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model,stream:false,...(effort?{reasoning_effort:effort}:{}),response_format:{type:'json_object'},max_tokens:attempt?1600:1200,messages:[
   {role:'system',content:SUMMARY_PROMPT},
   {role:'user',content:JSON.stringify({pendingTasks:report.pendingTasks,transcript:text})},
  ]})});
  if(!response.ok)throw Error(`summary-http-${response.status}`);
  const data=await response.json(),summary=data.choices?.[0]?.message?.content?.trim();
  if(!summary||summary.length>1600||data.choices?.[0]?.finish_reason==='length')throw Error('summary-invalid');
  return parseSummary(summary);
   }catch(error){
    const code=summaryFailureCode(error);
    failure=Object.assign(Error(code),{attempts:attempt+1});
    if(attempt||!/^summary-(?:timeout|network|invalid|http-(?:408|429|5\d\d))$/u.test(code))throw failure;
    await wait(1000);
   }
  }
  throw failure;
 };
}

export function createConversationCalls({gateway,directory,publicOrigin='',basePath='',summarize=null,audit=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const reports=new Map(),jobs=new Set(),writes=new Map();
 const track=work=>{jobs.add(work);work.finally(()=>jobs.delete(work)).catch(()=>{});return work;};
 const save=report=>{const copy=structuredClone(report);reports.set(copy.id,copy);if(!directory)return Promise.resolve();const work=(writes.get(copy.id)??Promise.resolve()).catch(()=>{}).then(async()=>{await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,copy.id+'.json'),tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(copy)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,path);});writes.set(copy.id,work);work.finally(()=>{if(writes.get(copy.id)===work)writes.delete(copy.id);}).catch(()=>{});return work;};
 const messageId=receipt=>receipt?.messageId??receipt?.messageIds?.[0]??receipt?.results?.find(r=>r.messageId)?.messageId;
 const send=async(target,id,message,callGateway=gateway)=>{
  const args={...target,message,idempotencyKey:`voice-call:${id}`};let receipt;
  try{receipt=await callGateway.request('send',args,{timeoutMs:20000});}catch(error){if(!/timeout|timed out|ECONN|socket|network|not connected/iu.test(error.message??''))throw error;receipt=await callGateway.request('send',args,{timeoutMs:20000});}
  if(!receipt||receipt.ok===false||['error','failed','partial_failed'].includes(receipt.status)||!receipt.messageId&&!receipt.messageIds?.length&&!receipt.results?.some(r=>r.messageId))throw Error('call-delivery-unconfirmed');
  audit({type:'call.report-delivered',reportId:id,receipt});return receipt;
 };
 const editStatus=async(target,id,ended,durationMs,callGateway=gateway)=>{
  // This is a host-owned lifecycle action on our own send receipt, using the
  // existing authenticated operator contract. No model/browser can supply IDs.
  const params={agentId:target.agentId,sessionKey:target.sessionKey,conversationReadOrigin:'direct-operator',name:'message',args:{action:'edit',channel:'feishu',accountId:target.accountId,target:target.to,messageId:id,card:callStatusCard(ended,durationMs)}};
  let receipt;
  try{receipt=await callGateway.request('tools.invoke',params,{timeoutMs:20000});}catch(e){if(!/TIMEOUT|TIMED OUT|ECONN|socket|network|CONNECTION_CLOSED/iu.test(e.code??e.message??''))throw e;receipt=await callGateway.request('tools.invoke',params,{timeoutMs:20000});}
  const result=receipt?.output?.details;
  if(receipt?.ok!==true||result?.ok!==true||result.messageId!==id)throw Error('call-status-update-unconfirmed');
  audit({type:'call.status-updated',messageId:id,ended});
 };
 return {
  begin(binding,target,ownerId,{statusCard=true}={}){
   if(binding.id==='tianyi'||!['group','dm'].includes(binding.kind)||!target)return null;
   const callGateway=binding.gateway??gateway;
   const report={id:randomUUID(),scope:scope(binding),entry:binding.id,name:binding.displayName,ownerId,startedAt:null,endedAt:null,durationMs:0,turns:[],summary:'正在整理通话…',summaryState:'pending',pendingTasks:false};
   let closed=false,serial=0,statusId=null,statusTarget=null,startWork=Promise.resolve(),statusWork=Promise.resolve(),statusTimer=null,statusFailures=0;const responses=new Map(),users=new Map(),tasks=new Set();
   const error=(stage,e)=>audit({type:'call.report-error',voiceSessionId:ownerId,reportId:report.id,stage,error:stage==='summary'?summaryFailureCode(e):/^call-status-(?:target|update)-unconfirmed$/u.test(e?.message??'')?e.message:'call-report-operation-failed'});
   const update=()=>{if(report.startedAt&&!closed)track(save(report).catch(e=>error('save',e)));};
   const tickStatus=()=>{
    if(closed||!statusId)return Promise.resolve();
    const started=now();
    // One update at a time. Derive elapsed time from media readiness rather
    // than counting timer callbacks, so slow transport cannot accumulate drift.
    statusWork=track(editStatus(statusTarget,statusId,false,now()-report.startedAt,callGateway)
     .then(()=>{statusFailures=0;})
     .catch(e=>{statusFailures++;error('status-tick',e);})
     .finally(()=>{if(!closed){const cadence=statusFailures?Math.min(15000,1000*2**Math.min(statusFailures,4)):1000;statusTimer=setTimer(tickStatus,Math.max(100,cadence-(now()-started)));statusTimer?.unref?.();}}));
    return statusWork;
   };
   return {
    id:report.id,
    ready(){
     if(closed||report.startedAt!==null)return;report.startedAt=now();
     // iPhone already presents live call state in the system surface. Keep
     // recording and the end summary, without sending a push-producing card.
     if(!statusCard){audit({type:'call.status-suppressed',voiceSessionId:ownerId,reportId:report.id,reason:'ios-device'});update();return;}
     // Outbound normalizes native card typography. Send literal text first,
     // then apply the full styled card through the provider's edit contract.
     const initial=callStatusCard();initial.body.elements[0].content='V正在电话通话 · 00:00';
     startWork=track((async()=>{const receipt=await send(target,report.id+':status',JSON.stringify(initial),callGateway);statusId=messageId(receipt);
      // Sending a DM uses an open user ID, but editing its card requires the
      // native chat ID from this exact server-owned message receipt.
      let chatId=receipt.chatId??receipt.results?.find(r=>r.messageId===statusId)?.chatId??(binding.kind==='group'?target.to:null);
      if(!chatId&&binding.kind==='dm'){
       // Some Gateway/Feishu versions omit chatId in send receipts. Resolve the
       // trusted canonical session, and bind its native chat to this same user
       // and bot before any edit. Never take this mapping from browser input.
       const {session}=await callGateway.request('sessions.describe',{key:target.sessionKey,includeDerivedTitles:false,includeLastMessage:false},{timeoutMs:20000});
       const origin=session?.origin;
       if(session?.key!==target.sessionKey||session.agentId!==target.agentId||origin?.provider!=='feishu'||origin.accountId!==target.accountId||origin.nativeDirectUserId!==target.to||origin.chatType!=='direct')throw Error('call-status-target-unconfirmed');
       chatId=origin.nativeChannelId;
      }
      if(!/^oc_[A-Za-z0-9_]+$/u.test(chatId??'')||(binding.kind==='group'&&chatId!==target.to))throw Error('call-status-target-unconfirmed');
      statusTarget={...target,to:chatId};if(!closed)await tickStatus();})().catch(e=>error('status-start',e)));update();
    },
    user(text,{final=true,turnId,admitted=true}={}){if(closed||!final||!admitted||!text?.trim())return;let row=turnId&&users.get(turnId);if(row)row.text=text.trim();else{row={id:turnId??`user-${++serial}`,role:'user',text:text.trim(),at:now()};report.turns.push(row);if(turnId)users.set(turnId,row);}update();},
    begin(id){if(id&&!responses.has(id))responses.set(id,{user:report.turns.findLast(t=>t.role==='user'),rows:[]});},
    transcript(text,{final=false,source,responseId}={}){
     if(closed||source||typeof text!=='string'||!text)return;const id=responseId??'anonymous';if(!responses.has(id))this.begin(id);const group=responses.get(id),last=group.rows.at(-1);
     if(!final){let row=last?.partial?last:null;if(!row){row={id:`assistant-${++serial}`,role:'assistant',text:'',at:now(),interrupted:true,partial:true};report.turns.push(row);group.rows.push(row);}row.text+=text;return;}
     if(last?.partial){last.text=text.trim();last.partial=false;update();return;}
     if(last?.text===text.trim())return;if(last&&text.trim().startsWith(last.text)){last.text=text.trim();update();return;}
     const row={id:`assistant-${++serial}`,role:'assistant',text:text.trim(),at:now(),interrupted:true};report.turns.push(row);group.rows.push(row);update();
    },
    finish({responseId,status='completed'}={}){for(const row of responses.get(responseId??'anonymous')?.rows??[])row.interrupted=status!=='completed'||row.partial===true;update();},
    interrupt(responseId){for(const [id,value] of responses)if(!responseId||id===responseId)for(const row of value.rows)row.interrupted=true;update();},
    ignore(responseId){const value=responses.get(responseId??'anonymous');if(value){const ignored=new Set([...value.rows,value.user]);report.turns=report.turns.filter(row=>!ignored.has(row));responses.delete(responseId??'anonymous');}update();},
    captureTask(id,{from}={}){if(from)tasks.delete(from);tasks.add(id);},
    result(id,text,{questionId=id}={}){tasks.delete(questionId);if(closed)return;if(text?.trim()){report.turns.push({id:`result-${++serial}`,role:'assistant',text:text.trim(),at:now(),source:'task-result'});update();}},
    close(){
     if(closed)return;closed=true;if(statusTimer!==null)clearTimer(statusTimer);if(report.startedAt===null)return;
     report.endedAt=now();report.durationMs=report.endedAt-report.startedAt;report.pendingTasks=tasks.size>0;
     // Freeze the call before queued Agent results arrive. They retain their own delivery.
     const frozen=structuredClone(report);
     track((async()=>{
      await save(frozen);await startWork;await statusWork;
      if(statusId&&statusTarget)await editStatus(statusTarget,statusId,true,frozen.durationMs,callGateway).catch(e=>error('status-ended',e));
      try{if(summarize&&frozen.turns.length){const result=await summarize(frozen);if(typeof result==='string'){frozen.summary=result;}else{frozen.summaryDocument=parseSummary(result);frozen.summary=summaryText(frozen.summaryDocument);}frozen.summaryState='generated';}else throw Error('summary-unavailable');}
      catch(e){frozen.summaryError=summaryFailureCode(e);frozen.summaryAttempts=e.attempts??0;frozen.summary=frozen.turns.length?'本次通话已结束，完整对话已保存。暂时未生成摘要，点开查看。':'本次通话未产生可保存的对话。';frozen.summaryState='unavailable';error('summary',e);}
      await save(frozen);await startWork;
      const url=new URL(publicOrigin+basePath+'/feishu');url.searchParams.set('phone',binding.id);url.searchParams.set('call',report.id);
      await send(target,report.id+':end',JSON.stringify(callSummaryCard(frozen,url.href)),callGateway);
     })().catch(e=>error('finish',e)));
    },
   };
  },
  async read(binding,id){
   if(!callIdValid(id))return null;
   let report=reports.get(id);
   if(!report&&directory){try{const path=join(directory,id+'.json'),stat=await lstat(path);if(!stat.isFile()||stat.size>20_000_000||stat.mode&0o077)return null;report=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
   if(!report||report.scope!==scope(binding))return null;
   const {scope:_,entry,ownerId,...safe}=report;return safe;
  },
  get pending(){return jobs.size;},
  async flush(){while(jobs.size)await Promise.allSettled([...jobs]);},
 };
}
