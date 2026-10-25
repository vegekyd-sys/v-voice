import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeishuConfirmation} from './feishu-confirmation-client.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(overrides={}){
  const states=[],entries=[],requests=[],timers=[];
  const setup={state:'browser-request',label:'海风 · 1234',expiresAt:10000,entry:{unidentified:true}};
  const client=createFeishuConfirmation({now:()=>0,schedule:fn=>{timers.push(fn);return fn;},unschedule:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},
    onState:v=>states.push(v),onEntry:v=>entries.push(v),request:async(action,body)=>{requests.push({action,body});return overrides[action]?overrides[action](body):action==='prepare'?setup:action==='status'?{status:'waiting'}:{status:'waiting'};}});
  return {client,states,entries,requests,timers};
}
test('automatically sends once and applies verified entry in place',async()=>{
  const f=fixture({status:()=>({status:'complete',entry:{accountLabel:'确认的成员'}})});
  await Promise.all([f.client.start(),f.client.start()]);
  assert.deepEqual(f.requests.map(r=>r.action),['prepare','start']);
  assert.equal(f.states.at(-1).phase,'waiting');await f.timers.shift()();
  assert.equal(f.entries.at(-1).accountLabel,'确认的成员');assert.equal(f.states.at(-1),null);
});
test('cancel during prepare waits for cookie response and invalidates without sending',async()=>{
  const pending=deferred(),f=fixture({prepare:()=>pending.promise});
  const start=f.client.start();const cancel=f.client.cancel();
  pending.resolve({state:'pending',entry:{unidentified:true}});await start;await cancel;
  assert.deepEqual(f.requests.map(r=>r.action),['prepare','cancel']);assert.equal(f.entries.length,0);assert.equal(f.states.at(-1),null);
});
test('late poll cannot overwrite cancelled presentation or start more polling',async()=>{
  const pending=deferred(),f=fixture({status:()=>pending.promise});
  await f.client.start();const polling=f.timers.shift()();const cancellation=f.client.cancel();
  pending.resolve({status:'complete',entry:{accountLabel:'late'}});await polling;await cancellation;
  assert.equal(f.entries.length,1);assert.equal(f.states.at(-1),null);assert.equal(f.timers.length,0);
});
test('delivery error is visible and retry creates a fresh request',async()=>{
  let count=0;const f=fixture({start:()=>{if(!count++)throw Error('发送失败');return {status:'waiting'};}});
  await f.client.start();assert.equal(f.states.at(-1).error,'发送失败');await f.client.start();
  assert.equal(f.states.at(-1).phase,'waiting');assert.equal(f.requests.filter(r=>r.action==='prepare').length,2);
});
