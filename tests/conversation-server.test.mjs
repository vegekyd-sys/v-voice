import test from 'node:test';import assert from 'node:assert/strict';import {request as httpRequest} from 'node:http';import {Readable} from 'node:stream';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
const origin='https://voice.example.com';
const entries=['a','b','alias'].map((suffix,i)=>({id:'phone-room-'+suffix,agentId:'makaron',sessionKey:'agent:makaron:feishu:group:oc_room_'+(suffix==='alias'?'a':suffix),accountId:'existing-account',kind:'group',callerId:'tianyi',permissionProfile:'personal-tianyi',accessToken:String(i+1).repeat(40)}));
async function fixture(t){
 const calls=[];let serial=0;
 const bridge=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:'legacy'.repeat(8),conversationEntries:entries,
 gateway:{request:async(method,args)=>{calls.push({method,args});return method==='talk.client.create'?{voiceSessionId:'native-'+(++serial),model:'gpt-live-1-codex',transport:'webrtc',offerUrl:'/plugins/openai/realtime/calls'}:{ok:true};}},
 directVoice:{models:()=>[],reserve:async args=>{calls.push({method:'direct.reserve',args});return {voiceSessionId:'direct-'+(++serial),provider:args.model};},close:async()=>{},dispose:async()=>{}},offer:async()=>''});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
 const request=(id,path,cookie,body)=>new Promise((resolve,reject)=>{
 const req=httpRequest({hostname:'127.0.0.1',port:bridge.server.address().port,path:`/voice/api/${path}?phone=${id}`,method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,origin,...(cookie?{cookie}:{}),'content-type':'application/json'}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 const login=async entry=>{const r=await request(entry.id,'access','',{access:entry.accessToken});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 return {calls,request,login};
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
 assert.equal(f.calls[0].args.sessionKey,entries[0].sessionKey);
});
for(const model of ['seeduplex','grok'])test(`${model} uses the same phone binding as native GPT Live`,async t=>{
 const f=await fixture(t),cookie=await f.login(entries[1]);
 const r=await f.request(entries[1].id,'session',cookie,{model});assert.equal(r.status,200);
 assert.equal(f.calls[0].method,'direct.reserve');assert.equal(f.calls[0].args.sessionKey,entries[1].sessionKey);
 assert.equal(f.calls[0].args.model,model);
});
