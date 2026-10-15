import {validateVoiceTaskControl} from '../../lib/voice-task-control.mjs';
import {randomUUID} from 'node:crypto';

// The authenticated telephone connection owns the task, independently of media.
// Public OpenClaw SDK admission owns execution, child lineage and continuation.
export function createVoiceTasks({consult,control,agentRuntime,getConfig,logger,subscribe}){
 const tasks=new Map(),requests=new Map();
 const requestKey=(p,conn)=>JSON.stringify([conn,p?.voiceSessionId,p?.callId]);
 const owned=(p,conn)=>{
  const row=tasks.get(p?.taskId);
  if(!row||!conn||row.ownerConnId!==conn)throw Error('Voice task requires its authenticated owner');
  return row;
 };
 const snapshot=r=>({taskId:r.taskId,runId:r.runId,runs:[...r.runs],status:r.status,text:r.text,error:r.error,progress:[...r.progress]});
 const clean=()=>{for(const [id,r] of tasks)if(r.expiresAt<Date.now()){tasks.delete(id);requests.delete(r.requestKey);}};
 return {
  async start(params,connId,onStarted){
   clean();
   if(!connId||typeof params?.voiceSessionId!=='string'||!params.voiceSessionId||typeof params.callId!=='string'||!params.callId||typeof params.question!=='string'||!params.question.trim()||params.question.length>32768)throw Error('Invalid Voice task');
   const match=/^agent:([^:]+):feishu:(?:group|direct|dm):(?:oc_|ou_)[A-Za-z0-9]+$/.exec(params.sessionKey??'');
   if(!match)throw Error('Voice task requires its bound Feishu session');
   const key=requestKey(params,connId),existing=requests.get(key);
   if(existing){
    if(existing.sessionKey!==params.sessionKey||existing.question!==params.question)throw Error('Voice task replay changed its input');
    onStarted?.(await existing.accepted.promise);await existing.done.promise;return snapshot(existing);
   }
   if(tasks.size>=512)throw Error('Voice task capacity reached');
   const cfg=getConfig(),taskId=randomUUID(),controller=new AbortController(),accepted=Promise.withResolvers(),done=Promise.withResolvers();
   void accepted.promise.catch(()=>{});
   const row={taskId,ownerConnId:connId,requestKey:key,sessionKey:params.sessionKey,question:params.question,controller,accepted,done,status:'starting',runs:[],progress:[],expiresAt:Infinity};
   tasks.set(taskId,row);requests.set(key,row);
   const toolResults=new Set(),unsubscribe=subscribe?.(event=>{if(event.stream==='tool'&&event.data?.phase==='result')toolResults.add(event.runId);});
   const started=value=>{
    if(typeof value?.runId!=='string')throw Error('Voice SDK returned no admitted run');
    if(!row.runs.includes(value.runId))row.runs.push(value.runId);
    row.runId=value.runId;row.status='running';
    const receipt={taskId,runId:row.runs[0]};accepted.resolve(receipt);onStarted?.(receipt);
   };
   try{
    const result=await consult({cfg,agentRuntime,logger,agentId:match[1],sessionKey:params.sessionKey,
     args:{question:params.question},transcript:[],surface:'a V Voice telephone',userLabel:'User',questionSourceLabel:'user',
     runIdPrefix:'voice-product-task',lane:'talk',thinkLevel:cfg.talk?.consultThinkingLevel??cfg.agents?.defaults?.thinkingDefault,
     abortSignal:controller.signal,onRunStarted:started,onResumeRunStarted:started,
     onProgress:p=>{if(toolResults.has(p.provenance?.runId)){row.progress.push(p);if(row.progress.length>100)row.progress.shift();}},
     continuationContext:{identity:{delegationItemId:taskId,delegationGeneration:1},ownerConnId:connId,
      voiceSessionId:params.voiceSessionId,ownerGeneration:taskId,isCurrent:()=>tasks.get(taskId)===row&&!controller.signal.aborted},
    });
    controller.signal.throwIfAborted();
    if(typeof result?.text!=='string'||!result.text.trim())throw Error('Voice SDK returned no complete task result');
    row.status='ok';row.text=result.text;
   }catch(error){row.status=controller.signal.aborted?'cancelled':'error';row.error=controller.signal.aborted?'任务已取消':'V 后台任务未完成';accepted.reject(error);logger?.warn?.(`Voice task failed: ${error?.name??'Error'}`);}
   finally{unsubscribe?.();row.expiresAt=Date.now()+600000;done.resolve();}
   return snapshot(row);
  },
  read(params,connId){return snapshot(owned(params,connId));},
  lookup(params,connId){const r=requests.get(requestKey(params,connId));return r?snapshot(owned({taskId:r.taskId},connId)):{found:false};},
  async control(params,connId){
   const r=owned(params,connId),input=validateVoiceTaskControl(params);
   const current=()=>tasks.get(r.taskId)===r&&r.status==='running'&&!r.controller.signal.aborted;
   if(!current())return {taskId:r.taskId,ok:false,active:false,queued:false,reason:'no_active_run'};
   if(input.mode==='cancel')return {taskId:r.taskId,ok:false,queued:false,reason:'use_explicit_cancel'};
   const result=await control({sessionKey:r.sessionKey,...input,runTarget:{runId:r.runId,signal:r.controller.signal,isCurrent:current}});
   if(result.queued&&!current())return {taskId:r.taskId,ok:false,queued:false,applied:false,queueAcceptedBeforeOwnerChanged:true,reason:'owner_changed'};
   return {...result,taskId:r.taskId,...(result.queued?{applied:false}:{})};
  },
  async cancel(params,connId){
   const r=owned(params,connId);
   if(r.status==='ok')return {taskId:r.taskId,cancelled:false,completed:true};
   r.controller.abort(Error('Voice task explicitly cancelled'));await r.done.promise;
   return {taskId:r.taskId,cancelled:r.status==='cancelled'};
  },
 };
}
