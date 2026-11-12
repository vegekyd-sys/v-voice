import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createDirectVoiceService} from './session.mjs';
import {preconnectSeeduplex} from '../seeduplex-realtime-provider.mjs';

const until=async(check,ms=1000)=>{for(const end=Date.now()+ms;Date.now()<end;await delay(2))if(check())return true;return check();};
const SESSION='agent:makaron:feishu:group:oc_fixture';

// A provider socket that opens asynchronously, like the real one.
function harness({model='seeduplex',catalog=async()=>({groups:[{tools:[{id:'web_search'}]}]}),context=async()=>'Overlap context',...options}={}) {
 const peers=[],audit=[],reads={catalog:0,context:0};
 class WS extends EventEmitter {
  constructor(url){super();this.url=url;this.readyState=0;this.sent=[];peers.push(this);setImmediate(()=>{if(this.readyState!==0)return;this.readyState=1;this.emit('open');});}
  send(raw){const value=JSON.parse(raw);this.sent.push(value);
   if(value.type==='session.update')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.updated'})),false));
   if(value.type==='session.create')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.created',session:{id:'fixture-dialog'}})),false));}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
  terminate(){this.close();}
 }
 class Server {handleUpgrade(req,socket,head,done){done(socket);}close(){}}
 const gateway={request:async method=>{assert.equal(method,'tools.catalog');reads.catalog++;return catalog(reads.catalog);}};
 const service=createDirectVoiceService({gateway,loadContext:async()=>{reads.context++;return context(reads.context);},wsModule:{WebSocket:WS,WebSocketServer:Server},
  apiKeys:{grok:'fixture-key',seeduplex:'fixture-key'},audit:event=>audit.push(event),...options});
 const client=()=>{const c=new EventEmitter();c.readyState=1;c.sent=[];c.send=raw=>c.sent.push(JSON.parse(raw));c.close=()=>{c.readyState=3;c.emit('close');};return c;};
 const dial=async({prefetched,sessionKey=SESSION,agentId='makaron',beforeAttach,afterAttach}={})=>{
  const reservation=await service.reserve({model,gateway,sessionKey,agentId,actorScoped:true,sessionBound:true,inputPolicy:'native',...(prefetched?{prefetched}:{})});
  const c=client();await beforeAttach?.(c);
  assert.equal(service.attach(reservation.voiceSessionId,reservation.relayTicket,c),true);
  afterAttach?.(c);
  assert(await until(()=>c.sent.some(e=>e.type==='ready')||c.readyState===3));
  return {reservation,client:c};
 };
 const stages=()=>audit.filter(e=>e.type==='call.connection-stage').map(e=>e.stage);
 return {service,gateway,peers,audit,reads,dial,stages,model};
}
const sessionConfig=h=>h.peers.flatMap(p=>p.sent).find(v=>['session.create','session.update'].includes(v.type)).session;

test('reads begun during admission serve the admitted call once, on the socket opened meanwhile',async t=>{
 const h=harness();t.after(()=>h.service.dispose());
 const prefetched=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'seeduplex'});
 assert(await until(()=>h.peers[0]?.readyState===1));
 assert.equal(h.peers[0].sent.length,0,'no session exists before admission');
 const {client}=await h.dial({prefetched});
 assert(client.sent.some(e=>e.type==='ready'));
 assert.deepEqual(h.reads,{catalog:1,context:1});
 assert.equal(h.peers.length,1,'the admitted call reuses the upstream socket');
 assert(sessionConfig(h).instructions.includes('Overlap context'));
 assert.equal(prefetched.adopted,true);
 const stages=h.stages();
 for(const stage of ['catalog-requested','context-requested','catalog-ready','context-ready','admitted','model-ready','provider-ready'])assert(stages.includes(stage),stage);
 assert.equal(stages.filter(stage=>stage==='catalog-requested').length,1);
});

test('reads for another conversation are dropped and the admitted call reads its own',async t=>{
 const h=harness({context:async read=>'Context read '+read});t.after(()=>h.service.dispose());
 const prefetched=h.service.prefetch({gateway:h.gateway,sessionKey:'agent:makaron:feishu:group:oc_previous',agentId:'makaron',model:'seeduplex'});
 await until(()=>h.peers[0]?.readyState===1);
 const {client}=await h.dial({prefetched});
 assert(client.sent.some(e=>e.type==='ready'));
 assert.equal(prefetched.adopted,false);
 assert.deepEqual(h.reads,{catalog:2,context:2});
 assert(sessionConfig(h).instructions.includes('Context read 2'));
 assert(!JSON.stringify(h.peers.flatMap(p=>p.sent)).includes('Context read 1'));
 assert(!h.stages().includes('admitted'));
});

test('an overlap for another agent or model is not adopted',async t=>{
 const h=harness();t.after(()=>h.service.dispose());
 const otherAgent=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'other',model:'seeduplex'});
 await h.dial({prefetched:otherAgent});
 assert.equal(otherAgent.adopted,false);
 const otherModel=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'grok'});
 await h.dial({prefetched:otherModel});
 assert.equal(otherModel.adopted,false);
});

test('a failed overlap does not fail the call',async t=>{
 const h=harness({catalog:async read=>{if(read===1)throw Error('Gateway refused the early read');return {groups:[]};}});t.after(()=>h.service.dispose());
 const prefetched=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'seeduplex'});
 const {client}=await h.dial({prefetched});
 assert(client.sent.some(e=>e.type==='ready'));
 assert.equal(h.reads.catalog,2);
 assert(h.stages().includes('prefetch-failed'));
});

test('an adopted overlap still expires when the client attaches late',async t=>{
 const h=harness({context:async read=>'Context read '+read});t.after(()=>h.service.dispose());
 const prefetched=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'seeduplex'});
 await h.dial({prefetched,beforeAttach:()=>delay(1050)});
 assert.deepEqual(h.reads,{catalog:2,context:2});
 assert(sessionConfig(h).instructions.includes('Context read 2'));
});

test('discarding an overlap closes its unused upstream socket and one overlap serves one call',async t=>{
 const h=harness();t.after(()=>h.service.dispose());
 const dropped=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'seeduplex'});
 await until(()=>h.peers[0]?.readyState===1);
 dropped.discard();
 assert.equal(h.peers[0].readyState,3);
 const prefetched=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'seeduplex'});
 const first=await h.dial({prefetched});
 await h.service.close(first.reservation.voiceSessionId);
 const reads={...h.reads};
 await h.dial({prefetched});
 assert.deepEqual(h.reads,{catalog:reads.catalog+1,context:reads.context+1},'a second call cannot reuse the first call\'s overlap');
});

test('closing an admitted call before attachment closes the socket it would have used',async t=>{
 const h=harness();t.after(()=>h.service.dispose());
 const prefetched=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'seeduplex'});
 await until(()=>h.peers[0]?.readyState===1);
 const reservation=await h.service.reserve({model:'seeduplex',gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',actorScoped:true,sessionBound:true,inputPolicy:'native',prefetched});
 await h.service.close(reservation.voiceSessionId);
 assert.equal(h.peers[0].readyState,3);
 assert.equal(h.peers[0].sent.length,0);
});

test('Grok overlaps its reads without opening an upstream socket',async t=>{
 const h=harness({model:'grok'});t.after(()=>h.service.dispose());
 const prefetched=h.service.prefetch({gateway:h.gateway,sessionKey:SESSION,agentId:'makaron',model:'grok'});
 await delay(5);assert.equal(h.peers.length,0);
 await h.dial({prefetched});
 assert.deepEqual(h.reads,{catalog:1,context:1});assert.equal(prefetched.adopted,true);
});

test('a greeting requested while the model connects is spoken once, at ready',async t=>{
 const h=harness();t.after(()=>h.service.dispose());
 const {client}=await h.dial({afterAttach:c=>{assert(!c.sent.some(e=>e.type==='ready'));c.emit('message',Buffer.from(JSON.stringify({type:'greeting'})),false);}});
 const greetings=()=>h.peers.flatMap(p=>p.sent).filter(v=>v.type==='speech_text_buffer.commit');
 assert(await until(()=>greetings().length===1));
 const sent=h.peers.flatMap(p=>p.sent).map(v=>v.type);
 assert(sent.indexOf('session.create')<sent.indexOf('speech_text_buffer.commit'));
 // The page repeats its request at ready for servers that ignore the early one.
 client.emit('message',Buffer.from(JSON.stringify({type:'greeting'})),false);
 await delay(5);assert.equal(greetings().length,1);
});

test('a greeting requested after ready is still spoken',async t=>{
 const h=harness();t.after(()=>h.service.dispose());
 const {client}=await h.dial();
 const greetings=()=>h.peers.flatMap(p=>p.sent).filter(v=>v.type==='speech_text_buffer.commit');
 assert.equal(greetings().length,0);
 client.emit('message',Buffer.from(JSON.stringify({type:'greeting'})),false);
 assert(await until(()=>greetings().length===1));
});

test('a socket opened ahead is handed over once and never after it failed',async()=>{
 const made=[];
 const createWebSocket=async()=>{const ws=new EventEmitter();ws.readyState=0;ws.terminate=()=>{ws.readyState=3;ws.emit('close');};made.push(ws);return ws;};
 const live=preconnectSeeduplex({apiKey:'fixture-key',createWebSocket});
 assert.equal(live.take(),null,'not created yet');
 await delay(0);
 assert.equal(live.take(),made[0]);assert.equal(live.take(),null);
 live.close();assert.equal(made[0].readyState,0,'a handed-over socket belongs to its bridge');
 const failed=preconnectSeeduplex({apiKey:'fixture-key',createWebSocket});await delay(0);
 made[1].emit('error',Error('network'));
 assert.equal(failed.take(),null);
 const refused=preconnectSeeduplex({apiKey:'fixture-key',createWebSocket:async()=>{throw Error('refused');}});await delay(0);
 assert.equal(refused.take(),null);refused.close();
});
