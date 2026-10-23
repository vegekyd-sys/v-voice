import {conversationReplyText} from '../lib/conversation-replies.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {request as httpRequest} from 'node:http';import {Readable} from 'node:stream';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import WebSocket,{WebSocketServer} from 'ws';
const origin='https://voice.example.com';
const selected=process.env.VOICE_TEST_TARGETS_JSON?JSON.parse(process.env.VOICE_TEST_TARGETS_JSON):null;
const entries=['a','b','alias'].map((suffix,i)=>({
 ...(selected?selected[suffix==='alias'?0:i]:{id:'phone-room-'+suffix,agentId:'makaron',sessionKey:'agent:makaron:feishu:group:oc_room_'+(suffix==='alias'?'a':suffix),accountId:'existing-account',kind:'group'}),
 ...(selected&&suffix==='alias'?{id:selected[0].id+'-alias'}:{}),
 callerId:'tianyi',permissionProfile:'personal-tianyi',accessToken:String(i+1).repeat(40)}));
async function fixture(t,options={}){
 const calls=[];let serial=0;
 const bridge=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:'legacy'.repeat(8),conversationEntries:options.entries??entries,callSummarize:async()=>'讨论了计划。',personalReply:options.personalReply,feishuAccounts:options.feishuAccounts??{},
 gateway:{request:async(method,args)=>{calls.push({method,args});if(method==='sessions.resolve')return options.resolve?options.resolve(args):{key:args.key,agentId:args.agentId};if(method==='send')return {messageId:'om_fixture'};if(method==='tools.invoke')return {ok:true,output:{details:{ok:true,messageId:args.args.messageId}}};return method==='talk.client.create'?{voiceSessionId:'native-'+(++serial),model:'gpt-live-1-codex',transport:'webrtc',offerUrl:'/plugins/openai/realtime/calls'}:{ok:true};}},
 directVoice:{models:()=>[],reserve:async args=>{calls.push({method:'direct.reserve',args});return {voiceSessionId:'direct-'+(++serial),provider:args.model};},close:async()=>{},handleEvent:()=>{},dispose:async()=>{},...options.directVoice},offer:options.offer??(async()=> '')});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
 const request=(id,path,cookie,body)=>new Promise((resolve,reject)=>{
 const req=httpRequest({hostname:'127.0.0.1',port:bridge.server.address().port,path:`/voice/api/${path}${id?'?phone='+id:''}`,method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,origin,...(cookie?{cookie}:{}),'content-type':'application/json'}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 const login=async entry=>{const r=await request(entry.id,'access','',{access:entry.accessToken});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 const html=(id,cookie)=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:bridge.server.address().port,path:`/voice/${id?'?phone='+id:''}`,headers:{host:new URL(origin).host,...(cookie?{cookie}:{})}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));req.on('error',reject);req.end();});
 return {calls,request,login,html,bridge};
}
test('separate phones run concurrently; same-session alias cannot replace an owner',async t=>{
 const f=await fixture(t),[a,b,c]=await Promise.all(entries.map(f.login));
 const first=await (await f.request(entries[0].id,'session',a,{})).json();
 assert.equal((await f.request(entries[1].id,'session',b,{})).status,200);
 assert.equal((await f.request(entries[2].id,'session',c,{})).status,409);
 assert.equal((await f.request(entries[1].id,'close',b,first)).status,409);
 assert.deepEqual(f.calls.filter(c=>c.method==='talk.client.create').map(c=>c.args.sessionKey),entries.slice(0,2).map(e=>e.sessionKey));
 assert.equal((await f.request(entries[0].id,'close',a,first)).status,200);
 const again=await (await f.request(entries[0].id,'session',a,{})).json();assert.notEqual(first.voiceSessionId,again.voiceSessionId);
 assert.equal(f.calls.filter(c=>c.method==='talk.client.create').at(-1).args.sessionKey,entries[0].sessionKey);
});
test('a phone cookie cannot access another phone or select an arbitrary session',async t=>{
 const f=await fixture(t),cookie=await f.login(entries[0]);
 assert.equal((await f.request(entries[1].id,'status',cookie)).status,401);
 assert.equal((await f.request('unknown-phone','status',cookie)).status,404);
 assert.equal((await f.request(entries[1].id,'access','',{access:entries[0].accessToken})).status,403);
 await f.request(entries[0].id,'session',cookie,{sessionKey:'agent:makaron:main',callerId:'someone'});
 assert.equal(f.calls.find(c=>c.method==='talk.client.create').args.sessionKey,entries[0].sessionKey);
});
for(const model of ['seeduplex','grok'])test(`${model} uses the same phone binding as native GPT Live`,async t=>{
 const f=await fixture(t),cookie=await f.login(entries[1]);
 const r=await f.request(entries[1].id,'session',cookie,{model});assert.equal(r.status,200);
 const call=f.calls.find(c=>c.method==='direct.reserve');assert.equal(call.args.sessionKey,entries[1].sessionKey);
 assert.equal(call.args.model,model);
});

test('unresolved or aliased sessions never create a native or direct voice call',async t=>{
 const f=await fixture(t,{resolve:()=>({key:'agent:makaron:main'})}),cookie=await f.login(entries[0]);
 for(const model of ['gpt-live','seeduplex','grok'])assert.equal((await f.request(entries[0].id,'session',cookie,{model})).status,500);
 assert.equal(f.calls.some(c=>c.method==='talk.client.create'||c.method==='direct.reserve'),false);
 assert.equal((await (await f.request(entries[0].id,'status',cookie)).json()).creatingSession,false);
});

test('old SDP completion cannot be accepted after close and redial',async t=>{
 let finish,started;const beginning=new Promise(r=>started=r);
 const f=await fixture(t,{offer:()=>{started();return new Promise(r=>finish=r);}}),cookie=await f.login(entries[0]);
 const first=await(await f.request(entries[0].id,'session',cookie,{})).json();
 const pending=f.request(entries[0].id,'offer',cookie,{...first,sdp:'v=0\r\n'});await beginning;
 await f.request(entries[0].id,'close',cookie,first);
 const second=await(await f.request(entries[0].id,'session',cookie,{})).json();finish('v=0\r\nold');
 assert.equal((await pending).status,409);assert.notEqual(second.voiceSessionId,first.voiceSessionId);
 assert.equal((await f.request(entries[0].id,'heartbeat',cookie,first)).status,409);
 assert.equal((await f.request(entries[0].id,'heartbeat',cookie,second)).status,200);
});

test('native backend presentation and late events remain with their actual phone owner',async t=>{
 const f=await fixture(t),[a,b]=await Promise.all(entries.slice(0,2).map(f.login));
 const first=await(await f.request(entries[0].id,'session',a,{})).json();
 await f.request(entries[1].id,'session',b,{});
 const event={event:'talk.event',payload:{voiceSessionId:first.voiceSessionId,talkEvent:{type:'tool.result',callId:'result-a',payload:{name:'openclaw_backend_result',text:'Only A'}}}};
 f.bridge.emit(event);
 assert.equal((await(await f.request(entries[0].id,'presentation',a)).json()).documents[0].text,'Only A');
 assert.deepEqual((await(await f.request(entries[1].id,'presentation',b)).json()).documents,[]);
 await f.request(entries[0].id,'close',a,first);await f.request(entries[0].id,'session',a,{});f.bridge.emit(event);
 assert.deepEqual((await(await f.request(entries[0].id,'presentation',a)).json()).documents,[]);
});

test('relay authenticates the specific visitor even when another phone adds a cookie',async t=>{
 const wss=new WebSocketServer({noServer:true}),clients=new Set();
 const f=await fixture(t,{directVoice:{upgrade:(req,socket,head)=>wss.handleUpgrade(req,socket,head,client=>clients.add(client)),dispose:async()=>{for(const client of clients)client.terminate();wss.close();}}});
 const a=await f.login(entries[0]),b=await f.login(entries[1]);
 const first=await(await f.request(entries[0].id,'session',a,{model:'seeduplex'})).json();
 const connect=(entry,cookie)=>new Promise((resolve,reject)=>{
  const socket=new WebSocket(`ws://127.0.0.1:${f.bridge.server.address().port}/voice/api/relay?phone=${entry}&voiceSessionId=${first.voiceSessionId}&ticket=fake`,{headers:{host:new URL(origin).host,cookie,origin},handshakeTimeout:1500});
  socket.once('open',()=>{socket.terminate();resolve();});socket.once('error',reject);
 });
 await connect(entries[0].id,a+'; '+b);
 const secondVisitor=await f.login(entries[0]);
 await assert.rejects(connect(entries[0].id,secondVisitor+'; '+b));
 const aliasCookie=await f.login(entries[2]);await assert.rejects(connect(entries[2].id,aliasCookie));
});

test('inline readiness cannot cross phone-cookie ownership and reveals no session binding',async t=>{
 const f=await fixture(t),cookie=await f.login(entries[0]);
 const owner=await (await f.html(entries[0].id,cookie)).text();
 assert.match(owner,/id="voiceEntryStatus"/u);
 const foreign=await (await f.html(entries[1].id,cookie)).text();
 assert.doesNotMatch(foreign,/id="voiceEntryStatus"/u);
 for(const e of entries){assert(!owner.includes(e.sessionKey));assert(!owner.includes(e.accessToken));}
 assert.equal(f.calls.length,0);
});


test('authenticated entry returns safe conversation label and passes only server-owned session mode',async t=>{
 const f=await fixture(t),cookie=await f.login(entries[0]);
 const status=await (await f.request(entries[0].id,'status',cookie)).json();
 assert.deepEqual(status.conversation,{name:'飞书群聊',kind:'group',replySync:false});
 assert(!JSON.stringify(status).includes(entries[0].sessionKey));
 await f.request(entries[0].id,'session',cookie,{model:'seeduplex'});
 const call=f.calls.find(x=>x.method==='direct.reserve');
 assert.equal(call.args.sessionBound,true);assert.equal(call.args.sessionKey,entries[0].sessionKey);
});

test('reply sync is enabled by private entry only; native final goes to that exact bot and session',async t=>{
 const enabled=entries.map(e=>({...e,replySync:true}));
 const f=await fixture(t,{entries:enabled,feishuAccounts:{accounts:{lab:{appId:'existing-account'}}}}),cookie=await f.login(entries[0]);
 const first=await(await f.request(entries[0].id,'session',cookie,{replyTarget:{to:'oc_foreign',accountId:'other'}})).json();
 await f.request(entries[0].id,'offer',cookie,{voiceSessionId:first.voiceSessionId,sdp:'v=0\r\n'});
 await f.request(entries[0].id,'call-control-input',cookie,{voiceSessionId:first.voiceSessionId,revision:1,turnId:'u1',text:'说明计划',final:true});
 const event={event:'talk.event',payload:{voiceSessionId:first.voiceSessionId,talkEvent:{type:'output.text.done',responseId:'r1',payload:{text:'完整回答，只属于这通电话。'}}}};
 f.bridge.emit(event);f.bridge.emit(event);
 await f.request(entries[0].id,'close',cookie,first);
 for(let i=0;f.bridge.releaseReadiness().backgroundTasks&&i<100;i++)await new Promise(r=>setTimeout(r,2));
 const sent=f.calls.filter(c=>c.method==='send');assert.equal(sent.length,2);
 assert.equal(JSON.parse(sent[0].args.message).body.elements[0].content,'正在通话');const card=JSON.parse(sent[1].args.message);assert.equal(card.header.title.content,'通话总结');
 for(const row of sent){assert.equal(row.args.to,'oc_room_a');assert.equal(row.args.accountId,'lab');assert.equal(row.args.sessionKey,entries[0].sessionKey);}
 const edited=f.calls.filter(c=>c.method==='tools.invoke');assert.ok(edited.length);for(const row of edited){assert.equal(row.args.args.messageId,'om_fixture');assert.equal(row.args.args.target,'oc_room_a');assert.equal(row.args.args.accountId,'lab');}assert.match(edited.at(-1).args.args.card.body.elements[0].content,/通话已结束/);
 const id=new URL(card.body.elements.at(-1).behaviors[0].default_url).searchParams.get('call');
 const report=await(await f.request(entries[0].id,'calls/'+id,cookie)).json();assert.deepEqual(report.turns.map(t=>t.text),['说明计划','完整回答，只属于这通电话。']);
 const foreignCookie=await f.login(entries[1]);assert.equal((await f.request(entries[1].id,'calls/'+id,foreignCookie)).status,404);
 f.bridge.emit(event);assert.equal(f.calls.filter(c=>c.method==='send').length,2);
 const direct=await f.request(entries[0].id,'session',cookie,{model:'seeduplex',replySync:false,replyTarget:{to:'oc_foreign'}});assert.equal(direct.status,200);
 assert.equal(f.calls.find(c=>c.method==='direct.reserve').args.replyTarget.to,'oc_room_a');
});

for(const model of ['seeduplex','grok','gpt-live'])test(`legacy personal ${model} shares reply routing without changing its session or tool identity`,async t=>{
 const {GPT_LIVE_PERSONAL_SESSION_KEY}=await import('../lab/gpt-live-h5/personal-session.mjs');
 const f=await fixture(t,{personalReply:{replySync:true,accountId:'personal-bot'},feishuAccounts:{accounts:{personal:{appId:'personal-bot'}}}});
 const cookie=await f.login({id:'',accessToken:'legacy'.repeat(8)});
 const response=await f.request('','session',cookie,{model,replyTarget:{to:'oc_foreign'},sessionKey:entries[0].sessionKey});
 assert.equal(response.status,200);const first=await response.json();
 if(model!=='gpt-live'){
  const call=f.calls.find(c=>c.method==='direct.reserve');assert.equal(call.args.sessionKey,GPT_LIVE_PERSONAL_SESSION_KEY);assert.equal(call.args.sessionBound,undefined);assert.equal(call.args.replyTarget.sessionKey,GPT_LIVE_PERSONAL_SESSION_KEY);assert.equal(call.args.replyTarget.accountId,'personal');
 }else{
  await f.request('','call-control-input',cookie,{voiceSessionId:first.voiceSessionId,revision:1,turnId:'u1',text:'给我一个完整回答',final:true});
  f.bridge.emit({event:'talk.event',payload:{voiceSessionId:first.voiceSessionId,talkEvent:{type:'output.text.done',responseId:'r1',payload:{text:'这是个人入口的一条完整回答。'}}}});
  await f.request('','close',cookie,first);
  const sent=f.calls.filter(c=>c.method==='send');assert.equal(sent.length,1);assert.equal(conversationReplyText(sent[0].args.message),'语音提问：给我一个完整回答\n\nV：这是个人入口的一条完整回答。');assert.equal(sent[0].args.sessionKey,GPT_LIVE_PERSONAL_SESSION_KEY);assert.equal(sent[0].args.accountId,'personal');assert.equal(sent[0].args.to,GPT_LIVE_PERSONAL_SESSION_KEY.split(':').at(-1));
 }
});
