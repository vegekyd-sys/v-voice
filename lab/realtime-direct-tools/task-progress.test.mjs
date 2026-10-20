import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTaskStages,stageLine,toolStageLabel} from './task-progress.mjs';

test('one tool call is one step, whether it arrives as a tool event, an item event or both',()=>{
 let t=0;const stages=createTaskStages({now:()=>t});
 assert.equal(stages.consume({stream:'tool',data:{phase:'start',name:'web_search',toolCallId:'a'}}),true);
 assert.equal(stages.consume({stream:'item',data:{kind:'tool',phase:'start',name:'web_search',toolCallId:'a'}}),false);
 t=5;assert.deepEqual({...stages.snapshot(),events:0},{running:true,label:'上网搜索',runningSince:0,completed:0,failed:0,changedAt:0,events:0});
 assert.equal(stages.consume({stream:'item',data:{kind:'tool',phase:'end',status:'completed',toolCallId:'a'}}),true);
 assert.equal(stages.consume({stream:'tool',data:{phase:'result',toolCallId:'a'}}),false,'same call already returned');
 assert.equal(stages.consume({stream:'tool',data:{phase:'result',toolCallId:'never-started'}}),false);
 assert.equal(stages.consume({stream:'assistant',data:{text:'模型的文字不是阶段'}}),false);
 const s=stages.snapshot();assert.equal(s.running,false);assert.equal(s.completed,1);assert.equal(s.changedAt,5);
 assert.deepEqual(stages.observed().streams,{'tool/start':1,'tool/result':2,'item/tool/start':1,'item/tool/end':1,assistant:1});
});

test('a failed step is counted; an unknown tool gets no invented name',()=>{
 const stages=createTaskStages();
 stages.consume({stream:'tool',data:{phase:'start',name:'some_private_tool',toolCallId:'x'}});
 assert.equal(stages.snapshot().label,null);assert.equal(stageLine(stages.snapshot(),{elapsedMs:3000}),'后台在做下一步。');
 stages.consume({stream:'tool',data:{phase:'result',isError:true,toolCallId:'x'}});
 assert.equal(stages.snapshot().failed,1);assert.equal(stageLine(stages.snapshot(),{elapsedMs:3000}),'有一步没成功，后台还在继续。');
 assert.equal(toolStageLabel('functions.web_fetch'),'读网页');assert.equal(toolStageLabel({}),null);
});

test('spoken lines state only the running tool, returned steps and elapsed time',()=>{
 const running={running:true,label:'读网页',completed:2,failed:0};
 assert.equal(stageLine(running,{elapsedMs:9000}),'后台正在读网页。');
 assert.equal(stageLine(running,{elapsedMs:41000,heartbeat:true}),'后台还在读网页，已经40秒了。');
 assert.equal(stageLine({running:false,label:null,completed:3,failed:0},{elapsedMs:65000,heartbeat:true}),'后台已经做完3步，还在继续，已经1分钟了。');
 assert.equal(stageLine({running:false,label:null,completed:0,failed:0},{elapsedMs:92000,heartbeat:true}),'后台还在处理，已经1分半钟了。');
 for(const line of [stageLine(running,{elapsedMs:1}),stageLine({running:false,completed:0,failed:0},{elapsedMs:20000})])
  assert.doesNotMatch(line,/完成了任务|查到了|结果是/,'never claims a result');
});
