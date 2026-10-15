import test from 'node:test';import assert from 'node:assert/strict';
import {createTaskProgress} from './task-progress.mjs';
test('real tool phases give immediate host status without exposing arguments, results or reasoning',()=>{
 const updates=[];let clock=1000;
 const p=createTaskProgress({runId:'owned',onUpdate:v=>updates.push(v),now:()=>clock});p.accepted();
 const event=(data,runId='owned',stream='tool')=>p.consume({event:'agent',payload:{runId,stream,data}});
 event({phase:'start',name:'memory_search',toolCallId:'m',args:{query:'PRIVATE_QUERY'}});clock+=5000;
 event({phase:'start',name:'web_search',toolCallId:'w'});
 event({phase:'result',name:'memory_search',toolCallId:'m',result:{text:'PRIVATE_RESULT'}});
 assert.equal(updates.at(-1).text,'正在搜索资料');
 event({phase:'result',name:'web_search',toolCallId:'w'});
 assert.equal(updates.at(-1).text,'资料搜索已返回，正在整理');assert.equal(updates.at(-1).completedSteps,2);
 assert.equal(updates.at(-1).elapsedMs,5000);const count=updates.length;
 event({phase:'result',name:'web_search',toolCallId:'w'});
 event({phase:'start',name:'exec',toolCallId:'foreign'},'other');
 event({phase:'start',name:'exec',toolCallId:'reasoning'},'owned','reasoning');
 event({phase:'result',name:'exec',toolCallId:'unobserved'});
 assert.equal(updates.length,count);assert(!JSON.stringify(updates).includes('PRIVATE'));
 p.close();event({phase:'start',name:'exec',toolCallId:'late'});assert.equal(updates.length,count);
});
test('a failed tool result is not presented as task success',()=>{
 const updates=[],p=createTaskProgress({runId:'r',onUpdate:v=>updates.push(v)});
 for(const phase of ['start','result'])p.consume({event:'agent',payload:{runId:'r',stream:'tool',data:{phase,name:'exec',toolCallId:'x',result:{isError:true}}}});
 assert.match(updates.at(-1).text,/错误/);assert(!updates.at(-1).text.includes('完成'));
});
test('real worker preparation receipts replace queued state without exposing payload details',()=>{
 const updates=[],p=createTaskProgress({runId:'owned',onUpdate:x=>updates.push(x)});p.accepted();
 const phase=(runId,phase)=>p.consume({event:'agent',payload:{runId,stream:'run_status',data:{phase,workspace:'/PRIVATE',prompt:'PRIVATE TEXT'}}});
 phase('foreign','starting_model');assert.equal(updates.length,1);
 phase('owned','preparing_workspace');phase('owned','preparing_context');phase('owned','starting_model');phase('owned','unknown_phase');
 assert.deepEqual(updates.map(x=>x.text),['任务已接收，等待后台执行','正在准备任务环境','正在读取任务上下文','正在等待后台模型响应']);
 assert.doesNotMatch(JSON.stringify(updates),/PRIVATE/);p.close();phase('owned','preparing_context');assert.equal(updates.length,4);
});
