import test from 'node:test';import assert from 'node:assert/strict';
import {validateTool,createCallDispatcher,createToolExecutor,processExited,calendarOutcome} from './tools.mjs';
test('typed tools reject malformed arguments and unknown actions',()=>{assert.throws(()=>validateTool('exec',{command:42}));assert.throws(()=>validateTool('feishu_calendar',{start:'today;curl'}));assert.throws(()=>validateTool('web_search',{query:'a',count:99}));assert.throws(()=>validateTool('end_call',{reason:'a'}));});
test('one native tool call executes once; conflicting replay rejected',async()=>{let count=0;const dispatch=createCallDispatcher(async()=>++count);const item={type:'function_call',call_id:'call1',name:'current_time',arguments:'{}'};assert.deepEqual(await Promise.all([dispatch(item),dispatch(item)]),[1,1]);assert.equal(count,1);assert.throws(()=>dispatch({...item,name:'end_call'}));});
test('calendar uses dedicated executor, search goes straight to OpenClaw',async()=>{const seen=[];const execute=createToolExecutor({invoke:async(...a)=>{seen.push(a);return {actual:true}},calendar:async a=>({calendar:a})});assert.deepEqual(await execute('feishu_calendar',{start:'2026-10-06'},'a'),{calendar:{start:'2026-10-06'}});assert.deepEqual(await execute('memory_search',{query:'十二'},'b'),{actual:true});assert.deepEqual(seen,[['memory_search',{query:'十二'},'b',undefined]]);});
test('calendar fails closed without local executor and never falls back to Gateway exec',async()=>{
 let invoked=false;await assert.rejects(createToolExecutor({invoke:()=>{invoked=true;}})('feishu_calendar',{},'calendar'),/本地飞书/);assert.equal(invoked,false);
});
test('calendar requires both exit zero and actual CLI ok, including exit annotations',async()=>{
 assert(calendarOutcome({details:{exitCode:0,aggregated:'{"ok":true}'}}).ok);
 for(const [code,text] of [[3,'{"ok":false,"error":{"message":"not bound"}}\n\n(Command exited with code 3)'],[0,'{"ok":false}'],[3,'{"ok":true}'],[0,'invalid JSON']])assert(!calendarOutcome({details:{exitCode:code,aggregated:text}}).ok);
 const calendar=async()=>{throw Error('not bound');};
 await assert.rejects(createToolExecutor({calendar})('feishu_calendar',{},'call'),/not bound/);
});

test('process registry failure never claims a live owned process exited',()=>{
 assert.equal(processExited({details:{status:'failed'},content:[{type:'text',text:'No session found for neat-breeze'}]}),false);
 assert.equal(processExited({details:{status:'failed'}}),false);
 assert.equal(processExited({details:{status:'failed',exitCode:1}}),true);
 assert.equal(processExited({details:{status:'killed'},isError:true}),false);
 assert.equal(processExited({details:{status:'completed',exitCode:0}}),true);
});
test('native process SIGTERM exit is terminal, but a registry miss remains failure',()=>{assert(processExited({details:{status:'failed',sessionId:'owned',exitSignal:'SIGTERM'}}));assert(!processExited({isError:true,details:{status:'failed',exitSignal:'SIGTERM'}}));});
