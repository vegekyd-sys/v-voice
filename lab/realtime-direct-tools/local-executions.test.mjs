import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createLocalExecutions,executionFinishedLine,executionResultFacts} from './local-executions.mjs';
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

test('errors preserve known non-submission and never infer it from an arbitrary failure',async()=>{
 const jobs=createLocalExecutions();
 const invalid=await jobs.start(()=>{throw Object.assign(Error('bad arguments'),{code:'invalid_arguments',submission:'not-submitted'});});
 assert.equal(invalid.details.status,'not-started');assert.equal(invalid.details.retryable,true);assert.equal(invalid.error,'bad arguments');assert.equal(invalid.submission,'not-submitted');assert.match(invalid.instruction,/首次提交/);
 const unknown=await jobs.start(()=>{throw Error('connection lost');});
 assert.equal(unknown.details.submission,'unknown');assert.equal(unknown.details.retryable,false);assert.equal(unknown.submission,'unknown');assert.match(unknown.instruction,/不重新提交/);
});

test('nonzero executor results retain diagnostic output and expose unknown submission without retry',async()=>{
 const jobs=createLocalExecutions();
 const output=await jobs.start(()=>({isError:true,content:[{type:'text',text:'connection lost'}],details:{status:'failed',submission:'unknown',exitCode:1}}));
 assert.equal(output.submission,'unknown');assert.equal(output.status,'failed');assert.equal(output.details.exitCode,1);assert.equal(output.details.retryable,false);assert.equal(output.content[0].text,'connection lost');assert.match(output.instruction,/不重新提交/);
});
test('a finished execution nobody read is offered once, after settling, and process still reads it',async()=>{
 let clock=0,finish;const jobs=createLocalExecutions({yieldMs:1,settleMs:100,now:()=>clock});
 const running=await jobs.start(()=>new Promise(r=>finish=r),{metadata:{completionLine:'小猫画好了'}});
 assert.equal(jobs.takeUnread(),null);
 finish({media:{kind:'image',url:'https://cdn.test/a.webp'},content:[{type:'text',text:'done'}]});
 await delay(5);
 assert.equal(jobs.takeUnread(),null,'a poll between two model turns may still claim it');
 clock=100;
 assert.equal(jobs.takeUnread(m=>m.completionLine==='别的'),null);
 assert.equal(jobs.takeUnread().metadata.completionLine,'小猫画好了');
 assert.equal(jobs.takeUnread(),null);
 assert.match((await jobs.poll(running.sessionId)).instruction,/不要再通报/);
});
test('a result the model already read is never offered',async()=>{
 let clock=0,finish;const jobs=createLocalExecutions({yieldMs:1,settleMs:0,now:()=>clock});
 const running=await jobs.start(()=>new Promise(r=>finish=r));
 finish({content:[{type:'text',text:'done'}]});await delay(5);clock=1;
 assert.equal((await jobs.poll(running.sessionId)).instruction,undefined);
 assert.equal(jobs.takeUnread(),null);
});
test('the words spoken are the model\'s own, and unusable ones fall back to a plain statement',()=>{
 const lines={completionLine:' 小猫画好了，你看看 ',failureLine:'小猫那个这次没拿到结果'};
 assert.equal(executionFinishedLine({},lines),'小猫画好了，你看看');
 assert.equal(executionFinishedLine({isError:true},lines),'小猫那个这次没拿到结果');
 assert.equal(executionFinishedLine({},{}),'刚才那个弄好了。');
 assert.equal(executionFinishedLine({},{completionLine:'看 https://cdn.test/a.mp4'}),'刚才那个弄好了。');
 assert.equal(executionFinishedLine({isError:true},{completionLine:'好了'}),'刚才那个没弄成。');assert.doesNotMatch(executionFinishedLine({},{}),/[吗？?]/u);
});
test('result facts keep what later turns need and carry no raw output when media exists',()=>{
 const facts=JSON.parse(executionResultFacts({media:{kind:'video',url:'https://cdn.test/a.mp4'},presentation:{shown:true},content:[{type:'text',text:'cli noise'}]}));
 assert.deepEqual(facts,{status:'completed',media:{kind:'video',url:'https://cdn.test/a.mp4'},presentation:{shown:true}});
 assert.equal(JSON.parse(executionResultFacts({isError:true,status:'failed',submission:'unknown',error:'x',content:[{type:'text',text:'x'}]})).submission,'unknown');
});
