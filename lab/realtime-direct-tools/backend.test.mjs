import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {createBackendDelegation,visibleText} from './backend.mjs';
function fixture(){let status='running',text='真实最终结果',runId='initial',cancelError=false;const calls=[],audit=[],progress=[],delivered=[];
const gateway={request:async(method,args)=>{calls.push({method,args});if(method==='voice.product.task.start')return {taskId:'owned-task',runId:'initial'};if(method==='voice.product.task.read')return {taskId:'owned-task',status,text,runId,runs:['initial',runId],progress:[]};if(method==='voice.product.task.cancel'){if(cancelError)throw Error('cancel unconfirmed');status='cancelled';return {taskId:'owned-task',cancelled:true};}throw Error('Unexpected method '+method);}};
const backend=createBackendDelegation({gateway,sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call',pollMs:1,audit:x=>audit.push(x),onProgress:p=>progress.push(p),taskDelivery:{started(){},completed:async(run,text)=>delivered.push({run,text}),failed:async()=>{},cancelled:async()=>{}}});
return {backend,gateway,calls,audit,progress,delivered,start:(signal)=>backend.run({question:'完整查询目标',context:'上海；不要替我付款',callId:'tool',signal}),set:(v)=>{if(v.status)status=v.status;if(v.runId)runId=v.runId;if(v.text)text=v.text;if(v.cancelError!==undefined)cancelError=v.cancelError;}};}
test('one logical SDK task carries full goal and never uses chat latest-text reconciliation',async()=>{
const f=fixture(),p=f.start();await delay(5);assert(f.backend.snapshot());const start=f.calls[0];assert.equal(start.method,'voice.product.task.start');assert.equal(start.args.voiceSessionId,'call');assert.match(start.args.question,/完整查询目标/);assert.match(start.args.question,/不要替我付款/);assert.equal(start.args.model,undefined);
f.set({status:'ok',runId:'causal-resume',text:'子任务完成后的父任务结果'});assert.equal((await p).result,'子任务完成后的父任务结果');assert.deepEqual(f.delivered,[{run:'initial',text:'子任务完成后的父任务结果'}]);assert(!f.calls.some(x=>['agent.wait','chat.history','chat.send'].includes(x.method)));assert.equal(f.backend.snapshot(),null);
});
test('initial parent turn ending and unrelated session events cannot settle the SDK task',async()=>{
 const f=fixture(),p=f.start();await delay(5);f.backend.handleEvent({event:'chat',payload:{runId:'initial',state:'final',message:{text:'初始回合结束'}}});f.backend.handleEvent({event:'chat',payload:{runId:'foreign',state:'final',message:{text:'其他任务结果'}}});await delay(5);assert(f.backend.snapshot());assert.equal(f.delivered.length,0);f.set({status:'ok'});await p;
});
test('no duplicate task starts while one is waiting on its children',async()=>{
const f=fixture(),p=f.start();await delay(5);await assert.rejects(f.start(),/已有一个/);assert.equal(f.calls.filter(x=>x.method==='voice.product.task.start').length,1);f.set({status:'ok'});await p;
});
test('explicit cancel uses exact opaque task and does not publish a late final',async()=>{
const f=fixture(),p=f.start(),rejected=assert.rejects(p,/取消/);await delay(5);await f.backend.cancel();await rejected;assert.deepEqual(f.calls.find(x=>x.method==='voice.product.task.cancel').args,{taskId:'owned-task'});assert.equal(f.delivered.length,0);assert.equal(f.backend.snapshot(),null);
});
test('unconfirmed cancellation blocks another task until exact cancellation is confirmed',async()=>{
const f=fixture(),p=f.start(),rejected=assert.rejects(p,/取消/);await delay(5);f.set({cancelError:true});await assert.rejects(f.backend.cancel(),/unconfirmed/);await assert.rejects(f.start(),/已有一个/);f.set({cancelError:false});await f.backend.cancel();await rejected;assert.equal(f.backend.snapshot(),null);
});
test('lost start response uses exact owned lookup, never submits again',async()=>{
const f=fixture(),original=f.gateway.request;f.gateway.request=async(m,a)=>m==='voice.product.task.start'?Promise.reject(Error('lost response')):m==='voice.product.task.lookup'?{taskId:'owned-task',runs:['initial']}:original(m,a);f.set({status:'ok'});assert.equal((await f.start()).result,'真实最终结果');
});
test('foreign native task result is rejected rather than delivered',async()=>{
const f=fixture(),original=f.gateway.request;f.gateway.request=async(m,a)=>m==='voice.product.task.read'?{taskId:'foreign',status:'ok',text:'other'}:original(m,a);await assert.rejects(f.start(),/不属于/);assert.equal(f.delivered.length,0);
});
test('reasoning, commentary, partial tool output and tool-use messages are not public final',()=>{
for(const m of [{phase:'analysis',text:'private'},{phase:'commentary',text:'progress'},{openclawStreamFallback:{source:'segment'},text:'partial'},{stopReason:'toolUse',text:'tool plan'}])assert.equal(visibleText(m),'');
});
