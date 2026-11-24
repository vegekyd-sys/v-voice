import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {GptLiveBridge,GPT_LIVE_MODEL,GPT_LIVE_IDENTITY,gptLiveDelegationPolicy,gptLiveInitialItems,gptLiveResultText,gptLiveText,gptLiveVoice} from './gpt-live-provider.mjs';
import {TOOL_RESULT_MAX_BYTES} from './search-result.mjs';
import {createDelegationRouter} from './gpt-live-router.mjs';
const signal=()=>({listeners:[],subscribe(fn){this.listeners.push(fn);},emit(v){for(const fn of this.listeners)fn(v);}});
function media(state){
  class RTCPeerConnection{constructor(){state.peer=this;this.onTrack=signal();this.connectionStateChange=signal();this.track={kind:'audio',onReceiveRtp:signal()};}
    addTransceiver(){return {sender:{sendRtp:async()=>{state.rtp=(state.rtp??0)+1;}},receiver:{track:this.track}};}
    async createOffer(){return {type:'offer',sdp:'v=0\r\noffer'};}async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(){}async close(){state.peerClosed=true;}}
  class OpusScript{static Application={VOIP:1};constructor(){}encode(){return Buffer.from([1,2]);}decode(packet){const b=Buffer.alloc(3840);for(let i=0;i<b.length;i+=2)b.writeInt16LE((packet?.[0]??1)*1000,i);return b;}delete(){}}
  return {werift:{RTCPeerConnection,useOPUS:o=>o,RtpHeader:class{constructor(o){Object.assign(this,o);}},RtpPacket:class{constructor(h,p){this.header=h;this.payload=p;}}},OpusScript};
}
// Stands in for the routing model: which tool is its judgement, here a fixed one per kind of sentence.
const judge=async({tools,user})=>{
  const said=user.match(/要办的事：(.*)/u)?.[1]??'',has=name=>tools.some(tool=>tool.name===name);
  if(has('explain_on_board')&&/讲解|讲讲/u.test(said))return {name:'explain_on_board',args:{topic:said}};
  if(has('end_call')&&/拜拜|挂电话/u.test(said))return {name:'end_call',args:{}};
  if(has('web_search')&&/查|搜|股价|新闻/u.test(said))return {name:'web_search',args:{query:said}};
  return null;
};
class Socket extends EventEmitter{constructor(){super();this.readyState=1;this.sent=[];}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.emit('close');}}
async function fixture({tools,route,resolveAuth,model,now,replyJudge,resume}={}){
  const events=[],calls=[],audio=[],text=[],closes=[],ws=new Socket();
  const request={instructions:'你是 V。',tools:tools??[{type:'function',name:'web_search',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{question:{type:'string'},context:{type:'string'}},required:['question']}},{type:'function',name:'exec',parameters:{type:'object',properties:{command:{type:'string'}},required:['command']}},{type:'function',name:'explain_on_board',parameters:{type:'object',properties:{topic:{type:'string'}},required:['topic']}},{type:'function',name:'end_call',parameters:{type:'object',properties:{},required:[]}}],inputSampleRate:24000,
    onToolCall:c=>calls.push(c),onAudio:(b,m)=>audio.push([b.length,m?.responseId]),onTranscript:(...a)=>text.push(a),onEvent:e=>events.push(e),onReady:()=>events.push({ready:true}),
    onError:e=>events.push({error:e.message}),onClose:r=>closes.push(r),onClearAudio:(r,m)=>events.push({clear:r,...(m??{})}),onResponseDone:e=>events.push({done:e}),onInputSpeech:(a,d)=>events.push({speech:a,...(d??{})}),onDiagnostic:d=>events.push({diag:d})};
  const fetches=[];
  const fetchImpl=async(url,init)=>{fetches.push({url,init});return {ok:true,status:201,headers:new Headers({location:'/v1/realtime/calls/rtc_u23_Em7Mvp3oMOyinaFyEylD7nKHGz6ZmT38'}),text:async()=>'v=0\r\nanswer'};};
  const bridge=new GptLiveBridge(request,{createWebSocket:async(url,options)=>{ws.url=url;ws.options=options;return ws;},resolveAuth:resolveAuth??(async()=>({token:'tok',accountId:'acct'})),loadMedia:async()=>media(ws),fetchImpl,model,
    route:route??createDelegationRouter({audit:e=>events.push(e),complete:judge}),notes:'媒体说明',...(now?{now}:{}),...(replyJudge?{judge:replyJudge}:{}),...(resume?{resume}:{})});
  return {bridge,ws,events,calls,audio,text,closes,fetches,request};
}
const item=(id,textValue)=>({type:'delegation.created',item:{id,type:'delegation',target:'client',content:[{type:'input_text',text:textValue}]},offset_ms:5000});
async function ready(f){const p=f.bridge.connect();await new Promise(r=>setTimeout(r,5));f.ws.emit('open');f.ws.emit('message',Buffer.from(JSON.stringify({type:'session.started',session:{id:f.ws.options?'rtc_u23_Em7Mvp3oMOyinaFyEylD7nKHGz6ZmT38':'x',status:'active'}})),false);await p;}

test('opens the call on the ChatGPT login over WebRTC and declares client delegation',async()=>{
  const f=await fixture({model:'gpt-live-1.1-codex'});const opening=f.bridge.connect();await new Promise(r=>setTimeout(r,5));
  assert.equal(f.fetches[0].url,'https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas');
  const {headers,body}=f.fetches[0].init,sent=JSON.parse(body);
  assert.equal(headers.Authorization,'Bearer tok');assert.equal(headers['chatgpt-account-id'],'acct');assert.equal(headers['OpenAI-Alpha'],'quicksilver=v2');
  assert.equal(sent.sdp,'v=0\r\noffer');assert.equal(sent.session.model,GPT_LIVE_MODEL);assert.deepEqual(sent.session.delegation,{type:'client'});assert.deepEqual(sent.session.audio,{output:{voice:'sol'}});
  assert.match(sent.session.instructions,/^你是 V。\nBackchannel policy:/u);assert.match(sent.session.instructions,/Delegation policy:\nBackend tools:\n- 搜索：/u);
  // The ChatGPT login ignores `instructions`; the same text is what the conversation starts with.
  assert(sent.session.initial_items.length>=1);assert(sent.session.initial_items.every(i=>i.type==='message'&&i.role==='developer'&&i.content.length===1&&i.content[0].type==='input_text'));
  assert.equal(sent.session.initial_items.map(i=>i.content[0].text).join('\n'),sent.session.instructions);
  f.ws.emit('open');assert.equal(f.ws.url,'wss://api.openai.com/v1/live/rtc_u23_Em7Mvp3oMOyinaFyEylD7nKHGz6ZmT38');assert.equal(f.ws.options.headers['OpenAI-Alpha'],'quicksilver=v2');
  f.ws.emit('message',Buffer.from(JSON.stringify({type:'session.started',session:{id:'rtc_x'}})),false);await opening;
  assert.deepEqual(f.events.filter(e=>e.ready),[{ready:true}]);assert.equal(f.bridge.ready,true);
  f.ws.peer.connectionStateChange.emit('connected');f.bridge.sendAudio(Buffer.alloc(960));await new Promise(r=>setTimeout(r,30));assert(f.ws.rtp>=1);
  f.bridge.close();assert.equal(f.ws.peerClosed,true);assert.equal(f.ws.readyState,3);assert.deepEqual(f.closes,['completed']);
});

const say=(f,id,textValue)=>f.ws.emit('message',Buffer.from(JSON.stringify(item(id,textValue))),false);
const appends=f=>f.ws.sent.filter(e=>e.type.endsWith('context.append'));
const idOf=n=>'item_'+String(n).padStart(24,'A');
test('a short lookup is one direct tool call and its result is spoken on the same delegation',async()=>{
  const f=await fixture();await ready(f);
  f.ws.emit('message',Buffer.from(JSON.stringify({type:'turn.done',turn:{id:'turn_1',role:'user',transcript:'帮我上网查一下今天苹果的股价'}})),false);
  say(f,idOf(1),'帮我上网查一下今天苹果的股价');await new Promise(r=>setTimeout(r,5));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].callId,idOf(1));assert.equal(f.calls[0].name,'web_search');
  f.bridge.submitToolResult(idOf(1),{content:[{type:'text',text:'{"results":[{"title":"AAPL","snippet":"312.45 美元"}]}'}],details:{results:[{title:'AAPL',snippet:'312.45 美元'}]}});
  const sent=appends(f);assert.equal(sent.length,1);
  assert.deepEqual({type:sent[0].type,id:sent[0].delegation_item_id,channel:sent[0].channel},{type:'delegation.context.append',id:idOf(1),channel:'speakable'});
  assert.match(sent[0].content[0].text,/^web_search：[\s\S]*AAPL：312\.45 美元/u);
  f.bridge.submitToolResult(idOf(1),{again:true});assert.equal(appends(f).length,1); // answered once
});
test('a long task is acknowledged at once and its result is spoken when it comes back',async()=>{
  const f=await fixture();await ready(f);say(f,idOf(2),'帮我调研三款扫地机器人写成报告');await new Promise(r=>setTimeout(r,5));
  assert.equal(f.calls[0].name,'delegate_to_v');
  f.bridge.beginBackgroundTool(idOf(2),'调研');
  assert.equal(appends(f)[0].channel,'commentary');assert.match(appends(f)[0].content[0].text,/^已受理，正在办[\s\S]*不用再说一遍/u);
  f.bridge.completeBackgroundTool(idOf(2),{result:'完整报告'.repeat(100)},{spokenText:'报告写好了，推荐石头 P20。',displayedFullResult:true});
  const sent=appends(f);
  assert.equal(sent.at(-1).channel,'speakable');assert.match(sent.at(-1).content[0].text,/报告写好了，推荐石头 P20。/u);
  assert(sent.some(e=>e.channel==='commentary'&&/完整结果/u.test(e.content[0].text)));
  assert(sent.every(e=>Buffer.byteLength(e.content[0].text)<=480));
  f.bridge.completeBackgroundTool(idOf(2),{result:'再来一次'});assert.equal(appends(f).length,sent.length);
});
test('an explanation is prepared in the background and its script is given to be read as written',async()=>{
  const f=await fixture({tools:[{type:'function',name:'explain_on_board',parameters:{type:'object',properties:{topic:{type:'string'}},required:['topic']}},{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{question:{type:'string'}},required:['question']}}]});
  await ready(f);say(f,idOf(3),'给我讲解一下为什么天空是蓝色的');await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(f.calls[0],{callId:idOf(3),name:'explain_on_board',args:{topic:'给我讲解一下为什么天空是蓝色的'}});
  f.bridge.beginBackgroundTool(idOf(3),'天空');
  assert.equal(appends(f).length,1);assert.equal(appends(f)[0].channel,'commentary');assert.match(appends(f)[0].content[0].text,/^讲解稿正在准备[\s\S]*不用再说话/u);
  const script='天空为什么是蓝的呢？'+'太阳光里有七种颜色，蓝光最容易被空气分子撞得四处乱飞。'.repeat(12);
  f.bridge.completeBackgroundTool(idOf(3),{result:script},{spokenText:script,displayedFullResult:true});
  const said=appends(f);
  const spoken=said.filter(e=>e.channel==='speakable').map(e=>e.content[0].text).join('');assert.match(spoken,/^下面是写好的讲稿[^<]*从第一句开始[^<]*讲稿要一口气完整讲完[^<]*原样念出 <say> 里的内容[^<]*<say>天空/u);assert.equal(said.at(-1).channel,'speakable');assert.match(said.at(-1).content[0].text,/<\/say>$/u);
  assert.match(said.at(-1).content[0].text,/蓝光/u); // the script is not a result the model should paraphrase
  f.bridge.completeBackgroundTool(idOf(3),{cancelled:true});
  assert.equal(appends(f).length,said.length);
});
test('completions for tasks this bridge never began are ignored',async()=>{
  const f=await fixture();await ready(f);
  f.bridge.completeBackgroundTool(idOf(4),{cancelled:true});
  assert.equal(appends(f).length,0);
  f.bridge.completeBackgroundTool(idOf(4),{result:'x'},{spokenText:'x'});
  assert.equal(appends(f).length,0);
  f.bridge.completeBackgroundTool(idOf(4),{cancelled:true});assert.equal(appends(f).length,0);
});
test('a failed lookup is said to have failed and unknown tools are refused by the router, never invented',async()=>{
  const calls=[];
  const f=await fixture({route:async({text,tools})=>{calls.push(text);return tools.some(t=>t.name==='nope')?{name:'nope',args:{}}:null;}});await ready(f);
  f.bridge.receive({type:'delegation.created',item:{id:idOf(5),type:'delegation',target:'client',content:[{type:'input_text',text:'做一件办不了的事'}]}});await new Promise(r=>setTimeout(r,5));
  assert.equal(f.calls.length,0);assert.equal(appends(f).at(-1).channel,'speakable');assert.match(appends(f).at(-1).content[0].text,/办不了/u);
  assert.equal(gptLiveResultText('web_search',{error:'timeout'}),'没有成功：timeout');
  assert.equal(gptLiveResultText('current_time',{now:'2026-11-20 09:30:00',timezone:'Asia/Shanghai'}),'{"now":"2026-11-20 09:30:00","timezone":"Asia/Shanghai"}');
  assert.equal(gptLiveResultText('web_search',{content:[{type:'text',text:'{"a":1}'}],details:{a:1}}),'{"a":1}');
  // A page is given whole, up to the budget every model has; only past it is it cut.
  assert.equal(gptLiveResultText('web_fetch','长'.repeat(5000)),'长'.repeat(5000));
  const over=gptLiveResultText('web_fetch','长'.repeat(20000));
  assert(Buffer.byteLength(over)<=TOOL_RESULT_MAX_BYTES&&over.endsWith(' [已截断]')&&Array.from(over).length>10000);
});
test('a day of meetings reaches GPT Live whole, as it reaches Doubao (cut at 2,400 it saw three of six)',()=>{
  const meeting=i=>({event_id:`evt-${i}`,summary:`示例会议 ${i}`,description:'议程：同步进展、确认下周计划、讨论风险和分工。',start_time:{timestamp:String(1795000000+i*3600),timezone:'Asia/Shanghai'},end_time:{timestamp:String(1795001800+i*3600),timezone:'Asia/Shanghai'},status:'confirmed',location:{name:`示例会议室 ${i}`},app_link:`https://applink.example.com/calendar/event?key=evt-${i}&startTime=${1795000000+i*3600}`});
  for(const count of [6,12]){
    const value={ok:true,data:{items:Array.from({length:count},(_,i)=>meeting(i+1))}};
    const text=gptLiveResultText('feishu_calendar',{content:[{type:'text',text:JSON.stringify(value)}],details:{status:'completed'}});
    assert.doesNotMatch(text,/已截断/u);
    for(let i=1;i<=count;i++)assert.match(text,new RegExp(`示例会议 ${i}"`,'u'));
  }
});
test('barge-in clears playback and mutes until V is given something to say or starts a new turn',async()=>{
  let clock=1000;const f=await fixture({now:()=>clock});await ready(f);f.ws.peer.connectionStateChange.emit('connected');
  const loud=()=>{const b=Buffer.alloc(960);b.writeInt16LE(5000,0);return b;};
  f.bridge.receive({type:'turn.created',turn:{id:'t1',role:'assistant'}});
  f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:1},payload:Buffer.from([1])});assert.equal(f.audio.length,1);
  f.bridge.receive({type:'turn.created',turn:{id:'u2',role:'user',transcript:'等'}});
  assert.deepEqual(f.events.find(e=>e.clear),{clear:'barge-in',retiredResponseId:'t1'});
  f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:2},payload:Buffer.from([2])});assert.equal(f.audio.length,1); // tail of the cut reply
  // The answer V is given unmutes it, once the in-flight tail has passed.
  clock+=100;f.bridge.submitToolResult('nope',{});f.bridge.completeBackgroundTool('nope',{result:'x'});
  f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:3},payload:Buffer.from([3])});assert.equal(f.audio.length,1);
  f.bridge.receive({type:'delegation.created',item:{id:'d1',type:'delegation',target:'client',content:[{type:'input_text',text:'讲解一下'}]}});await new Promise(r=>setTimeout(r,5));
  clock+=100;f.bridge.beginBackgroundTool('d1','x');f.bridge.completeBackgroundTool('d1',{result:'讲稿'},{spokenText:'讲稿',displayedFullResult:true});
  f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:4},payload:Buffer.from([4])});assert.equal(f.audio.length,1); // still inside the tail window
  clock+=300;f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:5},payload:Buffer.from([5])});assert.equal(f.audio.length,2);
  // A new assistant turn unmutes; the cut reply's in-flight tail is still dropped briefly.
  f.bridge.handleBargeIn();f.bridge.receive({type:'turn.created',turn:{id:'t2',role:'assistant'}});
  f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:6},payload:Buffer.from([6])});assert.equal(f.audio.length,2);
  clock+=300;f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:7},payload:Buffer.from([7])});assert.equal(f.audio.length,3);
});
test('policy text names only what this call may do, and voices are a closed set',()=>{
  const policy=gptLiveDelegationPolicy(new Set(['web_search','current_time','delegate_to_v','end_call']),{display:false});
  assert.match(policy,/^Backchannel policy:[^\n]+\nInterruption policy:[^\n]+\nDelegation policy:\nBackend tools:\n- 搜索：/u);assert.match(policy,/\nDelegate to the backend when:\n/u);assert.match(policy,/\nDo not delegate when:\n/u);
  assert.match(policy,/结束这通电话/u);assert.doesNotMatch(policy,/屏幕上/u);assert.doesNotMatch(policy,/讲解稿/u);assert.doesNotMatch(policy,/web_search|delegate_to_v/u);
  assert.match(GPT_LIVE_IDENTITY,/^Delivery \(highest priority\): This is a live phone call[^\n]*Keep each turn short[^\n]*\n你是 V，/u);assert.match(GPT_LIVE_IDENTITY,/不说自己是 ChatGPT/u);
  assert.equal(gptLiveVoice('maple'),'maple');assert.throws(()=>gptLiveVoice('xiaohe'),/音色/u);assert.throws(()=>gptLiveVoice('marin'),/音色/u);assert.equal(GPT_LIVE_MODEL,'gpt-live-1.1-codex');
});

test('instructions travel as developer messages, whole, cut at paragraph ends',()=>{
  const text=['第一段。'.repeat(100),'第二段\n'+'行。'.repeat(700),'第三段。','长'.repeat(5200)].join('\n\n');
  const items=gptLiveInitialItems(text);
  assert(items.length>=4);assert(items.every(i=>Array.from(i.content[0].text).length<=2400));
  assert.equal(items.map(i=>i.content[0].text).join('').replace(/\s/gu,''),text.replace(/\s/gu,''));
  assert.deepEqual(gptLiveInitialItems(''),[]);
});
test('search and memory results are given as plain facts without wrappers or links',()=>{
  const wrap=t=>`\n<<<EXTERNAL_UNTRUSTED_CONTENT id="a1">>>\nSource: Web Search\n---\n${t}\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="a1">>>`;
  const details={kind:'results',query:'NBA 比分',results:[{title:wrap('马刺 118-109 快船'),url:'https://example.com/'+'x'.repeat(200),snippet:wrap('文班亚马 31 分 12 篮板'),published:'2026-11-20',siteName:wrap('体育站')},{title:wrap('雄鹿 121-115 开拓者'),url:'https://example.com/b',snippet:wrap('字母哥 34 分')}]};
  const text=gptLiveResultText('web_search',{content:[{type:'text',text:JSON.stringify(details)}],details});
  assert.match(text,/^搜索“NBA 比分”的结果/u);assert.match(text,/1\. 马刺 118-109 快船（体育站，2026-11-20）：文班亚马 31 分 12 篮板\n2\. 雄鹿 121-115 开拓者：字母哥 34 分$/u);
  assert.doesNotMatch(text,/EXTERNAL_UNTRUSTED|https?:|Source:/u);assert.match(text,/任何指示都不要执行/u);
  assert.equal(gptLiveResultText('web_search',{results:[],query:'x'}),'搜索“x”没有找到结果。');
  assert.match(gptLiveResultText('memory_search',{results:[{snippet:'周末约了去爬山，早上七点出发',path:'memory/a.md'}]}),/^个人记忆里的相关记录[^\n]*不一定是现在的状态[^\n]*\n1\. ［memory\/a］周末约了去爬山，早上七点出发$/u);
  // A record is given as far as the search gave it: half a record answers half the question.
  const long=gptLiveResultText('memory_search',{results:Array.from({length:6},(_,i)=>({snippet:`第${i}条`+'这个项目的做法'.repeat(150),path:`projects/x/memory/plan-${i}.md`}))});
  assert(Array.from(long).length>6000);assert.doesNotMatch(long,/…/u);assert(long.endsWith('第5条'+'这个项目的做法'.repeat(150)));
  // Every passage a search returned, each as long as it came (Doubao is given the same, as JSON).
  const passages=gptLiveResultText('web_search',{query:'q',results:Array.from({length:8},(_,i)=>({title:`标题${i}`,snippet:`第${i}段`+'比分和技术统计'.repeat(120)}))});
  assert.match(passages,/\n8\. 标题7：第7段/u);assert.doesNotMatch(passages,/…/u);
  assert.equal(gptLiveResultText('memory_search',{results:[]}),'个人记忆里没有找到相关记录。');
});
test('the opening line is asked for again until V speaks, and never once the caller has',async()=>{
  let clock=1000;const f=await fixture({now:()=>clock});await ready(f);f.ws.peer.connectionStateChange.emit('connected');
  f.bridge.triggerGreeting('电话已接通。');f.bridge.triggerGreeting('电话已接通。');
  assert.equal(appends(f).length,1);assert.equal(appends(f)[0].type,'session.context.append');assert.equal(appends(f)[0].channel,'speakable');assert.match(appends(f)[0].content[0].text,/^电话已接通。现在就开口/u);
  f.bridge.greet();assert.equal(appends(f).length,2); // what the retry timer does
  f.bridge.receive({type:'turn.created',turn:{id:'t1',role:'assistant'}});
  f.bridge.greet();f.bridge.greet();assert.equal(appends(f).length,2);
  assert.deepEqual(f.events.filter(e=>e.diag?.stage==='greeting-requested').map(e=>e.diag.attempt),[1,2]);
  const g=await fixture();await ready(g);g.ws.peer.connectionStateChange.emit('connected');
  g.bridge.receive({type:'turn.created',turn:{id:'u1',role:'user'}});g.bridge.triggerGreeting('电话已接通。');
  assert.equal(appends(g).length,0); // the caller spoke first
  const k=await fixture();await ready(k);k.ws.peer.connectionStateChange.emit('connected');
  k.bridge.triggerGreeting('电话已接通。');k.bridge.receive({type:'turn.created',turn:{id:'u1',role:'user'}});k.bridge.receive({type:'turn.created',turn:{id:'u2',role:'user'}});
  assert.deepEqual(appends(k).map(e=>e.channel),['speakable','commentary']);assert.match(appends(k)[1].content[0].text,/不用再单独打招呼/u);
  k.bridge.greet();assert.equal(appends(k).length,2);k.bridge.close();
  const h=await fixture();await ready(h);h.ws.peer.connectionStateChange.emit('connected');
  h.bridge.triggerGreeting('x');h.bridge.greet();h.bridge.greet();h.bridge.greet();h.bridge.greet();assert.equal(appends(h).length,3); // bounded
  f.bridge.close();g.bridge.close();h.bridge.close();
});
test('a follow-up is routed with the conversation so far and task controls only while a task runs',async()=>{
  const seen=[];
  const f=await fixture({tools:[{type:'function',name:'web_search',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},{type:'function',name:'openclaw_agent_control',parameters:{type:'object',properties:{},required:[]}},{type:'function',name:'cancel_task',parameters:{type:'object',properties:{},required:[]}},{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{question:{type:'string'}},required:['question']}}],
    route:async request=>{seen.push(request);return {name:seen.length===3?'delegate_to_v':'web_search',args:seen.length===3?{question:'写报告'}:{query:'NBA 比分'}};}});
  await ready(f);
  const turn=(role,id,transcript)=>{f.bridge.receive({type:'turn.created',turn:{id,role}});f.bridge.receive({type:'turn.done',turn:{id,role,transcript}});};
  turn('user','u1','帮我查一下今天 NBA 的比赛结果');say(f,idOf(11),'帮我查一下今天 NBA 的比赛结果');await new Promise(r=>setTimeout(r,5));
  f.bridge.submitToolResult(idOf(11),{results:[{title:'马刺 118-109 快船',snippet:'文班亚马 31 分'}]});
  turn('assistant','a1','马刺赢了快船。');turn('user','u2','再看一下，具体比分是多少');say(f,idOf(12),'再看一下，具体比分是多少');await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(seen[1].history.map(e=>e.role),['user','tool','assistant','user']);
  assert.deepEqual(seen[1].history[1],{role:'tool',text:'',name:'web_search',query:'NBA 比分'});assert.equal(seen[1].history[0].text,'帮我查一下今天 NBA 的比赛结果');
  assert.equal(seen[1].running,false);assert.deepEqual(seen[1].tools.map(t=>t.name),['web_search','delegate_to_v','answer_directly']);
  say(f,idOf(13),'帮我写一份报告');await new Promise(r=>setTimeout(r,5));f.bridge.beginBackgroundTool(idOf(13),'写报告');
  say(f,idOf(14),'查得怎么样了');await new Promise(r=>setTimeout(r,5));
  assert.equal(seen[3].running,true);assert(seen[3].tools.some(t=>t.name==='openclaw_agent_control')&&seen[3].tools.some(t=>t.name==='cancel_task'));
  f.bridge.close();
});
test('a reply reported in pieces and again whole is passed on once',async()=>{
  const f=await fixture();await ready(f);
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});
  f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'你好，'});f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'我是 V。'});
  f.bridge.receive({type:'turn.done',turn:{id:'a1',role:'assistant',transcript:'你好，我是 V。'}});
  f.bridge.receive({type:'turn.created',turn:{id:'a2',role:'assistant'}});
  f.bridge.receive({type:'turn.done',turn:{id:'a2',role:'assistant',transcript:'在呢。'}});
  assert.deepEqual(f.text.filter(a=>a[0]==='assistant').map(a=>[a[1],a[2]]),[['你好，',false],['我是 V。',false],['你好，我是 V。',true],['在呢。',false],['在呢。',true]]);
  f.bridge.close();
});

test('choosing the tool starts when the caller stops speaking and is used by the delegation that follows',async()=>{
  const seen=[];let release;
  const f=await fixture({route:request=>{seen.push(request);return new Promise(resolve=>{release=()=>resolve({name:'web_search',args:{query:'英伟达 股价'}});});}});
  await ready(f);
  f.bridge.receive({type:'turn.created',turn:{id:'u1',role:'user'}});
  f.bridge.receive({type:'turn.done',turn:{id:'u1',role:'user',transcript:'英伟达 现在 的 股价 是 多少'}});
  assert.equal(seen.length,1);assert.equal(seen[0].speculative,true);assert.equal(seen[0].text,'英伟达现在的股价是多少');assert.equal(f.calls.length,0); // nothing runs before the model delegates
  say(f,idOf(21),'英伟达现在的股价是多少?');await new Promise(r=>setTimeout(r,5));
  assert.equal(seen.length,1);release();await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(f.calls.map(c=>[c.callId,c.name]),[[idOf(21),'web_search']]);
  // Different words are routed on their own; a short backchannel starts nothing.
  f.bridge.receive({type:'turn.done',turn:{id:'u2',role:'user',transcript:'嗯'}});assert.equal(seen.length,1);
  f.bridge.receive({type:'turn.done',turn:{id:'u3',role:'user',transcript:'上海今天天气怎么样'}});assert.equal(seen.length,2);
  say(f,idOf(22),'帮我查一下明天的天气');await new Promise(r=>setTimeout(r,5));assert.equal(seen.length,3);assert.equal(seen[2].speculative,undefined);
  release();await new Promise(r=>setTimeout(r,5));assert.equal(f.calls.length,2);
  assert.equal(gptLiveText('现在 几 点 了'),'现在几点了');assert.equal(gptLiveText(' What time is it '),'What time is it');assert.equal(gptLiveText('[lip smack] 嗨,天懿 [laugh]\uFFFD'),'嗨,天懿');assert.equal(gptLiveText('见 [1] 和 [A]'),'见 [1] 和 [A]');
  f.bridge.close();
});

test('a tool call waits for the caller\'s turn to be final and is not routed twice',async()=>{
  const seen=[];
  const f=await fixture({route:async request=>{seen.push(request);return {name:'end_call',args:{}};}});await ready(f);
  f.bridge.receive({type:'turn.created',turn:{id:'u1',role:'user'}});
  say(f,idOf(31),'好了,今天先这样,拜拜');await new Promise(r=>setTimeout(r,10));
  assert.equal(seen.length,1);assert.equal(f.calls.length,0); // routed, held: the caller's words are not final yet
  f.bridge.receive({type:'turn.done',turn:{id:'u1',role:'user',transcript:'好了,今天先这样,拜拜'}});await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(f.calls.map(c=>c.name),['end_call']);assert.equal(seen.length,1); // the final words are the ones already routed
  assert.deepEqual(f.text.filter(a=>a[0]==='user'&&a[2]).map(a=>a[1]),['好了,今天先这样,拜拜']);
  f.bridge.close();
});

test('a reply is reported finished after its last audio, never before',async()=>{
  let clock=1000;const f=await fixture({now:()=>clock});await ready(f);f.ws.peer.connectionStateChange.emit('connected');
  const rtp=n=>f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:n},payload:Buffer.from([n])});
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});rtp(1);
  f.bridge.receive({type:'turn.done',turn:{id:'a1',role:'assistant',transcript:'好，我讲讲。'}});
  clock+=300;rtp(2);
  assert.deepEqual(f.audio.map(a=>a[1]),['a1','a1']);assert.equal(f.events.filter(e=>e.done).length,0); // the tail belongs to the reply
  f.bridge.finishReply(); // what the tail timer does
  assert.deepEqual(f.events.filter(e=>e.done).map(e=>e.done),[{responseId:'a1',status:'completed'}]);
  clock+=100;rtp(3);assert.equal(f.audio.length,2); // nothing is passed on as a reply that never ends
  // The next reply settles the previous one first.
  f.bridge.receive({type:'turn.created',turn:{id:'a2',role:'assistant'}});f.bridge.receive({type:'turn.done',turn:{id:'a2',role:'assistant',transcript:'一'}});
  f.bridge.receive({type:'turn.created',turn:{id:'a3',role:'assistant'}});
  assert.deepEqual(f.events.filter(e=>e.done).map(e=>e.done.responseId),['a1','a2']);
  f.bridge.receive({type:'turn.done',turn:{id:'a3',role:'assistant',transcript:'二'}});f.bridge.close();
  assert.deepEqual(f.events.filter(e=>e.done).map(e=>e.done.responseId),['a1','a2','a3']);
});

test('an explanation the model promised but never delegated is prepared anyway, once',async()=>{
  const f=await fixture({tools:[{type:'function',name:'explain_on_board',parameters:{type:'object',properties:{topic:{type:'string'}},required:['topic']}},{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{question:{type:'string'}},required:['question']}}]});
  await ready(f);
  f.bridge.receive({type:'turn.created',turn:{id:'u1',role:'user'}});
  f.bridge.receive({type:'turn.done',turn:{id:'u1',role:'user',transcript:'给小朋友讲讲恐龙是怎么灭绝的'}});
  await new Promise(r=>setTimeout(r,2600));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'explain_on_board');assert.match(f.calls[0].callId,/^host_1$/u);
  assert.deepEqual(f.events.filter(e=>e.diag?.stage==='lesson-unprompted').length,1);
  f.bridge.beginBackgroundTool('host_1','恐龙');
  f.bridge.completeBackgroundTool('host_1',{result:'很久很久以前。'},{spokenText:'很久很久以前。',displayedFullResult:true});
  const sent=appends(f);
  assert(sent.every(e=>e.type==='session.context.append'&&e.delegation_item_id===undefined)); // no delegation exists for it
  assert.match(sent.at(-1).content[0].text,/<say>很久很久以前。<\/say>$/u);assert.equal(sent.at(-1).channel,'speakable');
  say(f,idOf(41),'给小朋友讲讲恐龙是怎么灭绝的');await new Promise(r=>setTimeout(r,10));
  assert.equal(f.calls.length,1); // the late delegation is already served
  // A delegation in time uses the choice and nothing is started twice.
  f.bridge.receive({type:'turn.done',turn:{id:'u2',role:'user',transcript:'给我讲解一下光合作用'}});
  say(f,idOf(42),'给我讲解一下光合作用');await new Promise(r=>setTimeout(r,2700));
  assert.deepEqual(f.calls.map(c=>c.callId),['host_1',idOf(42)]);
  // Other intents are never started without the model.
  f.bridge.receive({type:'turn.done',turn:{id:'u3',role:'user',transcript:'上海今天天气怎么样'}});await new Promise(r=>setTimeout(r,2700));
  assert.equal(f.calls.length,2);
  f.bridge.close();
});

test('the caller\'s unfinished words are never passed on as a transcript',async()=>{
  // Every consumer (the page's bubbles, the board) takes an unfinished transcript for V speaking.
  const f=await fixture();await ready(f);
  f.bridge.receive({type:'turn.created',turn:{id:'u1',role:'user'}});
  f.bridge.receive({type:'turn.delta',turn_id:'u1',delta:'你就'});f.bridge.receive({type:'turn.delta',turn_id:'u1',delta:'简单介绍一下'});
  assert.deepEqual(f.text,[]);
  f.bridge.receive({type:'turn.done',turn:{id:'u1',role:'user',transcript:'嗯，你就简单介绍一下'}});
  assert.deepEqual(f.text.map(a=>a.slice(0,3)),[['user','嗯，你就简单介绍一下',true]]);
  f.bridge.close();
});
const LESSON=[{type:'function',name:'explain_on_board',parameters:{type:'object',properties:{topic:{type:'string'}},required:['topic']}},{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{question:{type:'string'}},required:['question']}}];
const assistant=f=>f.text.filter(a=>a[0]==='assistant').map(a=>[a[1],a[2],a[3]]);
test('V begins speaking before its reply is announced: the beginning is kept and goes out with the reply',async()=>{
  let clock=1000;const f=await fixture({now:()=>clock});await ready(f);f.ws.peer.connectionStateChange.emit('connected');
  const rtp=(n,v)=>f.ws.peer.track.onReceiveRtp.emit({header:{sequenceNumber:n,timestamp:n*960},payload:Buffer.from([v])});
  let seq=0;const say=v=>{rtp(++seq,v);clock+=20;};
  // A reply said and over.
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});say(1);f.bridge.receive({type:'turn.done',turn:{id:'a1',role:'assistant',transcript:'好。'}});f.bridge.finishReply();
  assert.equal(f.audio.length,1);clock+=2000;
  // V's next reply is heard after a pause, before the event that announces it: nothing goes out yet ...
  const quiet=n=>{for(let i=0;i<n;i++)say(0);};
  quiet(12);say(2);say(3);say(0);say(4);
  assert.equal(f.audio.length,1);
  // ... and all of it from where V began goes out first when the reply is announced, as that reply's.
  f.bridge.receive({type:'turn.created',turn:{id:'a2',role:'assistant'}});
  assert.deepEqual(f.audio.slice(1).map(a=>a[1]),['a2','a2','a2','a2']);
  const early=f.events.find(e=>e.diag?.stage==='media-early');assert.ok(early.diag.earlyMs>0);
  say(5);assert.equal(f.audio.length,6);assert.equal(f.audio.at(-1)[1],'a2');
  f.bridge.receive({type:'turn.done',turn:{id:'a2',role:'assistant',transcript:'嗯，我想想。'}});f.bridge.finishReply();
  // Sound that goes straight on from a reply that is over is its end, not a beginning: still dropped.
  say(6);say(7);f.bridge.receive({type:'turn.created',turn:{id:'a3',role:'assistant'}});assert.equal(f.audio.length,6);
  f.bridge.receive({type:'turn.done',turn:{id:'a3',role:'assistant',transcript:'一'}});f.bridge.finishReply();
  // A beginning heard long before any reply is announced is not one.
  clock+=1000;quiet(12);say(8);clock+=1500;
  f.bridge.receive({type:'turn.created',turn:{id:'a4',role:'assistant'}});assert.equal(f.audio.length,6);
  f.bridge.receive({type:'turn.done',turn:{id:'a4',role:'assistant',transcript:'二'}});f.bridge.finishReply();
  // Nor the reply the caller has just cut off, whose last packets are still arriving.
  clock+=2000;f.bridge.receive({type:'turn.created',turn:{id:'a5',role:'assistant'}});say(1);assert.equal(f.audio.length,7);
  f.bridge.receive({type:'turn.created',turn:{id:'u9',role:'user'}});
  quiet(12);say(9);
  f.bridge.receive({type:'turn.created',turn:{id:'a6',role:'assistant'}});assert.equal(f.audio.length,7);
});
test('a script being read is captioned as it was written, as far as the voice has got',async()=>{
  const f=await fixture({tools:LESSON});await ready(f);say(f,idOf(3),'给我讲解一下为什么天空是蓝色的');await new Promise(r=>setTimeout(r,5));
  f.bridge.beginBackgroundTool(idOf(3),'天空');
  // Said while the script is written: an ordinary reply, shown as soon as it is known not to be the script.
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'好,'});
  f.bridge.receive({type:'turn.done',turn:{id:'a1',role:'assistant',transcript:'好,我讲讲。'}});
  const script='阳光看着是白的，其实混着各种颜色。穿过空气时，蓝光最容易被撞散。所以抬头看，到处都是蓝光。';
  f.bridge.completeBackgroundTool(idOf(3),{result:script},{spokenText:script,displayedFullResult:true});
  f.text.length=0;
  // The model's own text: other punctuation, no spaces. Nothing is shown until it is known to be the script.
  f.bridge.receive({type:'turn.created',turn:{id:'a2',role:'assistant'}});
  f.bridge.receive({type:'turn.delta',turn_id:'a2',delta:'阳光看'});assert.deepEqual(assistant(f),[]);
  f.bridge.receive({type:'turn.delta',turn_id:'a2',delta:'着是白的,其实'});
  assert.deepEqual(assistant(f),[['阳光看着是白的，其实',false,'V-backend-summary']]);
  f.bridge.receive({type:'turn.delta',turn_id:'a2',delta:'混着各种颜色。穿过'});
  assert.deepEqual(assistant(f).at(-1),['混着各种颜色。穿过',false,'V-backend-summary']);
  // Cut off by the caller: what was read is final, in the script's own words.
  f.bridge.receive({type:'turn.done',turn:{id:'a2',role:'assistant',transcript:'阳光看着是白的,其实混着各种颜色。穿过'}});
  assert.deepEqual(assistant(f).at(-1),['阳光看着是白的，其实混着各种颜色。穿过',true,'V-backend-summary']);
  // The reading picks up where it stopped: still the script, from that place.
  f.text.length=0;
  f.bridge.receive({type:'turn.created',turn:{id:'a3',role:'assistant'}});
  f.bridge.receive({type:'turn.delta',turn_id:'a3',delta:'空气时,蓝光最容易'});
  assert.deepEqual(assistant(f),[['空气时，蓝光最容易',false,'V-backend-summary']]);
  f.bridge.receive({type:'turn.done',turn:{id:'a3',role:'assistant',transcript:'空气时,蓝光最容易被撞散。所以抬头看,到处都是蓝光。'}});
  assert.deepEqual(assistant(f).at(-1),['空气时，蓝光最容易被撞散。所以抬头看，到处都是蓝光。',true,'V-backend-summary']);
  // Read to its end: what V says next is an ordinary reply again, shown from its first word.
  f.text.length=0;
  f.bridge.receive({type:'turn.created',turn:{id:'a4',role:'assistant'}});f.bridge.receive({type:'turn.delta',turn_id:'a4',delta:'对'});
  assert.deepEqual(assistant(f),[['对',false,undefined]]);
  f.bridge.close();
});
test('a reply that is not the script is shown as an ordinary reply while a script waits',async()=>{
  const f=await fixture({tools:LESSON});await ready(f);say(f,idOf(3),'给我讲解一下为什么天空是蓝色的');await new Promise(r=>setTimeout(r,5));
  f.bridge.beginBackgroundTool(idOf(3),'天空');
  f.bridge.completeBackgroundTool(idOf(3),{result:'阳光看着是白的，其实混着各种颜色。'},{spokenText:'阳光看着是白的，其实混着各种颜色。',displayedFullResult:true});
  f.text.length=0;
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});
  f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'等一下,'});assert.deepEqual(assistant(f),[]);
  // Held while it could still turn out to be the script with its opening put differently.
  f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'你刚才说什么来着?我没听清,'});assert.deepEqual(assistant(f),[]);
  f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'是想问晚霞为什么是红色的吗,还是想问白天为什么是蓝的'});
  assert.deepEqual(assistant(f),[['等一下,你刚才说什么来着?我没听清,是想问晚霞为什么是红色的吗,还是想问白天为什么是蓝的',false,undefined]]);
  f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'?'});
  f.bridge.receive({type:'turn.done',turn:{id:'a1',role:'assistant',transcript:'等一下,你刚才说什么来着?我没听清,是想问晚霞为什么是红色的吗,还是想问白天为什么是蓝的?'}});
  assert.deepEqual(assistant(f).slice(1),[['?',false,undefined],['等一下,你刚才说什么来着?我没听清,是想问晚霞为什么是红色的吗,还是想问白天为什么是蓝的?',true,undefined]]);
  // A reply too short to tell is shown whole when it ends.
  f.text.length=0;
  f.bridge.receive({type:'turn.created',turn:{id:'a2',role:'assistant'}});f.bridge.receive({type:'turn.delta',turn_id:'a2',delta:'嗯。'});
  f.bridge.receive({type:'turn.done',turn:{id:'a2',role:'assistant',transcript:'嗯。'}});
  assert.deepEqual(assistant(f),[['嗯。',true,undefined]]);
  f.bridge.close();
});
test('a finished task told as a script is read as written, and the model knows the result is in while it is written',async()=>{
  const f=await fixture({tools:LESSON,route:async()=>({name:'delegate_to_v',args:{question:'比较三款扫地机器人'}})});
  await ready(f);say(f,idOf(4),'帮我比较三款扫地机器人');await new Promise(r=>setTimeout(r,5));
  f.bridge.beginBackgroundTool(idOf(4),'比较');
  const before=appends(f).length;
  f.bridge.backgroundResultReady(idOf(4));
  assert.equal(appends(f).length,before+1);assert.equal(appends(f).at(-1).channel,'commentary');assert.match(appends(f).at(-1).content[0].text,/已经有结果了[\s\S]*不要说“还没查到”/u);
  const script='先说结论：没有一台全能冠军。大面上就三款值得看。';
  f.bridge.completeBackgroundTool(idOf(4),{result:'# 完整报告\n很长的正文'},{spokenText:script,displayedFullResult:true,script:true});
  const said=appends(f).slice(before+1);
  assert.match(said[0].content[0].text,/^完整结果，供回答追问时参考，不要念出来/u);assert.equal(said[0].channel,'commentary');
  assert.equal(said.at(-1).channel,'speakable');assert.match(said.filter(e=>e.channel==='speakable').map(e=>e.content[0].text).join(''),/^下面是写好的讲稿，屏幕上的画面是按它准备的[^<]*原样念出 <say> 里的内容[^<]*<say>先说结论：没有一台全能冠军。大面上就三款值得看。<\/say>$/u);
  f.text.length=0;
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'先说结论:没有一台'});
  assert.deepEqual(assistant(f),[['先说结论：没有一台',false,'V-backend-summary']]);
  // A result that is not a script is still told in the model's own words.
  const g=await fixture({tools:LESSON,route:async()=>({name:'delegate_to_v',args:{question:'查一下'}})});
  await ready(g);say(g,idOf(5),'帮我查一下那件事');await new Promise(r=>setTimeout(r,5));
  g.bridge.beginBackgroundTool(idOf(5),'查');g.bridge.completeBackgroundTool(idOf(5),{result:'查到了，一切正常。'},{spokenText:'查到了，一切正常。'});
  assert.match(appends(g).at(-1).content[0].text,/^后台任务有结果了。请像聊天一样把下面的内容告诉用户/u);
  g.bridge.backgroundResultReady(idOf(5));assert.match(appends(g).at(-1).content[0].text,/^后台任务有结果了/u); // nothing more once it is told
  f.bridge.close();g.bridge.close();
});

test('a script read with its opening put differently is still followed, and one talked past twice is let go',async()=>{
  const start=async()=>{const f=await fixture({tools:LESSON,route:async()=>({name:'delegate_to_v',args:{question:'扫地机器人'}})});await ready(f);say(f,idOf(6),'帮我查一下扫地机器人');await new Promise(r=>setTimeout(r,5));f.bridge.beginBackgroundTool(idOf(6),'查');return f;};
  const script='现在这个时间点，三台旗舰各有各的强项。想省心不折腾，首选石头 Saros 20。它吸力三万六千帕，机身只有七点九八厘米，沙发底能钻进去。';
  const f=await start();f.bridge.completeBackgroundTool(idOf(6),{result:script},{spokenText:script,displayedFullResult:true,script:true});f.text.length=0;
  // The first sentence skipped and a phrase changed: held until the script is found in it.
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});
  f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'日常省心不折腾,选石头 Saros二十。'});assert.deepEqual(assistant(f),[]);
  f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'它吸力三万六千帕,机身只有七点九八厘米,沙发底'});
  assert.equal(assistant(f).length,1);assert.equal(assistant(f)[0][2],'V-backend-summary');assert.match(assistant(f)[0][0],/它吸力三万六千帕，机身只有七点九八厘米，沙发底$/u);
  f.bridge.receive({type:'turn.done',turn:{id:'a1',role:'assistant',transcript:'日常省心不折腾,选石头 Saros二十。它吸力三万六千帕,机身只有七点九八厘米,沙发底能钻进去。'}});
  assert.equal(assistant(f).at(-1)[1],true);assert.match(assistant(f).at(-1)[0],/沙发底能钻进去。$/u);
  // The model answers in its own words instead, twice: captions stop waiting for the script.
  const g=await start();g.bridge.completeBackgroundTool(idOf(6),{result:script},{spokenText:script,displayedFullResult:true,script:true});
  for(const id of ['b1','b2']){
    g.bridge.receive({type:'turn.created',turn:{id,role:'assistant'}});
    g.bridge.receive({type:'turn.delta',turn_id:id,delta:'这个嘛，我觉得你家的情况其实不用想太多，随便挑一台中档的就很够用了呀，真的不用纠结那么多参数'});
    g.bridge.receive({type:'turn.done',turn:{id,role:'assistant',transcript:'这个嘛，我觉得你家的情况其实不用想太多，随便挑一台中档的就很够用了呀，真的不用纠结那么多参数'}});
  }
  g.text.length=0;
  g.bridge.receive({type:'turn.created',turn:{id:'b3',role:'assistant'}});g.bridge.receive({type:'turn.delta',turn_id:'b3',delta:'嗯'});
  assert.deepEqual(assistant(g),[['嗯',false,undefined]]);
  f.bridge.close();g.bridge.close();
});

const END=[{type:'function',name:'end_call',parameters:{type:'object',properties:{}}},{type:'function',name:'memory_search',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{question:{type:'string'}},required:['question']}}];
const userSays=(f,id,text)=>{f.bridge.receive({type:'turn.created',turn:{id,role:'user'}});f.bridge.receive({type:'turn.done',turn:{id,role:'user',transcript:text}});};
const vSays=(f,id,text)=>{f.bridge.receive({type:'turn.created',turn:{id,role:'assistant'}});f.bridge.receive({type:'turn.done',turn:{id,role:'assistant',transcript:text}});};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('a long result is given in pieces and asked about once, with nothing left to wait for',async()=>{
  const f=await fixture({tools:END,route:async()=>({name:'memory_search',args:{query:'推广'}})});await ready(f);
  userSays(f,'u1','我们讨论一下怎么往外推广');say(f,idOf(7),'我们讨论一下怎么往外推广');await pause(10);
  f.bridge.submitToolResult(idOf(7),{results:Array.from({length:4},(_,i)=>({snippet:`第${i}条`+'推广时先讲一个具体的日常场景。'.repeat(30),path:`memory/p${i}.md`}))});
  const sent=appends(f);
  assert(sent.length>4);assert(sent.slice(0,-1).every(e=>e.channel===undefined),'only the last piece asks to be spoken about');assert.equal(sent.at(-1).channel,'speakable');
  assert.match(sent.map(e=>e.content[0].text).join(''),/资料到此为止，这件事后台已经办完[\s\S]*现在就回答用户刚才的话：“我们讨论一下怎么往外推广”[\s\S]*不要说“我想想”/u);
  // A short result is one piece, with nothing added.
  const g=await fixture({tools:END,route:async()=>({name:'memory_search',args:{query:'x'}})});await ready(g);say(g,idOf(8),'查一下');await pause(10);
  g.bridge.submitToolResult(idOf(8),{results:[]});assert.deepEqual(appends(g).map(e=>[e.channel,e.content[0].text]),[['speakable','memory_search：个人记忆里没有找到相关记录。']]);
  f.bridge.close();g.bridge.close();
});
// Stands in for the model that judges what was just said: sure of whatever the test names.
const judging=verdicts=>{const asked=[];const judge=async request=>{asked.push(request);const hit=verdicts.find(([said])=>(request.reply||request.userText).includes(said));return {farewell:0,promise:0,stays:0,...(hit?.[1]??{})};};judge.asked=asked;return judge;};
test('a promise to think or look, with nothing delegated, is called out once; never while work is in flight',async()=>{
  const judge=judging([['还在想',{promise:.9}],['快好了',{promise:.9}],['想想看',{promise:.9}]]);
  // (What the caller said calls for nothing to be looked up: the router's reading of it is "say it yourself".)
  const f=await fixture({tools:END,route:async()=>({name:'answer_directly',args:{}}),replyJudge:judge});await ready(f);
  userSays(f,'u1','你有在做吗');vSays(f,'a1','有啊,还在想,再给我一点点时间。');await pause(5);
  // What V said is judged with what the caller said and the turns before it, never matched against words.
  assert.equal(judge.asked[0].reply,'有啊,还在想,再给我一点点时间。');assert.equal(judge.asked[0].userText,'你有在做吗');assert(judge.asked[0].history.some(turn=>turn.role==='user'));
  await pause(2400);
  const nudge=appends(f).at(-1);assert.equal(nudge.channel,'speakable');assert.match(nudge.content[0].text,/后台并没有任何事在进行[\s\S]*直接回答用户刚才的话：“你有在做吗”/u);
  assert(f.events.some(e=>e.diag?.stage==='promise-unkept'));
  // Once for what the caller said: a second such line is left alone.
  const count=appends(f).length;vSays(f,'a2','快好了,再一下下。');await pause(2400);assert.equal(appends(f).length,count);
  // With a lookup in flight "let me see" is true, and after its result the model is given time to answer.
  const g=await fixture({tools:END,route:async()=>({name:'memory_search',args:{query:'推广'}}),replyJudge:judging([['想想看',{promise:.9}]])});await ready(g);
  userSays(g,'u1','帮我查一下推广的记录');say(g,idOf(9),'帮我查一下推广的记录');await pause(10);vSays(g,'a1','好啊,我来想想看。');
  await pause(2400);assert.equal(appends(g).length,0);
  // Not sure enough, a long answer (never asked about), no judge at all, a judge that fails: nothing is said.
  const unsure=judging([['我想想哈',{promise:.4}]]);
  const h=await fixture({tools:END,replyJudge:unsure});await ready(h);userSays(h,'u1','这个怎么推广');vSays(h,'a1','嗯,我想想哈。');await pause(2400);assert.equal(appends(h).length,0);assert.equal(unsure.asked.length,1);
  vSays(h,'a2','我想想哈,其实最顺的讲法是先说它记得你、懂你,再说它能替你盯住每天固定要做的小事,这样别人一听就知道它和普通聊天机器人不一样在哪里。');
  await pause(2400);assert.equal(appends(h).length,0);assert.equal(unsure.asked.length,1);
  const none=await fixture({tools:END});await ready(none);userSays(none,'u1','你有在做吗');vSays(none,'a1','有啊,还在想。');await pause(2400);assert.equal(appends(none).length,0);
  const broken=await fixture({tools:END,replyJudge:async()=>{throw Error('decisions HTTP 500');}});await ready(broken);userSays(broken,'u1','你有在做吗');vSays(broken,'a1','有啊,还在想。');await pause(2400);assert.equal(appends(broken).length,0);
  f.bridge.close();g.bridge.close();h.bridge.close();none.bridge.close();broken.bridge.close();
});
test('V saying goodbye without a hang-up delegated ends the call; the caller\'s goodbye over it is not a change of mind',async()=>{
  const judge=judging([['有需要再找我',{farewell:.93}],['拜拜',{farewell:.9,stays:.95}],['还有个事',{stays:.05}],['talk to you later',{farewell:.1}]]);
  const f=await fixture({tools:END,route:async()=>({name:'delegate_to_v',args:{question:'x'}}),replyJudge:judge});await ready(f);
  userSays(f,'u1','好嘞,我们先这样好吗,谢谢你');await pause(10);vSays(f,'a1','好啊,那我们就先这样,有需要再找我喔。');
  assert.equal(f.calls.length,0);await pause(2400);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'end_call');assert.match(f.calls[0].callId,/^host_/u);assert(f.events.some(e=>e.diag?.stage==='farewell-unprompted'));
  f.bridge.submitToolResult(f.calls[0].callId,{ok:true});
  assert.deepEqual([appends(f).at(-1).channel,appends(f).at(-1).delegation_item_id],['speakable',undefined]);assert.match(appends(f).at(-1).content[0].text,/^电话马上挂断。你已经道过别了/u);
  // The goodbye plays on while the caller says theirs; a hang-up delegated late is not a second one.
  const clears=f.events.filter(e=>e.clear).length;
  f.bridge.receive({type:'turn.created',turn:{id:'a2',role:'assistant'}});f.bridge.receive({type:'turn.created',turn:{id:'u2',role:'user'}});f.bridge.handleBargeIn();
  assert.equal(f.events.filter(e=>e.clear).length,clears);
  // The session asks whether the caller's words are only their goodbye; anything else undoes the hang-up there.
  assert.equal(await f.bridge.keepsEnding('拜拜'),true);assert.equal(await f.bridge.keepsEnding('等等,还有个事'),false);
  f.bridge.endingCancelled();assert.equal(await f.bridge.keepsEnding('拜拜'),false,'no hang-up in progress');
  f.bridge.handleBargeIn();assert.equal(f.events.filter(e=>e.clear).length,clears+1,'interruptions count again');
  // A goodbye in passing ends nothing; one that was delegated is not doubled; nor is one judged by nobody.
  const h=await fixture({tools:END,route:async({text})=>/拜拜/u.test(text)?{name:'end_call',args:{}}:{name:'delegate_to_v',args:{question:text}},replyJudge:judge});await ready(h);
  userSays(h,'u1','“下次聊”用英文怎么说');vSays(h,'a1','“下次聊”可以说 talk to you later 喔。');await pause(2400);assert.equal(h.calls.length,0);
  userSays(h,'u2','那先这样,拜拜');say(h,idOf(11),'那先这样,拜拜');await pause(10);vSays(h,'a2','好,拜拜~');await pause(2400);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].callId,idOf(11));
  h.bridge.submitToolResult(idOf(11),{ok:true});assert.match(appends(h).at(-1).content[0].text,/^电话马上挂断。现在只说一句很短的告别/u);assert.equal(appends(h).at(-1).delegation_item_id,idOf(11));
  const none=await fixture({tools:END});await ready(none);userSays(none,'u1','拜拜');vSays(none,'a1','拜拜。');await pause(2400);assert.equal(none.calls.length,0);assert.equal(await none.bridge.keepsEnding('拜拜'),false);
  f.bridge.close();h.bridge.close();none.bridge.close();
});
test('a cough transcribed as a marker is not a turn of the caller\'s',async()=>{
  const f=await fixture();await ready(f);
  assert.equal(gptLiveText('[cough'),'');assert.equal(gptLiveText('嗯 [cough]'),'嗯');
  userSays(f,'u1','[cough');
  assert.deepEqual(f.text,[]);assert.deepEqual(f.events.filter(e=>e.speech===false).at(-1),{speech:false,recognized:false});
  f.bridge.close();
});

test('everything a search returned reaches the model: six passages, the last as whole as the first',()=>{
  const results=Array.from({length:6},(_,i)=>({title:`第${i+1}场比赛`,url:'https://example.com/'+'x'.repeat(90),snippet:`第${i+1}场的比分和得分最高的球员。`+'赛况'.repeat(240),published:'2026-11-20',siteName:'示例站'}));
  const text=gptLiveResultText('web_search',{details:{query:'今天的比赛结果',results},content:[{type:'text',text:'{}'}]});
  assert(Array.from(text).length>3000);assert.doesNotMatch(text,/已截断/u);
  for(let i=1;i<=6;i++)assert.match(text,new RegExp(`\\n${i}\\. 第${i}场比赛（示例站，2026-11-20）：第${i}场的比分`,'u'));
  assert.match(text,/今天是 \d{4}-\d{2}-\d{2}/u);
});

test('without a lesson tool the model explains and tells stories itself; a delegation for one is handed back to it',async()=>{
  const names=new Set(['web_search','memory_search','delegate_to_v']);
  const native=gptLiveDelegationPolicy(names),scripted=gptLiveDelegationPolicy(new Set([...names,'explain_on_board']));
  assert.match(native,/Do not delegate when:[\s\S]*要你讲个故事：你自己讲，不要委派/u);assert.match(native,/讲解和讲故事（屏幕会跟着你说的话自动出现画面和图片/u);assert.doesNotMatch(native,/讲稿/u);
  assert.match(gptLiveDelegationPolicy(names,{display:false}),/\n讲解和讲故事：这时可以多说/u);
  assert.match(scripted,/委派给后台准备讲解稿/u);assert.doesNotMatch(scripted,/你自己讲，不要委派/u);
  assert.match(GPT_LIVE_IDENTITY,/when you are asked to explain something or to tell a story, you tell it yourself/u);
  // The model delegated "explain the sky" anyway: there is nothing to look up, and it is told so at once.
  const offered=[];
  const f=await fixture({tools:[{type:'function',name:'web_search',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}],route:async({tools})=>{offered.push(tools.map(t=>t.name));return {name:'answer_directly',args:{}};}});
  await ready(f);userSays(f,'u1','给我讲解一下为什么天空是蓝色的');say(f,idOf(16),'给我讲解一下为什么天空是蓝色的');await pause(20);
  assert(offered.at(-1).includes('answer_directly'));assert.equal(f.calls.length,0);
  const told=appends(f).at(-1);assert.deepEqual([told.channel,told.delegation_item_id],['speakable',idOf(16)]);
  assert.match(told.content[0].text,/^这件事不用查，后台也没有在办的事：你自己现在就讲给用户听——“给我讲解一下为什么天空是蓝色的”/u);
  // With a lesson tool in the call that way out is not offered: the script is the lesson.
  const g=await fixture({tools:LESSON,route:async({tools})=>{offered.push(tools.map(t=>t.name));return {name:'explain_on_board',args:{topic:'天空'}};}});
  await ready(g);say(g,idOf(17),'讲讲天空');await pause(20);assert(!offered.at(-1).includes('answer_directly'));assert.equal(g.calls[0].name,'explain_on_board');
  f.bridge.close();g.bridge.close();
});

test('while the call is being hung up, a caller who is audibly speaking is waited for',async()=>{
  const judge=judging([['拜拜',{stays:.95}],['还有个事',{stays:.05}]]);
  const f=await fixture({tools:END,route:async()=>({name:'end_call',args:{}}),replyJudge:judge});await ready(f);
  const loud=Buffer.alloc(4800);for(let i=0;i<loud.length;i+=2)loud.writeInt16LE(8000,i); // 100 ms at 24 kHz
  f.bridge.sendAudio(loud);f.bridge.sendAudio(loud);assert.equal(f.bridge.endingHeld(),null,'no hang-up in progress: nothing to hold');
  userSays(f,'u1','那先这样,拜拜');say(f,idOf(1),'那先这样,拜拜');await pause(10);assert.equal(f.calls[0]?.name,'end_call');
  assert.equal(f.bridge.endingHeld(),null,'what the caller said before the hang-up began is not them speaking now');
  f.bridge.sendAudio(loud);assert.equal(f.bridge.endingHeld(),null,'a click is not speech');
  f.bridge.sendAudio(loud);
  const held=f.bridge.endingHeld();assert(held instanceof Promise);assert(f.events.some(e=>e.diag?.stage==='ending-held'));
  let released=false;void held.then(()=>{released=true;});await pause(300);assert.equal(released,false,'still within the time their words take to arrive');
  // Their turn opens and closes, and what they said is being judged: held throughout; a change of mind releases it at once.
  f.bridge.receive({type:'turn.created',turn:{id:'u2',role:'user'}});await pause(150);assert.equal(released,false);
  f.bridge.receive({type:'turn.done',turn:{id:'u2',role:'user',transcript:'等等,还有个事'}});
  assert.equal(await f.bridge.keepsEnding('等等,还有个事'),false);f.bridge.endingCancelled();await pause(200);assert.equal(released,true);
  assert.equal(f.bridge.endingHeld(),null);
});

test('a promise to look something up that nobody delegated is kept for the model: the lookup is made and its result told',async()=>{
  const judge=judging([['去看下',{promise:.9}]]);
  const f=await fixture({tools:END,route:async({text})=>/日程|记录/u.test(text)?{name:'memory_search',args:{query:'今天的安排'}}:{name:'answer_directly',args:{}},replyJudge:judge});await ready(f);
  // The model says it will look and delegates nothing; the caller's words were already read as a memory lookup.
  userSays(f,'u1','我今天有什么日程安排');await pause(10);vSays(f,'a1','嗯,我去看下你今天的日程。');await pause(2400);
  assert.equal(f.calls.length,1);assert.deepEqual([f.calls[0].name,f.calls[0].args],['memory_search',{query:'今天的安排'}]);assert.match(f.calls[0].callId,/^host_/u);
  assert(f.events.some(e=>e.diag?.stage==='promise-kept'));assert(!f.events.some(e=>e.diag?.stage==='promise-unkept'));
  assert(!appends(f).some(e=>/后台并没有任何事在进行/u.test(e.content?.[0]?.text??'')),'it is not told off: the thing is done');
  f.bridge.submitToolResult(f.calls[0].callId,{results:[{text:'下午三点和设计组过方案'}]});
  const told=appends(f).at(-1);assert.equal(told.channel,'speakable');assert.equal(told.delegation_item_id,undefined);assert.match(told.content[0].text,/下午三点和设计组过方案/u);
  // A delegation for the same words that still comes is already served.
  say(f,idOf(3),'我今天有什么日程安排');await pause(20);assert.equal(f.calls.length,1);
});

test('whether to look something up is the model\'s call: nothing is looked up on the caller\'s words until it delegates',async()=>{
  const route=async({text})=>/记录|进展|heartbeat/iu.test(text)?{name:'memory_search',args:{query:'夜班项目进展'},via:'model'}:{name:'answer_directly',args:{},via:'decision'};
  const f=await fixture({tools:END,route});await ready(f);
  userSays(f,'u1','我们最近的夜班项目进展怎么样');await pause(10);assert.equal(f.calls.length,0);
  say(f,idOf(1),'查一下夜班项目最近的进展');await pause(1700);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'memory_search');
  f.bridge.submitToolResult(f.calls[0].callId,{results:[{text:'十一月十六号复核：正式线已切到新版本'}]});
  assert.equal(appends(f).at(-1).delegation_item_id,idOf(1));
  // A reply from its own idea, with no promise to look, is left as the model gave it.
  const g=await fixture({tools:END,route});await ready(g);
  userSays(g,'u1','我想从 heartbeat 这一部分聊');await pause(10);vSays(g,'a1','好啊，Heartbeat 就是一个很轻的提醒节奏。');await pause(3000);
  assert.equal(g.calls.length,0);assert.equal(appends(g).length,0);
});

test('a call that comes back gives the routing model the lost call\'s last words and lookups',async()=>{
  let seen=null;const route=async({history})=>{seen=history;return {name:'answer_directly',args:{},via:'decision'};};
  const f=await fixture({tools:END,route,resume:{user:'最近 AI 解了什么数学难题',reply:'是一个百年猜想，同行还在核验',unfinished:false,found:[{name:'web_search',text:'某团队宣布证明了百年猜想'}]}});await ready(f);
  userSays(f,'u1','这一次是怎么弄出来的呢');await pause(10);
  assert.deepEqual(seen.slice(0,3).map(e=>[e.role,e.name??e.text]),[['user','最近 AI 解了什么数学难题'],['tool','web_search'],['assistant','是一个百年猜想，同行还在核验']]);
});

test('a goodbye the caller plainly said is hung up on soon after V\'s own, not after the full wait',async()=>{
  const judge=judging([['拜拜',{farewell:.95}],['有需要再找我',{farewell:.9}]]);
  // The caller's words are read as a hang-up as they stop speaking; the model says goodbye and delegates nothing.
  const f=await fixture({tools:END,route:async({text})=>/拜拜/u.test(text)?{name:'end_call',args:{}}:{name:'answer_directly',args:{}},replyJudge:judge});await ready(f);
  userSays(f,'u1','好了今天先这样,拜拜');await pause(10);vSays(f,'a1','拜拜。');await pause(300);assert.equal(f.calls.length,0);
  await pause(500);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'end_call');assert(f.events.some(e=>e.diag?.stage==='farewell-unprompted'));
  // The same for a goodbye too short to have been read ahead ("拜拜"), and for closing words read as something else.
  const g=await fixture({tools:END,route:async()=>({name:'answer_directly',args:{}}),replyJudge:judge});await ready(g);
  userSays(g,'u1','拜拜');await pause(10);vSays(g,'a1','拜拜。');await pause(300);assert.equal(g.calls.length,0);await pause(500);assert.equal(g.calls.length,1);
  // A promise is still given the full wait before it is repaired.
  const p=await fixture({tools:END,route:async()=>({name:'answer_directly',args:{}}),replyJudge:judging([['想想看',{promise:.9}]])});await ready(p);
  userSays(p,'u1','这个怎么推广比较好');await pause(10);vSays(p,'a1','嗯,我想想看。');await pause(1200);assert.equal(appends(p).filter(e=>/后台并没有任何事在进行/u.test(e.content[0].text)).length,0);
  await pause(1300);assert.equal(appends(p).filter(e=>/后台并没有任何事在进行/u.test(e.content[0].text)).length,1);
});

test('a call that follows one whose connection was cut is not greeted: V says it is back and goes on from where it stopped',async()=>{
  // The call that is cut off: the caller asked, V was in the middle of answering.
  const f=await fixture({tools:END});await ready(f);
  userSays(f,'u1','给我讲讲这座桥是怎么建起来的');
  f.bridge.receive({type:'turn.created',turn:{id:'a1',role:'assistant'}});f.bridge.receive({type:'turn.delta',turn_id:'a1',delta:'先打桥墩,再从两边往中间一段一段地架梁,最后'});
  f.bridge.close();
  const words=f.bridge.lastWords();assert.deepEqual(words,{user:'给我讲讲这座桥是怎么建起来的',reply:'先打桥墩,再从两边往中间一段一段地架梁,最后',unfinished:true,found:[]});
  // The call dialled again: its first words are asked for with what was cut off.
  const g=await fixture({tools:END,resume:words});await ready(g);g.bridge.triggerGreeting('电话已接通。');await pause(10);
  // (A long line goes as consecutive pieces of one append.)
  const whole=f=>appends(f).map(e=>e.content[0].text).join('');assert.equal(appends(g).at(-1).channel,'speakable');
  const first={content:[{text:whole(g)}]};
  assert.match(first.content[0].text,/^电话刚才断了一下，现在接回来了[\s\S]*不重新打招呼[\s\S]*从断掉的地方往后讲[\s\S]*对方最后说的是：“给我讲讲这座桥是怎么建起来的”[\s\S]*最后”（话在这里断了）/u);
  assert.doesNotMatch(first.content[0].text,/只说一句很短的问候/u);
  // A reply that had been said to its end: V only says it is back and asks.
  const h=await fixture({tools:END});await ready(h);userSays(h,'u1','今天星期几');vSays(h,'a1','今天星期一。');h.bridge.close();
  assert.deepEqual(h.bridge.lastWords(),{user:'今天星期几',reply:'今天星期一。',unfinished:false,found:[]});
  const k=await fixture({tools:END,resume:h.bridge.lastWords()});await ready(k);k.bridge.triggerGreeting('电话已接通。');await pause(10);
  assert.match(whole(k),/问一句要不要接着刚才的说，然后停下来听/u);
  // What was looked up before the cut is given again first, as background, and the line is asked for after it.
  const s=await fixture({tools:END});await ready(s);userSays(s,'u1','最近那个数学难题是什么');
  s.bridge.delegations.set('item_q1',{text:'查最近的数学难题',state:'running',polls:0,name:'web_search'});
  s.bridge.submitToolResult('item_q1',{content:[{type:'text',text:'某大学的团队宣布证明了一个百年猜想，同行还在核验。'}]});s.bridge.close();
  const lost=s.bridge.lastWords();assert.equal(lost.found.length,1);assert.equal(lost.found[0].name,'web_search');assert.match(lost.found[0].text,/百年猜想/u);
  const r=await fixture({tools:END,resume:lost});await ready(r);r.bridge.triggerGreeting('电话已接通。');await pause(10);
  const given=appends(r).map(e=>[e.channel,e.content[0].text]);
  assert.equal(given[0][0],'commentary');assert.match(given[0][1],/^断线前已经查到的资料[\s\S]*web_search：[\s\S]*百年猜想/u);assert.equal(given.at(-1)[0],'speakable');
  r.bridge.triggerGreeting('电话已接通。');await pause(10);assert.equal(appends(r).filter(e=>/断线前已经查到的资料/u.test(e.content[0].text)).length,1,'given once');
  // An ordinary call is greeted as before.
  const n=await fixture({tools:END});await ready(n);n.bridge.triggerGreeting('电话已接通。');await pause(10);assert.match(whole(n),/只说一句很短的问候/u);
});

test('without a lesson tool the model is told the page shows what it names, and what to do when asked for more pictures',()=>{
  const native=gptLiveDelegationPolicy(new Set(['web_search','exec','end_call']),{display:true});
  assert.match(native,/屏幕会自动配上你讲到的东西的真实照片[\s\S]*再点出四五样刚才没讲过[\s\S]*只有他明确要新做一张图或一个视频，才委派创作/u);
  // Nothing to look at, or a lesson tool that brings its own pictures: not said.
  assert.doesNotMatch(gptLiveDelegationPolicy(new Set(['web_search','exec']),{display:false}),/屏幕会自动配上/u);
  assert.doesNotMatch(gptLiveDelegationPolicy(new Set(['web_search','explain_on_board']),{display:true}),/屏幕会自动配上/u);
});

test('V is told what the caller\'s question put on the page, and names those things in that order',async()=>{
  const WEB=[{type:'function',name:'web_search',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}];
  const f=await fixture({tools:WEB,route:async()=>({name:'answer_directly',args:{}})});await ready(f);
  const whole=()=>appends(f).map(e=>e.content[0].text).join('');
  // A call whose page has never reported: "say it yourself" is not kept waiting.
  userSays(f,'u1','给我介绍几种常见的盆栽');say(f,idOf(1),'给我介绍几种常见的盆栽');await pause(30);
  assert.match(whole(),/你自己现在就讲给用户听/u);assert.doesNotMatch(whole(),/屏幕上已经摆好了/u);
  // The page reports (here: nothing drawn for a greeting). From then on what it shows is waited for, and told with it.
  f.bridge.boardOpening([]);
  const before=appends(f).length;
  userSays(f,'u2','再讲讲适合阳台的花');say(f,idOf(2),'再讲讲适合阳台的花');await pause(60);
  assert.equal(appends(f).length,before,'waiting for the page');
  f.bridge.boardOpening(['茉莉','月季','三角梅','x'.repeat(40),'']);await pause(20);
  const told=appends(f).slice(before).map(e=>e.content[0].text).join('');
  assert.match(told,/你自己现在就讲给用户听[\s\S]*屏幕上已经摆好了这几样的照片，按顺序是：茉莉、月季、三角梅。就按这个顺序把这几样讲到，讲到哪一样就说出它的名字/u);
  assert.equal(appends(f).at(-1).channel,'speakable');
  // The model already answering by itself (nothing delegated): told in passing, not as something to say.
  const count=appends(f).length;userSays(f,'u3','那水培的呢');f.bridge.receive({type:'turn.created',turn:{id:'a3',role:'assistant'}});
  f.bridge.boardOpening(['绿萝','富贵竹']);await pause(10);
  const aside=appends(f).slice(count);assert.equal(aside.at(-1).channel,'commentary');assert.match(aside.map(e=>e.content[0].text).join(''),/^（屏幕）用户的屏幕上已经摆好了这几样的照片，按顺序是：绿萝、富贵竹。/u);
  // Nothing on the page for a question: nothing said about it, and the next "say it yourself" is not delayed by it.
  const quiet=appends(f).length;f.bridge.boardOpening([]);await pause(10);assert.equal(appends(f).length,quiet);
});
test('a page that does not report in time does not hold the answer',async()=>{
  const WEB=[{type:'function',name:'web_search',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}];
  const f=await fixture({tools:WEB,route:async()=>({name:'answer_directly',args:{}})});await ready(f);f.bridge.boardOpening([]);
  await pause(5);userSays(f,'u1','讲讲候鸟为什么迁徙');say(f,idOf(1),'讲讲候鸟为什么迁徙');await pause(1500);assert.equal(appends(f).length,0);
  await pause(300);const told=appends(f).map(e=>e.content[0].text).join('');assert.match(told,/你自己现在就讲给用户听/u);assert.doesNotMatch(told,/屏幕上已经摆好了/u);
});

test('the policy asks the model to look up what the results it holds do not say',()=>{
  const policy=gptLiveDelegationPolicy(new Set(['web_search','memory_search','end_call']),{display:false});
  assert.match(policy,/追问[^\n]*结果没写到这一点：重新委派，不要凭印象补/u);
  assert.match(policy,/拿不准要不要查，就查/u);
  // No line hands the model words to say: a sample opener became the opener of every reply, said even with nothing looked up.
  assert.doesNotMatch(policy,/对一下|半句/u);
});
