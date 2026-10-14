import test from 'node:test';import assert from 'node:assert/strict';
import {createTaskDelivery,requestsTaskDelivery,voiceFeishuTarget} from './task-delivery.mjs';
test('delivery requires a real user instruction and a server-bound Feishu target',async()=>{
 const calls=[],d=createTaskDelivery({gateway:{request:async(m,p)=>{calls.push(p);return {messageId:'om-real'};}},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call'});
 await assert.rejects(d.subscribe(),/尚未要求/);d.started('run');await d.completed('run','已有结果');assert.equal(calls.length,0);
 assert(requestsTaskDelivery('我现在挂电话了，之后把进展都发在群里面好吗？'));
 assert(!requestsTaskDelivery('把进展发到销售群'));
 assert(!requestsTaskDelivery('不要把进展发群'));assert(!requestsTaskDelivery('他说“把进展发群”是什么意思'));
 d.observeUser('把结果发群里');await d.subscribe();assert.equal(calls.length,1);assert.equal(calls[0].to,'oc_test');assert.equal(calls[0].message,'已有结果');
 assert.equal(voiceFeishuTarget('agent:makaron:webchat:oc_other'),null);
});
test('hangup preserves ordered, deduplicated progress and final delivery',async()=>{
 const calls=[],d=createTaskDelivery({gateway:{request:async(m,p)=>{calls.push(p);return {messageId:'om-'+calls.length};}},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call'});
 d.started('run');d.observeUser('后续进展发群');await d.subscribe();d.close();d.progress('run','已找到实际资料');d.progress('run','已找到实际资料');await d.completed('run','真实最终结果');await d.completed('run','真实最终结果');await d.flush();
 assert.deepEqual(calls.map(c=>c.message),['已接续这通电话的后台任务，后续进展和结果会发在这里。','已找到实际资料','真实最终结果']);assert.equal(new Set(calls.map(c=>c.idempotencyKey)).size,3);
});
test('rejected send produces failure evidence, never a success receipt',async()=>{
 const audit=[],d=createTaskDelivery({gateway:{request:async()=>({ok:false})},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call',audit:e=>audit.push(e)});
 d.started('run');d.observeUser('进展发群');await assert.rejects(d.subscribe(),/发送回执/);await d.flush();assert(audit.some(e=>e.type==='task.delivery-failed'));assert(!audit.some(e=>e.type==='task.delivery-confirmed'));
});
test('native final is reconciled only from its exact run after the call closes',async()=>{
 let finish;const waiting=new Promise(r=>finish=r),calls=[];
 const d=createTaskDelivery({gateway:{request:async(m,p)=>{if(m==='agent.wait')return waiting;if(m==='chat.history')return {messages:[{role:'assistant',__openclaw:{runId:'foreign'},content:[{type:'text',text:'错的任务'}]},{role:'assistant',__openclaw:{runId:'native'},content:[{type:'text',text:'已完成的真实结果'}]}]};calls.push(p);return {messageId:'om-'+calls.length};}},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call'});
 d.observeUser('结果发群');d.watch('native');d.close();finish({status:'ok'});
 for(let i=0;i<50&&!calls.some(c=>c.message==='已完成的真实结果');i++)await new Promise(r=>setTimeout(r,5));
 assert(calls.some(c=>c.message==='已完成的真实结果'));assert(!calls.some(c=>c.message==='错的任务'));d.dispose();
});

test('native resumed run supersedes old outcome without cancelling either run',async()=>{
 const a=Promise.withResolvers(),b=Promise.withResolvers(),calls=[];
 const d=createTaskDelivery({gateway:{request:async(m,p)=>{if(m==='agent.wait')return p.runId==='old'?a.promise:b.promise;if(m==='chat.history')return {messages:[{role:'assistant',__openclaw:{runId:'resumed'},content:[{type:'text',text:'接续任务完成'}]}]};calls.push(p);return {messageId:'om-'+calls.length};}},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call'});
 d.observeUser('结果发群');d.watch('old','logical');d.close();d.watch('resumed','logical');a.resolve({status:'error',error:'old run yielded'});b.resolve({status:'ok'});
 for(let i=0;i<50&&!calls.some(c=>c.message==='接续任务完成');i++)await new Promise(r=>setTimeout(r,5));
 await d.flush();assert(calls.some(c=>c.message==='接续任务完成'));assert(!calls.some(c=>c.message.includes('未确认完成')));d.dispose();
});
