import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRelayAudio,PcmPlaybackQueue,relayWorkletSource} from './relay-audio.mjs';

function queue(rate=48000,ms=120){return new PcmPlaybackQueue(rate,ms)}
const pcm=(n,value=8192)=>new Int16Array(n).fill(value);
function render(q,n=128,at=0){const out=new Float32Array(n);q.render(out,at);return out;}
function replay(rate,arrivals){
 const q=queue(rate),out=[];let index=0,first=null;
 for(let frame=0;frame<rate*.5;frame+=128){const at=frame/rate;
  while(index<arrivals.length&&at>=arrivals[index]){q.push(pcm(480,8192+index*100));index++;if(index===arrivals.length)q.end();}
  const block=render(q,128,at);for(const v of block){if(v!==0&&first===null)first=out.length;out.push(v);}
 }
 const last=out.findLastIndex(v=>v!==0);return {q,out,first,last,zeros:first===null?0:out.slice(first,last+1).filter(v=>v===0).length};
}
test('120ms audio-thread prebuffer absorbs the recorded 50/60ms scheduling holes without replay',()=>{
 const arrivals=[0,.02,.04,.11,.13,.15,.23,.25,.27];
 for(const rate of [24000,44100,48000]){const r=replay(rate,arrivals);assert.equal(r.zeros,0);assert.equal(r.q.consumed,9*480);assert.equal(r.q.underflows,0);assert.ok(r.first/rate<.13);assert.ok(r.first/rate>=.11);}
});
test('starvation produces silence, not the last syllable; new speech resumes once after rebuffer',()=>{
 const q=queue(48000,0);q.push(pcm(480,16384));const heard=render(q,960);assert(heard.every(v=>v===.5));
 assert(render(q).every(v=>v===0));assert.equal(q.underflows,1);assert(render(q).every(v=>v===0));assert.equal(q.underflows,1);
 q.push(pcm(480,8192));const next=render(q,960);assert(next.every(v=>v===.25));assert.equal(q.consumed,960);
});
test('a large first Grok packet cannot bypass the real jitter window',()=>{
 for(const rate of [24000,44100,48000]){
  const q=queue(rate),heard=[];let first=null,second=false;
  q.push(pcm(5872));
  for(let frame=0;frame<rate*.9;frame+=128){const at=frame/rate;if(at>=.3&&!second){q.push(pcm(12000));q.end();second=true;}
   for(const value of render(q,128,at)){if(value&&first===null)first=heard.length;heard.push(value);}
  }
  const last=heard.findLastIndex(v=>v!==0);assert(first/rate>=.11);assert(first/rate<.13);assert.equal(heard.slice(first,last+1).filter(v=>v===0).length,0);assert.equal(q.underflows,0);assert.equal(q.consumed,17872);
 }
});
test('recorded Grok 595ms and late tail cadence plays continuously with the 400ms provider lead',()=>{
 const cases=[[[0,5872],[.595,20552],[.599,3670],[1.167,8074],[1.466,15414],[1.785,11744],[1.885,14680],[1.973,8074],[1.974,1680]],[[0,5872],[.329,15414],[.330,5138],[.332,7340],[1.765,2476]]];
 for(const rate of [24000,44100,48000])for(const arrivals of cases){
  const q=queue(rate,400),heard=[];let index=0,first=null;
  for(let frame=0;frame<rate*5;frame+=128){const at=frame/rate;
   while(index<arrivals.length&&at>=arrivals[index][0]){q.push(pcm(arrivals[index][1]));index++;if(index===arrivals.length)q.end();}
   for(const value of render(q,128,at)){if(value&&first===null)first=heard.length;heard.push(value);}
  }
  const last=heard.findLastIndex(v=>v!==0);assert(first/rate>=.39&&first/rate<.41);assert.equal(heard.slice(first,last+1).filter(v=>v===0).length,0);assert.equal(q.underflows,0);assert.equal(q.consumed,arrivals.reduce((n,x)=>n+x[1],0));
 }
});
test('FIFO retains chunk boundaries, sample order, and legitimate identical frames',()=>{
 const q=queue(24000,0);q.push(Int16Array.from([1,2,3]));q.push(Int16Array.from([4,5]));q.push(Int16Array.from([4,5]));q.end();
 assert.deepEqual([...render(q,7)].map(v=>Math.round(v*32768)),[1,2,3,4,5,4,5]);assert.equal(q.frames,0);assert.equal(q.underflows,0);
});
test('clear discards queued/partly consumed speech, resets resampling, and bounds allocation',()=>{
 const q=new PcmPlaybackQueue(44100,0,1024);q.push(pcm(1000));render(q);assert.throws(()=>q.push(pcm(1000)),/overflow/);
 q.clear();assert.equal(q.frames,0);assert(render(q).every(v=>v===0));q.push(pcm(100,-8192));q.end();const out=render(q);assert(out.every(v=>v===-.25));
});
test('fast long speech releases queue capacity after playback, independently of a 30-second lead',()=>{
 const q=queue(24000,0);for(let i=0;i<70;i++)q.push(pcm(24000));assert.equal(q.frames,70*24000);q.end();
 for(let i=0;i<70*24000;i+=24000)render(q,24000);assert.equal(q.frames,0);assert.equal(q.consumed,70*24000);assert.equal(q.underflows,0);
});

async function fixture(t,provider,deferReady=false,options={}){
 const old={WebSocket:globalThis.WebSocket,location:globalThis.location,AudioWorkletNode:globalThis.AudioWorkletNode};
 let socket;const sent=[],nodes=[],classes=new Map(),events=[],errors=[],listeners=new Map();
 class Socket{static OPEN=1;readyState=1;bufferedAmount=0;constructor(){socket=this}send(e){sent.push(e)}close(){this.readyState=3;this.onclose?.()}}
 const realm=vm.createContext({Int16Array,Float32Array,sampleRate:48000,currentTime:0,registerProcessor:(name,K)=>classes.set(name,K),AudioWorkletProcessor:class{constructor(){this.port={postMessage:e=>this.toHost?.(e)}}}});
 class Worklet{constructor(context,name,options){this.name=name;this.processor=new(classes.get(name))(options);this.port={postMessage:(e,transfer=[])=>this.processor.port.onmessage?.({data:structuredClone(e,{transfer})}),close(){}};this.processor.toHost=e=>this.port.onmessage?.({data:e});nodes.push(this)}connect(){}disconnect(){this.disconnected=true}}
 Object.assign(globalThis,{WebSocket:Socket,location:{href:'https://voice.test/voice/'},AudioWorkletNode:Worklet});
 const ctx={state:'running',currentTime:0,destination:{},audioWorklet:{addModule:async url=>vm.runInContext(await(await fetch(url)).text(),realm)},addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener:name=>listeners.delete(name),createMediaStreamSource:()=>({connect(){},disconnect(){}}),createGain:()=>({gain:{value:1},connect(){},disconnect(){}})};
 const relay=createRelayAudio({context:ctx,stream:{},reservation:{voiceSessionId:'fixture',relayTicket:'fixture',provider},onEvent:e=>events.push(e),onError:e=>errors.push(e.message),onClosed(){},...options});
 const event=e=>socket.onmessage({data:JSON.stringify({voiceSessionId:'fixture',...e})});const started=relay.start();if(!deferReady){event({type:'ready'});await started;}
 t.after(()=>{relay.dispose();Object.assign(globalThis,old)});
 const speaker=nodes.find(n=>n.name==='v-direct-speaker');const pump=n=>{const output=[];for(let i=0;i<n;i+=128){realm.currentTime=ctx.currentTime;const block=new Float32Array(128);speaker.processor.process([],[[block]]);output.push(...block);ctx.currentTime+=128/48000;}return output;};
 return {relay,event,ctx,speaker,nodes,sent,events,errors,pump,listeners,started};
}
test('actual serialized worklet receives only the selected Grok buffer; Xiaohe stays at 120ms',async t=>{
 const f=await fixture(t,'grok');assert.equal(f.relay.stats.startBufferMs,400);assert.equal(f.speaker.processor.queue.prefill,19200);
});
test('recorded Grok greeting hole is held to completion; next answer keeps its streaming lead and the microphone',async t=>{
 const f=await fixture(t,'grok');
 // Original R14 greeting packets: a 1.867s mid-response arrival hole,
 // despite the first three packets already containing 1.346s of PCM.
 const arrivals=[[0,5872],[.181,22754],[.181,3670],[2.048,8074],[2.229,14680],[2.231,11744],[2.410,16882],[2.411,8074],[2.411,1850]];
 let index=0;const before=[];
 for(let frame=0;frame<48000*2.5;frame+=128){
  const at=frame/48000;
  while(index<arrivals.length&&at>=arrivals[index][0]){const n=arrivals[index][1];f.event({type:'audio',sequence:index+1,sampleRate:24000,audio:Buffer.from(pcm(n).buffer).toString('base64')});index++;}
  before.push(...f.pump(128));
 }
 assert(before.every(v=>v===0));assert.equal(f.speaker.processor.queue.consumed,0);
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');mic.port.onmessage({data:new Int16Array(480).buffer});assert.equal(f.relay.stats.inputBytes,960);
 f.event({type:'audio.done'});const n=arrivals.reduce((sum,x)=>sum+x[1],0),heard=f.pump(n*2+512);
 assert(heard.slice(0,n*2).every(v=>v===.25));assert(heard.slice(n*2).every(v=>v===0));assert.equal(f.speaker.processor.queue.consumed,n);assert.equal(f.relay.stats.underflows,0);
 f.event({type:'audio',sequence:10,sampleRate:24000,audio:Buffer.from(pcm(24000,-8192).buffer).toString('base64')});
 const next=f.pump(24000);assert(next.some(v=>v===-.25));assert.equal(f.speaker.processor.queue.holdUntilComplete,false);
 f.event({type:'audio.done'});f.pump(48000);assert.equal(f.relay.stats.underflows,0);assert.equal(f.relay.stats.duplicateFrames,0);
});
test('an interrupted held greeting is retired; the next response does not inherit its hold',async t=>{
 const f=await fixture(t,'grok');const audio=value=>Buffer.from(pcm(24000,value).buffer).toString('base64');
 f.event({type:'audio',sequence:1,sampleRate:24000,audio:audio(8192)});assert(f.pump(24000).every(v=>v===0));
 f.event({type:'audio.clear'});f.event({type:'audio',sequence:2,sampleRate:24000,audio:audio(-8192)});
 const out=f.pump(24000);assert(out.some(v=>v===-.25));assert(out.every(v=>v===0||v===-.25));assert.equal(f.speaker.processor.queue.holdUntilComplete,false);
 f.event({type:'audio.done'});f.pump(48000);assert.equal(f.relay.stats.underflows,0);
});
test('serialized production worklet executes; exact relay sequence is consumed once, identical PCM still valid',async t=>{
 const f=await fixture(t),audio=Buffer.alloc(960,1).toString('base64');
 for(const sequence of [1,1,2])f.event({type:'audio',sequence,sampleRate:24000,audio});f.event({type:'audio.done'});f.pump(48000);
 assert.equal(f.relay.stats.duplicateFrames,1);assert.equal(f.relay.stats.outputBytes,1920);assert.equal(f.relay.stats.queuedOutputBytes,0);assert.equal(f.speaker.processor.queue.consumed,960);assert.deepEqual(f.errors,[]);
});
test('Safari interruption buffers audio without ending the call; render-thread playback drains after resume',async t=>{
 const f=await fixture(t);f.ctx.state='interrupted';f.listeners.get('statechange')();f.event({type:'audio',sequence:1,sampleRate:24000,audio:Buffer.alloc(960,1).toString('base64')});
 assert.equal(f.relay.stats.queuedOutputBytes,960);assert(f.events.some(e=>e.type==='playback.blocked'));assert.deepEqual(f.errors,[]);
 f.ctx.state='running';f.listeners.get('statechange')();f.event({type:'audio.done'});f.pump(48000);assert.equal(f.relay.stats.queuedOutputBytes,0);assert(f.events.some(e=>e.type==='playback.resumed'));
});
test('clear retires old audio and late epoch receipts; only new speech is played',async t=>{
 const f=await fixture(t);const frame=value=>Buffer.from(pcm(2400,value).buffer).toString('base64');
 f.event({type:'audio',sequence:1,sampleRate:24000,audio:frame(8192)});f.event({type:'audio.clear'});f.event({type:'audio',sequence:2,sampleRate:24000,audio:frame(-8192)});
 f.speaker.port.onmessage({data:{type:'playback',epoch:0,consumed:90000,lastPlayedAt:0}});assert.equal(f.relay.stats.queuedOutputBytes,4800);
 f.event({type:'audio.done'});const out=f.pump(24000);assert(out.filter(v=>v!==0).every(v=>v===-.25));assert.equal(f.relay.stats.queuedOutputBytes,0);
});
test('farewell acknowledgement waits for actual render and 750ms tail; disposal rejects stale audio',async t=>{
 const f=await fixture(t);f.event({type:'audio',sequence:1,sampleRate:24000,audio:Buffer.alloc(960,1).toString('base64')});f.event({type:'audio.done'});f.event({type:'end.after-playback',callId:'end-1'});
 assert.equal(f.sent.filter(s=>typeof s==='string'&&JSON.parse(s).type==='playback.drained').length,0);
 f.pump(48000);await new Promise(r=>setTimeout(r,120));assert.equal(f.sent.filter(s=>typeof s==='string'&&JSON.parse(s).type==='playback.drained').length,1);
 f.relay.dispose();const bytes=f.relay.stats.outputBytes;f.event({type:'audio',sequence:2,sampleRate:24000,audio:Buffer.alloc(960).toString('base64')});assert.equal(f.relay.stats.outputBytes,bytes);assert(f.nodes.every(n=>n.disconnected));
});
test('worklet source does not perform main-thread per-frame BufferSource scheduling',()=>{
 assert.match(relayWorkletSource(),/registerProcessor\('v-direct-speaker'/);assert.doesNotMatch(createRelayAudio.toString(),/createBufferSource/);
});
test('queued and prebuffering playback reports busy before the first rendered sample',async t=>{
 const f=await fixture(t);f.event({type:'audio',sequence:1,sampleRate:24000,audio:Buffer.alloc(960,1).toString('base64')});
 assert(f.sent.some(raw=>typeof raw==='string'&&JSON.parse(raw).type==='playback.state'&&JSON.parse(raw).speaking));
 f.event({type:'audio.done'});f.pump(48000);assert.equal(JSON.parse(f.sent.filter(raw=>typeof raw==='string'&&JSON.parse(raw).type==='playback.state').at(-1)).speaking,false);
});

test('a slow upstream connect does not capture or overflow pre-call microphone PCM; first greeting is retained',async t=>{
 const f=await fixture(t,'grok',true);await new Promise(r=>setImmediate(r));
 f.ctx.currentTime=10;assert.equal(f.nodes.length,0);assert.equal(f.relay.stats.inputBytes,0);assert.deepEqual(f.errors,[]);
 f.event({type:'ready'});f.event({type:'audio',sequence:1,sampleRate:24000,audio:Buffer.alloc(960,1).toString('base64')});f.event({type:'audio.done'});
 await f.started;const speaker=f.nodes.find(n=>n.name==='v-direct-speaker');assert(speaker);assert.equal(speaker.processor.queue.frames,480);
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');assert(mic);mic.port.onmessage({data:new Int16Array(480).buffer});
 assert.equal(f.relay.stats.inputBytes,960);assert.equal(f.sent.filter(x=>x instanceof ArrayBuffer).length,1);assert.deepEqual(f.errors,[]);
});
test('closing a connecting call cannot attach late microphone or playback nodes',async t=>{
 const f=await fixture(t,'grok',true);const outcome=assert.rejects(f.started,/关闭/);
 f.relay.dispose();await outcome;f.event({type:'ready'});await new Promise(r=>setImmediate(r));assert.equal(f.nodes.length,0);
});

test('a sustained client utterance retires backend final PCM within four 20ms frames, keeps uploading mic, and rejects old tail',async t=>{
 const f=await fixture(t,'seeduplex'),frame=Buffer.from(pcm(24000).buffer).toString('base64');
 f.event({type:'audio',sequence:1,sampleRate:24000,audio:frame,source:'injected-speech',responseId:'final-1'});
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');
 mic.port.onmessage({data:pcm(480,0).buffer});mic.port.onmessage({data:pcm(480,16000).buffer});mic.port.onmessage({data:pcm(480,0).buffer});
 assert.equal(f.relay.stats.clears,0,'silence and one spike are not a speech onset');
 for(let i=0;i<3;i++)mic.port.onmessage({data:pcm(480,3000).buffer});assert.equal(f.relay.stats.clears,0);
 mic.port.onmessage({data:pcm(480,3000).buffer});
 assert.equal(f.relay.stats.clears,1);assert.equal(f.relay.stats.queuedOutputBytes,0);assert(f.pump(1024).every(v=>v===0));
 assert.equal(f.sent.filter(x=>typeof x==='string'&&JSON.parse(x).type==='barge-in').length,1);
 assert.equal(f.sent.filter(x=>x instanceof ArrayBuffer).length,7,'every mic frame remains uploaded');
 f.event({type:'audio',sequence:2,sampleRate:24000,audio:frame,source:'injected-speech',responseId:'final-1'});
 assert.equal(f.relay.stats.queuedOutputBytes,0);assert(f.pump(1024).every(v=>v===0));
 f.event({type:'audio',sequence:3,sampleRate:24000,audio:Buffer.from(pcm(2400,-8192).buffer).toString('base64'),responseId:'next'});f.event({type:'audio.done'});
 const heard=f.pump(48000);assert(heard.some(v=>v===-.25));assert(heard.every(v=>v===0||v===-.25));assert.deepEqual(f.errors,[]);
});
test('ordinary native speech still uses upstream interruption rather than the fixed-speech detector',async t=>{
 const f=await fixture(t,'seeduplex');f.event({type:'audio',sequence:1,sampleRate:24000,audio:Buffer.from(pcm(24000).buffer).toString('base64'),responseId:'native'});
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');for(let i=0;i<10;i++)mic.port.onmessage({data:pcm(480,3000).buffer});assert.equal(f.relay.stats.clears,0);assert.equal(f.relay.stats.inputBytes,9600);
});


test('speaker-gated input cannot interrupt backend playback before a routing decision',async t=>{
 const f=await fixture(t,'seeduplex',false,{inputGated:true});
 f.event({type:'audio',sequence:1,sampleRate:24000,audio:Buffer.from(pcm(24000).buffer).toString('base64'),source:'injected-speech',responseId:'final-1'});
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');for(let i=0;i<10;i++)mic.port.onmessage({data:pcm(480,3000).buffer});
 assert.equal(f.relay.stats.clears,0);assert.equal(f.relay.stats.inputBytes,9600);
 assert(!f.sent.some(x=>typeof x==='string'&&JSON.parse(x).type==='barge-in'));
 f.event({type:'audio.clear'});assert.equal(f.relay.stats.clears,1);
});
