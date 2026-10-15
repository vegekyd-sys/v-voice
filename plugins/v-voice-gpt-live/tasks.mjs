import {randomUUID} from 'node:crypto';

// Owned by the authenticated telephone service connection, independently of
// its media. The SDK owns Agent admission, child lineage and continuation.
export function createVoiceTasks({consult,agentRuntime,getConfig,logger}){
 const tasks=new Map();
 const owned=(params,connId)=>{
  const row=tasks.get(params?.taskId);
  if(!row||!connId||row.ownerConnId!==connId)throw Error('Voice task requires its authenticated owner');
  return row;
 };
 return {
  async start(params,connId,onStarted){
   if(!connId||typeof params?.voiceSessionId!=='string'||!params.voiceSessionId||typeof params.question!=='string'||!params.question.trim()||params.question.length>32768)throw Error('Invalid Voice task');
   const match=/^agent:([^:]+):feishu:(?:group|direct|dm):(?:oc_|ou_)[A-Za-z0-9]+$/.exec(params.sessionKey??'');
   if(!match)throw Error('Voice task requires its bound Feishu session');
   const cfg=getConfig(),taskId=randomUUID(),controller=new AbortController();
   const row={taskId,ownerConnId:connId,controller,status:'starting',runs:[],progress:[],expiresAt:Infinity};tasks.set(taskId,row);
   const started=value=>{
    if(typeof value?.runId!=='string')throw Error('Voice SDK returned no admitted run');
    if(!row.runs.includes(value.runId))row.runs.push(value.runId);
    row.runId=value.runId;row.status='running';onStarted?.({taskId,runId:row.runs[0]});
   };
   try{
    const result=await consult({cfg,agentRuntime,logger,agentId:match[1],sessionKey:params.sessionKey,
     args:{question:params.question},transcript:[],surface:'a V Voice telephone',userLabel:'User',questionSourceLabel:'user',
     runIdPrefix:'voice-product-task',lane:'talk',thinkLevel:cfg.talk?.consultThinkingLevel??cfg.agents?.defaults?.thinkingDefault,
     abortSignal:controller.signal,onRunStarted:started,onResumeRunStarted:started,
     onProgress:p=>{row.progress.push(p);if(row.progress.length>100)row.progress.shift();},
     continuationContext:{identity:{delegationItemId:taskId,delegationGeneration:1},ownerConnId:connId,
      voiceSessionId:params.voiceSessionId,ownerGeneration:taskId,isCurrent:()=>tasks.get(taskId)===row&&!controller.signal.aborted},
    });
    if(typeof result?.text!=='string'||!result.text.trim())throw Error('Voice SDK returned no complete task result');
    row.status='ok';row.text=result.text;
   }catch(error){row.status='error';row.error=error?.message??'后台任务未完成';logger?.warn?.(`Voice task failed: ${error?.name??'Error'}`);}
   finally{row.expiresAt=Date.now()+600000;}
   return {taskId,status:row.status};
  },
  read(params,connId){const r=owned(params,connId);return {taskId:r.taskId,runId:r.runId,runs:[...r.runs],status:r.status,text:r.text,error:r.error,progress:[...r.progress]};},
  cancel(params,connId){const r=owned(params,connId);r.controller.abort(Error('Voice task explicitly cancelled'));return {requested:true};},
 };
}
