import test from 'node:test';import assert from 'node:assert/strict';
import {createVoiceTasks} from './tasks.mjs';
const request={voiceSessionId:'call',callId:'tool-call',sessionKey:'agent:makaron:feishu:group:oc_test',question:'实际完整目标'};
function fixture(control=async()=>({ok:true,queued:true})){const done=Promise.withResolvers();let input,event,started;const service=createVoiceTasks({control,getConfig:()=>({agents:{defaults:{thinkingDefault:'off'}}}),agentRuntime:{real:true},subscribe:fn=>{event=fn;return()=>event=undefined;},consult:async p=>{input=p;p.onRunStarted({runId:'root'});return done.promise;}});const pending=service.start(request,'host',x=>started??=x);return {service,pending,done,get input(){return input;},get id(){return started.taskId;},emit:e=>event(e)};}
test('logical task survives initial yield and uses only the SDK causal final',async()=>{
 const f=fixture();assert.equal(f.service.read({taskId:f.id},'host').status,'running');
 assert.equal(f.input.agentRuntime.real,true);assert.equal(f.input.args.question,request.question);assert.equal(f.input.thinkLevel,'off');
 f.input.onResumeRunStarted({runId:'resumed'});assert.equal(f.service.read({taskId:f.id},'host').status,'running');
 f.done.resolve({text:'子任务已核对，父任务的真正完整结果'});await f.pending;
 assert.deepEqual(f.service.read({taskId:f.id},'host').runs,['root','resumed']);assert.equal(f.service.read({taskId:f.id},'host').text,'子任务已核对，父任务的真正完整结果');
});
test('foreign connection, unknown task and changed replay are rejected',async()=>{
 const f=fixture();assert.throws(()=>f.service.read({taskId:f.id},'foreign'),/authenticated/);await assert.rejects(f.service.cancel({taskId:'foreign'},'host'),/authenticated/);
 await assert.rejects(f.service.start({...request,question:'different'},'host'),/replay changed/);
 assert.equal(f.service.lookup(request,'foreign').found,false);f.done.resolve({text:'result'});await f.pending;
});
test('lost start response is reconciled by original connection/call identity without rerunning',async()=>{
 const f=fixture();let replay;const p=f.service.start(request,'host',x=>replay=x);await new Promise(r=>setImmediate(r));assert.equal(replay.taskId,f.id);assert.equal(f.service.lookup(request,'host').taskId,f.id);
 f.done.resolve({text:'one result'});await Promise.all([f.pending,p]);
});
test('public progress requires actual tool result from that SDK provenance run',async()=>{
 const f=fixture(),p={kind:'commentary',text:'实际查到事实。',provenance:{runId:'child',sequence:1}};
 f.input.onProgress(p);assert.equal(f.service.read({taskId:f.id},'host').progress.length,0);
 f.emit({runId:'other',stream:'tool',data:{phase:'result'}});f.input.onProgress(p);assert.equal(f.service.read({taskId:f.id},'host').progress.length,0);
 f.emit({runId:'child',stream:'tool',data:{phase:'result'}});f.input.onProgress(p);assert.equal(f.service.read({taskId:f.id},'host').progress.length,1);
 f.done.resolve({text:'result'});await f.pending;
});
test('explicit cancellation waits for SDK settlement and cannot later become success',async()=>{
 const f=fixture();let settled=false;const c=f.service.cancel({taskId:f.id},'host').then(x=>{settled=true;return x;});await new Promise(r=>setImmediate(r));assert(f.input.abortSignal.aborted);assert.equal(settled,false);
 f.done.resolve({text:'late must not succeed'});await f.pending;assert.equal((await c).cancelled,true);assert.equal(f.service.read({taskId:f.id},'host').status,'cancelled');
});
test('completed work cannot falsely claim successful cancellation',async()=>{
 const f=fixture();f.done.resolve({text:'done'});await f.pending;assert.deepEqual(await f.service.cancel({taskId:f.id},'host'),{taskId:f.id,cancelled:false,completed:true});
});

test('steer and followup resolve only this owned SDK task and its current continuation',async()=>{
 const calls=[],f=fixture(async input=>{calls.push(input);return {ok:true,queued:true};});
 await assert.rejects(f.service.control({taskId:f.id,mode:'steer',text:'foreign'},'other'),/authenticated/);
 assert.equal(calls.length,0);
 assert.equal((await f.service.control({taskId:f.id,mode:'steer',text:'新版目标'},'host')).applied,false);
 f.input.onResumeRunStarted({runId:'resumed'});
 assert.equal((await f.service.control({taskId:f.id,mode:'followup',text:'追加总结'},'host')).queued,true);
 assert.deepEqual(calls.map(x=>[x.mode,x.runTarget.runId]),[['steer','root'],['followup','resumed']]);
 assert(calls.every(x=>x.sessionKey===request.sessionKey&&x.runTarget.signal===f.input.abortSignal&&x.runTarget.isCurrent()));
 f.done.resolve({text:'新版目标和追加总结'});await f.pending;
 assert.equal((await f.service.control({taskId:f.id,mode:'steer',text:'too late'},'host')).queued,false);
 assert(calls.every(x=>!x.runTarget.isCurrent()));
});
test('control accepted while owner completes does not claim a current queued change',async()=>{
 const queue=Promise.withResolvers(),f=fixture(()=>queue.promise);
 const control=f.service.control({taskId:f.id,mode:'steer',text:'change'},'host');
 f.done.resolve({text:'complete'});await f.pending;queue.resolve({ok:true,queued:true});
 assert.equal((await control).reason,'owner_changed');
});
