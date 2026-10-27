import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import WebSocket from 'ws';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
const origin='https://voice.example.com';
const entries=['a','b','alias'].map((id,i)=>({id:'phone-room-'+id,agentId:'makaron',sessionKey:'agent:makaron:feishu:group:room-'+(id==='alias'?'a':id),accountId:'existing',kind:'group',callerId:'tianyi',permissionProfile:'personal-tianyi',accessToken:String(i+1).repeat(40)}));
async function fixture(t,options={}){
 const calls=[],sessions=new Map();
 const direct={models:()=>[{id:'seeduplex',available:true}],hasSession:id=>sessions.has(id),backgroundTaskCount:()=>0,
  reserve:async args=>{calls.push(['reserve',args]);await options.reserve?.();const r={voiceSessionId:randomUUID(),relayTicket:randomUUID(),transport:'gateway-relay',model:'1.2.6.1'};sessions.set(r.voiceSessionId,{r});return r;},
  attach:(id,ticket,ws)=>{const s=sessions.get(id);assert.equal(s.r.relayTicket,ticket);s.ws=ws;calls.push(['attach',id]);ws.on('close',()=>sessions.delete(id));ws.send(JSON.stringify({type:'ready',voiceSessionId:id}));return true;},
  close:async id=>{calls.push(['close',id]);sessions.get(id)?.ws?.close();sessions.delete(id);},
  dispose:async()=>{for(const s of sessions.values())s.ws?.terminate();sessions.clear();},handleEvent:()=>{},};
 const bridge=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:'legacy'.repeat(8),conversationEntries:entries,phoneInputPolicy:'native',speakerRouting:{close(){},dispose(){},snapshot:()=>({})},directVoice:direct,avatarEvaluate:null,
  gateway:{ready:true,request:async(method,args)=>{calls.push([method,args]);if(method==='sessions.describe'){await options.describe?.();return {session:options.missing?null:{key:args.key,agentId:'makaron'}};}return {};}}});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
 const request=(entry,route,cookie,body)=>new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port:bridge.server.address().port,path:'/voice/api/'+route+'?phone='+entry.id,method:body?'POST':'GET',headers:{host:new URL(origin).host,origin,...cookie?{cookie}:{},'content-type':'application/json'}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 const login=async entry=>(await request(entry,'access','',{access:entry.accessToken})).headers.get('set-cookie').split(';')[0];
 const connect=(entry,cookie,extra='',headers={})=>{
  const ws=new WebSocket(`ws://127.0.0.1:${bridge.server.address().port}/voice/api/dial?phone=${entry.id}&model=${options.model??'seeduplex'}&dialVersion=1&nativeRuntimeVersion=1${extra}`,{headers:{host:new URL(origin).host,origin,cookie,...headers},handshakeTimeout:2000});
  const messages=[];const done=new Promise(resolve=>{ws.on('message',data=>{messages.push(JSON.parse(data));if(['ready','dial.error'].includes(messages.at(-1).type))resolve({messages,ws});});ws.on('unexpected-response',(_,res)=>{res.resume();resolve({status:res.statusCode,messages,ws});ws.terminate();});ws.on('error',()=>resolve({status:0,messages,ws}));});
  t.after(()=>ws.terminate());return {ws,done,messages};
 };
 return {calls,sessions,bridge,request,login,connect};
}
test('one socket authenticates and reserves exact session before ready, with service input policy',async t=>{
 const f=await fixture(t),cookie=await f.login(entries[0]);
 assert.equal((await(await f.request(entries[0],'status',cookie)).json()).nativeDialVersion,1);
 const {messages,ws}=await f.connect(entries[0],cookie).done;
 assert.deepEqual(messages.map(m=>m.type),['reservation','ready']);assert.equal(messages[0].dialVersion,1);assert.equal(messages[0].relayTicket,undefined);
 assert.equal(messages[0].voiceSessionId,messages[1].voiceSessionId);
 const args=f.calls.find(c=>c[0]==='reserve')[1];assert.equal(args.sessionKey,entries[0].sessionKey);assert.equal(args.inputPolicy,'native');assert.equal(args.sessionBound,true);assert.equal(args.nativeRuntimeVersion,1);
 assert.equal(f.calls.filter(c=>c[0]==='sessions.describe').length,1);
 ws.close();await new Promise(r=>ws.once('close',r));for(let i=0;i<20&&f.sessions.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.sessions.size,0);
});
test('wrong cookie, origin, unknown identity parameters and duplicate model cannot create calls',async t=>{
 const f=await fixture(t),cookie=await f.login(entries[0]);
 assert.equal((await f.connect(entries[1],cookie).done).status,401);
 assert.equal((await f.connect(entries[0],cookie,'&sessionKey=agent:makaron:main').done).status,400);
 assert.equal((await f.connect(entries[0],cookie,'&model=grok').done).status,400);
 assert.equal((await f.connect(entries[0],cookie,'',{origin:'https://evil.example'}).done).status,0);
 assert.equal(f.calls.some(c=>c[0]==='reserve'),false);
});
test('missing exact session fails before any provider reservation and clears creating lock',async t=>{
 const f=await fixture(t,{missing:true}),cookie=await f.login(entries[0]);
 const result=await f.connect(entries[0],cookie).done;assert.equal(result.messages[0].type,'dial.error');
 assert.equal(f.calls.some(c=>c[0]==='reserve'),false);
 assert.equal((await(await f.request(entries[0],'status',cookie)).json()).creatingSession,false);
});
test('concurrent same session, second visitor and alias cannot replace pending or active dial',async t=>{
 let resolve,entered;const pending=new Promise(r=>resolve=r),started=new Promise(r=>entered=r);
 const f=await fixture(t,{describe:async()=>{entered();await pending;}}),a=await f.login(entries[0]),alias=await f.login(entries[2]),other=await f.login(entries[0]);
 const first=f.connect(entries[0],a);await started;
 for(const [entry,cookie] of [[entries[0],a],[entries[0],other],[entries[2],alias]])assert.equal((await f.connect(entry,cookie).done).messages[0].status,409);
 resolve();await first.done;
 assert.equal((await f.connect(entries[0],other).done).messages[0].status,409);
 assert.equal(f.calls.filter(c=>c[0]==='reserve').length,1);
});
test('cancel while exact verification is pending never reserves a provider',async t=>{
 let resolve,entered;const pending=new Promise(r=>resolve=r),started=new Promise(r=>entered=r);
 const f=await fixture(t,{describe:async()=>{entered();await pending;}}),cookie=await f.login(entries[0]);
 const attempt=f.connect(entries[0],cookie);await started;attempt.ws.terminate();await new Promise(r=>attempt.ws.once('close',r));await new Promise(r=>setTimeout(r,20));resolve();await new Promise(r=>setTimeout(r,20));
 assert.equal(f.calls.some(c=>c[0]==='reserve'),false);assert.equal(f.sessions.size,0);
 assert.equal((await(await f.request(entries[0],'status',cookie)).json()).creatingSession,false);
});
test('cancel during reservation retires the owned reservation without attaching a provider',async t=>{
 let resolve,entered;const pending=new Promise(r=>resolve=r),started=new Promise(r=>entered=r);
 const f=await fixture(t,{reserve:async()=>{entered();await pending;}}),cookie=await f.login(entries[0]);
 const attempt=f.connect(entries[0],cookie);await started;attempt.ws.terminate();await new Promise(r=>attempt.ws.once('close',r));await new Promise(r=>setTimeout(r,20));resolve();await new Promise(r=>setTimeout(r,20));
 assert.equal(f.calls.filter(c=>c[0]==='close').length,1);assert.equal(f.calls.some(c=>c[0]==='attach'),false);assert.equal(f.sessions.size,0);
});

test('an old Grok fast-dial preference cannot allocate or close a call in the ordinary catalog',async t=>{
 const f=await fixture(t,{model:'grok'}),cookie=await f.login(entries[0]);
 const result=await f.connect(entries[0],cookie).done;
 assert.equal(result.messages[0].type,'dial.error');assert.equal(result.messages[0].status,409);
 assert.equal(f.calls.length,0);assert.equal(f.sessions.size,0);
});
