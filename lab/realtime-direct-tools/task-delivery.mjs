import {createGptLiveConsultProgressObserver} from '../gpt-live-consult-progress.mjs';
import {createHash} from 'node:crypto';
import {readBackendResult} from '../gpt-live-h5/result-presentation.mjs';

// The destination comes from the authenticated phone entry, never tool arguments.
export function voiceFeishuTarget(sessionKey) {
  const match=/^agent:([^:]+):feishu:(group|direct|dm):((?:oc_|ou_)[A-Za-z0-9]+)$/.exec(sessionKey??'');
  if(!match)return null;
  return {agentId:match[1],channel:'feishu',to:match[3]};
}
export function requestsTaskDelivery(text) {
  // Native captions may put spaces between Chinese words. Interpret the same
  // final USER instruction without changing the authenticated destination.
  if(typeof text==='string')text=text.replace(/\s+/gu,'');
  if(typeof text!=='string'||/[“"「『]|(?:不要|不用|别|不必).{0,20}(?:发|同步|汇报|通知)/u.test(text))return false;
  if(/(?:发|同步)(?:送)?(?:到|在|给)(?!这个群|当前群|群里|群里面|飞书(?:群)?(?:里|上|$))[^，。]{1,16}群/u.test(text))return false;
  return /(?:进展|结果|报告|内容|后续).{0,40}(?:发|同步).{0,12}(?:群|飞书)|(?:发|同步).{0,12}(?:群里|群里面|飞书群)|(?:在|到|就)(?:这个|当前|我们(?:的)?|咱们(?:的)?)?(?:飞书)?群(?:里面|里).{0,20}(?:发给我|发送|同步|汇报|通知)/u.test(text);
}

/** One delivery subscription per exact task. Hangup does not own its lifetime. */
export function createTaskDelivery({gateway,sessionKey,ownerId,readNativeResult,audit=()=>{},onIdle=()=>{}}) {
  let authorized=false,closed=false,activeRun,lastResult;
  const watched=new Set(),observers=new Map(),currentByDelegation=new Map();let disposed=false;
  const outcomes=new Map();let tail=Promise.resolve();
  const target=voiceFeishuTarget(sessionKey);
  const send=(runId,kind,text)=>{
    if(!authorized||!target||!runId||!text?.trim())return Promise.resolve({sent:false});
    const digest=createHash('sha256').update(text).digest('hex').slice(0,20);
    const key=`voice:${runId}:${kind}:${digest}`;
    if(outcomes.has(key))return outcomes.get(key);
    const work=tail.then(async()=>{
      const receipt=await gateway.request('send',{...target,message:text,idempotencyKey:key},{timeoutMs:20000});
      if(!receipt||receipt.ok===false||receipt.status==='error'||!receipt.messageId&&!receipt.messageIds?.length&&!receipt.results?.some(r=>r.messageId))throw Error('飞书没有确认发送回执');
      audit({type:'task.delivery-confirmed',voiceSessionId:ownerId,runId,kind,receipt});
      return {sent:true,receipt};
    });
    outcomes.set(key,work);tail=work.catch(error=>audit({type:'task.delivery-failed',voiceSessionId:ownerId,runId,kind,error:error.message}));
    return work;
  };
  return {
    observeUser(text){if(requestsTaskDelivery(text))authorized=true;return authorized;},
    async subscribe(){
      if(!authorized)throw Error('用户尚未要求把任务进展发到飞书群');
      if(!target)throw Error('当前电话没有经过验证的飞书交付入口');
      if(activeRun)await send(activeRun,'accepted','已接续这通电话的后台任务，后续进展和结果会发在这里。');
      else if(lastResult)await send(lastResult.runId,'final',lastResult.text);
      return {accepted:true,channel:'feishu',continuedAfterHangup:true};
    },
    started(runId){activeRun=runId;if(authorized)void send(runId,'accepted','已接续这通电话的后台任务，后续进展和结果会发在这里。').catch(()=>{});},
    progress(runId,text){if(authorized)void send(runId,'progress',text).catch(()=>{});},
    async completed(runId,text){lastResult={runId,text};await send(runId,'final',text);if(activeRun===runId)activeRun=undefined;},
    async failed(runId,error){await send(runId,'failure',`电话中的后台任务未完成：${error.message??error}。没有确认完成的操作，请勿当作已成功。`);if(activeRun===runId)activeRun=undefined;},
    async cancelled(runId){await send(runId,'cancelled','已按你的明确要求取消这通电话的后台任务。');if(activeRun===runId)activeRun=undefined;},
    close(){closed=true;if(!activeRun&&!watched.size)onIdle();if(authorized&&activeRun)void send(activeRun,'accepted','已接续这通电话的后台任务，后续进展和结果会发在这里。').catch(()=>{});},
    get detached(){return closed;},
    get pending(){return Boolean(activeRun||watched.size);},
    handleEvent(event){
      const native=event.event==='talk.event'&&event.payload?.voiceSessionId===ownerId?event.payload.talkEvent:null;
      const completed=native&&observers.get(native.callId);
      if(completed&&native.payload?.name==='openclaw_agent_consult'&&['tool.result','tool.error'].includes(native.type))
        completed.terminal.resolve(native.type==='tool.result'?{status:'ok'}:{status:'error',error:'原后台任务执行失败'});
      const row=observers.get(event.payload?.runId);if(!row||event.event!=='agent')return;
      if(event.payload.stream==='tool'&&event.payload.data?.phase==='result')row.hasToolResult=true;
      if(row.hasToolResult)row.observer.onAgentEvent(event.payload);
    },
    watch(runId,delegationId=runId){
      if(typeof runId!=='string'||!runId)return;
      if(watched.has(runId))return;currentByDelegation.set(delegationId,runId);watched.add(runId);activeRun=runId;
      const terminal=Promise.withResolvers();
      observers.set(runId,{terminal,hasToolResult:false,observer:createGptLiveConsultProgressObserver({runId,onProgress:p=>{if(authorized&&p.text?.length<=220)void send(runId,'progress',p.text).catch(()=>{});}})});
      if(authorized)void send(runId,'accepted','已接续这通电话的后台任务，后续进展和结果会发在这里。').catch(()=>{});
      void (async()=>{
        let misses=0;const deadline=Date.now()+600000;
        while(!disposed&&currentByDelegation.get(delegationId)===runId){
          if(Date.now()>deadline)throw Error("等待后台结果超过十分钟，请在飞书继续查询原任务，不要重复执行");
          if(readNativeResult){
            const result=await readNativeResult(runId);
            if(result.runId!==runId)throw Error('后台结果不属于原任务');
            if(result.status==='error')throw Error(result.error??'后台任务未完成');
            if(result.status==='ok'&&typeof result.text==='string'&&result.text.trim()){
              const text=readBackendResult(result.text).text;lastResult={runId,text};await send(runId,'final',text);if(activeRun===runId)activeRun=undefined;return;
            }
            await new Promise(r=>setTimeout(r,1000));continue;
          }
          // Native consults report completion to their original host, but need
          // not populate agent.wait's completion cache. Keep the exact run and
          // owner checks, then reconcile its canonical persisted final.
          let state;try{state=await Promise.race([gateway.request('agent.wait',{runId,timeoutMs:20000},{timeoutMs:25000}),terminal.promise]);}catch{
            if(++misses>=3)throw Error('暂时无法核对后台结果，请在飞书继续查询原任务，不要重复下单');
            await new Promise(r=>setTimeout(r,500));continue;
          }
          if(disposed||currentByDelegation.get(delegationId)!==runId)return;
          if(state.aborted||state.status==='error')throw Error(state.error??'后台任务结束但没有完成');
          if(state.yielded){await new Promise(r=>setTimeout(r,50));continue;}
          // Closing a native media owner may also stop its terminal event. A
          // wait timeout is not failure or proof of running: reconcile the
          // exact persisted run as a fallback, never another run's latest text.
          const history=await gateway.request('chat.history',{agentId:target?.agentId??'makaron',sessionKey,limit:60},{timeoutMs:10000});
          const final=[...(history.messages??[])].reverse().find(m=>m.role==='assistant'&&m.__openclaw?.runId===runId&&m.phase!=='analysis'&&m.phase!=='commentary'&&!m.isReasoning&&m.stopReason!=='toolUse');
          const text=typeof final?.content==='string'?final.content:(final?.content??[]).filter(b=>b.type==='text'&&!b.isReasoning&&b.phase!=='analysis').map(b=>b.text??'').join('\n');
          if(!text?.trim()){
            if(state.status==='ok')throw Error('后台已结束，但尚未核对到这个任务的结果');
            await new Promise(r=>setTimeout(r,250));continue;
          }
          const result=readBackendResult(text).text;lastResult={runId,text:result};await send(runId,'final',result);if(activeRun===runId)activeRun=undefined;return;
        }
      })().catch(error=>{if(currentByDelegation.get(delegationId)===runId)void send(runId,'failure',`电话中的后台任务未确认完成：${error.message}。`).catch(()=>{});}).finally(()=>{if(activeRun===runId)activeRun=undefined;watched.delete(runId);observers.get(runId)?.observer.close();observers.delete(runId);if(closed&&!watched.size)onIdle();});
    },
    dispose(){disposed=true;for(const r of observers.values())r.observer.close();observers.clear();},
    flush:()=>tail,
  };
}
