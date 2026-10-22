import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {GatewayClient,connectGatewayClient} from '../lib/gateway-client.mjs';
import {setTimeout as delay} from 'node:timers/promises';
async function fixture(t,respond=()=>{},options={}){
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 const requests=[];let peer;
 server.on('connection',ws=>{peer=ws;ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'real-challenge'}}));ws.on('message',raw=>{const f=JSON.parse(raw);requests.push(f);if(f.method==='connect')ws.send(JSON.stringify({type:'res',id:f.id,ok:true,payload:{type:'hello-ok',protocol:4}}));else respond(ws,f);});});
 let hello;const ready=new Promise(r=>hello=r);const events=[];
 const client=new GatewayClient({url:`ws://127.0.0.1:${server.address().port}`,token:'fixture-only',...options,onHelloOk:hello,onEvent:e=>events.push(e),reconnectMs:30});client.start();await ready;
 t.after(async()=>{client.stop();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});
 return {client,requests,events,get peer(){return peer;}};
}
test('protocol handshake and out-of-order RPCs match request IDs',async t=>{
 const queued=[];const f=await fixture(t,(ws,r)=>{queued.push(r);if(queued.length===2)for(const q of queued.reverse())ws.send(JSON.stringify({type:'res',id:q.id,ok:true,payload:{method:q.method}}));});
 assert.equal(f.requests[0].params.minProtocol,4);assert.deepEqual(f.requests[0].params.caps,['voice-direct-tools','tool-events']);
 const [a,b]=await Promise.all([f.client.request('health'),f.client.request('chat.history')]);assert.equal(a.method,'health');assert.equal(b.method,'chat.history');
 f.peer.send(JSON.stringify({type:'event',event:'chat',payload:{state:'delta'}}));await delay(10);assert.equal(f.events[0].event,'chat');
});
test('timeouts and abort retire late results without duplicate effects',async t=>{
 const f=await fixture(t);await assert.rejects(f.client.request('slow',{}, {timeoutMs:10}),/TIMEOUT/);
 const stop=new AbortController();const p=f.client.request('abort',{}, {signal:stop.signal});stop.abort();await assert.rejects(p,/ABORTED/);assert.equal(f.client.pending.size,0);
});
test('disconnect rejects pending work and reconnect never replays it',async t=>{
 const f=await fixture(t);const p=f.client.request('mutating');await delay(10);f.peer.terminate();await assert.rejects(p,/CLOSED/);await delay(70);
 assert.equal(f.client.ready,true);assert.equal(f.requests.filter(r=>r.method==='mutating').length,1);assert.equal(f.events.some(e=>e.event==='voice.gateway.disconnected'),true);
});
test('credentials cannot be placed in an insecure remote URL',()=>{
 assert.throws(()=>new GatewayClient({url:'ws://example.com',token:'x'}),/loopback/);
 assert.throws(()=>new GatewayClient({url:'wss://example.com?token=x'}),/credentials/);
});
test('a retryable startup rejection retains its cause and reconnects without replaying work',async t=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 let connects=0,client;const errors=[];
 server.on('connection',ws=>{ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'startup'}}));ws.on('message',raw=>{
  const f=JSON.parse(raw);assert.equal(f.method,'connect');connects++;
  ws.send(JSON.stringify(connects===1?{type:'res',id:f.id,ok:false,error:{code:'UNAVAILABLE',message:'gateway starting',retryable:true,retryAfterMs:500,details:{reason:'startup-sidecars'}}}:{type:'res',id:f.id,ok:true,payload:{protocol:4}}));
 });});
 t.after(async()=>{client?.stop();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Handshake never recovered')),2000);
  client=new GatewayClient({url:`ws://127.0.0.1:${server.address().port}`,token:'fixture-only',reconnectMs:10,onConnectError:e=>errors.push(e),onHelloOk:()=>{clearTimeout(timer);resolve();}});client.start();
 });
 assert.equal(connects,2);assert.equal(errors.length,1);assert.equal(errors[0].retryable,true);assert.equal(errors[0].details.reason,'startup-sidecars');assert.equal(client.ready,true);
});

test('reconnect reads the current server-side credential without replaying business requests',async t=>{
 let token='before',reads=0;
 const f=await fixture(t,()=>{},{getToken:async()=>{reads++;return token;}});
 assert.equal(f.requests[0].params.auth.token,'before');token='after';f.peer.terminate();
 for(let i=0;i<100&&(!f.client.ready||reads<2);i++)await delay(10);
 assert(f.client.ready);assert.equal(reads,2);
 assert.deepEqual(f.requests.filter(r=>r.method==='connect').map(r=>r.params.auth.token),['before','after']);
 assert.equal(f.requests.filter(r=>r.method!=='connect').length,0);
});

test('a credential read completing after stop cannot send a late handshake',async t=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 const requests=[];let finish,reading;const readStarted=new Promise(r=>reading=r);
 server.on('connection',ws=>{ws.on('message',raw=>requests.push(JSON.parse(raw)));ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'retired'}}));});
 const client=new GatewayClient({url:`ws://127.0.0.1:${server.address().port}`,getToken:()=>new Promise(r=>{finish=r;reading();})});
 t.after(async()=>{client.stop();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});
 client.start();await readStarted;client.stop();finish('retired-token');await delay(20);assert.equal(requests.length,0);assert.equal(client.ready,false);
});

test('the admitted Voice connection recovers after a later auth rejection rather than stopping',async t=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 let client,peer,connects=0,token='first';const auth=[],errors=[];
 server.on('connection',ws=>{peer=ws;ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'voice'}}));ws.on('message',raw=>{
  const f=JSON.parse(raw);assert.equal(f.method,'connect');connects++;auth.push(f.params.auth.token);
  ws.send(JSON.stringify(connects===2?{type:'res',id:f.id,ok:false,error:{code:'UNAUTHORIZED'}}:{type:'res',id:f.id,ok:true,payload:{protocol:4}}));
 });});
 t.after(async()=>{client?.stop();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});
 client=await connectGatewayClient({url:`ws://127.0.0.1:${server.address().port}`,getToken:async()=>token,reconnectMs:10},{startupTimeoutMs:2000,onConnectError:e=>{errors.push(e.code);token='current';}});
 peer.terminate();for(let i=0;i<200&&(connects<3||!client.ready);i++)await delay(10);
 assert.equal(client.ready,true);assert.equal(client.stopped,false);assert.equal(connects,3);assert.deepEqual(errors,['UNAUTHORIZED']);assert.deepEqual(auth,['first','first','current']);
});

test('startup waits through a restarting Gateway that still refuses connections',async t=>{
 const probe=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>probe.once('listening',r));
 const port=probe.address().port;await new Promise(r=>probe.close(r));
 const errors=[];let server,client;
 t.after(async()=>{client?.stop();if(!server)return;for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});
 const pending=connectGatewayClient({url:`ws://127.0.0.1:${port}`,token:'fixture-only',reconnectMs:20},{startupTimeoutMs:3000,onConnectError:e=>errors.push(e.code)});
 pending.catch(()=>{});
 await delay(150);
 server=new WebSocketServer({port,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 server.on('connection',ws=>{ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'restarted'}}));ws.on('message',raw=>{const f=JSON.parse(raw);ws.send(JSON.stringify({type:'res',id:f.id,ok:true,payload:{protocol:4}}));});});
 client=await pending;
 assert.equal(client.ready,true);assert(errors.length>=1);assert(errors.every(code=>code==='TRANSPORT_ERROR'));
});

test('a startup credential rejection still fails admission at once',async t=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 server.on('connection',ws=>{ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'bad'}}));ws.on('message',raw=>{const f=JSON.parse(raw);ws.send(JSON.stringify({type:'res',id:f.id,ok:false,error:{code:'UNAUTHORIZED'}}));});});
 t.after(async()=>{for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});
 await assert.rejects(connectGatewayClient({url:`ws://127.0.0.1:${server.address().port}`,token:'fixture-only',reconnectMs:20},{startupTimeoutMs:3000}),/UNAUTHORIZED/);
});
test('a session subscriber renews sessions.subscribe on every connection, and only when asked',async t=>{
 const plain=await fixture(t);await delay(10);assert.equal(plain.requests.some(r=>r.method==='sessions.subscribe'),false);
 const f=await fixture(t,(ws,r)=>{if(r.method==='sessions.subscribe')ws.send(JSON.stringify({type:'res',id:r.id,ok:true,payload:{subscribed:true}}));},{subscribeSessions:true});
 for(let i=0;i<50&&!f.requests.some(r=>r.method==='sessions.subscribe');i++)await delay(5);
 assert.equal(f.requests.filter(r=>r.method==='sessions.subscribe').length,1);
 f.peer.terminate();for(let i=0;i<100&&f.requests.filter(r=>r.method==='sessions.subscribe').length<2;i++)await delay(10);
 assert.equal(f.requests.filter(r=>r.method==='sessions.subscribe').length,2,'a new socket is a new subscription');
});
