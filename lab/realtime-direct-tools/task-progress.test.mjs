import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTaskStages,stageLine,stageKey,toolStageLabel,spawnedChild} from './task-progress.mjs';

test('one tool call is one step, whether it arrives as a tool event, an item event or both',()=>{
 let t=0;const stages=createTaskStages({now:()=>t});
 assert.equal(stages.consume({stream:'tool',data:{phase:'start',name:'web_search',toolCallId:'a'}}),true);
 assert.equal(stages.consume({stream:'item',data:{kind:'tool',phase:'start',name:'web_search',toolCallId:'a'}}),false);
 t=5;assert.deepEqual(stages.snapshot(),{latest:'上网搜索',latestRunning:true,latestFailed:false,steps:1,completed:0,failed:0,changedAt:0,events:2});
 assert.equal(stages.consume({stream:'item',data:{kind:'tool',phase:'end',status:'completed',toolCallId:'a'}}),true);
 assert.equal(stages.consume({stream:'tool',data:{phase:'result',toolCallId:'a'}}),false,'same call already returned');
 assert.equal(stages.consume({stream:'tool',data:{phase:'result',toolCallId:'never-started'}}),false);
 assert.equal(stages.consume({stream:'assistant',data:{text:'模型的文字不是阶段'}}),false);
 const s=stages.snapshot();assert.equal(s.latest,'上网搜索');assert.equal(s.latestRunning,false);assert.equal(s.completed,1);assert.equal(s.changedAt,5);
 assert.deepEqual(stages.observed().streams,{'tool/start':1,'tool/result':2,'item/tool/start':1,'item/tool/end':1,assistant:1});
});

test('a quick step that already returned is still the stage; only a new kind of step or a failure changes it',()=>{
 const stages=createTaskStages(),key=()=>stageKey(stages.snapshot());
 assert.equal(key(),'none');
 stages.consume({stream:'tool',data:{phase:'start',name:'web_fetch',toolCallId:'1'}});const first=key();
 stages.consume({stream:'tool',data:{phase:'result',name:'web_fetch',toolCallId:'1'}});assert.equal(key(),first,'returning is not news');
 stages.consume({stream:'tool',data:{phase:'start',name:'exec',toolCallId:'2'}});assert.notEqual(key(),first);
 stages.consume({stream:'tool',data:{phase:'result',isError:true,toolCallId:'2'}});
 assert.equal(stageLine(stages.snapshot(),{elapsedMs:3000}),'刚才有一步没成功，后台还在继续。');
});

test('an unknown tool gets no invented name',()=>{
 const stages=createTaskStages();
 stages.consume({stream:'tool',data:{phase:'start',name:'some_private_tool',toolCallId:'x'}});
 assert.equal(stages.snapshot().latest,null);assert.equal(stageLine(stages.snapshot(),{elapsedMs:3000}),'后台在做第1步。');
 assert.equal(toolStageLabel('functions.web_fetch'),'读网页');assert.equal(toolStageLabel({}),null);
});

test('spoken lines state only the latest real step, how many there were, and elapsed time',()=>{
 const step=(latest,latestRunning,steps)=>({latest,latestRunning,latestFailed:false,steps,completed:steps-(latestRunning?1:0),failed:0});
 assert.equal(stageLine(step('读网页',true,1),{elapsedMs:9000}),'后台正在读网页。');
 assert.equal(stageLine(step('读网页',true,4),{elapsedMs:9000}),'后台正在读网页，这是第4步。');
 assert.equal(stageLine(step('读网页',false,5),{elapsedMs:9000}),'后台刚做完读网页这一步，一共做了5步，还在继续。');
 assert.equal(stageLine(step('读网页',false,5),{elapsedMs:41000,heartbeat:true}),'后台还在处理，已经40秒了，刚才在读网页。');
 assert.equal(stageLine(step('读网页',false,5),{elapsedMs:15600,heartbeat:true}),'后台还在处理，已经10秒了，刚才在读网页。','rounded down, never more than elapsed');
 assert.equal(stageLine(step(null,false,0),{elapsedMs:65000,heartbeat:true}),'后台还在处理，已经1分钟了。');
 assert.equal(stageLine(step(null,false,0),{elapsedMs:92000,heartbeat:true}),'后台还在处理，已经1分半钟了。');
 for(const line of [stageLine(step('查记忆',true,1),{elapsedMs:1}),stageLine(step(null,false,0),{elapsedMs:20000})])
  assert.doesNotMatch(line,/完成了任务|查到了|结果是/,'never claims a result');
});

test('only an accepted sub-agent spawn names a child run of this task',()=>{
 const spawn=(result,extra={})=>({stream:'tool',data:{phase:'result',name:'sessions_spawn',toolCallId:'s',result,...extra}});
 assert.deepEqual(spawnedChild(spawn({details:{status:'accepted',childSessionKey:'agent:makaron:subagent:child',runId:'child-run'}})),{runId:'child-run',sessionKey:'agent:makaron:subagent:child'});
 assert.deepEqual(spawnedChild(spawn({content:[{type:'text',text:JSON.stringify({status:'accepted',childSessionKey:'agent:makaron:subagent:c2',runId:'r2'})}]})),{runId:'r2',sessionKey:'agent:makaron:subagent:c2'});
 assert.equal(spawnedChild(spawn({details:{status:'forbidden',childSessionKey:'x',runId:'y'}})),null);
 assert.equal(spawnedChild(spawn({details:{status:'accepted',childSessionKey:'x',runId:'y'}},{isError:true})),null);
 assert.equal(spawnedChild({stream:'tool',data:{phase:'result',name:'web_search',result:{details:{status:'accepted',childSessionKey:'x',runId:'y'}}}}),null);
 assert.equal(spawnedChild(spawn({content:[{type:'text',text:'not json'}]})),null);
});
