import test from 'node:test';import assert from 'node:assert/strict';
import {createTaskDelivery,requestsTaskDelivery,voiceFeishuTarget} from './task-delivery.mjs';
test('native spaced captions authorize this group but preserve denial and other-group boundaries',()=>{
 assert(requestsTaskDelivery('这是 语 音 验 收 测试，请 交 给 后台 运行 一个 等待 二 十 秒 再 输出 验 收 成功 的 命 令，完成 后 把 结果 发到 这个 群，不要 做 其他 操作'));
 assert(requestsTaskDelivery('完成 后 把 结 果 发 到 飞 书 群 里'));
 assert(!requestsTaskDelivery('不要 把 结 果 发 到 这个 群'));
 assert(!requestsTaskDelivery('把 结 果 发 到 销 售 群'));
 assert(!requestsTaskDelivery('他说“把 结 果 发 到 这个 群”是什么意思'));
});
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
 d.observeUser('结 果 发 到 这个 群');d.watch('native');d.close();finish({status:'ok'});
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

test('owned native completion after hangup reconciles final when agent.wait has no terminal cache',async()=>{
 const calls=[];let historyReads=0;
 const d=createTaskDelivery({gateway:{request:async(m,p)=>{
  if(m==='agent.wait')return new Promise(()=>{});
  if(m==='chat.history'){historyReads++;return {messages:[{role:'assistant',__openclaw:{runId:'native'},content:[{type:'text',text:'已验证的原任务结果'}]}]};}
  calls.push(p);return {messageId:'om-'+calls.length};
 }},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'owned-call'});
 d.observeUser('结 果 发 到 这个 群');d.watch('native');d.close();
 const event=id=>({event:'talk.event',payload:{voiceSessionId:id,talkEvent:{type:'tool.result',callId:'native',payload:{name:'openclaw_agent_consult'}}}});
 d.handleEvent(event('foreign-call'));await new Promise(r=>setImmediate(r));assert.equal(historyReads,0);
 d.handleEvent(event('owned-call'));
 for(let i=0;i<50&&!calls.some(c=>c.message==='已验证的原任务结果');i++)await new Promise(r=>setTimeout(r,5));
 await d.flush();assert.equal(historyReads,1);assert.equal(calls.filter(c=>c.message==='已验证的原任务结果').length,1);assert.equal(d.pending,false);d.dispose();
});

test('hangup can retire native events; wait timeout reconciles only the exact persisted final',async()=>{
 const calls=[];let reads=0;
 const d=createTaskDelivery({gateway:{request:async(m,p)=>{
  if(m==='agent.wait')return {status:'timeout'};
  if(m==='chat.history')return {messages:++reads===1?[{role:'assistant',__openclaw:{runId:'foreign'},content:[{type:'text',text:'别的任务'}]}]:[{role:'assistant',__openclaw:{runId:'native'},stopReason:'stop',content:[{type:'text',text:'原任务实际最终结果'}]}]};
  calls.push(p);return {messageId:'om-'+calls.length};
 }},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call'});
 d.observeUser('结果发群');d.watch('native');d.close();
 for(let i=0;i<100&&!calls.some(c=>c.message==='原任务实际最终结果');i++)await new Promise(r=>setTimeout(r,5));
 await d.flush();assert.equal(reads,2);assert(calls.some(c=>c.message==='原任务实际最终结果'));assert(!calls.some(c=>c.message==='别的任务'));assert.equal(d.pending,false);d.dispose();
});
test('Voice native owner result avoids redacted history and does not accept another run',async()=>{
 const calls=[],d=createTaskDelivery({gateway:{request:async(m,p)=>{assert.equal(m,'send');calls.push(p);return {messageId:'om-'+calls.length};}},
  readNativeResult:async runId=>({runId,status:'ok',text:'原 runner 的真实结果'}),sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call'});
 d.observeUser('结 果 发 到 这个 群');d.watch('exact');d.close();
 for(let i=0;i<50&&!calls.some(c=>c.message==='原 runner 的真实结果');i++)await new Promise(r=>setTimeout(r,5));
 await d.flush();assert(calls.some(c=>c.message==='原 runner 的真实结果'));assert.equal(d.pending,false);d.dispose();
});

test('actual phone request recognizes destination-first delivery after hangup',async()=>{
 const request='电话要挂断了，所以你之后就都在群里面给我发吧，好吗？';
 assert(requestsTaskDelivery(request));
 for(const text of ['之后就在群里面给我发吧','完成后在这个群里给我发结果','电话挂了以后都在当前群里面给我发'])assert(requestsTaskDelivery(text),text);
 for(const text of ['不要在群里面给我发','别在群里给我发了','在销售群里给我发','在另一个群里面给我发','他说“在群里面给我发”是什么意思','可以发到别的群吗'])assert(!requestsTaskDelivery(text),text);
 const calls=[],d=createTaskDelivery({gateway:{request:async(method,params)=>{assert.equal(method,'send');calls.push(params);return {messageId:'om-'+calls.length};}},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'actual-call'});
 d.started('actual-run');assert(d.observeUser(request));await d.subscribe();d.close();await d.completed('actual-run','最新要求已标出勇士队，挂断后完成的报告');await d.flush();
 assert.equal(calls.length,2);assert.equal(calls[1].to,'oc_test');assert.match(calls[1].message,/勇士队/);assert.equal(d.pending,false);
});
