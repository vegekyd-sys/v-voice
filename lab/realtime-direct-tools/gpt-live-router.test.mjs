import test from 'node:test';import assert from 'node:assert/strict';
import {quickRoute,fallbackRoute,createDelegationRouter,createRouterCompletion,routerCompletionFromEnv} from './gpt-live-router.mjs';
const tool=name=>({type:'function',name,description:name,parameters:{type:'object',properties:{query:{type:'string'},question:{type:'string'},topic:{type:'string'}},required:[]}});
const names=(...list)=>new Set(list);
test('time, hang-up and explanation requests are routed without a model',()=>{
  assert.deepEqual(quickRoute('现在上海几点了',names('current_time','web_search')),{name:'current_time',args:{},via:'quick'});
  assert.equal(quickRoute('今天苹果的股价现在几点更新',names('current_time','web_search')).name,'web_search'); // not a question about the time
  assert.equal(quickRoute('今天苹果的股价现在几点更新',names('current_time')),null);
  assert.deepEqual(quickRoute('好了，挂电话吧',names('end_call')),{name:'end_call',args:{},via:'quick'});
  assert.equal(quickRoute('你能挂电话吗？讲讲挂断功能是怎么做的',names('end_call')),null);
  assert.equal(quickRoute('给我讲解一下为什么天空是蓝色的',names('explain_on_board','delegate_to_v')).name,'explain_on_board');
  assert.equal(quickRoute('帮我生成一张讲解用的图片',names('explain_on_board','delegate_to_v')),null);
  assert.equal(quickRoute('',names('current_time')),null);
});
test('without a model, clear search wording searches and the rest goes to the backend agent',()=>{
  assert.deepEqual(fallbackRoute('帮我上网搜一下马斯克最近说了什么',names('web_search','delegate_to_v')),{name:'web_search',args:{query:'帮我上网搜一下马斯克最近说了什么'},via:'fallback'});
  assert.equal(fallbackRoute('帮我给妈妈发一封邮件说周末回家',names('web_search','delegate_to_v'),{userText:'发邮件'}).name,'delegate_to_v');
  assert.equal(fallbackRoute('帮我画一张小猫的图',names('web_search','delegate_to_v')).name,'delegate_to_v');
  assert.equal(fallbackRoute('随便聊聊',names()),null);
});
test('router model call names only this call\'s tools and its choice is checked against them',async()=>{
  const seen=[],events=[];
  const route=createDelegationRouter({complete:async request=>{seen.push(request);return {name:'web_search',args:{query:'苹果 股价'}};},audit:e=>events.push(e)});
  const tools=[tool('web_search'),tool('delegate_to_v')];
  assert.deepEqual(await route({text:'苹果今天怎么样',userText:'苹果今天怎么样？',tools,notes:'笔记'}),{name:'web_search',args:{query:'苹果 股价'},via:'model'});
  assert.match(seen[0].system,/笔记/u);assert.equal(seen[0].tools.length,2);
  const wrong=createDelegationRouter({complete:async()=>({name:'exec',args:{command:'rm'}}),audit:e=>events.push(e)});
  assert.equal((await wrong({text:'帮我整理一份周报发给团队',tools})).name,'delegate_to_v');
  assert(events.some(e=>e.type==='gpt-live.route-rejected'&&e.name==='exec'));
  const broken=createDelegationRouter({complete:async()=>{throw Error('HTTP 500');},audit:e=>events.push(e)});
  assert.equal((await broken({text:'帮我上网搜一下马斯克最近说了什么',tools})).via,'fallback');
});
test('chat-completions request asks for one required function and parses its arguments',async()=>{
  let body;const fetchImpl=async(url,init)=>{body=JSON.parse(init.body);assert.equal(init.headers.authorization,'Bearer key');
    return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'current_time',arguments:'{}'}}]}}]})};};
  const complete=createRouterCompletion({apiKey:'key',endpoint:'https://router.example/chat',model:'fast',extra:{thinking:{type:'disabled'}},fetchImpl});
  assert.deepEqual(await complete({system:'s',user:'u',tools:[tool('current_time')]}),{name:'current_time',args:{}});
  assert.equal(body.tool_choice,'required');assert.equal(body.tools[0].function.name,'current_time');assert.deepEqual(body.thinking,{type:'disabled'});
  await assert.rejects(createRouterCompletion({apiKey:'k',endpoint:'https://x/y',model:'m',fetchImpl:async()=>({ok:false,status:500})})({system:'',user:'',tools:[]}),/router HTTP 500/u);
});
test('router configuration reuses the board key unless it names its own',()=>{
  assert.equal(routerCompletionFromEnv({}),null);
  const complete=routerCompletionFromEnv({VOICE_BOARD_API_KEY:'k'},{fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'web_search',arguments:'{"query":"x"}'}}]}}]})})});
  assert.equal(typeof complete,'function');
});

test('today\'s agenda needs no model, another day does',()=>{
  const all=names('feishu_calendar','web_search','delegate_to_v');
  assert.deepEqual(quickRoute('我今天有什么日程安排',all),{name:'feishu_calendar',args:{},via:'quick'});
  assert.equal(quickRoute('明天有什么会',all),null);assert.equal(quickRoute('帮我安排一个会议',all),null);
  assert.equal(quickRoute('我今天有什么日程安排',names('web_search')),null);
});
test('the routing model is given the conversation so far and whether a task is running',async()=>{
  const seen=[];
  const route=createDelegationRouter({complete:async request=>{seen.push(request);return {name:'web_search',args:{query:'NBA 马刺 快船 比分'}};}});
  const tools=[tool('web_search'),tool('delegate_to_v')];
  const history=[{role:'user',text:'帮我查一下今天 NBA 的比赛结果'},{role:'tool',text:'',name:'web_search',query:'NBA 今天 比赛结果'},{role:'assistant',text:'马刺赢了快船。'},{role:'user',text:'再看一下'}];
  assert.equal((await route({text:'再看一下',userText:'再看一下',tools,history,running:false})).name,'web_search');
  assert.match(seen[0].user,/^最近对话（从早到晚）：\n用户：帮我查一下今天 NBA 的比赛结果\n（刚才用了 web_search：NBA 今天 比赛结果）\nV：马刺赢了快船。\n用户：再看一下\n后台任务：没有正在执行的\n要办的事：再看一下$/u);
  assert.match(seen[0].system,/追问、纠正或补充/u);
  await route({text:'查得怎么样了',tools,running:true});assert.match(seen[1].user,/^后台任务：有一件正在执行\n要办的事：查得怎么样了$/u);
});

test('a farewell the model delegated is the hang-up, discussing one is not',()=>{
  assert.deepEqual(quickRoute('好了，今天先这样，拜拜',names('end_call','delegate_to_v')),{name:'end_call',args:{},via:'quick'});
  assert.deepEqual(quickRoute('Okay bye',names('end_call')),{name:'end_call',args:{},via:'quick'});
  assert.equal(quickRoute('如果用户说拜拜，你的挂断功能是怎么做的',names('end_call')),null);
});

test('a lookup that says everything it needs is its own query; one that leans on the conversation is not',()=>{
  const all=names('web_search','memory_search','feishu_calendar','delegate_to_v');
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  assert.deepEqual(quickRoute('帮我查一下今天有什么科技新闻',all),{name:'web_search',args:{query:`今天有什么科技新闻 ${day}`},via:'quick'});
  assert.deepEqual(quickRoute('特斯拉的股价是多少？',all),{name:'web_search',args:{query:'特斯拉的股价是多少'},via:'quick'});
  assert.deepEqual(quickRoute('我儿子的大名叫什么',all),{name:'memory_search',args:{query:'我儿子的大名叫什么'},via:'quick'});
  for(const said of ['再看一下,具体比分是多少','那另一场的比分呢','这个多少钱','帮我把今天的新闻发到群里','你觉得学编程应该先学什么语言','天气'])assert.equal(quickRoute(said,all),null,said);
  assert.equal(quickRoute('上海今天天气怎么样',names('delegate_to_v')),null);
});

test('a story is told like a lesson, with pictures, unless something new is to be made or sent',async()=>{
  const {quickRoute}=await import('./gpt-live-router.mjs');
  const names=new Set(['explain_on_board','delegate_to_v','web_search','memory_search']);
  for(const text of ['你可以给小朋友讲个故事吗','我想听一个恐龙的故事,然后也要给我配上图片'])
    assert.deepEqual(quickRoute(text,names),{name:'explain_on_board',args:{topic:text},via:'quick'});
  for(const text of ['帮我生成一张恐龙讲故事的图','把这个故事发到群里','这个故事的作者是谁'])assert.equal(quickRoute(text,names),null);
});
