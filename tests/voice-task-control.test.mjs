import {test} from 'node:test';import assert from 'node:assert/strict';
import {controlVoiceTask,validateVoiceTaskControl} from '../lib/voice-task-control.mjs';
import {requestsTaskDelivery} from '../lab/realtime-direct-tools/task-delivery.mjs';
test('both transports preserve one control contract and queued is not applied',async()=>{
 const calls=[],gateway={request:async(...a)=>{calls.push(a);return {ok:true,queued:true};}};
 for(const native of [true,false])assert.equal((await controlVoiceTask({gateway,native,sessionKey:'bound',runId:'original',voiceSessionId:'call'},{mode:'steer',text:'改日期'})).applied,false);
 assert.equal(calls[0][0],'talk.client.steer');assert.equal(calls[1][0],'voice.product.task-control');assert.equal(calls[1][1].runId,'original');
 assert.equal(calls[0][1].mode,calls[1][1].mode);
});
test('no active task and malformed requests never create a task',async()=>{
 let n=0;const gateway={request:async()=>{n++;}};
 assert.equal((await controlVoiceTask({gateway},{mode:'steer',text:'改日期'})).ok,false);
 for(const args of [{mode:'unknown',text:'x'},{mode:'steer',text:''},{mode:'steer',text:'x'.repeat(2001)}])assert.throws(()=>validateVoiceTaskControl(args));
 assert.equal(n,0);
});
test('an ok response without queue receipt does not claim steering accepted',async()=>{
 const gateway={request:async()=>({ok:true})};assert.equal((await controlVoiceTask({gateway,native:true},{mode:'steer',text:'改日期'})).ok,false);
});
test('actual destination-first user requests authorize only the bound-group delivery',()=>{
 for(const text of ['可以啊，你待会就在群里面发给我吧，好吗？','没什么特别要求，然后选了以后你就，我待会电话就挂掉了，然后你就那个所有都安排后台在我们的群里面汇报就好了，好吗？'])assert.equal(requestsTaskDelivery(text),true);
 for(const text of ['不要在我们的群里面汇报','在项目甲群里面汇报','他问“你在我们的群里面汇报吗”','我们随便聊聊'])assert.equal(requestsTaskDelivery(text),false);
});
