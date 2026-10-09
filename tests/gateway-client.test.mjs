import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {GatewayClient} from '../lib/gateway-client.mjs';
import {setTimeout as delay} from 'node:timers/promises';
async function fixture(t,respond=()=>{}){
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 const requests=[];let peer;
 server.on('connection',ws=>{peer=ws;ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'real-challenge'}}));ws.on('message',raw=>{const f=JSON.parse(raw);requests.push(f);if(f.method==='connect')ws.send(JSON.stringify({type:'res',id:f.id,ok:true,payload:{type:'hello-ok',protocol:4}}));else respond(ws,f);});});
 let hello;const ready=new Promise(r=>hello=r);const events=[];
 const client=new GatewayClient({url:`ws://127.0.0.1:${server.address().port}`,token:'fixture-only',onHelloOk:hello,onEvent:e=>events.push(e),reconnectMs:30});client.start();await ready;
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
