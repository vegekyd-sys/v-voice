import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {GrokVoiceBridge} from '../realtime-direct-tools/grok-provider.mjs';
import {createRelayAudio,PcmPlaybackQueue,relayWorkletSource,NativeSpeechPause,observeAudioMeters} from './relay-audio.mjs';

function queue(rate=48000,ms=120){return new PcmPlaybackQueue(rate,ms)}
test('visual meters read actual nodes, publish silence when suspended and detach only their taps',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const analysers=[],detached=[],levels=[];
 const context={state:'running',createAnalyser(){const node={value:analysers.length?.04:.1,getFloatTimeDomainData(a){a.fill(this.value);},disconnect(){detached.push(this);}};analysers.push(node);return node;}};
 const input={connect(node){this.tap=node;},disconnect(node){assert.equal(node,this.tap);}},output={...input};
 const stop=observeAudioMeters({context,input,output,onLevel:e=>levels.push(e)});
 t.mock.timers.tick(100);assert.ok(Math.abs(levels[0].input-.1)<1e-7);assert.ok(Math.abs(levels[0].output-.04)<1e-7);
 context.state='suspended';t.mock.timers.tick(100);assert.deepEqual(levels[1],{input:0,output:0});
 stop();assert.equal(detached.length,2);t.mock.timers.tick(500);assert.equal(levels.length,2);
});
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
 const ctx={state:'running',resumeCalls:0,async resume(){this.resumeCalls++;if(options.resume)await options.resume(this);},currentTime:0,destination:{},audioWorklet:{addModule:async url=>vm.runInContext(await(await fetch(url)).text(),realm)},addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener:name=>listeners.delete(name),createMediaStreamSource:()=>({connect(){},disconnect(){}}),createGain:()=>({gain:{value:1},connect(){},disconnect(){}})};
 const relay=createRelayAudio({context:ctx,stream:{},onEvent:e=>events.push(e),onError:e=>errors.push(e.message),onClosed(){},...options,reservation:{voiceSessionId:'fixture',relayTicket:'fixture',provider,...options.reservation}});
 const event=e=>socket.onmessage({data:JSON.stringify({voiceSessionId:'fixture',...e})});const started=relay.start();if(!deferReady){event({type:'ready'});await started;}
 t.after(()=>{relay.dispose();Object.assign(globalThis,old)});
 const speaker=nodes.find(n=>n.name==='v-direct-speaker');const pump=n=>{const output=[];for(let i=0;i<n;i+=128){realm.currentTime=ctx.currentTime;const block=new Float32Array(128);speaker.processor.process([],[[block]]);output.push(...block);ctx.currentTime+=128/48000;}return output;};
 return {relay,event,ctx,speaker,nodes,sent,events,errors,pump,listeners,started};
}
test('actual serialized worklet receives only the selected Grok buffer; Xiaohe stays at 120ms',async t=>{
 const f=await fixture(t,'grok');assert.equal(f.relay.stats.startBufferMs,400);assert.equal(f.speaker.processor.queue.prefill,19200);
});
test('real Grok bridge audio identity matches its completion and releases the held greeting',async t=>{
 const f=await fixture(t,'grok');let sequence=0;
 const bridge=new GrokVoiceBridge({onAudio:(bytes,metadata)=>f.event({type:'audio',sequence:++sequence,sampleRate:24000,audio:bytes.toString('base64'),...metadata}),
  onResponseDone:e=>f.event({type:'audio.done',responseId:e.responseId})},{apiKey:'LOCAL_FIXTURE_ONLY'});
 bridge.receive({type:'response.created',response:{id:'greeting-1'}});
 bridge.receive({type:'response.output_audio.delta',delta:Buffer.from(pcm(4800,8192).buffer).toString('base64')});
 assert(f.pump(1024).every(v=>v===0));
 bridge.receive({type:'response.done',response:{id:'greeting-1',status:'completed'}});
 const heard=f.pump(12000);assert(heard.some(v=>v===.25));assert.equal(f.relay.stats.queuedOutputBytes,0);
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
test('speaker routing preserves exact ordered PCM with immediate 20ms uplink frames',async t=>{
 const f=await fixture(t,'seeduplex',false,{inputGated:true});const mic=f.nodes.find(n=>n.name==='v-direct-mic');for(let i=1;i<=5;i++)mic.port.onmessage({data:new Int16Array(480).fill(i).buffer});const sent=f.sent.filter(x=>x instanceof ArrayBuffer);assert.equal(sent.length,5);for(let i=0;i<5;i++){assert.equal(sent[i].byteLength,960);assert(new Int16Array(sent[i]).every(n=>n===i+1));}assert.equal(f.relay.stats.inputBytes,4800);
});
test('capture rechecks Safari context after ready, independently of the fulfilled dial resume',async t=>{
 const f=await fixture(t,'seeduplex',true,{resume:ctx=>{ctx.state='running';}});
 f.ctx.state='interrupted';f.event({type:'ready'});await f.started;
 assert.equal(f.ctx.resumeCalls,1);assert.equal(f.nodes.filter(n=>n.name==='v-direct-mic').length,1);
});
test('foreground context interruption resumes once; disposal removes the old recovery listener',async t=>{
 const f=await fixture(t,'seeduplex',false,{resume:ctx=>{ctx.state='running';}});
 f.ctx.state='interrupted';f.listeners.get('statechange')();await Promise.resolve();
 assert.equal(f.ctx.state,'running');assert.equal(f.ctx.resumeCalls,1);
 const old=f.listeners.get('statechange');f.relay.dispose();old();assert.equal(f.ctx.resumeCalls,1);
});
test('input diagnostics distinguish active frames, muted tracks and absent worklet callbacks without retaining PCM',async t=>{
 const f=await fixture(t);const mic=f.nodes.find(n=>n.name==='v-direct-mic');
 mic.port.onmessage({data:new Int16Array(480).fill(1600).buffer});mic.port.onmessage({data:new Int16Array(480).buffer});
 f.relay.dispose();const stats=f.sent.filter(x=>typeof x==='string').map(x=>JSON.parse(x)).find(x=>x.type==='playback.stats');
 assert.equal(stats.inputFrames,2);assert.equal(stats.inputActiveFrames,1);assert.equal(stats.inputBytes,1920);assert.equal(stats.contextState,'running');
 assert.equal('audio' in stats,false);assert.equal('samples' in stats,false);
});

const voiceFrame=()=>Int16Array.from({length:480},(_,i)=>Math.round(6000*Math.sin(2*Math.PI*220*i/24000))).buffer;
test('native speech courtesy pauses within 140ms without deleting unconsumed samples',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true}});
 f.event({type:'audio',responseId:'old',sequence:1,sampleRate:24000,audio:Buffer.from(pcm(24000,8192).buffer).toString('base64')});
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');
 for(let i=0;i<7;i++)mic.port.onmessage({data:voiceFrame()});
 assert.equal(f.relay.stats.nativePauses,1);const before=f.speaker.processor.queue.frames;
 assert(f.pump(4800).every(x=>x===0));assert.equal(f.speaker.processor.queue.frames,before);
 assert.equal(f.relay.stats.clears,0);assert(!f.sent.some(x=>typeof x==='string'&&JSON.parse(x).type==='barge-in'));
 f.event({type:'input.speech.started'});f.event({type:'input.speech.stopped'});
 f.event({type:'audio',responseId:'next',sequence:2,sampleRate:24000,audio:Buffer.from(pcm(2400,-8192).buffer).toString('base64')});
 f.event({type:'audio',responseId:'old',sequence:3,sampleRate:24000,audio:Buffer.from(pcm(2400,8192).buffer).toString('base64')});
 f.event({type:'audio.done'});const played=f.pump(24000).filter(x=>x!==0);
 assert(played.length>0);assert(played.every(x=>x===-.25),'only the new answer may play');assert.equal(f.relay.stats.clears,1);
 assert.equal(f.relay.stats.queuedOutputBytes,0);assert.deepEqual(f.errors,[]);
});
test('short clicks and broadband noise never acquire a native speech pause',()=>{
 const p=new NativeSpeechPause();
 for(let i=0;i<5;i++)assert.equal(p.observe(voiceFrame(),true,i*20),false);
 assert.equal(p.observe(new Int16Array(480).buffer,true,100),false);
 let seed=1234567;const noise=()=>Int16Array.from({length:480},()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>16)*.4}).buffer;
 for(let i=0;i<100;i++)assert.equal(p.observe(noise(),true,120+i*20),false);
});
test('an unconfirmed pause expires but recognized speech waits for model disposition',()=>{
 const p=new NativeSpeechPause();for(let i=0;i<7;i++)p.observe(voiceFrame(),true,i*20);
 assert.equal(p.held,true);assert.equal(p.observe(new Int16Array(480).buffer,true,1920),false);
 assert.equal(p.observe(voiceFrame(),true,1940),false,'an expired probe cannot immediately reacquire');
 for(let i=0;i<20;i++)p.observe(new Int16Array(480).buffer,true,4160+i*20);
 p.nativeStarted(4600);assert.equal(p.observe(new Int16Array(480).buffer,true,5000),true);
 p.nativeStopped(5000);assert.equal(p.observe(new Int16Array(480).buffer,true,6799),true);
 assert.equal(p.observe(new Int16Array(480).buffer,true,6800),true);
 assert.equal(p.observe(voiceFrame(),false,7000),false);
 p.reset();for(let i=0;i<607;i++)p.observe(voiceFrame(),true,i*20);
 assert.equal(p.held,false,'a continuous unconfirmed signal cannot hold playback forever');
});
test('paused audio-thread output resumes at the exact sample rather than repeating or dropping a syllable',()=>{
 const q=queue(24000,0);q.push(Int16Array.from([1,2,3,4,5]));q.end();
 assert.equal(Math.round(render(q,1)[0]*32768),1);q.paused=true;
 assert(render(q,5).every(x=>x===0));assert.equal(q.consumed,1);
 q.paused=false;assert.deepEqual([...render(q,4)].map(x=>Math.round(x*32768)),[2,3,4,5]);assert.equal(q.underflows,0);
});

test('speech already underway before first output pauses before the jitter window can play an early reply',()=>{
 const p=new NativeSpeechPause();for(let i=0;i<30;i++)assert.equal(p.observe(voiceFrame(),false,i*20),false);
 assert.equal(p.observe(voiceFrame(),true,600),true,'ongoing speech is known on the first output frame');
});

test('an early reply arriving between syllables still yields before playing',()=>{
 const p=new NativeSpeechPause();for(let i=0;i<20;i++)p.observe(voiceFrame(),false,i*20);
 for(let i=0;i<9;i++)assert.equal(p.observe(new Int16Array(480).buffer,false,400+i*20),false);
 assert.equal(p.observe(new Int16Array(480).buffer,true,580),true,'a 200ms syllable gap is not a completed caller turn');
});

test('unconfirmed speech gets a bounded handover; an ignored acknowledgment cannot wait for a whole generation',()=>{
 const p=new NativeSpeechPause();for(let i=0;i<8;i++)p.observe(voiceFrame(),true,i*20,false);
 assert.equal(p.observe(new Int16Array(480).buffer,true,2500,false),true);
 assert.equal(p.observe(new Int16Array(480).buffer,true,2600,false),false);
 p.generationDone(4000);assert.equal(p.observe(new Int16Array(480).buffer,true,4020,true),false,'a late terminal cannot revive a rejected pause');
 p.nativeStarted(4050);p.nativeStopped(4800);assert.equal(p.observe(new Int16Array(480).buffer,true,6500,true),true);
 assert.equal(p.observe(new Int16Array(480).buffer,true,6600,true),true);
});

test('a confirmed speech stop retires an already-generated response as well as its queued playback',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true}}),frame=value=>Buffer.from(pcm(2400,value).buffer).toString('base64');
 f.event({type:'audio',responseId:'old',sequence:1,sampleRate:24000,audio:frame(8192)});f.event({type:'audio.done'});
 f.event({type:'audio.clear',retiredResponseId:'old'});
 f.event({type:'audio',responseId:'old',sequence:2,sampleRate:24000,audio:frame(8192)});
 assert(f.pump(24000).every(x=>x===0),'a late old tail cannot reacquire playback');
 f.event({type:'audio',responseId:'new',sequence:3,sampleRate:24000,audio:frame(-8192)});f.event({type:'audio.done'});
 assert(f.pump(24000).filter(x=>x!==0).every(x=>x===-.25));
});

for(const nativePlaybackPolicy of ['provider'])test(nativePlaybackPolicy+' turns keep background speech onset from muting the live answer',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true,nativePlaybackPolicy}});
 f.event({type:'audio',responseId:'story',sequence:1,sampleRate:24000,audio:Buffer.from(pcm(24000,8192).buffer).toString('base64')});
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');for(let i=0;i<25;i++)mic.port.onmessage({data:voiceFrame()});
 f.event({type:'input.speech.started'});f.event({type:'input.speech.stopped'});
 assert.equal(f.relay.stats.nativePauses,0);assert.equal(f.relay.stats.clears,0);
 assert(f.pump(9600).some(x=>x===.25));assert.equal(f.relay.stats.inputBytes,25*960);
 assert(!f.sent.some(x=>typeof x==='string'&&JSON.parse(x).type==='barge-in'));
});

for(const nativePlaybackPolicy of ['provider','assisted'])test(nativePlaybackPolicy+' replacement retires the old tail even when local VAD never paused it',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true,nativePlaybackPolicy}}),frame=value=>Buffer.from(pcm(2400,value).buffer).toString('base64');
 f.event({type:'audio',responseId:'old',sequence:1,sampleRate:24000,audio:frame(8192)});
 f.event({type:'audio',responseId:'new',sequence:2,sampleRate:24000,audio:frame(-8192)});
 f.event({type:'audio',responseId:'old',sequence:3,sampleRate:24000,audio:frame(8192)});f.event({type:'audio.done'});
 const played=f.pump(24000).filter(x=>x!==0);assert(played.length>0);assert(played.every(x=>x===-.25));assert.equal(f.relay.stats.clears,1);
});

test('assisted pause needs both local speech and service confirmation',()=>{
 const p=new NativeSpeechPause({minRms:.035,consecutiveOnset:true,trustNativeOnset:false,requireConfirmation:true});
 const quiet=new Int16Array(480).buffer,background=()=>{const a=new Int16Array(voiceFrame());for(let i=0;i<a.length;i++)a[i]*=.2;return a.buffer;};
 p.nativeStarted(0);assert.equal(p.held,false);p.nativeStopped(1,false);
 for(let i=0;i<100;i++)assert.equal(p.observe(i%6===5?quiet:background(),true,i*20),false);
 for(let i=0;i<7;i++)p.observe(voiceFrame(),true,2000+i*20);assert.equal(p.held,false);p.nativeStarted(2140);assert.equal(p.held,true);
 p.ignored();assert.equal(p.observe(voiceFrame(),true,2160),false);
 for(let i=0;i<20;i++)p.observe(quiet,true,2200+i*20);
 for(let i=0;i<7;i++)p.observe(voiceFrame(),true,2600+i*20);assert.equal(p.held,false);p.nativeStarted(2740);assert.equal(p.held,true);
});
test('assisted ignored-turn release is scoped to the preserved response',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true,nativePlaybackPolicy:'assisted'}});
 f.event({type:'audio',responseId:'story',sequence:1,sampleRate:24000,audio:Buffer.from(pcm(24000,8192).buffer).toString('base64')});
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');for(let i=0;i<8;i++)mic.port.onmessage({data:voiceFrame()});
 assert.equal(f.relay.stats.nativePauses,0);
 f.event({type:'input.speech.started'});assert.equal(f.relay.stats.nativePauses,1);
 f.event({type:'input.speech.ignored',preservedResponseId:'stale'});assert.equal(f.relay.stats.nativeResumes,0);
 f.event({type:'input.speech.ignored',preservedResponseId:'story'});assert.equal(f.relay.stats.nativeResumes,1);
 assert(f.pump(9600).some(x=>x===.25));assert.equal(f.relay.stats.clears,0);
});

test('scoped server replacement clears a generated old queue before new PCM and ignores its late completion',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true,nativePlaybackPolicy:'assisted'}}),frame=(count,value)=>Buffer.from(pcm(count,value).buffer).toString('base64');
 f.event({type:'audio',responseId:'old',sequence:1,sampleRate:24000,audio:frame(120000,8192)});f.event({type:'audio.done',responseId:'old'});
 assert(f.pump(9600).some(x=>x===.25));
 // Legacy cached notice may still arrive from an older server.
 f.event({type:'audio',source:'cached-native-tool-start',sequence:2,sampleRate:24000,audio:frame(24000,8192)});
 f.event({type:'audio.clear',reason:'response-replaced',retiredResponseId:'old'});
 assert(f.pump(24000).every(x=>x===0),'old audio stops while the next answer has no PCM yet');
 f.event({type:'audio',responseId:'next',sequence:3,sampleRate:24000,audio:frame(2400,-8192)});
 f.event({type:'audio.done',responseId:'old'});assert.equal(f.speaker.processor.queue.complete,false);
 f.event({type:'audio',responseId:'old',sequence:4,sampleRate:24000,audio:frame(2400,8192)});
 f.event({type:'audio.done',responseId:'next'});
 const heard=f.pump(24000).filter(x=>x!==0);assert(heard.length>0);assert(heard.every(x=>x===-.25));assert.deepEqual(f.errors,[]);
});

test('a delayed scoped clear for a retired response leaves the current browser queue intact',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true,nativePlaybackPolicy:'assisted'}}),frame=value=>Buffer.from(pcm(24000,value).buffer).toString('base64');
 f.event({type:'audio',responseId:'old',sequence:1,sampleRate:24000,audio:frame(8192)});
 f.event({type:'audio',responseId:'next',sequence:2,sampleRate:24000,audio:frame(-8192)});
 f.event({type:'audio.clear',retiredResponseId:'old'});f.event({type:'audio.done',responseId:'next'});
 const heard=f.pump(48000).filter(x=>x!==0);assert(heard.length>0);assert(heard.every(x=>x===-.25));
});

for(const ended of [true,false])test('recognized interruption stays silent through a delayed replacement; generationComplete='+ended,async t=>{
 let now=0;const oldPerformance=globalThis.performance;
 globalThis.performance={now:()=>now};t.after(()=>{globalThis.performance=oldPerformance;});
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true,nativePlaybackPolicy:'assisted'}});
 const audio=(id,n,value,sequence)=>f.event({type:'audio',responseId:id,sequence,sampleRate:24000,audio:Buffer.from(pcm(n,value).buffer).toString('base64')});
 audio('old',120000,8192,1);if(ended)f.event({type:'audio.done',responseId:'old'});
 assert(f.pump(9600).some(x=>x===.25));
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');
 for(let i=0;i<8;i++){now+=20;mic.port.onmessage({data:voiceFrame()});}
 f.event({type:'input.speech.started'});f.event({type:'input.speech.stopped',recognized:true});
 const consumed=f.speaker.processor.queue.consumed;
 for(const at of [2500,5000,16000,60000]){
  now=at;mic.port.onmessage({data:new Int16Array(480).buffer});
  assert(f.pump(9600).every(x=>x===0),'old answer must not resume while awaiting a response at '+at);
  assert.equal(f.speaker.processor.queue.consumed,consumed);
 }
 f.event({type:'input.speech.ignored',preservedResponseId:'stale'});
 assert(f.pump(9600).every(x=>x===0));
 f.event({type:'audio.clear',retiredResponseId:'old'});
 audio('next',2400,-8192,2);f.event({type:'audio.done',responseId:'next'});
 const heard=f.pump(24000).filter(x=>x!==0);assert(heard.length>0);assert(heard.every(x=>x===-.25));
});
test('recognized speech can still be ignored; failed or empty recognition remains bounded',()=>{
 const quiet=new Int16Array(480).buffer;
 for(const recognized of [true,false]){
  const p=new NativeSpeechPause({trustNativeOnset:false});for(let i=0;i<8;i++)p.observe(voiceFrame(),true,i*20);
  p.nativeStarted(160);p.nativeStopped(400,recognized);
  assert.equal(p.observe(quiet,true,20000),recognized);
  if(recognized){p.nativeStarted(20020);p.nativeStopped(20040,false);assert.equal(p.observe(quiet,true,23000),true,'a later failed probe cannot release a pending recognized turn');}
  p.ignored();assert.equal(p.observe(quiet,true,20020),false);
  p.reset();assert.equal(p.observe(quiet,true,20040),false);
 }
});

test('assisted sustained unconfirmed sound never pauses queued speech',async t=>{
 const f=await fixture(t,'seeduplex',false,{reservation:{nativeDuplex:true,nativePlaybackPolicy:'assisted'}});
 f.event({type:'audio',responseId:'story',sequence:1,sampleRate:24000,audio:Buffer.from(pcm(24000,8192).buffer).toString('base64')});
 const mic=f.nodes.find(n=>n.name==='v-direct-mic');
 for(let i=0;i<3000;i++)mic.port.onmessage({data:voiceFrame()});
 assert.equal(f.relay.stats.nativePauses,0);assert.equal(f.relay.stats.clears,0);
 assert(f.pump(9600).some(x=>x===.25));
});

test('assisted service onset may precede local corroboration but cannot survive expiration or stop',()=>{
 for(const delay of [0,3000]){
  const p=new NativeSpeechPause({trustNativeOnset:false,requireConfirmation:true});p.nativeStarted(0);
  for(let i=0;i<8;i++)p.observe(voiceFrame(),true,delay+i*20);
  assert.equal(p.held,delay===0);
 }
 const p=new NativeSpeechPause({trustNativeOnset:false,requireConfirmation:true});p.nativeStarted(0);p.nativeStopped(10,false);
 for(let i=0;i<8;i++)p.observe(voiceFrame(),true,20+i*20);
 assert.equal(p.held,false);
});
