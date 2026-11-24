import test from 'node:test';import assert from 'node:assert/strict';
import {fallbackRoute,createDelegationRouter,createRouterCompletion,routerCompletionFromEnv,GPT_LIVE_SELF_TOOL} from './gpt-live-router.mjs';
const tool=name=>({type:'function',name,description:name,parameters:{type:'object',properties:{query:{type:'string'},question:{type:'string'},topic:{type:'string'}},required:[]}});
const names=(...list)=>new Set(list);
test('no pattern decides a tool: every sentence goes to the model, and without its answer the agent decides',async()=>{
  // Sentences that fixed patterns used to decide by a word in them ("几点", "拜拜", "天气", "讲解").
  const asked=[],tools=[tool('current_time'),tool('end_call'),tool('web_search'),tool('memory_search'),tool('delegate_to_v'),GPT_LIVE_SELF_TOOL];
  const route=createDelegationRouter({complete:async request=>{asked.push(request.user);return {name:'delegate_to_v',args:{question:'x'}};}});
  for(const text of ['现在上海几点了','好了，今天先这样，拜拜','今天天气怎么样，适合带孩子去哪玩','给我讲解一下为什么天空是蓝色的','我今天有什么日程安排'])
    assert.equal((await route({text,tools})).via,'model',text);
  assert.equal(asked.length,5);
  // The model gives nothing usable: the agent is asked, in the caller's words; with no agent, nothing is done.
  assert.deepEqual(fallbackRoute('帮我上网搜一下最近的新闻',names('web_search','delegate_to_v')),{name:'delegate_to_v',args:{question:'帮我上网搜一下最近的新闻'},via:'fallback'});
  assert.deepEqual(fallbackRoute('帮我发一封邮件',names('delegate_to_v'),{userText:'发邮件'}).args,{question:'帮我发一封邮件',context:'用户原话：发邮件'});
  assert.equal(fallbackRoute('现在几点了',names('current_time','web_search')),null);assert.equal(fallbackRoute('',names('delegate_to_v')),null);
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


test('the quick choice settles a tool that takes no arguments; everything else waits for the arguments',async()=>{
  const {createDecisionsChooser,decisionsChooserFromEnv}=await import('./gpt-live-router.mjs');
  const bare=name=>({type:'function',name,description:name,parameters:{type:'object',properties:{}}});
  const tools=[bare('current_time'),bare('end_call'),tool('web_search'),tool('delegate_to_v')];
  const events=[];let aborted=false,filled=0;
  const slow=({signal})=>new Promise((resolve,reject)=>{filled++;const timer=setTimeout(()=>resolve({name:'web_search',args:{query:'今天 新闻'}}),40);signal?.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);reject(Error('aborted'));});});
  const make=choose=>createDelegationRouter({complete:slow,choose,audit:e=>events.push(e)});
  // No arguments to wait for: decided at once, and the other request is given up.
  assert.deepEqual(await make(async()=>({name:'end_call',confidence:.9}))({text:'今天先这样',tools}),{name:'end_call',args:{},via:'decision'});
  assert.equal(aborted,true);assert.equal(events.at(-1).via,'decision');
  // A tool with arguments, an unsure choice, a tool this call does not have, a failure: the arguments decide.
  for(const choose of [async()=>({name:'web_search',confidence:.99}),async()=>({name:'end_call',confidence:.3}),async()=>({name:'exec',confidence:.99}),async()=>{throw Error('decisions HTTP 500');},async()=>null]){
    aborted=false;assert.deepEqual(await make(choose)({text:'今天有什么新闻',tools}),{name:'web_search',args:{query:'今天 新闻'},via:'model'});assert.equal(aborted,false);
  }
  // Both are asked at the same moment, with the same words.
  const order=[];
  await createDelegationRouter({complete:async request=>{order.push(['model',request.user]);return {name:'web_search',args:{query:'x'}};},choose:async request=>{order.push(['decision',request.user]);await new Promise(r=>setTimeout(r,10));return {name:'web_search',confidence:1};}})({text:'查一下',tools});
  assert.deepEqual(order.map(([who])=>who),['model','decision']);assert.equal(order[0][1],order[1][1]);
  // The request and its answer on the wire.
  let sent;const choose=createDecisionsChooser({apiKey:'k',fetchImpl:async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return {ok:true,json:async()=>({answers:[{type:'choice',name:'tool',choice:'end_call',confidence:.73}]})};}});
  assert.deepEqual(await choose({system:'规则',user:'要办的事：拜拜',tools}),{name:'end_call',confidence:.73});
  assert.equal(sent.url,'https://api.openai.com/v1/decisions');assert.equal(sent.init.headers.authorization,'Bearer k');assert.equal(sent.body.model,'gpt-6-luna');
  assert.deepEqual(sent.body.input.map(item=>[item.role,item.content[0].text]),[['developer','规则'],['user','要办的事：拜拜']]);
  assert.deepEqual(sent.body.questions[0].choices.map(c=>c.value),['current_time','end_call','web_search','delegate_to_v']);assert.equal(sent.body.questions[0].type,'choice');
  await assert.rejects(createDecisionsChooser({apiKey:'k',fetchImpl:async()=>({ok:false,status:401})})({system:'',user:'',tools}),/decisions HTTP 401/u);
  assert.equal(decisionsChooserFromEnv({}),null);assert.equal(typeof decisionsChooserFromEnv({VOICE_GPT_LIVE_DECISIONS_API_KEY:'k'}),'function');
});

test('what was just said is judged by a model: probabilities with a Decisions key, yes or no from the routing model without',async()=>{
  const {createReplyJudge,replyJudgeFromEnv}=await import('./gpt-live-router.mjs');
  const history=[{role:'user',text:'今天先聊到这儿吧'},{role:'assistant',text:'好呀。'}];
  let sent;
  const judge=createReplyJudge({apiKey:'k',fetchImpl:async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return {ok:true,json:async()=>({answers:[{type:'predicate',name:'farewell',probability:.91},{type:'predicate',name:'promise',probability:.02},{type:'predicate',name:'stays',probability:.88}]})};}});
  assert.deepEqual(await judge({reply:'那就先这样，有事再找我。',userText:'谢谢你',history}),{farewell:.91,promise:.02,stays:.88});
  assert.equal(sent.url,'https://api.openai.com/v1/decisions');assert.equal(sent.body.model,'gpt-6-luna');
  assert.deepEqual(sent.body.questions.map(q=>[q.type,q.name]),[['predicate','farewell'],['predicate','promise'],['predicate','stays']]);
  assert.match(sent.body.input[1].content[0].text,/用户：今天先聊到这儿吧\nV：好呀。\n对方最后说：“谢谢你”\nV 刚才说：“那就先这样，有事再找我。”$/u);
  await assert.rejects(createReplyJudge({apiKey:'k',fetchImpl:async()=>({ok:false,status:429})})({reply:'x'}),/decisions HTTP 429/u);
  // Without the key the routing model answers each as yes or no.
  let asked;
  const plain=createReplyJudge({complete:async request=>{asked=request;return {name:'verdict',args:{farewell:false,promise:true,stays:false}};}});
  assert.deepEqual(await plain({reply:'我想想再告诉你。',userText:'这个怎么做'}),{farewell:0,promise:1,stays:0});
  assert.deepEqual(asked.tools[0].parameters.required,['farewell','promise','stays']);assert.match(asked.user,/V 刚才说：“我想想再告诉你。”$/u);
  await assert.rejects(createReplyJudge({complete:async()=>null})({reply:'x'}),/no verdict/u);
  // Neither: there is nobody to judge, and nothing is repaired.
  assert.equal(createReplyJudge({}),null);assert.equal(replyJudgeFromEnv({}),null);
  assert.equal(typeof replyJudgeFromEnv({VOICE_GPT_LIVE_DECISIONS_API_KEY:'k'}),'function');assert.equal(typeof replyJudgeFromEnv({},{complete:async()=>null}),'function');
});
