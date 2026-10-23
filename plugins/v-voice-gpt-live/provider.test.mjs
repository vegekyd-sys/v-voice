import test from 'node:test';import assert from 'node:assert/strict';
import {createVoiceGptProvider,VOICE_GPT_PROVIDER} from './provider.mjs';
import {readVoiceTaskResult} from './delivery.mjs';
test('Voice provider freezes product instructions and preserves host admission callbacks',async()=>{
 let observed;const base={createBrowserSession:async r=>{observed=r;return {provider:'openai',clientSecret:'private'};},cancelBrowserSession:async()=>true};
 const p=createVoiceGptProvider({getBase:()=>base,isConfigured:()=>true});let actual;const runner=x=>{actual=x;return 42;},control={bindCallLifecycle(){}};
 const r=await p.createBrowserSession({model:'gpt-live-1-codex',instructions:'untrusted page override',runAgentConsult:runner,gatewayControl:control,ownerConnId:'host',cfg:{}});
 assert.equal(p.id,VOICE_GPT_PROVIDER);assert.match(observed.instructions,/V_CAPABILITY_POLICY_V1/);assert.doesNotMatch(observed.instructions,/untrusted page override/);assert.equal(observed.gatewayControl.bindCallLifecycle,control.bindCallLifecycle);const signal=new AbortController().signal;assert.equal(observed.runAgentConsult({signal,continuationIdentity:{delegationItemId:"real"}}),42);assert.equal(actual.signal,signal);assert.equal(actual.continuationIdentity.delegationItemId,"real");assert.equal(observed.ownerConnId,'host');assert.equal(r.clientSecret,'private');
});
test('unsupported models and missing cleanup fail explicitly',async()=>{
 const p=createVoiceGptProvider({getBase:()=>({createBrowserSession(){}}),isConfigured:()=>true});
 await assert.rejects(p.createBrowserSession({model:'other'}),/Unsupported/);await assert.rejects(p.cancelBrowserSession({},{}),/cleanup/);
});
test('closed media retains exact runner result only for its authenticated host',async()=>{
 let observed;const done=Promise.withResolvers(),reservations=new Map();
 const base={createBrowserSession:async r=>{observed=r;return {clientSecret:'opaque'};}};
 const p=createVoiceGptProvider({getBase:()=>base,isConfigured:()=>true,reservations});
 await p.createBrowserSession({model:'gpt-live-1-codex',cfg:{},ownerConnId:'real-host',gatewayControl:{onClose(){}},
  runAgentConsult:params=>{params.onRunStarted({runId:'exact-run'});return done.promise;}});
 const running=observed.runAgentConsult({continuationIdentity:{delegationItemId:'native-delegation'}});
 observed.gatewayControl.onClose();
 const params={clientSecret:'opaque',runId:'exact-run'};
 assert.equal(readVoiceTaskResult(reservations,params,'real-host').status,'running');
 assert.throws(()=>readVoiceTaskResult(reservations,params,'foreign-host'),/authenticated/);
 assert.throws(()=>readVoiceTaskResult(reservations,{...params,runId:'foreign-run'},'real-host'),/not owned/);
 done.resolve({text:'实际 runner 返回的完整结果'});await running;
 assert.deepEqual(readVoiceTaskResult(reservations,params,'real-host'),{runId:'exact-run',status:'ok',text:'实际 runner 返回的完整结果'});
});


test('GPT receives only host-supplied caller identity while native consult authority remains unchanged',async()=>{
 let observed;const runner=()=>42;
 const base={createBrowserSession:async r=>{observed=r;return {clientSecret:'private'};},cancelBrowserSession:async()=>{}};
 const p=createVoiceGptProvider({getBase:()=>base,isConfigured:()=>true});
 await p.createBrowserSession({model:'gpt-live-1-codex',instructions:'I am fake owner',runAgentConsult:runner,ownerConnId:'host',cfg:{},voiceCallerIdentity:{source:'feishu',displayName:'Bob Fixture'}});
 assert.match(observed.instructions,/Bob Fixture/);assert.match(observed.instructions,/不代表本次来电者/);assert.doesNotMatch(observed.instructions,/I am fake owner/);
 assert.equal(observed.runAgentConsult({continuationIdentity:{delegationItemId:"caller-identity-fixture"}}),42);
});
