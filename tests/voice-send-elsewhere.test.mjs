// Call efecdf3d (2026-11-25): after making an image and a video in the call, the caller said
// "把这个视频发到我跟艾瑞特和你的那个群里面吧". The voice model picked send_task_updates (which only
// forwards this call's backend task to the call's own group), got a bare refusal, asked the caller
// to confirm, then said it was sending without calling anything. No backend task was ever started.
import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffHint,taskUpdatesResult,SEND_ELSEWHERE_HINT} from '../lab/realtime-direct-tools/session.mjs';
import {createTaskDelivery,requestsTaskDelivery} from '../lab/realtime-direct-tools/task-delivery.mjs';
import {TOOLS} from '../lab/realtime-direct-tools/tools.mjs';

const withDelegate=[{name:'send_task_updates'},{name:'delegate_to_v'}];

test('the actual request names another group, so it never authorizes forwarding to the call group',()=>{
 assert.equal(requestsTaskDelivery('你这样吧，然后把这个视频发到我跟艾瑞特和你的那个群里面吧？'),false);
 assert.equal(requestsTaskDelivery('是的，去发吧。'),false);
});

test('send_task_updates refusals hand the send to delegate_to_v, without asking to confirm again',()=>{
 for(const message of ['用户尚未要求把任务进展发到飞书群','当前电话没有经过验证的飞书交付入口','未知工具参数']){
  const hint=handoffHint('send_task_updates',message,withDelegate);
  assert.equal(hint,SEND_ELSEWHERE_HINT,message);
  assert.match(hint,/delegate_to_v/u);assert.match(hint,/不要再问一遍确认/u);assert.match(hint,/不能说在发或已发/u);
 }
 // A failed send of a real task's result is not a reason to start a new task.
 assert.equal(handoffHint('send_task_updates','飞书没有确认发送回执',withDelegate),'');
 // No hand-off where the call has no backend.
 assert.equal(handoffHint('send_task_updates','用户尚未要求把任务进展发到飞书群',[{name:'send_task_updates'}]),'');
 // The lookup hint is unchanged.
 assert.match(handoffHint('feishu_calendar','permission denied',[{name:'delegate_to_v'}]),/交给后台去查/u);
 assert.equal(handoffHint('web_search','permission denied',[{name:'delegate_to_v'}]),'');
});

test('with no backend task to forward, send_task_updates says nothing was sent and where the send goes',()=>{
 const nothing=taskUpdatesResult({accepted:true,channel:'feishu',continuedAfterHangup:true},{hasTask:false,canDelegate:true});
 assert.equal(nothing.sent,false);assert.equal(nothing.taskRunning,false);assert.match(nothing.instruction,/delegate_to_v/u);
 const running={accepted:true,channel:'feishu',continuedAfterHangup:true};
 assert.equal(taskUpdatesResult(running,{hasTask:true,canDelegate:true}),running);
 assert.equal(taskUpdatesResult(running,{hasTask:false,canDelegate:false}),running);
});

test('task delivery knows whether it has a backend task to forward',async()=>{
 const d=createTaskDelivery({gateway:{request:async()=>({messageId:'om'})},sessionKey:'agent:makaron:feishu:group:oc_test',ownerId:'call'});
 assert.equal(d.hasTask,false);
 d.started('run');assert.equal(d.hasTask,true);
 await d.completed('run','结果');assert.equal(d.hasTask,true,'a finished result can still be forwarded');
});

test('the tool says it cannot send what was made in the call or to another group',()=>{
 const description=TOOLS.find(tool=>tool.name==='send_task_updates').description;
 assert.match(description,/delegate_to_v/u);assert.match(description,/图片、视频/u);assert.match(description,/别的群/u);
});
