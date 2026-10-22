import {conversationReplyText} from '../lib/conversation-replies.mjs';
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
 assert.equal(f.calls.length,1);assert.equal(conversationReplyText(f.calls[0].args.message),'语音提问：介绍方案\n\nV：第一点，沿用当前会话。\n第二点，主要回复同步飞书。');assert.equal(f.calls[0].args.sessionKey,binding.sessionKey);
});
test('interruption, cancelled response and hangup never publish unfinished text',async()=>{
 const f=fixture();f.d.user('说一下');f.d.transcript('旧回答',{final:true});f.d.interrupt();await f.d.finish();
 f.d.transcript('被取消的回答',{final:true});await f.d.finish({status:'cancelled'});
 f.d.transcript('没有说完',{final:true});await f.d.close();await f.d.finish();assert.equal(f.calls.length,0);
});
test('background full result survives hangup and is not duplicated by spoken summary',async()=>{
 const f=fixture();f.d.user('给我报告');f.d.captureTask('task-1');await f.d.result('task-1','报告的完整正文');f.d.transcript('报告的摘要',{final:true});await f.d.finish();
 await f.d.result('task-1','报告的完整正文');assert.equal(f.calls.length,1);
 f.d.user('再给我另一个报告');f.d.captureTask('task-2');await f.d.close();await f.d.result('task-2','挂断后完成的正文');assert.equal(f.calls.length,2);
});
test('ambiguous send retry keeps exact idempotency key and route; failure never claims sent',async()=>{
 const f=fixture(async(_args,n)=>{if(n===1)throw Error('TIMEOUT');return {messageId:'om_receipt'};});f.d.user('回答');f.d.transcript('真实回答',{final:true});await f.d.finish();
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.audit.filter(e=>e.type==='reply.delivery-confirmed').length,1);
 const g=fixture(async()=>({ok:true}));g.d.user('完成任务');g.d.captureTask('run');await g.d.result('run','真实内容');assert.equal(g.statuses.at(-1).status,'failed');assert(!g.audit.some(e=>e.type==='reply.delivery-confirmed'));
});
test('send queue is ordered and belongs to one fixed session across new user turns',async()=>{
 const f=fixture();f.d.user('第一问');f.d.transcript('同一个答案',{final:true});const a=f.d.finish({responseId:'r1'});
 f.d.user('再说一遍');f.d.transcript('同一个答案',{final:true});const b=f.d.finish({responseId:'r2'});await Promise.all([a,b]);
 assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].args.idempotencyKey,f.calls[1].args.idempotencyKey);assert(f.calls.every(c=>c.args.to==='oc_room'&&c.args.accountId==='default'));assert.equal(f.d.pending,false);
});

test('response owns its question even if a later caller turn arrives before completion',async()=>{
 const f=fixture();f.d.user('明天下午有什么安排？',{turnId:'q1'});f.d.begin('a1');
 f.d.transcript('明天下午',{responseId:'a1'});f.d.user('那后天呢？',{turnId:'q2'});
 f.d.transcript('明天下午有两场会议。',{final:true,responseId:'a1'});await f.d.finish({responseId:'a1'});
 f.d.transcript('后天下午没有会议。',{final:true,responseId:'a2'});await f.d.finish({responseId:'a2'});
 assert.deepEqual(f.calls.map(c=>conversationReplyText(c.args.message)),['语音提问：明天下午有什么安排？\n\nV：明天下午有两场会议。','语音提问：那后天呢？\n\nV：后天下午没有会议。']);
});
test('partial, unadmitted and ignored asides cannot create a posted question',async()=>{
 const f=fixture();f.d.user('没有说完',{final:false});f.d.user('对旁边人说的话',{admitted:false});
 f.d.transcript('不应该发送。',{final:true,responseId:'none'});await f.d.finish({responseId:'none'});
 f.d.user('旁聊的完整识别');f.d.begin('aside');f.d.ignore('aside');
 f.d.transcript('模型自言自语。',{final:true,responseId:'aside'});await f.d.finish({responseId:'aside'});
 f.d.user('嗯');f.d.transcript('继续说。',{final:true,responseId:'ack'});await f.d.finish({responseId:'ack'});assert.equal(f.calls.length,0);
});
test('task question is frozen at request, survives intervening turns and hangup',async()=>{
 const f=fixture();f.d.user('请查明天的天气',{turnId:'q1'});f.d.captureTask('request');
 f.d.user('顺便讲个笑话',{turnId:'q2'});f.d.captureTask('run',{from:'request'});
 f.d.transcript('这是一个笑话。',{final:true,responseId:'joke'});await f.d.finish({responseId:'joke'});
 await f.d.close();await f.d.result('run:final','明天晴天。',{questionId:'run'});
 assert.equal(conversationReplyText(f.calls[1].args.message),'语音提问：请查明天的天气\n\nV：明天晴天。');
 await f.d.result('run:final','明天晴天。',{questionId:'run'});assert.equal(f.calls.length,2);
});
test('same final user turn and repeated assistant completion produce one pair',async()=>{
 const f=fixture();f.d.user('解释方案',{turnId:'q1'});f.d.transcript('方案正文。',{final:true,responseId:'r1'});await f.d.finish({responseId:'r1'});
 f.d.user('解释方案',{turnId:'q1'});f.d.transcript('重复正文。',{final:true,responseId:'r2'});await f.d.finish({responseId:'r2'});assert.equal(f.calls.length,1);
});

test('response created before final ASR binds to the new speech, never the previous turn',async()=>{
 const f=fixture();f.d.user('前一个问题');f.d.inputStarted();f.d.begin('early');
 f.d.user('这次的新问题',{turnId:'late-asr'});f.d.transcript('新问题的答案。',{final:true,responseId:'early'});await f.d.finish({responseId:'early'});
 assert.equal(conversationReplyText(f.calls[0].args.message),'语音提问：这次的新问题\n\nV：新问题的答案。');
});

test('card keeps a literal question, one divider and unabridged formatted answer',async()=>{
 const f=fixture(),q='如何显示 **星号** 和 <at id=all>？',a='**重点**\n\n- 一项\n- 另一项\n\n[资料](https://example.com)';
 f.d.user(q);f.d.transcript(a,{final:true});await f.d.finish({responseId:'styled'});
 const card=JSON.parse(f.calls[0].args.message);assert.equal(card.schema,'2.0');assert.equal(card.header.template,'purple');assert.equal(card.body.elements[1].text.tag,'plain_text');assert.equal(card.body.elements[1].text.content,q);assert.equal(card.body.elements.filter(e=>e.tag==='hr').length,1);assert.equal(card.body.elements[3].content,'**V 的回答**\n\n'+a);assert.equal(f.calls.length,1);
});

test('oversized background answers retain the full result via text delivery',async()=>{
 const f=fixture(),answer='完整结果。'.repeat(3000);f.d.user('给我完整报告');f.d.captureTask('long');
 await f.d.result('long',answer);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].args.message,'语音提问：给我完整报告\n\n---\n\nV：'+answer);
});
