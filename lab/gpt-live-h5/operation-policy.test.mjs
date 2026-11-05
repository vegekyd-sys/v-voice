import test from 'node:test';
import assert from 'node:assert/strict';
import {GPT_LIVE_CALL_INSTRUCTIONS} from './instructions.mjs';
import {directInstructions} from '../realtime-direct-tools/session.mjs';
import {backendQuestion,createBackendDelegation} from '../realtime-direct-tools/backend.mjs';
import {VOICE_OPERATION_CONSENT_POLICY,VOICE_CALENDAR_SERVICE_POLICY} from '../../lib/voice-operation-policy.mjs';

test('all voice providers share explicit-request consent and calendar service boundaries',()=>{
  const prompts=[GPT_LIVE_CALL_INSTRUCTIONS];
  for(const model of ['grok','seeduplex'])for(const surface of ['phone','speaker'])for(const sessionBound of [false,true]) {
    prompts.push(directInstructions([], '',model,{surface,sessionBound}));
  }
  for(const prompt of prompts){
    assert(prompt.includes(VOICE_OPERATION_CONSENT_POLICY));
    assert(prompt.includes(VOICE_CALENDAR_SERVICE_POLICY));
  }
  const visitor=directInstructions([],'','seeduplex',{unidentified:true});
  assert(!visitor.includes(VOICE_OPERATION_CONSENT_POLICY));
  assert.match(visitor,/没有账号工具权限/);
  const publicTask=backendQuestion('解释日历怎么使用','',undefined,{publicVoice:true});
  assert.match(publicTask,/Public/);
  assert.match(publicTask,/通过已绑定飞书会话/); // Conditional default, not a visitor account grant.
});

test('delegation carries the original authorized request and exact service, without a permission bypass or automatic retry',async()=>{
  const calls=[];
  const original='帮我在飞书建立2030年5月6日11点到12点的产品评审日程，不邀请其他人。';
  const callerTurn={text:'好的，做吧。',receivedAt:'2030-05-05T01:00:00Z'};
  const gateway={request:async(method,args)=>{
    calls.push({method,args});
    if(method==='voice.product.task.start')return {taskId:'owned-calendar',runId:'run-calendar'};
    if(method==='voice.product.task.read')return {taskId:'owned-calendar',status:'ok',runId:'run-calendar',text:'飞书账号授权已过期，日程未创建。',progress:[]};
    throw Error('Unexpected method '+method);
  }};
  const backend=createBackendDelegation({gateway,sessionKey:'agent:test:feishu:group:oc_fixture',ownerId:'fixture-call',sessionBound:true,pollMs:1});
  const result=await backend.run({question:original,context:'用户原要求：'+original,callId:'fixture-tool',callerTurn});
  const start=calls.find(x=>x.method==='voice.product.task.start').args;
  assert.equal(start.publicQuestion,original);
  assert(start.question.includes('用户原要求：'+original));
  assert(start.question.includes(JSON.stringify(callerTurn)));
  assert(start.question.includes(VOICE_OPERATION_CONSENT_POLICY));
  assert(start.question.includes(VOICE_CALENDAR_SERVICE_POLICY));
  assert.deepEqual(Object.keys(start).sort(),['callId','publicQuestion','question','sessionKey','voiceSessionId'].sort());
  assert.equal(result.result,'飞书账号授权已过期，日程未创建。');
  assert.equal(calls.filter(x=>x.method==='voice.product.task.start').length,1);
});
