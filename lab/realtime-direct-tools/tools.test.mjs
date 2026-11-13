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
test('speaker volume takes exactly one of an absolute level or a step, and needs a speaker',async()=>{
 assert.deepEqual(validateTool('set_speaker_volume',{volume:70}),{volume:70});
 assert.deepEqual(validateTool('set_speaker_volume',{change:'down'}),{change:'down'});
 for(const args of [{},{volume:70,change:'up'},{volume:101},{volume:5.5},{change:'max'}])assert.throws(()=>validateTool('set_speaker_volume',args));
 await assert.rejects(createToolExecutor({invoke:()=>{throw Error('must not reach OpenClaw');}})('set_speaker_volume',{change:'up'},'v'),/不能调音量/);
 assert.deepEqual(await createToolExecutor({speakerVolume:async a=>({volume:a.volume})})('set_speaker_volume',{volume:30},'v'),{volume:30});
 assert.deepEqual(validateTool('look',{question:'这是什么'}),{question:'这是什么'});
 for(const args of [{},{question:''},{question:'x',zoom:2}])assert.throws(()=>validateTool('look',args));
 await assert.rejects(createToolExecutor({invoke:()=>{throw Error('must not reach OpenClaw');}})('look',{question:'这是什么'},'v'),/没有摄像头/);
 assert.deepEqual(await createToolExecutor({look:async a=>({description:a.question})})('look',{question:'这是什么'},'v'),{description:'这是什么'});
});

test('the caller\'s own words decide whether a hand-off or a search becomes a lesson', async () => {
  const {asksForLesson} = await import('./tools.mjs');
  for (const yes of ['你给十二讲解一下宝可梦', '再给我说说电动车跟现在这个低空经济的关系', '怎么摆呀？你摆给我看看', 'Could you explain how rockets land', '介绍一下它们的区别'])
    assert.equal(asksForLesson(yes), true, yes);
  for (const no of ['明天上海天气怎么样', '给我介绍一下巴黎的景点', '讲解完帮我生成一份文档', '帮我查一下日程', '有没有人可以坐的那种飞机', undefined])
    assert.equal(asksForLesson(no), false, String(no));
  // Calls 649709d0 and 4132718f: asked in these words, no lesson came.
  for (const yes of ['你可以网上先查一查今天的新闻，然后再给我讲解一下今天的事情', '那你说一下那个数码相机和以前的胶卷相机的区别', '是要有这种图标展示的那种', '具体的讲解一下', '你说一下今年发布的那个苹果的折叠屏和它的竞品的比较'])
    assert.equal(asksForLesson(yes), true, yes);
  const {lessonResearch} = await import('./tools.mjs');
  assert.equal(lessonResearch('讲解一下今天黄仁勋的事情'), 'web_search');
  assert.equal(lessonResearch('讲解一下我们的夜班模式'), 'memory_search');
  assert.equal(lessonResearch('讲解一下宝可梦的属性相克'), null);
});
