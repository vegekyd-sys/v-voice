import test from 'node:test';import assert from 'node:assert/strict';import {createVoiceCallControl} from './call-control.mjs';
test('only a finalized real caller turn can select host hangup',async()=>{
 const accepted=[];let calls=0;const c=createVoiceCallControl({evaluate:async()=>{calls++;return {answers:{endIntent:{type:'noul',noul:.99}}};},onAccepted:x=>accepted.push(x)});
 await c.observe({role:'user',text:'先挂',final:false});await c.observe({role:'tool',text:'拜拜',final:true});assert.equal(calls,0);
 await c.observe({role:'user',text:'好了今天就这样，拜拜',final:true});assert.equal(accepted.length,1);assert.equal(accepted[0].source,'voice_host_control');assert.equal(accepted[0].userText,'好了今天就这样，拜拜');
});
test('a newer caller turn or closed call revokes a late decision; uncertainty stays connected',async()=>{
 const finish=[];const events=[];const c=createVoiceCallControl({evaluate:()=>new Promise(r=>{finish.push(r);}),onAccepted:x=>events.push(x)});
 const old=c.observe({role:'user',text:'拜拜',final:true});const newer=c.observe({role:'user',text:'等一下继续',final:true});finish[0]({answers:{endIntent:{type:'noul',noul:.99}}});await old;finish[1]({answers:{endIntent:{type:'noul',noul:.2}}});await newer;c.close();assert.equal(events.length,0);
 const d=createVoiceCallControl({evaluate:async()=>({answers:{endIntent:{type:'noul',noul:.8}}}),onAccepted:x=>events.push(x)});await d.observe({role:'user',text:'你能挂电话吗',final:true});assert.equal(events.length,0);
});
test('stable streaming USER reaches a proposal without delayed native done, and done cannot replay it',async()=>{
 const requests=[],events=[];const c=createVoiceCallControl({stableMs:25,evaluate:async x=>{requests.push(x.request);return {answers:{endIntent:{type:'noul',noul:.99}}};},onAccepted:x=>events.push(x)});
 await c.observe({role:'user',text:'请',turnId:'u',final:false});await c.observe({role:'user',text:'挂断',turnId:'u',final:false});await c.observe({role:'user',text:'电话',turnId:'u',final:false});
 await new Promise(r=>setTimeout(r,50));assert.deepEqual(requests,['请挂断电话']);assert.equal(events.length,1);assert(c.matches(events[0]));
 await c.observe({role:'user',text:'请挂断电话',turnId:'u',final:true});assert.equal(events.length,1);c.close();assert(!c.matches(events[0]));
});
test('continuing an unfinished sentence revokes a pending streamed decision and obsolete confirmation',async()=>{
 const finish=[],events=[];const c=createVoiceCallControl({stableMs:10,evaluate:()=>new Promise(r=>finish.push(r)),onAccepted:x=>events.push(x)});
 await c.observe({role:'user',text:'挂断',turnId:'u',final:false});await new Promise(r=>setTimeout(r,20));
 await c.observe({role:'user',text:'之前先帮我查日程',turnId:'u',final:false});finish[0]({answers:{endIntent:{type:'noul',noul:1}}});await new Promise(r=>setTimeout(r,20));assert.equal(events.length,0);
 finish[1]({answers:{endIntent:{type:'noul',noul:0}}});await new Promise(r=>setImmediate(r));assert.equal(events.length,0);c.close();
});
test('native caption snapshots replace rather than duplicate USER fragments',async()=>{
 const texts=[],events=[];const c=createVoiceCallControl({evaluate:async x=>{texts.push(x.request);return {answers:{endIntent:{type:'noul',noul:1}}};},onAccepted:x=>events.push(x)});
 await c.observe({role:'user',turnId:'native-u',text:'请',final:false,snapshot:true});await c.observe({role:'user',turnId:'native-u',text:'请挂断',final:false,snapshot:true});await c.observe({role:'user',turnId:'native-u',text:'请挂断电话',final:true,snapshot:true});assert.deepEqual(texts,['请挂断电话']);assert.equal(events.length,1);c.close();
});

test('speech onset revokes a decision before the delayed ASR completes',async()=>{
 let resolve;const events=[];const c=createVoiceCallControl({evaluate:()=>new Promise(r=>resolve=r),onAccepted:e=>events.push(e)});
 const work=c.observe({role:'user',text:'再见',final:true,turnId:'old'});c.interrupt();resolve({answers:{endIntent:{type:'noul',noul:1}}});await work;assert.equal(events.length,0);c.close();
});
