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
