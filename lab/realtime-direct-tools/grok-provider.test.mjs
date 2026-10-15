import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {GrokVoiceBridge,GROK_VOICE_MODEL,GROK_VOICE_MODELS,GROK_EXPRESSIVE_INSTRUCTIONS,GROK_SPEECH_TAGS} from './grok-provider.mjs';
class Socket extends EventEmitter {constructor(){super();this.readyState=1;this.sent=[];}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.emit('close');}}
async function fixture(model=GROK_VOICE_MODEL,voice='eve',options={}){const ws=new Socket(),calls=[],audio=[],text=[];
 const bridge=new GrokVoiceBridge({instructions:'中文',tools:[{type:'function',name:'memory_search',parameters:{type:'object'}}],onToolCall:c=>calls.push(c),onAudio:b=>audio.push(b),onTranscript:(...a)=>text.push(a)},
 {apiKey:'private-key',model,voice,...options,createWebSocket:async(url,options)=>{assert.equal(new URL(url).searchParams.get('model'),model);assert.equal(options.headers.Authorization,'Bearer private-key');return ws;}});
 const opening=bridge.connect();await new Promise(r=>setImmediate(r));ws.emit('open');bridge.receive({type:'session.updated'});await opening;
 return {ws,calls,audio,text,bridge};}
test('Grok config is Chinese PCM plus native functions; keys are not provider events',async()=>{const f=await fixture();assert.equal(f.ws.sent[0].session.audio.input.format.rate,24000);assert.equal(f.ws.sent[0].session.audio.input.transcription.language_hint,'zh');assert.equal(f.ws.sent[0].session.tools[0].name,'memory_search');f.bridge.receive({type:'response.output_audio.delta',delta:Buffer.from([0,1]).toString('base64')});assert.deepEqual(f.audio,[Buffer.from([0,1])]);f.bridge.close();});
test('parallel calls wait for terminal call batch and both real results; one continuation',async()=>{const f=await fixture();f.bridge.receive({type:'response.created',response:{id:'r1'}});
 for(const id of ['a','b'])f.bridge.receive({type:'response.function_call_arguments.done',response_id:'r1',call_id:id,name:'memory_search',arguments:'{"query":"x"}'});
 f.bridge.submitToolResult('a',{result:'A'});f.bridge.submitToolResult('b',{result:'B'});
 assert.equal(f.ws.sent.filter(e=>e.type==='response.create').length,0);
 f.bridge.receive({type:'response.done',response:{id:'r1',status:'completed'}});
 assert.equal(f.ws.sent.filter(e=>e.type==='conversation.item.create').length,2);
 assert.equal(f.ws.sent.filter(e=>e.type==='response.create').length,1);
 f.bridge.submitToolResult('a',{result:'changed'});assert.equal(f.ws.sent.filter(e=>e.type==='response.create').length,1);f.bridge.close();});
test('duplicate function event is not executed twice and conflicting call identity closes',async()=>{const f=await fixture();const event={type:'response.function_call_arguments.done',response_id:'r1',call_id:'a',name:'memory_search',arguments:'{"query":"x"}'};
 f.bridge.receive(event);f.bridge.receive(event);assert.equal(f.calls.length,1);f.bridge.receive({...event,arguments:'{"query":"other"}'});assert.equal(f.bridge.closed,true);});
test('provider failure cancels connect, late events cannot emit audio',async()=>{const f=await fixture();f.bridge.close();f.bridge.receive({type:'response.output_audio.delta',delta:'AAE='});assert.equal(f.audio.length,0);});
test('backend progress uses documented interruptible force_message without a second response.create',async()=>{
 const f=await fixture();f.bridge.speakProgress('网页已核对，继续比较。');
 assert.deepEqual(f.ws.sent.at(-1),{type:'conversation.item.create',item:{type:'force_message',role:'assistant',interruptible:true,content:[{type:'output_text',text:'网页已核对，继续比较。'}]}});
 assert.equal(f.ws.sent.filter(e=>e.type==='response.create').length,0);f.bridge.close();
});

test('async backend releases native function before chat and returns final once via force_message',async()=>{
 const f=await fixture();f.bridge.receive({type:'response.created',response:{id:'job'}});f.bridge.receive({type:'response.function_call_arguments.done',response_id:'job',call_id:'owned-job',name:'delegate_to_v',arguments:'{}'});
 f.bridge.beginBackgroundTool('owned-job');f.bridge.receive({type:'response.done',response:{id:'job',status:'completed'}});assert(JSON.parse(f.ws.sent.find(x=>x.item?.type==='function_call_output').item.output).accepted);
 f.bridge.receive({type:'response.created',response:{id:'chat'}});f.bridge.receive({type:'response.done',response:{id:'chat',status:'completed'}});
 f.bridge.completeBackgroundTool('owned-job',{result:'真实后台最终结果'});f.bridge.completeBackgroundTool('owned-job',{result:'不能重复'});assert.equal(f.ws.sent.filter(x=>x.item?.type==='force_message').length,1);f.bridge.close();
});
test('audio transport event identity is idempotent; equal PCM with new identities remains valid',async()=>{
 const f=await fixture(),e={type:'response.output_audio.delta',event_id:'audio-1',delta:'AAE='};f.bridge.receive(e);f.bridge.receive(e);f.bridge.receive({...e,event_id:'audio-2'});assert.equal(f.audio.length,2);f.bridge.close();
});

test('long backend document stays in context; only brief notice requests interruptible speech once',async()=>{
 const f=await fixture();f.bridge.receive({type:'response.created',response:{id:'job'}});f.bridge.receive({type:'response.function_call_arguments.done',response_id:'job',call_id:'doc',name:'delegate_to_v',arguments:'{}'});f.bridge.beginBackgroundTool('doc');f.bridge.receive({type:'response.done',response:{id:'job',status:'completed'}});
 const text='## 原始完整方案\n'+'日期与条件。'.repeat(100),spokenText='结果回来了，详细方案在屏幕上。';
 const before=f.ws.sent.length;f.bridge.completeBackgroundTool('doc',{result:text},{spokenText,displayedFullResult:true});f.bridge.completeBackgroundTool('doc',{result:'不要重复'},{spokenText,displayedFullResult:true});
 assert.deepEqual(f.ws.sent.slice(before),[
  {type:'conversation.item.create',item:{type:'message',role:'assistant',content:[{type:'output_text',text}]}},
  {type:'conversation.item.create',item:{type:'force_message',role:'assistant',interruptible:true,content:[{type:'output_text',text:spokenText}]}}
 ]);f.bridge.close();
});

for(const model of GROK_VOICE_MODELS)test(`Grok pins ${model} without changing voice, reasoning, tools or audio`,async()=>{
 const f=await fixture(model);assert.equal(f.bridge.model,model);
 assert.equal(f.ws.sent[0].session.voice,'eve');assert.deepEqual(f.ws.sent[0].session.reasoning,{effort:'high'});
 assert.equal(f.ws.sent[0].session.audio.output.format.rate,24000);f.bridge.close();
});
test('Grok rejects unpinned or unsupported models before opening a socket',()=>{
 for(const model of ['grok-voice-latest','grok-3','',null])assert.throws(()=>new GrokVoiceBridge({}, {model}),/不支持/);
});
test('chosen voice reaches the realtime session; unsupported voices fail before connecting',async()=>{
 for(const voice of ['iris','eve','ara','carina','luna']){
  const f=await fixture(GROK_VOICE_MODEL,voice);assert.equal(f.ws.sent[0].session.voice,voice);f.bridge.close();
 }
 for(const voice of ['unknown','',null,{id:'iris'}])assert.throws(()=>new GrokVoiceBridge({}, {voice}),/不支持/);
});

test('Grok delivery controls reach upstream; defaults preserve old style and invalid speed fails early',async()=>{
 const old=await fixture();assert.equal(old.ws.sent[0].session.audio.output.speed,1);assert.equal(old.ws.sent[0].session.instructions,'中文');old.bridge.close();
 const f=await fixture(GROK_VOICE_MODEL,'iris',{speed:1.06,expressiveTags:true});
 assert.equal(f.ws.sent[0].session.audio.output.speed,1.06);assert(f.ws.sent[0].session.instructions.endsWith(GROK_EXPRESSIVE_INSTRUCTIONS));
 assert.equal(f.ws.sent[0].session.tools[0].name,'memory_search');f.bridge.close();
 for(const speed of [0,0.69,1.51,NaN,Infinity,'1.06',null])assert.throws(()=>new GrokVoiceBridge({}, {speed}),/语速/);
});
test('split speech tags are hidden in captions while spoken text, user text and tool payloads stay intact',async()=>{
 const f=await fixture(GROK_VOICE_MODEL,'iris',{expressiveTags:true});
 for(const delta of ['好！[ch','uckle] 这个<em','phasis>点子</emphasis>很棒。[pa','use] 我们试试？'])f.bridge.receive({type:'response.output_audio_transcript.delta',response_id:'tagged',delta});
 assert.equal(f.text.map(t=>t[1]).join(''),'好！ 这个点子很棒。 我们试试？');
 f.bridge.receive({type:'response.output_audio_transcript.done',response_id:'tagged',transcript:'好！[chuckle] 这个<emphasis>点子</emphasis>很棒。[pause] 我们试试？'});
 assert.deepEqual(f.text.at(-1),['assistant','好！ 这个点子很棒。 我们试试？',true]);
 f.bridge.receive({type:'conversation.item.input_audio_transcription.completed',transcript:'标签 [pause] 是什么？'});assert.equal(f.text.at(-1)[1],'标签 [pause] 是什么？');
 f.bridge.receive({type:'response.output_audio_transcript.done',response_id:'literal',transcript:'保留[unknown]和<code>原文</code>'});assert.equal(f.text.at(-1)[1],'保留[unknown]和<code>原文</code>');
 f.bridge.speakProgress('实际结果 <code>不改</code>');assert.equal(f.ws.sent.at(-1).item.content[0].text,'实际结果 <code>不改</code>');f.bridge.close();
});

test('full documented delivery vocabulary supports nested styles and tags split at every character',async()=>{
 const f=await fixture(GROK_VOICE_MODEL,'iris',{expressiveTags:true});
 assert.equal(GROK_SPEECH_TAGS.inline.length+GROK_SPEECH_TAGS.wrapping.length,26);
 const spoken='哎，这个转折真没想到。我们接着聊。';
 const raw='[sigh]<decrease-intensity><lower-pitch>哎，这个转折真没想到。</lower-pitch></decrease-intensity>[tongue-click]<build-intensity><sing-song>我们接着聊。</sing-song></build-intensity>';
 for(const delta of raw)f.bridge.receive({type:'response.output_audio_transcript.delta',response_id:'nested',delta});
 assert.equal(f.text.map(t=>t[1]).join(''),spoken);
 f.bridge.receive({type:'response.output_audio_transcript.done',response_id:'nested',transcript:raw});assert.equal(f.text.at(-1)[1],spoken);
 for(const [index,tag] of GROK_SPEECH_TAGS.inline.entries()){
  f.bridge.receive({type:'response.output_audio_transcript.done',response_id:'inline-'+index,transcript:'前['+tag+']后'});assert.equal(f.text.at(-1)[1],'前后');
 }
 for(const [index,tag] of GROK_SPEECH_TAGS.wrapping.entries()){
  f.bridge.receive({type:'response.output_audio_transcript.done',response_id:'style-'+index,transcript:'前<'+tag+'>后</'+tag+'>'});assert.equal(f.text.at(-1)[1],'前后');
 }
 f.bridge.close();
});
