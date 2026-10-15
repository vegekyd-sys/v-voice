import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceTaskControlHandler} from './task-control.mjs';
const voiceSessionId='11111111-1111-4111-8111-111111111111',runId=`voice-${voiceSessionId}-22222222-2222-4222-8222-222222222222`;
function fixture(control=async()=>({ok:true,queued:true})) {
 const entry={ownerConnId:'host',sessionKey:'agent:makaron:explicit:candidate',sessionId:'actual-session',kind:'chat-send',controller:new AbortController()};
 const context={chatAbortControllers:new Map([[runId,entry]])},answers=[],calls=[];
 const handler=createVoiceTaskControlHandler(async p=>{calls.push(p);return control(p);});
 const request={params:{voiceSessionId,runId,sessionKey:entry.sessionKey,mode:'steer',text:'改成新条件'},client:{connId:'host'},context,respond:(...a)=>answers.push(a)};
 return {entry,request,handler,answers,calls};
}
test('direct Voice uses the existing SDK controller and an exact registered owner',async()=>{
 const f=fixture();await f.handler(f.request);assert.equal(f.calls.length,1);
 const target=f.calls[0].runTarget;assert.equal(target.runId,runId);assert.equal(target.signal,f.entry.controller.signal);
 assert.equal(target.isCurrent('actual-session'),true);assert.equal(target.isCurrent('other-session'),false);
 assert.equal(f.answers[0][1].queued,true);assert.equal(f.answers[0][1].applied,false);
 f.request.context.chatAbortControllers.set(runId,{...f.entry});assert.equal(target.isCurrent(),false);
});
test('foreign connection, other run, call, session, retired owner and abort never control work',async t=>{
 for(const mutate of [f=>f.request.client.connId='other',f=>f.request.params.runId+='0',f=>f.request.params.voiceSessionId='other',f=>f.request.params.sessionKey='another',f=>f.entry.registrationCleanupRequested=true,f=>f.entry.controller.abort()])await t.test(String(mutate),async()=>{
  const f=fixture();mutate(f);await f.handler(f.request);assert.equal(f.calls.length,0);assert.equal(f.answers[0][0],false);
 });
});
test('compaction rejection is preserved rather than reported accepted',async()=>{
 const f=fixture(async()=>({ok:false,queued:false,reason:'compacting'}));await f.handler(f.request);assert.equal(f.answers[0][1].ok,false);assert.equal(f.answers[0][1].reason,'compacting');
});

test('owner ending during acceptance is not reported as conditions applied',async()=>{
 let f;f=fixture(async()=>{f.request.context.chatAbortControllers.delete(runId);return {ok:true,queued:true};});
 await f.handler(f.request);assert.equal(f.answers[0][1].ok,false);assert.equal(f.answers[0][1].queueAcceptedBeforeOwnerChanged,true);
});
