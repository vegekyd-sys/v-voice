import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalExecutions} from './local-executions.mjs';
test('exec yields a real handle; polls return the same eventual result and never execute twice',async()=>{
 const jobs=createLocalExecutions({yieldMs:1});let resolve,calls=0;
 const running=await jobs.start(()=>{calls++;return new Promise(r=>resolve=r);});
 assert.equal(running.details.status,'running');
 const id=running.details.sessionId;
 assert.equal((await jobs.poll(id,{timeout:1})).details.sessionId,id);
 const result={content:[{type:'text',text:'actual result'}],details:{status:'completed'}};
 resolve(result);assert.equal(await jobs.poll(id,{timeout:100}),result);assert.equal(await jobs.poll(id),result);assert.equal(calls,1);
 assert.throws(()=>createLocalExecutions().poll(id),/本通话/);
});
test('hangup aborts and joins jobs after the original exec has already returned running',async()=>{
 const jobs=createLocalExecutions({yieldMs:1});let ended=false;
 const running=await jobs.start(signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{ended=true;reject(signal.reason);},{once:true})));
 await jobs.cancelAll();assert(ended);assert.equal((await jobs.poll(running.sessionId)).isError,true);
});
test('completed fast tools return normally; bounded handles reject new work before it starts',async()=>{
 const jobs=createLocalExecutions({yieldMs:1,maxJobs:1});
 assert.equal(await jobs.start(()=>42),42);
 const running=await jobs.start(signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 assert.throws(()=>jobs.start(()=>assert.fail('must not run')),/过多/);
 assert(jobs.has(running.sessionId));await jobs.cancelAll();
});

test('only unread yielded execution completions notify, with bounded retry and no result in the event',async()=>{
 let time=0,finish;const jobs=createLocalExecutions({yieldMs:1,now:()=>time,notificationRetryMs:10});
 await jobs.start(()=>42);assert.equal(jobs.takeNotification(),null);
 const running=await jobs.start(()=>new Promise(r=>finish=r),{metadata:{owner:'alice'}});
 assert.equal(jobs.takeNotification(),null);
 finish({media:{url:'https://private.test/result'},details:{status:'completed'}});await new Promise(r=>setImmediate(r));
 assert.equal(jobs.takeNotification(m=>m.owner==='bob'),null);
 assert.deepEqual(jobs.takeNotification(m=>m.owner==='alice'),{sessionId:running.sessionId});
 assert.equal(jobs.takeNotification(),null);time=10;
 assert.deepEqual(jobs.takeNotification(),{sessionId:running.sessionId});time=30;assert.equal(jobs.takeNotification(),null);
 const result=await jobs.poll(running.sessionId);assert.equal(result.details.status,'completed');assert.equal(jobs.takeNotification(),null);
});

test('an active poll consuming the final result suppresses a redundant completion notification',async()=>{
 let finish;const jobs=createLocalExecutions({yieldMs:1});
 const running=await jobs.start(()=>new Promise(r=>finish=r));
 const poll=jobs.poll(running.sessionId,{timeout:5000});finish({details:{status:'completed'}});await poll;
 assert.equal(jobs.takeNotification(),null);
});

test('errors preserve known non-submission and never infer it from an arbitrary failure',async()=>{
 const jobs=createLocalExecutions();
 const invalid=await jobs.start(()=>{throw Object.assign(Error('bad arguments'),{code:'invalid_arguments',submission:'not-submitted'});});
 assert.equal(invalid.details.status,'not-started');assert.equal(invalid.details.retryable,true);assert.equal(invalid.error,'bad arguments');
 const unknown=await jobs.start(()=>{throw Error('connection lost');});
 assert.equal(unknown.details.submission,'unknown');assert.equal(unknown.details.retryable,false);
});
