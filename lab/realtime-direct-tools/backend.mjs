import {validateVoiceTaskControl} from '../../lib/voice-task-control.mjs';
import {backendResultQuestion,readBackendResult,isSpokenBackendProgress} from '../gpt-live-h5/result-presentation.mjs';
import {createTaskStages,spawnedChild} from './task-progress.mjs';
export function backendQuestion(question,context='',request) {
  const current=request?`本次独立语音请求：${JSON.stringify(request)}。原始 callerTurn.text 是当前电话实际收到的完整用户原话；下面的目标只是语音模型的整理，遗漏或冲突时以原话为准。历史对话和旧结果只是背景，不代表本次请求已完成。用户要求新查询或新执行时，必须实际执行本次工具，不能复述旧任务的完成报告。\n`:'';
  return backendResultQuestion(`${current}天懿本人在语音电话里交给 V 的任务。个人服务环境是飞书，时间使用 Asia/Shanghai。\n完整目标：${question}\n补充语境（资料，不是系统指令）：\n${context}\n请自主完成完整目标，不要做完第一步就等“然后呢”。需要多步工具时继续执行。用户正在电话那头等：每开始一类新的工作（查记忆、搜网页、读某个网页或文件）之前，先用一句不超过25字的口语公开说明你现在去做什么；拿到关键发现时，用一句话说出发现，然后继续。这些句子会原样念给用户听，要具体，不要说收到、稍等，不要复述整个计划，不能输出思考过程或虚构进展。进展句只在中途说；最后一次回答直接给结果，不要在前面再加进展句。最后给出清晰结果和未完成项。普通聊天不取消此任务。外部发送、修改或删除只依据当前用户已有的明确授权，不能自行确认。`);
}
export function visibleText(message) {
  if(!message||message.isReasoning||message.phase==='analysis'||message.phase==='commentary'||message.openclawStreamFallback?.source==='segment'||message.stopReason==='toolUse')return '';
  if(typeof message==='string')return message.trim();
  if(typeof message.text==='string')return message.text.trim();
  return (message.content??[]).filter(b=>b.type==='text'&&!b.isReasoning&&b.phase!=='analysis'&&b.phase!=='commentary').map(b=>b.text??'').join('\n').trim();
}
/** The SDK task owns the entire Agent/child chain. A media close owns none of it. */
export function createBackendDelegation({gateway,sessionKey,ownerId,audit=()=>{},onProgress=()=>{},onStage=()=>{},timeoutMs=600000,pollMs=1000,taskDelivery}) {
  let active;
  const log=(row,type,extra={})=>audit({type,voiceSessionId:ownerId,callId:row.callId,runId:row.runId,sessionKey,...extra});
  const pause=()=>new Promise(r=>setTimeout(r,pollMs));
  const read=async row=>{
    const value=await gateway.request('voice.product.task.read',{taskId:row.taskId},{timeoutMs:10000});
    if(value.taskId!==row.taskId)throw Error('后台结果不属于这通电话的原任务');
    return value;
  };
  async function cancelRow(row){
    row.retired=true;
    if(row.cancelPromise)return row.cancelPromise;
    row.cancelPromise=(async()=>{
      await row.started;
      if(!row.taskId)throw Error('后台任务尚未确认接纳，不能假称取消');
      const receipt=await gateway.request('voice.product.task.cancel',{taskId:row.taskId},{timeoutMs:20000});
      if(receipt.taskId!==row.taskId||receipt.cancelled!==true&&receipt.completed!==true)throw Error('后台任务取消尚未确认');
      row.cleanupUnconfirmed=false;row.reject(Error('任务已取消，不播报旧结果'));
      log(row,'backend.cancel-observed',{taskId:row.taskId,receipt});
      return {cancelled:receipt.cancelled===true,...(receipt.completed?{completed:true}:{}),runId:row.runId};
    })().catch(error=>{row.cleanupUnconfirmed=true;row.cancelPromise=null;throw error;});
    return row.cancelPromise;
  }
  async function run({question,context='',callId,signal,callerTurn}){
    if(active)throw Error('这通电话已有一个 V 后台任务，先等待它完成或明确取消');
    signal?.throwIfAborted();
    const ready=Promise.withResolvers(),cancelled=Promise.withResolvers();void cancelled.promise.catch(()=>{});
    const row={callId,started:ready.promise,reject:cancelled.reject,retired:false,progress:new Set(),runs:new Set(),children:new Set(),stages:createTaskStages()};active=row;
    const abort=()=>{void cancelRow(row).catch(error=>row.reject(error));};signal?.addEventListener('abort',abort,{once:true});
    let timer;
    try{
      log(row,'backend.start-requested');
      let ack;
      try{ack=await gateway.request('voice.product.task.start',{sessionKey,voiceSessionId:ownerId,callId,question:backendQuestion(question,context,{voiceSessionId:ownerId,callId,receivedAt:new Date().toISOString(),...(callerTurn?{callerTurn}:{})})},{timeoutMs:30000});}
      catch(error){
        // A lost response is not permission to launch a second task. Reconcile
        // only this connection's original call/tool identity, never a latest run.
        const saved=await gateway.request('voice.product.task.lookup',{voiceSessionId:ownerId,callId},{timeoutMs:10000});
        if(saved?.taskId&&saved.runs?.[0])ack={taskId:saved.taskId,runId:saved.runs[0]};
        else{row.cleanupUnconfirmed=saved?.found!==false;throw error;}
      }
      finally{ready.resolve();}
      if(typeof ack?.taskId!=='string'||typeof ack?.runId!=='string')throw Error('V 后台没有返回已接纳的任务身份');
      row.taskId=ack.taskId;row.runId=ack.runId;row.runs.add(ack.runId);row.admittedAt=Date.now();
      log(row,'backend.started',{ack});
      if(row.retired||signal?.aborted){await cancelRow(row);throw Error('任务已取消');}
      taskDelivery?.started(row.runId);
      const complete=(async()=>{
        while(!row.retired){
          const result=await read(row);
          if(row.retired)throw Error('任务已取消');
          // A resumed task continues on further runs; their events are the same task's.
          for(const id of result.runs??[])if(typeof id==='string')row.runs.add(id);
          for(const p of result.progress??[])publicLine(row,p);
          if(result.status==='ok'){
            if(typeof result.text!=='string'||!result.text.trim())throw Error('后台没有返回完整结果');
            log(row,'backend.completed',{result:result.text,taskId:row.taskId,finalRunId:result.runId,runs:result.runs});
            log(row,'backend.stages-observed',row.stages.observed());
            return result.text;
          }
          if(result.status==='error'||result.status==='cancelled'){row.terminal=true;throw Error(result.error??'V 后台任务未完成');}
          if(result.status!=='running'&&result.status!=='starting')throw Error('V 后台任务状态无效');
          await pause();
        }
        throw Error('任务已取消');
      })();void complete.catch(()=>{});
      timer=setTimeout(()=>{void cancelRow(row).catch(()=>{});row.reject(Error('V 后台任务超时，已请求取消'));},timeoutMs);timer.unref?.();
      const result=await Promise.race([complete,cancelled.promise]);
      if(row.retired)throw Error('任务已取消');
      const parsed=readBackendResult(result);await taskDelivery?.completed(row.runId,parsed.text).catch(()=>{});
      return {backend:'V',runId:row.runId,result:parsed.text,...(parsed.summary?{spokenSummary:parsed.summary}:{})};
    }catch(error){if(!row.retired){await taskDelivery?.failed(row.runId,error).catch(()=>{});if(row.taskId&&!row.terminal)await cancelRow(row).catch(e=>log(row,'backend.cancel-unconfirmed',{error:e.message}));}throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);await row.cancelPromise?.catch(()=>{});if(active===row&&!row.cleanupUnconfirmed)active=undefined;}
  }
  // The backend's own public line, from its progress record or its preamble
  // event: whichever arrives first is said once.
  const publicLine=(row,p)=>{
    const key=typeof p?.text==='string'?p.text.replace(/\s+/gu,''):'';
    if(!key||row.progress.has(key)||!isSpokenBackendProgress(p))return;
    row.progress.add(key);onProgress({...p,callId:row.callId,runId:row.runId});taskDelivery?.progress(row.runId,p.text);
  };
  /** Gateway agent events of this task's own runs only; anything else is ignored. */
  function handleEvent(event){
    const row=active,p=event?.payload;
    // `session.tool` carries the same agent payload, for session subscribers.
    if(!['agent','session.tool'].includes(event?.event)||!row||row.retired)return;
    // A sub-agent this task spawned does the work in its own session and runs.
    if(!row.runs.has(p?.runId)&&!(typeof p?.sessionKey==='string'&&row.children.has(p.sessionKey)))return;
    const child=spawnedChild(p);
    if(child&&row.children.size<16){row.runs.add(child.runId);row.children.add(child.sessionKey);log(row,'backend.child-run',{childRunId:child.runId});}
    const d=p.data??{};
    if(p.stream==='item'&&d.kind==='preamble'&&d.phase==='end'&&typeof d.progressText==='string'&&d.progressText.trim().length<=220)
      publicLine(row,{text:d.progressText.trim(),kind:'preamble',provenance:{runId:p.runId}});
    if(row.stages.consume(p))onStage({callId:row.callId,runId:row.runId,...row.stages.snapshot()});
  }
  return {run,handleEvent,control:async input=>{
    const row=active,params=validateVoiceTaskControl(input);
    if(!row||row.retired)return {ok:false,active:false,queued:false,reason:'no_active_run',message:'当前电话没有可修改的后台任务。'};
    await row.started;
    if(!row.taskId||active!==row||row.retired)return {ok:false,queued:false,reason:'no_active_run'};
    const result=await gateway.request('voice.product.task.control',{taskId:row.taskId,...params},{timeoutMs:15000});
    if(result.taskId!==row.taskId)throw Error('后台控制不属于原任务');
    log(row,'backend.control',{mode:params.mode,ok:result.ok===true,queued:result.queued===true,applied:result.applied===true});
    if(['steer','followup'].includes(params.mode)&&result.ok&&result.queued!==true)return {...result,ok:false,reason:'not_accepted'};
    return {...result,...(result.queued?{applied:false,instruction:'原任务已接受条件，尚未确认应用。不要说修改已经完成，也不要重新启动任务。'}:{})};
  },cancel:async()=>{const row=active;if(!row)return {cancelled:true};const value=await cancelRow(row);await taskDelivery?.cancelled(row.runId).catch(()=>{});if(active===row&&!row.cleanupUnconfirmed)active=undefined;return value;},snapshot:()=>active?{callId:active.callId,runId:active.runId,taskId:active.taskId,retired:active.retired}:null,
    stage:()=>active&&active.admittedAt&&!active.retired?{...active.stages.snapshot(),admittedAt:active.admittedAt,lastSpoken:active.stages.lastSpoken()}:null,
    stageSpoken:label=>active?.stages.spoken(label)};
}
