import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTaskStages,stageLine,stageKey,stepDetail,toolStageLabel,spawnedChild,IDLE_LINES,NOT_DONE_LINE,TASK_FAILED_LINE} from './task-progress.mjs';

test('one tool call is one step, whether it arrives as a tool event, an item event or both',()=>{
 let t=0;const stages=createTaskStages({now:()=>t});
 assert.equal(stages.consume({stream:'tool',data:{phase:'start',name:'web_search',toolCallId:'a',args:{query:'勇士 赛程'}}}),true);
 assert.equal(stages.consume({stream:'item',data:{kind:'tool',phase:'start',name:'web_search',toolCallId:'a'}}),false);
 t=5;assert.deepEqual(stages.snapshot(),{latest:'上网搜索',detail:'勇士 赛程',latestRunning:true,latestFailed:false,steps:1,completed:0,failed:0,changedAt:0,events:2});
 assert.equal(stages.consume({stream:'item',data:{kind:'tool',phase:'end',status:'completed',toolCallId:'a'}}),true);
 assert.equal(stages.consume({stream:'tool',data:{phase:'result',toolCallId:'a'}}),false,'same call already returned');
 assert.equal(stages.consume({stream:'tool',data:{phase:'result',toolCallId:'never-started'}}),false);
 assert.equal(stages.consume({stream:'assistant',data:{text:'模型的文字不是阶段'}}),false);
 const s=stages.snapshot();assert.equal(s.latest,'上网搜索');assert.equal(s.latestRunning,false);assert.equal(s.completed,1);assert.equal(s.changedAt,5);
 assert.deepEqual(stages.observed().streams,{'tool/start':1,'tool/result':2,'item/tool/start':1,'item/tool/end':1,assistant:1});
});

test('a new subject is news; a returned step, a shell command or an unknown tool is not',()=>{
 const stages=createTaskStages(),key=()=>stageKey(stages.snapshot());
 assert.equal(key(),'none');
 stages.consume({stream:'tool',data:{phase:'start',name:'web_search',toolCallId:'1',args:{query:'勇士 赛程'}}});const first=key();
 stages.consume({stream:'tool',data:{phase:'result',name:'web_search',toolCallId:'1'}});assert.equal(key(),first,'returning is not news');
 stages.consume({stream:'tool',data:{phase:'start',name:'exec',toolCallId:'2',args:{command:'curl x'}}});assert.equal(key(),first,'a command is not news');
 stages.consume({stream:'tool',data:{phase:'start',name:'some_private_tool',toolCallId:'3'}});assert.equal(key(),first);
 assert.equal(stages.snapshot().steps,3,'still counted as work');
 stages.consume({stream:'tool',data:{phase:'start',name:'web_search',toolCallId:'4',args:{query:'勇士 直播'}}});assert.notEqual(key(),first,'a new search is news');
 stages.consume({stream:'tool',data:{phase:'result',isError:true,toolCallId:'4'}});
 assert.equal(stageLine(stages.snapshot()),'刚才有一步没走通，我还在弄。');
});

test('only commands so far: nothing to say, and no invented subject',()=>{
 const stages=createTaskStages();
 stages.consume({stream:'tool',data:{phase:'start',name:'exec',toolCallId:'x',args:{command:'ls'}}});
 assert.equal(stages.snapshot().latest,null);assert.equal(stageLine(stages.snapshot()),null);
 stages.consume({stream:'tool',data:{phase:'start',name:'sessions_spawn',toolCallId:'y'}});assert.equal(stageLine(stages.snapshot()),null,'a sub-agent is internal');
 assert.equal(toolStageLabel('functions.web_fetch'),'读网页');assert.equal(toolStageLabel({}),null);
});

test('a step is described by its own subject: search terms, memory query, the site only',()=>{
 assert.equal(stepDetail('web_search',{query:'  Golden State Warriors 2026-27 schedule first ten games  '}),'Golden State Warriors 2026-27','cut at a word, not mid-word');
 assert.equal(stepDetail('memory_search',{query:'StackChan 放在哪'}),'StackChan 放在哪');
 assert.equal(stepDetail('web_fetch',{url:'https://www.nba.com/warriors/schedule?token=secret'}),'nba.com','no path or query string');
 assert.equal(stepDetail('web_fetch',{url:'not a url'}),null);
 assert.equal(stepDetail('read',{path:'/home/private/notes.md'}),null,'no local paths');
 assert.equal(stepDetail('exec',{command:'curl -H "Authorization: x"'}),null,'no commands');
 assert.equal(stepDetail('web_search',{query:'"引号"\n换行'}),'引号 换行');
});

test('spoken lines are V doing the work: no second party, no duration, no claim of a result',()=>{
 const step=(latest,detail,latestRunning=true)=>({latest,detail,latestRunning,latestFailed:false,steps:3,completed:2,failed:0});
 assert.equal(stageLine(step('上网搜索','勇士 赛程')),'我在查勇士 赛程。');
 assert.equal(stageLine(step('查记忆','StackChan')),'我翻翻记忆里StackChan的记录。');
 assert.equal(stageLine(step('读网页','nba.com',false)),'我在看 nba.com 上的内容。');
 assert.equal(stageLine(step('读 PDF 文档',null)),'我在读 PDF 文档。');
 for(const line of [stageLine(step('查记忆',null)),stageLine(step('生成图片',null)),'刚才有一步没走通，我还在弄。',...IDLE_LINES,NOT_DONE_LINE,TASK_FAILED_LINE]){
  assert.doesNotMatch(line,/后台|后端|模型|子任务|转交|\d+\s*秒|分钟/u,line);assert.doesNotMatch(line,/查到了|结果是/u,line);}
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
