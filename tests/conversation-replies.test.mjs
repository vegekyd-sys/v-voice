import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationReplyTarget,createConversationReplyDelivery} from '../lib/conversation-replies.mjs';
const binding={replySync:true,sessionKey:'agent:makaron:feishu:group:oc_room',kind:'group',agentId:'makaron',accountId:'cli_lab'};
const config={appId:'cli_lab',enabled:true};
const target=conversationReplyTarget(binding,config);
function fixture(request=async()=>({messageId:'om_sent'})){
 const calls=[],audit=[],statuses=[];
 const d=createConversationReplyDelivery({target,gateway:{request:async(method,args)=>{calls.push({method,args});return request(args,calls.length);}},ownerId:'call-a',audit:e=>audit.push(e),onStatus:e=>statuses.push(e)});
 return {d,calls,audit,statuses};
}
test('only explicitly enabled private entries resolve their exact configured bot and conversation',()=>{
 assert.equal(conversationReplyTarget({...binding,replySync:false},config),null);
 assert.deepEqual(target,{channel:'feishu',agentId:'makaron',sessionKey:binding.sessionKey,accountId:'default',to:'oc_room'});
 assert.equal(conversationReplyTarget({...binding,accountId:'cli_other'},{accounts:{lab:{appId:'cli_other'}}}).accountId,'lab');
 assert.throws(()=>conversationReplyTarget(binding,{appId:'cli_else'}),/机器人账号/);
 assert.throws(()=>conversationReplyTarget({...binding,kind:'dm'},config),/目标/);
 assert.throws(()=>conversationReplyTarget(binding,{...config,enabled:false}),/未配置/);
});
test('completed response combines final segments once, excluding greeting, deltas and progress',async()=>{
 const f=fixture();f.d.transcript('你好，我是 V',{final:true});await f.d.finish();
 f.d.user('介绍方案');f.d.transcript('未完成内容',{final:false});f.d.transcript('正在查询',{final:true,source:'tool-progress'});
 f.d.transcript('第一点，沿用当前会话。',{final:true});f.d.transcript('第一点，沿用当前会话。',{final:true});f.d.transcript('第二点，主要回复同步飞书。',{final:true});
 assert.equal(f.calls.length,0);await f.d.finish({responseId:'r1'});await f.d.finish({responseId:'r1'});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.message,'第一点，沿用当前会话。\n第二点，主要回复同步飞书。');assert.equal(f.calls[0].args.sessionKey,binding.sessionKey);
});
test('interruption, cancelled response and hangup never publish unfinished text',async()=>{
 const f=fixture();f.d.user('说一下');f.d.transcript('旧回答',{final:true});f.d.interrupt();await f.d.finish();
 f.d.transcript('被取消的回答',{final:true});await f.d.finish({status:'cancelled'});
 f.d.transcript('没有说完',{final:true});await f.d.close();await f.d.finish();assert.equal(f.calls.length,0);
});
test('background full result survives hangup and is not duplicated by spoken summary',async()=>{
 const f=fixture();f.d.user('给我报告');await f.d.result('task-1','报告的完整正文');f.d.transcript('报告的摘要',{final:true});await f.d.finish();
 await f.d.result('task-1','报告的完整正文');assert.equal(f.calls.length,1);
 await f.d.close();await f.d.result('task-2','挂断后完成的正文');assert.equal(f.calls.length,2);
});
test('ambiguous send retry keeps exact idempotency key and route; failure never claims sent',async()=>{
 const f=fixture(async(_args,n)=>{if(n===1)throw Error('TIMEOUT');return {messageId:'om_receipt'};});f.d.user('回答');f.d.transcript('真实回答',{final:true});await f.d.finish();
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.audit.filter(e=>e.type==='reply.delivery-confirmed').length,1);
 const g=fixture(async()=>({ok:true}));await g.d.result('run','真实内容');assert.equal(g.statuses.at(-1).status,'failed');assert(!g.audit.some(e=>e.type==='reply.delivery-confirmed'));
});
test('send queue is ordered and belongs to one fixed session across new user turns',async()=>{
 const f=fixture();f.d.user('第一问');f.d.transcript('同一个答案',{final:true});const a=f.d.finish({responseId:'r1'});
 f.d.user('再说一遍');f.d.transcript('同一个答案',{final:true});const b=f.d.finish({responseId:'r2'});await Promise.all([a,b]);
 assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].args.idempotencyKey,f.calls[1].args.idempotencyKey);assert(f.calls.every(c=>c.args.to==='oc_room'&&c.args.accountId==='default'));assert.equal(f.d.pending,false);
});
