import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {encode,decode} from '@msgpack/msgpack';
import {FishAsrStream,FISH_STT_URL} from './fish-asr.mjs';
import {FishVoiceBridge,createFishBudget,fishConfigured} from './fish-provider.mjs';
import {streamFishReply} from './fish-synthesis.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fishBudgetFromFile} from './fish-provider.mjs';

const config={audio:{format:'pcm_s16le',sample_rate:24000,channels:1},turn_detection:{mode:'auto'},results:{drafts:true}};
async function until(fn){for(let n=0;n<200&&!fn();n++)await delay(2);assert(fn(),'expected asynchronous result');}
function asrFixture(options={}){
  const sent=[],events=[],errors=[];const socket=new EventEmitter();socket.readyState=1;socket.send=raw=>sent.push(decode(raw));socket.close=()=>{socket.readyState=3;socket.emit('close');};
  const asr=new FishAsrStream({apiKey:'private-fixture',createWebSocket:async(url,opts)=>{assert.equal(url,FISH_STT_URL);assert.equal(opts.headers.model,'transcribe-stream-1');return socket;},onEvent:e=>events.push(e),onError:e=>errors.push(e.message),...options});
  const event=e=>socket.emit('message',encode(e),true);
  return {asr,socket,sent,events,errors,event,async connect(){const promise=asr.connect();await delay(0);socket.emit('open');assert.equal(sent[0].type,'config');event({type:'session_started',seq:0,config});await promise;}};
}
test('Fish native MessagePack buffers 20ms PCM into 100ms bin frames and finishes remainder',async t=>{
  const f=asrFixture();t.after(()=>f.asr.close());await f.connect();
  for(let n=0;n<6;n++)f.asr.append(Buffer.alloc(960,n));
  assert.equal(f.sent.filter(e=>e.type==='audio').length,1);
  assert(f.sent[1].data instanceof Uint8Array);assert.equal(f.sent[1].data.length,4800);
  f.asr.agentSpeaking(true);f.asr.agentSpeaking(true);assert.equal(f.sent.filter(e=>e.type==='agent_speaking').length,1);
  f.asr.finish();assert.equal(f.sent.at(-2).data.length,960);assert.equal(f.sent.at(-1).type,'audio_done');
});
test('Fish rejects mismatched accepted format, event sequence gaps, and text frames',async()=>{
  for(const kind of ['config','sequence','text']){
    const f=asrFixture();
    if(kind==='config'){
      const p=f.asr.connect();await delay(0);f.socket.emit('open');f.event({type:'session_started',seq:0,config:{...config,audio:{...config.audio,sample_rate:16000}}});await assert.rejects(p);
    }else{await f.connect();if(kind==='sequence')f.event({type:'draft',seq:2,text:'gap'});else f.socket.emit('message',Buffer.from('{}'),false);}
    assert(f.asr.closed);assert.equal(f.errors.length,1);
  }
});
test('Fish preserves HTTP failure code and never includes an upstream error body',async()=>{
  const f=asrFixture();const p=f.asr.connect();await delay(0);
  f.socket.emit('unexpected-response',null,{statusCode:402,resume(){}});await assert.rejects(p,/402/);assert.equal(f.errors.length,1);
});
test('a Fish disconnect stops the session without replay or automatic reconnect',async()=>{
  const f=asrFixture();await f.connect();f.socket.emit('close');assert(f.asr.closed);assert.match(f.errors[0],/不能恢复旧会话/);
});
const sse=message=>new Response('data: '+JSON.stringify({choices:[{delta:message}]})+'\n\ndata: [DONE]\n\n');
function voiceFixture(options={}){
  let callbacks;const transcripts=[],audio=[],clear=[],calls=[],bodies=[],diagnostics=[],done=[];
  const asr={connect:async()=>{},append(){},agentSpeaking:v=>calls.push(['speaking',v]),context:t=>calls.push(['context',t]),close(){}};
  const bridge=new FishVoiceBridge({inputSampleRate:24000,instructions:'fixture-policy',tools:[],onTranscript:(...a)=>transcripts.push(a),onAudio:(...a)=>audio.push(a),onClearAudio:(...a)=>clear.push(a),onResponseDone:e=>done.push(e),onDiagnostic:e=>diagnostics.push(e),...options.request},{createWebSocket:()=>{},apiKey:'fish-fixture',dialogApiKey:'dialog-fixture',ttsApiKey:'tts-fixture',asrFactory:c=>{callbacks=c;return asr;},fetchImpl:async(_url,opts)=>{bodies.push(JSON.parse(opts.body));return sse({content:'已收到。'});},tts:async(_text,o)=>o.onAudio(Buffer.alloc(960)),...options.provider});
  return {bridge,transcripts,audio,clear,calls,bodies,diagnostics,done,event:e=>callbacks.onEvent(e)};
}
test('drafts, noise, backchannels, eager/resume and duplicate commits cannot invoke the dialog',async t=>{
  const f=voiceFixture();t.after(()=>f.bridge.close());await f.bridge.connect();
  for(const e of [{type:'speech_start',turn_index:0},{type:'draft',turn_index:0,text:'电视声音'},{type:'committed',turn_index:0,user_turn:false,text:'电视声音'},{type:'user_backchannel',turn_index:1},{type:'committed',turn_index:1,user_turn:false,text:'嗯'},{type:'eager_end_of_turn',turn_index:2,text:'明天'},{type:'turn_resumed',turn_index:2}])f.event(e);
  assert.equal(f.bodies.length,0);assert.equal(f.transcripts.length,0);assert.equal(f.clear.length,0);
  f.event({type:'user_turn_taken',turn_index:2});f.event({type:'committed',turn_index:2,user_turn:true,text:'明天，不，是后天。'});
  f.event({type:'committed',turn_index:2,user_turn:true,text:'明天，不，是后天。'});
  await until(()=>f.done.length===1);assert.equal(f.bodies.length,1);assert.equal(f.bodies[0].messages.at(-1).content,'明天，不，是后天。');
  assert.equal(f.transcripts.filter(a=>a[0]==='user').length,1);assert.equal(f.audio.length,1);
});
test('actual playback state is forwarded; unconfirmed client noise cannot stop the reply',async t=>{
  const f=voiceFixture();t.after(()=>f.bridge.close());await f.bridge.connect();f.bridge.audioResponseId='old';
  f.bridge.setPlaybackState(true);f.event({type:'user_backchannel',turn_index:1});f.bridge.handleBargeIn({confirmed:false});assert.equal(f.clear.length,0);
  f.event({type:'user_turn_taken',turn_index:2});assert.equal(f.clear.length,1);assert.deepEqual(f.clear[0],['barge-in',{responseId:'old'}]);
});
test('only admitted user drafts are rendered as replacing snapshots, final remains authoritative',async t=>{
  const f=voiceFixture();t.after(()=>f.bridge.close());await f.bridge.connect();
  f.event({type:'draft',turn_index:3,text:'明天三点'});assert.equal(f.transcripts.length,0);
  f.event({type:'user_turn_taken',turn_index:3});f.event({type:'draft',turn_index:3,text:'后天两点'});
  assert.deepEqual(f.transcripts.map(a=>[a[1],a[4].snapshot]),[['明天三点',true],['后天两点',true]]);
  assert.equal(f.bodies.length,0);f.event({type:'committed',turn_index:3,user_turn:true,text:'不是明天，是后天两点。'});
  await until(()=>f.done.some(e=>e.status==='completed'));assert.equal(f.bodies.length,1);
});
test('background completion supplies actual result context to the same dialog without reissuing a tool',async t=>{
  const f=voiceFixture();t.after(()=>f.bridge.close());await f.bridge.connect();
  f.bridge.adoptBackgroundTool('accepted-task');f.bridge.completeBackgroundTool('accepted-task',{answer:'fixture-only-final-fact'});
  await until(()=>f.done.some(e=>e.status==='completed'));assert.equal(f.bodies.length,1);
  assert(f.bodies[0].messages.some(m=>m.content?.includes('fixture-only-final-fact')));assert.equal(f.audio.length,1);
});
test('Candidate reservations persist across restart instead of resetting spend to zero',t=>{
  const dir=mkdtempSync(join(tmpdir(),'fish-budget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'budget.json');fishBudgetFromFile(file).reserve(0.125);
  assert.equal(fishBudgetFromFile(file).reservedUsd,0.125);assert.equal(JSON.parse(readFileSync(file)).reservedUsd,0.125);
});
test('a barge-in drops late PCM from a cancelled TTS generation',async t=>{
  let deliver;const f=voiceFixture({provider:{tts:async(_text,o)=>{deliver=o.onAudio;await delay(20);deliver(Buffer.alloc(960));}}});
  t.after(()=>f.bridge.close());await f.bridge.connect();f.bridge.sendUserMessage('第一句');await until(()=>Boolean(deliver));
  f.event({type:'user_turn_taken',turn_index:1});await delay(30);assert.equal(f.audio.length,0);
});
test('tool batches use only declared tools and deliver real results before continuing',async t=>{
  let f;let requests=0;
  f=voiceFixture({request:{tools:[{name:'current_time',description:'时间',parameters:{type:'object',properties:{}}}],onToolCall:c=>f.bridge.submitToolResult(c.callId,{time:'fixture-time'})},provider:{fetchImpl:async(_url,opts)=>{
    f.bodies.push(JSON.parse(opts.body));return ++requests===1?sse({tool_calls:[{index:0,id:'tool-1',function:{name:'current_time',arguments:'{}'}}]}):sse({content:'当前时间已查到。'});
  }}});t.after(()=>f.bridge.close());await f.bridge.connect();f.bridge.sendUserMessage('现在几点');await until(()=>f.done.length===1);
  assert.equal(f.bodies.length,2);assert.equal(f.bodies[1].messages.at(-1).role,'tool');assert.equal(f.bodies[1].messages.at(-1).content,'{"time":"fixture-time"}');
  assert.equal(f.bodies[0].tools[0].function.name,'current_time');assert.equal(f.audio.length,1);
});
test('closing during connection never emits ready or submits a dialog',async()=>{
  let ready;const f=voiceFixture({provider:{asrFactory:()=>({connect:()=>new Promise(r=>{ready=r;}),close(){},agentSpeaking(){}})}});
  const connect=f.bridge.connect();f.bridge.close();ready();await connect;assert(!f.bridge.ready);assert.equal(f.bodies.length,0);
});
test('budget rejects excess before a network request and model needs all three credentials',async()=>{
  const budget=createFishBudget({limitUsd:0.001});let requested=0;
  const f=voiceFixture({provider:{budget,fetchImpl:()=>{requested++;}}});await assert.rejects(f.bridge.connect(),/预算/);assert.equal(requested,0);f.bridge.close();
  assert(!fishConfigured({fish:'x',fishDialog:'y'},{enabled:true}));assert(!fishConfigured({fish:'x',fishDialog:'y',fishTts:'z'},{}));assert(fishConfigured({fish:'x',fishDialog:'y',fishTts:'z'},{enabled:true}));
});
test('Volc NDJSON returns PCM before final line and validates completion',async()=>{
  let first=false,finish;const audio=[];
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({code:0,data:Buffer.alloc(20).toString('base64')})+'\n'));finish=()=>{assert(first);c.enqueue(new TextEncoder().encode('{"code":20000000,"usage":{"text_words":3}}'));c.close();};}});
  const p=streamFishReply('测试。',{apiKey:'private',signal:new AbortController().signal,onAudio:b=>{first=true;audio.push(b);},fetchImpl:async(_url,opts)=>{assert.equal(JSON.parse(opts.body).req_params.audio_params.format,'pcm');return new Response(stream);}});
  await until(()=>first);finish();await p;assert.equal(audio[0].length,20);
  await assert.rejects(streamFishReply('测试。',{apiKey:'private',signal:new AbortController().signal,onAudio(){},fetchImpl:async()=>new Response('{"code":0,"data":"AAAA"}\n')}),/对齐|完整/);
});
