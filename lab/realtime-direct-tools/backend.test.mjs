import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createBackendDelegation,visibleText,backendQuestion,telephoneProgress} from './backend.mjs';

test('telephone progress requires an explicitly marked complete public line',()=>{
 assert.deepEqual(telephoneProgress('普通最终答案。'),[]);
 assert.deepEqual(telephoneProgress('【电话进展】10月21日有'),[]);
 assert.deepEqual(telephoneProgress('【电话进展】已拿到官方赛程，正在筛选勇士场次。'),['已拿到官方赛程，正在筛选勇士场次。']);
});

test('completion-provider progress reconciles only owned public tool-turn text before final',async()=>{
 let history=[];
 const f=fixture(async method=>method==='chat.history'?{messages:history}:new Promise(()=>{})),work=f.start();await delay(0);
 const {runId}=f.backend.snapshot();
 const marked='【电话进展】已经取得官方赛程，正在筛选首月比赛。';
 history=[
  {role:'assistant',__openclaw:{runId:'foreign'},stopReason:'toolUse',content:[{type:'text',text:'【电话进展】不能播的外来内容。'}]},
  {role:'assistant',__openclaw:{runId},stopReason:'toolUse',content:[{type:'thinking',thinking:'【电话进展】不能播的推理。'},{type:'text',text:marked}]},
  {role:'assistant',__openclaw:{runId},stopReason:'stop',content:[{type:'text',text:'【电话进展】不是中间进展。'}]},
 ];
 const tool=(phase,id)=>f.backend.handleEvent({event:'agent',payload:{runId,sessionKey:f.sessionKey,stream:'tool',data:{phase,name:'pdf',toolCallId:id}}});
 tool('result','download');tool('start','parse');await delay(5);
 assert.deepEqual(f.progress.map(p=>p.text),['已经取得官方赛程，正在筛选首月比赛。']);
 f.backend.handleEvent({event:'agent',payload:{runId,stream:'assistant',data:{text:marked}}});
 assert.equal(f.progress.length,1);
 f.backend.handleEvent({event:'agent',payload:{runId,stream:'reasoning',data:{text:'【电话进展】不能播的推理。'}}});
 f.event(runId,'final',{text:'报告已完成'});assert.equal((await work).result,'报告已完成');
 tool('start','late');await delay(5);assert.equal(f.progress.length,1);
});

test('the host keeps the complete caller goal ahead of an expanded frontend paraphrase',()=>{
 const original='请查一下我们的合作，说明两条业务线和各自状态。';
 const message=backendQuestion('只核对晨报是否恢复，再扫描所有文件','参考资料',['之前请介绍合作背景。',original]);
 assert(message.startsWith('天意本人'));assert(message.includes('完整目标：'+original));
 assert(message.indexOf('完整目标：'+original)<message.indexOf('只核对晨报'));
 assert.match(message,/不新增步骤、范围或授权/);assert.match(message,/仅用较早原话解释当前指代/);
});

function fixture(handler=()=>new Promise(()=>{})){
  const calls=[],progress=[],audit=[],sessionKey='agent:makaron:feishu:group:personal-test';
  const gateway={request:async(method,args)=>{calls.push({method,args});if(method==='chat.send')return {runId:args.idempotencyKey,status:'started'};return handler(method,args);}};
  const backend=createBackendDelegation({gateway,sessionKey,ownerId:'call-owner',onProgress:p=>progress.push(p),audit:e=>audit.push(e)});
  return {backend,gateway,calls,progress,audit,sessionKey,start:()=>backend.run({question:'先查记忆，再上网核对，比较后给出结论',context:'上海；不要替我预订',callId:'native-function-1',signal:new AbortController().signal}),
    event:(runId,state,message)=>backend.handleEvent({event:'chat',payload:{runId,sessionKey,state,message}})};
}
test('one complete goal uses configured V session; unrelated run cannot complete it',async()=>{
  const f=fixture(),promise=f.start();await delay(0);const row=f.backend.snapshot();
  const request=f.calls[0];assert.equal(request.method,'chat.send');assert.equal(request.args.sessionKey,f.sessionKey);assert.equal(request.args.deliver,false);assert.equal(request.args.model,undefined);
  assert.match(request.args.message,/上海；不要替我预订/);assert.match(request.args.message,/全部步骤|完整目标/);
  f.event('foreign-run','final',{content:[{type:'text',text:'外来答案'}]});assert.equal(f.backend.snapshot().runId,row.runId);
  f.event(row.runId,'final',{content:[{type:'text',text:'两步已完成，实际结论'}]});const result=await promise;
  assert.equal(result.backend,'V');assert.equal(result.result,'两步已完成，实际结论');assert.equal(f.backend.snapshot(),null);
});
test('progress admits public complete commentary only and deduplicates source mirrors',async()=>{
  const f=fixture(),promise=f.start();await delay(0);const {runId}=f.backend.snapshot();
  const agent=data=>f.backend.handleEvent({event:'agent',payload:{runId,sessionKey:f.sessionKey,stream:'item',data}});
  agent({kind:'preamble',phase:'end',progressText:'收到，我现在开始查。'});assert.equal(f.progress.length,0);
  f.backend.handleEvent({event:'agent',payload:{runId,stream:'tool',data:{phase:'result',name:'memory_search',toolCallId:'real-step'}}});
  agent({kind:'reasoning',phase:'end',progressText:'私有推理。'});
  agent({kind:'preamble',phase:'end',isReasoning:true,progressText:'隐私思考。'});
  agent({kind:'preamble',phase:'update',itemId:'item',progressText:'记忆已查到第一条记录。下一'});
  agent({kind:'preamble',phase:'end',itemId:'item',progressText:'记忆已查到第一条记录。下一步网页已核对。'});
  assert.deepEqual(f.progress.map(p=>p.text),['记忆已查到第一条记录。','下一步网页已核对。']);
  f.event(runId,'final',{text:'完成'});await promise;
});
test('yield/wait timeout cannot reconcile unrelated session history as final',async()=>{
  let release;const f=fixture(async(method)=>{if(method==='agent.wait')return await new Promise(resolve=>release=resolve);if(method==='chat.history')return {messages:[{role:'assistant',__openclaw:{runId:'foreign'},text:'不能播报'}]};});
  const promise=f.start();await delay(0);release({status:'timeout',yielded:true});await delay(0);
  assert.equal(f.calls.some(c=>c.method==='chat.history'),false);assert.ok(f.backend.snapshot());
  f.event(f.backend.snapshot().runId,'final',{text:'完整最终结果'});await promise;
});
test('a transient wait RPC timeout keeps the admitted run alive for its real final',async()=>{
  const f=fixture(async method=>{if(method==='agent.wait')throw Object.assign(Error('poll timed out'),{code:'TIMEOUT'});});
  const pending=f.start();await delay(0);const {runId}=f.backend.snapshot();
  assert(f.audit.some(e=>e.type==='backend.wait-retry'));
  assert.equal(f.calls.filter(c=>c.method==='chat.send').length,1);
  assert.equal(f.calls.some(c=>c.method==='chat.abort'),false);
  f.event(runId,'final',{text:'同一任务的真实结论'});
  assert.equal((await pending).result,'同一任务的真实结论');
  assert.equal(f.calls.some(c=>c.method==='chat.abort'),false);
});
test('status uses exact-owner stage receipts without waiting on another RPC',async()=>{
  const f=fixture(),pending=f.start();await delay(0);const {runId}=f.backend.snapshot();
  const event=(scope,key)=>f.backend.handleEvent({event:'agent',payload:{runId:scope,sessionKey:key,stream:'tool',data:{phase:'start',name:'memory_search',toolCallId:'memory',args:{query:'PRIVATE QUERY'}}}});
  event('foreign',f.sessionKey);event(runId,'foreign-session');
  let result=await f.backend.control({mode:'status',text:'查得怎么样了'});
  assert.equal(result.lastConfirmedStage,'任务已接收，等待后台执行');
  event(runId,f.sessionKey);
  result=await f.backend.control({mode:'status',text:'查的过程中汇报进度'});
  assert.equal(result.lastConfirmedStage,'正在查记忆');assert.equal(result.admissionConfirmed,true);
  assert.equal(result.source,'owned-live-events');assert.doesNotMatch(JSON.stringify(result),/PRIVATE QUERY/);
  assert.equal(f.calls.some(c=>c.method==='voice.product.task-control'),false);
  f.gateway.ready=false;
  result=await f.backend.control({mode:'status',text:'现在呢'});
  assert.equal(result.connectionUncertain,true);assert.match(result.message,/执行状态未确认/);
  f.event(runId,'final',{text:'查询完成'});await pending;
  assert.equal((await f.backend.control({mode:'status',text:'现在呢'})).active,false);
});
test('a completed receipt remains queryable while speech is pending and retires on a new goal or cancellation',async()=>{
  const f=fixture(),pending=f.start();await delay(0);const {runId}=f.backend.snapshot();
  f.event(runId,'final',{text:'后台已核实的真实结论'});await pending;
  const done=await f.backend.control({mode:'status',text:'怎么样了'});
  assert.equal(done.ok,true);assert.equal(done.completed,true);assert.equal(done.active,false);assert.equal(done.runId,runId);
  assert.match(done.message,/结果已经返回/);assert.equal(done.source,'owned-terminal-receipt');
  const next=f.start();await delay(0);
  const current=await f.backend.control({mode:'status',text:'现在呢'});
  assert.notEqual(current.runId,runId);assert.equal(current.completed,undefined);
  f.event(f.backend.snapshot().runId,'final',{text:'新的真实结果'});await next;
  await f.backend.cancel();assert.equal((await f.backend.control({mode:'status',text:'现在呢'})).ok,false);
});
test('cancellation uses exact owned run and requires observed terminal, ignoring late facts',async()=>{
  let cancelled=false;const f=fixture(method=>method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
  const pending=f.start();const rejection=assert.rejects(pending,/取消|未完成/);await delay(0);
  const {runId}=f.backend.snapshot();await f.backend.cancel();
  f.event(runId,'final',{text:'取消后旧结果'});await rejection;
  assert.deepEqual(f.calls.find(c=>c.method==='chat.abort').args,{agentId:'makaron',sessionKey:f.sessionKey,runId});
  assert.equal(f.progress.length,0);assert.equal(f.audit.some(e=>e.type==='backend.completed'),false);
});
test('simultaneous delegation does not launch duplicate runs; one call can continue after final',async()=>{
  const f=fixture(),first=f.start();await delay(0);await assert.rejects(f.start(),/已有一个/);
  assert.equal(f.calls.filter(c=>c.method==='chat.send').length,1);
  f.event(f.backend.snapshot().runId,'final',{text:'第一个完成'});await first;
  const second=f.start();await delay(0);f.event(f.backend.snapshot().runId,'final',{text:'第二个完成'});await second;
  assert.equal(f.calls.filter(c=>c.method==='chat.send').length,2);
});
test('terminal native poll without sessionId releases only its exact owned process',async()=>{
  const f=fixture(),first=f.start();await delay(0);const {runId}=f.backend.snapshot();
  const tool=(data,scope=runId)=>f.backend.handleEvent({event:'agent',payload:{runId:scope,sessionKey:f.sessionKey,stream:'tool',data}});
  tool({name:'exec',phase:'result',toolCallId:'exec',result:{details:{status:'running',sessionId:'owned'}}});
  tool({name:'process',phase:'start',toolCallId:'poll',args:{action:'poll',sessionId:'owned'}});
  tool({name:'process',phase:'result',toolCallId:'poll',result:{details:{status:'completed'}}},'foreign');
  tool({name:'process',phase:'start',toolCallId:'other-poll',args:{action:'poll',sessionId:'foreign-process'}});
  tool({name:'process',phase:'result',toolCallId:'other-poll',result:{details:{status:'completed'}}});
  f.event(runId,'final',{text:'消息已发送'});await first;
  assert.ok(f.backend.snapshot());await assert.rejects(f.start(),/已有一个/);
  const awaitingExit=await f.backend.control({mode:'status',text:'后台结束了吗'});
  assert.equal(awaitingExit.resultReturned,true);assert.equal(awaitingExit.completed,false);assert.equal(awaitingExit.active,true);
  tool({name:'process',phase:'result',toolCallId:'poll',result:{details:{status:'completed',name:'python3'}}});
  assert.equal(f.backend.snapshot(),null);
  const second=f.start();await delay(0);f.event(f.backend.snapshot().runId,'final',{text:'日程已修改'});await second;
  assert.equal(f.calls.filter(c=>c.method==='chat.send').length,2);
});
test('terminal wait reconciles only durable exact-run public text',async()=>{
  const f=fixture(async(method,args)=>{if(method==='agent.wait')return {status:'ok'};if(method==='chat.history')return {messages:[{role:'assistant',__openclaw:{runId:f.backend.snapshot().runId},text:'后台真实答案'},{role:'assistant',__openclaw:{runId:'other'},text:'另一个会话'}]};});
  assert.equal((await f.start()).result,'后台真实答案');
  assert.equal(visibleText({phase:'analysis',text:'不能公开'}),'');assert.equal(visibleText({phase:'commentary',text:'不是最终值'}),'');
  assert.equal(visibleText({openclawStreamFallback:{source:'segment'},text:'图片已提交，现在开始做视频。'}),'');
  assert.equal(visibleText({stopReason:'toolUse',content:[{type:'text',text:'现在运行Makaron。'},{type:'toolCall',name:'exec'}]}),'');
});
test('unconfirmed cancellation blocks another goal until exact-run termination is observed',async()=>{
  let cancelled=false,confirmed=false;const f=fixture(method=>method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:confirmed?'error':'timeout',aborted:confirmed}:new Promise(()=>{}));
  const pending=f.start(),rejected=assert.rejects(pending,/取消/);await delay(0);
  await assert.rejects(f.backend.cancel(),/尚未确认/);
  // The retired waiter is rejected by cancellation failure, with no false
  // completed claim. An operator can retry exact-run reconciliation safely.
  f.event(f.backend.snapshot().runId,'final',{text:'迟到值不能清除孤儿责任'});
  await assert.rejects(f.start(),/已有一个/);
  confirmed=true;await f.backend.cancel();await rejected;assert.equal(f.backend.snapshot(),null);
});

test('executing native final list survives aborted outer callbacks and proves only its exact registry',async()=>{
 let cancelled=false;const f=fixture(method=>method==='vlab.workers.voice.cancelProcesses'?Promise.reject(Error('outer callback stopped')):method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
 const pending=f.start(),rejected=assert.rejects(pending,/取消/);await delay(0);const {runId}=f.backend.snapshot();
 const native=(scope,entries)=>f.backend.handleEvent({event:'agent',payload:{runId,sessionKey:f.sessionKey,stream:'tool',data:{name:'process',phase:'result',result:{__voiceHost:{source:'voice-native-lifecycle',registryScope:scope,registryFinal:true},details:{sessions:entries}}}}});
 f.backend.handleEvent({event:'agent',payload:{runId,stream:'tool',data:{name:'exec',phase:'result',result:{details:{status:'running',sessionId:'owned'}}}}});
 const cancel=f.backend.cancel();await delay(5);
 native('foreign',[{sessionId:'owned',status:'completed',exitCode:0}]);assert.equal(f.audit.some(e=>e.type==='backend.native-cleanup-confirmed'),false);
 native(runId,[{sessionId:'owned',status:'running'}]);assert.equal(f.audit.some(e=>e.type==='backend.native-cleanup-confirmed'),false);
 native(runId,[{sessionId:'owned',status:'failed',exitSignal:'SIGTERM'}]);await cancel;await rejected;
 assert(f.audit.some(e=>e.type==='backend.native-cleanup-confirmed'));assert(f.audit.some(e=>e.type==='backend.process-cancel-observed'&&e.sessionId==='owned'));
});

test('one normal V run returns both actual summary and full Markdown; raw canonical output remains audited',async()=>{
 const f=fixture(),pending=f.start();await delay(0);const {runId}=f.backend.snapshot();
 const summary='推荐先核对身份和招生政策，暂不定案。',text='## 完整方案\n'+'具体事实、时间和限制。'.repeat(80),raw=`【语音摘要】\n${summary}\n【完整方案】\n${text}`;
 assert(f.calls[0].args.message.includes('【语音摘要】'));f.event(runId,'final',{text:raw});const result=await pending;
 assert.equal(result.result,text);assert.equal(result.spokenSummary,summary);assert.equal(f.audit.find(x=>x.type==='backend.completed').result,raw);assert.equal(f.calls.filter(x=>x.method==='chat.send').length,1);
});
