import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createConversationCalls,callSummarizerFromEnv} from '../lib/conversation-calls.mjs';
import {createConversationReplyDelivery} from '../lib/conversation-replies.mjs';
const binding={id:'test-group',kind:'group',sessionKey:'agent:makaron:feishu:group:oc_a',callerId:'tianyi',accountId:'bot',displayName:'测试群'},target={sessionKey:binding.sessionKey,to:'oc_a'};
test('group call: real readiness, one summary, admitted complete transcript and late results survive',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'voice-call-'));let at=1000,release;const sent=[];
 const gateway={request:async(method,args)=>{sent.push(args);return {messageId:'om_'+sent.length};}};
 const calls=createConversationCalls({gateway,directory,publicOrigin:'https://phone.example',basePath:'/voice',now:()=>at,summarize:async()=>new Promise(r=>release=r)});
 try{
  const report=calls.begin(binding,target,'call');const delivery=createConversationReplyDelivery({gateway,target,ownerId:'call',callReport:report});
  assert.equal(sent.length,0);delivery.ready();delivery.ready();
  delivery.user('你好',{turnId:'u0'});delivery.begin('r0');delivery.transcript('你好，我在。',{final:true,responseId:'r0'});await delivery.finish({responseId:'r0'});
  delivery.user('查下今天安排',{turnId:'u1'});delivery.begin('r1');delivery.transcript('我来',{responseId:'r1'});delivery.transcript('查一下',{responseId:'r1'});delivery.interrupt('r1');
  delivery.user('旁边的人聊天',{turnId:'aside'});delivery.begin('ra');delivery.transcript('旁聊',{final:true,responseId:'ra'});delivery.ignore('ra');
  delivery.user('请生成方案',{turnId:'u2'});delivery.captureTask('request');delivery.captureTask('run',{from:'request'});
  at=66000;await delivery.close();
  // close releases audio without waiting for the summarizer.
  for(let i=0;!release&&i<100;i++)await new Promise(r=>setTimeout(r,5));assert.ok(release);assert.ok(calls.pending);
  assert.equal(sent.length,2);assert.equal(sent[0].message,'📞 开始打电话');
  await delivery.result('run:final','方案已生成',{questionId:'run'});assert.equal(sent.length,3);
  release('讨论了今天的安排，并请求生成方案，结果待后台返回。');await calls.flush();
  assert.equal(sent.length,4);const card=JSON.parse(sent[3].message);assert.match(card.body.elements[0].content,/1 分 5 秒/);
  const url=new URL(card.body.elements.at(-1).behaviors[0].default_url);assert.equal(url.searchParams.get('phone'),binding.id);
  const saved=await calls.read(binding,report.id);assert.equal(saved.summaryState,'generated');assert.equal(saved.pendingTasks,true);assert.equal(saved.turns.length,5);assert.equal(saved.turns.find(r=>r.text==='我来查一下').interrupted,true);assert.ok(!saved.turns.some(t=>t.text==='方案已生成'||t.text==='旁聊'));
  assert.equal((await stat(join(directory,report.id+'.json'))).mode&0o777,0o600);
  const reopened=createConversationCalls({directory});assert.deepEqual(await reopened.read(binding,report.id),saved);assert.equal(await reopened.read({...binding,sessionKey:'different'},report.id),null);assert.equal(await reopened.read(binding,'../../secret'),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('reservation cancellation stays silent; unavailable summary retains full dialogue honestly',async()=>{
 const sent=[],calls=createConversationCalls({gateway:{request:async(_,a)=>{sent.push(a);return{messageId:'ok'};}},publicOrigin:'https://phone.example',basePath:'/voice',summarize:async()=>{throw Error('timeout');}});
 const cancelled=calls.begin(binding,target,'cancelled');cancelled.close();await calls.flush();assert.equal(sent.length,0);
 const live=calls.begin(binding,target,'live');live.ready();live.user('我要安排一场会议');live.close();live.close();await calls.flush();assert.equal(sent.length,3);const report=await calls.read(binding,live.id);assert.equal(report.turns[0].text,'我要安排一场会议');assert.equal(report.summaryState,'unavailable');assert.match(report.summary,/暂时未生成摘要/);
});
test('summary request is bounded, has no tools and rejects truncated completion',async()=>{
 let payload;const summarize=callSummarizerFromEnv({XAI_API_KEY:'test',VOICE_CALL_SUMMARY_MODEL:'test-model'},{fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'half'}}]})};}});
 await assert.rejects(summarize({turns:[{role:'user',text:'测试'}]}),/summary-invalid/);assert.equal(payload.tools,undefined);assert.equal(payload.max_tokens,500);
});
