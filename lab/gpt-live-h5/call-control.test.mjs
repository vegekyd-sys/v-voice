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
