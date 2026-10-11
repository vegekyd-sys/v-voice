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
 const bridge=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:'legacy'.repeat(8),conversationEntries:entries,
 gateway:{request:async(method,args)=>{calls.push({method,args});if(method==='sessions.resolve')return options.resolve?options.resolve(args):{key:args.key,agentId:args.agentId};return method==='talk.client.create'?{voiceSessionId:'native-'+(++serial),model:'gpt-live-1-codex',transport:'webrtc',offerUrl:'/plugins/openai/realtime/calls'}:{ok:true};}},
 directVoice:{models:()=>[],reserve:async args=>{calls.push({method:'direct.reserve',args});return {voiceSessionId:'direct-'+(++serial),provider:args.model};},close:async()=>{},handleEvent:()=>{},dispose:async()=>{},...options.directVoice},offer:options.offer??(async()=> '')});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
 const request=(id,path,cookie,body)=>new Promise((resolve,reject)=>{
 const req=httpRequest({hostname:'127.0.0.1',port:bridge.server.address().port,path:`/voice/api/${path}?phone=${id}`,method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,origin,...(cookie?{cookie}:{}),'content-type':'application/json'}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 const login=async entry=>{const r=await request(entry.id,'access','',{access:entry.accessToken});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 return {calls,request,login,bridge};
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
