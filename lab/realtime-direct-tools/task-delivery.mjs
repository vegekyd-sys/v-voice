import {createGptLiveConsultProgressObserver} from '../gpt-live-consult-progress.mjs';
import {createHash} from 'node:crypto';
import {readBackendResult} from '../gpt-live-h5/result-presentation.mjs';

// The destination comes from the authenticated phone entry, never tool arguments.
export function voiceFeishuTarget(sessionKey) {
  const match=/^agent:([^:]+):feishu:(group|direct|dm):((?:oc_|ou_)[A-Za-z0-9]+)$/.exec(sessionKey??'');
  if(!match)return null;
  return {agentId:match[1],channel:'feishu',to:match[3]};
}
// Only interpret the caller's own delivery instruction. Quoted output payloads
// and reported instructions are data, not authorization. Destinations remain
// bound to the authenticated phone entry, never to words supplied by the caller.
function taskDeliveryIntent(text) {
  if(typeof text!=='string')return null;
  const unquoted=text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"(?:\\.|[^"\\])*"|‘[^’]*’|'[^']*'/gu,'');
  const clauses=unquoted.split(/[，,。.!！？?；;\n]/u).map(s=>s.replace(/\s+/gu,''));
  const group='(?:(?:这个|当前|我们(?:的)?|咱们(?:的)?)(?:飞书)?群|本群|飞书群|群)(?:里面|里|内|中)?';
  const destination=`(?:${group}|飞书(?:上|里)?)`;
  const targetEnd='(?=$|吧|吗|啊|呀|哦|哈|呢|就|再|并|同时|给|让|等|好|谢谢|可以|行不行)';
  const sendFirst=new RegExp(`^(?:一下|一份|一条|这份|这个|任务|的|进展|最终|结果|报告|内容|消息|信息|通知|后续|都|也|给我|给大家)*(?:到|在|至|往|向|给)?${destination}${targetEnd}`,'u');
  const targetFirst=new RegExp(`(?:在|到|就|往|向)${destination}(?:把|将|任务|的|进展|最终|结果|报告|内容|消息|信息|通知|后续|都|也|给我|给大家|再|直接|及时|持续|一下|完成后|不要|不用|别|不必|无需|不需要)*$`,'u');
  // Negation must govern THIS send verb. An unrelated action such as
  // "不要付款" must not veto the later "结果发群里", even without ASR punctuation.
  const denial=/(?:不要|不用|别|不必|无需|禁止|勿|不需要|不想|不能|不准)(?:再|继续|直接|自动|主动|帮我|替我|你|把|将|任何|这些|那些|这个|当前|我们|咱们|飞书|本群|群|里面|里|在|到|往|向|给我|给大家|任务|的|进展|最终|结果|报告|内容|消息|信息|通知|后续|都|也|全部|东西|一份|一条|一下|先)*$/u;
  let intent=null;
  for(const clause of clauses){
    // Questions about another person's words and hypothetical examples are not
    // requests to send. Removing a quoted payload still permits "把报告发群里".
    if(/[“"「『‘']|(?:他说|她说|别人说|有人说|例如|比如说|假如|假设|如果说|是什么意思|什么意思|已经|刚才|之前)/u.test(clause))continue;
    for(const match of clause.matchAll(/发送|同步|汇报|通知|发/gu)){
      const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
      if(!sendFirst.test(after)&&!targetFirst.test(before))continue;
      const prefix=before.replace(/(?:不要|别)忘(?:记)?(?:了)?/gu,'请');
      intent=!denial.test(prefix);
    }
  }
  return intent;
}
export function requestsTaskDelivery(text) {
  return taskDeliveryIntent(text)===true;
}

/** One delivery subscription per exact task. Hangup does not own its lifetime. */
export function createTaskDelivery({gateway,sessionKey,ownerId,readNativeResult,replyDelivery,audit=()=>{},onIdle=()=>{}}) {
  let authorized=false,closed=false,activeRun,lastResult;
  const watched=new Set(),observers=new Map(),currentByDelegation=new Map();let disposed=false;
  const outcomes=new Map();let tail=Promise.resolve();
  const target=voiceFeishuTarget(sessionKey);
  const send=(runId,kind,text)=>{
    if(replyDelivery&&runId&&['final','failure','cancelled'].includes(kind))return replyDelivery.result(`${runId}:${kind}`,text,{questionId:runId});
    if(!authorized||!target||!runId||!text?.trim())return Promise.resolve({sent:false});
    const digest=createHash('sha256').update(text).digest('hex').slice(0,20);
    const key=`voice:${runId}:${kind}:${digest}`;
    if(outcomes.has(key))return outcomes.get(key);
    const work=tail.then(async()=>{
      if(!authorized)return {sent:false};
      const receipt=await gateway.request('send',{...target,message:text,idempotencyKey:key},{timeoutMs:20000});
      if(!receipt||receipt.ok===false||receipt.status==='error'||!receipt.messageId&&!receipt.messageIds?.length&&!receipt.results?.some(r=>r.messageId))throw Error('飞书没有确认发送回执');
      audit({type:'task.delivery-confirmed',voiceSessionId:ownerId,runId,kind,receipt});
      return {sent:true,receipt};
    });
    outcomes.set(key,work);tail=work.catch(error=>audit({type:'task.delivery-failed',voiceSessionId:ownerId,runId,kind,error:error.message}));
    return work;
  };
  return {
    observeUser(text){const intent=taskDeliveryIntent(text);if(intent!==null)authorized=intent;return authorized;},
    async subscribe(){
      if(!authorized)throw Error('用户尚未要求把任务进展发到飞书群');
      if(!target)throw Error('当前电话没有经过验证的飞书交付入口');
      if(activeRun)await send(activeRun,'accepted','已接续这通电话的后台任务，后续进展和结果会发在这里。');
      else if(lastResult)await send(lastResult.runId,'final',lastResult.text);
      return {accepted:true,channel:'feishu',continuedAfterHangup:true};
    },
    requested(id,text){replyDelivery?.captureTask(id,{text});},
    started(runId,{requestId}={}){replyDelivery?.captureTask(runId,{from:requestId});activeRun=runId;if(authorized)void send(runId,'accepted','已接续这通电话的后台任务，后续进展和结果会发在这里。').catch(()=>{});},
    progress(runId,text){if(authorized)void send(runId,'progress',text).catch(()=>{});},
    async completed(runId,text){lastResult={runId,text};await send(runId,'final',text);if(activeRun===runId)activeRun=undefined;},
    async failed(runId,error){await send(runId,'failure',`电话中的后台任务未完成：${error.message??error}。没有确认完成的操作，请勿当作已成功。`);if(activeRun===runId)activeRun=undefined;},
    async cancelled(runId){await send(runId,'cancelled','已按你的明确要求取消这通电话的后台任务。');if(activeRun===runId)activeRun=undefined;},
    close(){closed=true;if(!activeRun&&!watched.size)onIdle();if(authorized&&activeRun)void send(activeRun,'accepted','已接续这通电话的后台任务，后续进展和结果会发在这里。').catch(()=>{});},
    get detached(){return closed;},
    get pending(){return Boolean(activeRun||watched.size||replyDelivery?.pending);},
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
      if(watched.has(runId))return;replyDelivery?.captureTask(delegationId);replyDelivery?.captureTask(runId,{from:delegationId});currentByDelegation.set(delegationId,runId);watched.add(runId);activeRun=runId;
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
