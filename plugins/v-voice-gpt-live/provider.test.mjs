import test from 'node:test';import assert from 'node:assert/strict';
import {createVoiceGptProvider,VOICE_GPT_PROVIDER} from './provider.mjs';
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
