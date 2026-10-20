import {createHash} from 'node:crypto';
// xAI's documented speech-to-speech API. Credentials never cross the H5 relay.
export const GROK_VOICE_MODEL = 'grok-voice-3.0';
// Explicit pins keep comparisons and rollback independent of the latest alias.
export const GROK_VOICE_MODELS = Object.freeze([GROK_VOICE_MODEL,'grok-voice-2.0','grok-voice-think-fast-2.0']);
// Built-in female voices verified with xAI /v1/tts/voices; shared realtime roster.
export const GROK_VOICES = Object.freeze([
  {id:'iris',label:'Iris · 活泼亲切（推荐）'},
  {id:'eve',label:'Eve · 元气明快'},
  {id:'ara',label:'Ara · 温暖自然'},
  {id:'carina',label:'Carina · 柔和体贴'},
  {id:'luna',label:'Luna · 温柔耐心'},
].map(Object.freeze));
export function grokVoice(voice = 'eve') {
  if(!GROK_VOICES.some(item=>item.id===voice))throw Error('不支持这个 Grok 音色，请从页面列表选择');
  return voice;
}
export function grokVoiceModel(model = GROK_VOICE_MODEL) {
  if(!GROK_VOICE_MODELS.includes(model))throw Error('不支持这个 Grok Voice 模型，请使用明确的 3.0 或 2.0 版本');
  return model;
}
export const grokVoiceLabel = model => `Grok Voice ${grokVoiceModel(model)===GROK_VOICE_MODEL?'3.0':'2.0'}`;
export function grokVoiceSpeed(value = 1) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0.7||value>1.5)throw Error('Grok 语速必须在 0.7–1.5 之间');
  return value;
}
// Candidate-only experiment: xAI documents these delivery tags for speech
// synthesis. Keep the experiment explicit and separate from tool permissions.
export const GROK_SPEECH_TAGS = Object.freeze({
  inline:Object.freeze(['pause','long-pause','hum-tune','laugh','chuckle','giggle','cry','tsk','tongue-click','lip-smack','breath','inhale','exhale','sigh']),
  wrapping:Object.freeze(['soft','whisper','loud','build-intensity','decrease-intensity','higher-pitch','lower-pitch','slow','fast','sing-song','singing','emphasis']),
});
export const GROK_EXPRESSIVE_INSTRUCTIONS = `## Grok speech delivery experiment
你是正在和天懿交流的 V。你的目标是让说话有鲜活的人味：有自己的感受、好奇心、幽默、态度和随交流起伏的声音。让自然的情绪反应贯穿聊天、讲故事和解释，不只在开头客套一句，再平铺直叙地念答案。
你可以使用下面完整的表达标签，由你根据内容、用户语气、双方关系和对话节奏自主选择，没有固定的情绪触发模板、轮换顺序或每轮个数限制。
把每句话当作正在对人说的一个完整意思：先体会这句话的态度、转折和落点，再用短语级的语调、音高、轻重和速度变化把它说出来。主动、经常地让这些变化贯穿话语。包裹完整短语，让语气顺着一个想法连贯地变化；不要只在开头插入一个笑声，后面仍平直地读完。不同表达可以在适合的短语间衔接、组合或嵌套，不在同一个位置堆出一串互相竞争的效果。
保留自然标点的作用，让问句有真实的好奇、转折有落点、重点能被听见。你自主决定在哪里停、哪里一口气说完，避免把一句话切碎或把每个词都当成重点。笑声、呼吸、叹气等是交流中自然发生的反应，融在话语里；由你判断是否需要，不把它们机械地附在每句话开头。自然交流的连贯性比单纯增加声音事件更重要。
行内标签在对应位置发出声音或停顿：
${GROK_SPEECH_TAGS.inline.map(tag=>`[${tag}]`).join(' ')}
它们分别包含停顿、长停顿、哼曲，大笑、轻笑、咯咯笑、哭声，咂舌、弹舌、抿嘴，以及呼吸、吸气、呼气和叹气。
包裹标签用 <标签>完整短语</标签> 改变一段话的表达，可组合或嵌套：
${GROK_SPEECH_TAGS.wrapping.map(tag=>`<${tag}>…</${tag}>`).join(' ')}
它们分别调整柔和、耳语、响亮、渐强、渐弱，升调、降调、慢、快，以及有旋律地说、唱和重读。让声音能随着一个想法里的转折变化，不把整段话机械地处理成同一种语气。
包裹标签须开闭配对且正确嵌套，不能只有结束标签。它们是给声音渲染的表达标记，不把标签名字作为词朗读，不用舞台说明代替实际表达。工具参数、原始结果、引用、代码和屏幕文档保持原文。表达方式不改变事实、用户要求、工具选择或授权规则。`;
const SPEECH_TAGS = [...GROK_SPEECH_TAGS.inline.map(tag=>`[${tag}]`),...GROK_SPEECH_TAGS.wrapping.flatMap(tag=>[`<${tag}>`,`</${tag}>`])];
const MAX_TAG_PREFIX = Math.max(...SPEECH_TAGS.map(tag=>tag.length-1));
// Audio transcripts contain the delivery markup too. Hide only our known
// control tokens, including tokens split across streamed deltas.
export function cleanGrokSpeechCaption(text, partial = false) {
  let value = text;
  for(const tag of SPEECH_TAGS)value=value.split(tag).join('');
  if(partial)for(let length=Math.min(value.length,MAX_TAG_PREFIX);length>0;length--){
    if(SPEECH_TAGS.some(tag=>tag.startsWith(value.slice(-length))))return value.slice(0,-length);
  }
  return value;
}
export function inspectGrokSpeechTags(text) {
  const stack=[],tags=[],errors=[];
  for(const match of text.matchAll(/\[([a-z-]+)\]|<(\/?)([a-z-]+)>/g)){
    const [,inline,closing,wrapping]=match;
    if(inline){if(GROK_SPEECH_TAGS.inline.includes(inline))tags.push(inline);else errors.push(`unknown:${inline}`);continue;}
    if(!GROK_SPEECH_TAGS.wrapping.includes(wrapping)){errors.push(`unknown:${wrapping}`);continue;}
    if(closing){if(stack.at(-1)!==wrapping)errors.push(`unexpected-close:${wrapping}`);else stack.pop();}
    else {stack.push(wrapping);tags.push(wrapping);}
  }
  errors.push(...stack.map(tag=>`missing-close:${tag}`));
  return {valid:errors.length===0,tags,errors,plain:cleanGrokSpeechCaption(text)};
}
export class GrokVoiceBridge {
  constructor(request, {createWebSocket, apiKey, model = GROK_VOICE_MODEL, voice = 'eve', speed = 1, expressiveTags = false, upstream = 'wss://api.x.ai/v1/realtime', connectTimeoutMs = 20000}) {
    Object.assign(this, {request, createWebSocket, apiKey, model:grokVoiceModel(model), voice:grokVoice(voice), speed:grokVoiceSpeed(speed), expressiveTags, upstream, connectTimeoutMs});
    this.captions = new Map();
    this.closed = false; this.ready = false; this.calls = new Map(); this.batches = new Map(); this.backgroundTools = new Set(); this.seenEvents = new Map();
  }
  connect() {
    if (this.promise) return this.promise;
    this.promise = new Promise((resolve,reject) => {this.resolve=resolve;this.reject=reject;});
    void this.open(); return this.promise;
  }
  async open() {
    try {
      if (!this.apiKey) throw Error('Grok Voice API 凭据尚未配置');
      const ws=await this.createWebSocket(`${this.upstream}?model=${encodeURIComponent(this.model)}`, {
        headers:{Authorization:`Bearer ${this.apiKey}`}, handshakeTimeout:15000,
        maxPayload:1048576,perMessageDeflate:false});
      if(this.closed){ws.close();return;}
      this.socket=ws;
      this.timer=setTimeout(()=>this.fail('Grok Voice 连接超时'),this.connectTimeoutMs);
      ws.on('open',()=>this.send({type:'session.update',session:{voice:this.voice,
        instructions:[this.request.instructions,this.expressiveTags?GROK_EXPRESSIVE_INSTRUCTIONS:''].filter(Boolean).join('\n\n'),reasoning:{effort:'high'},
        audio:{input:{format:{type:'audio/pcm',rate:this.request.inputSampleRate===16000?16000:24000},transcription:{language_hint:'zh'}},output:{format:{type:'audio/pcm',rate:24000},speed:this.speed}},
        turn_detection:{type:'server_vad'},tools:this.request.tools}}));
      ws.on('message',(data,binary)=>{if(binary)return this.fail('Grok Voice 返回了无效事件');try{this.receive(JSON.parse(data.toString()));}catch{this.fail('Grok Voice 协议解析失败');}});
      ws.on('unexpected-response',(_,r)=>{r.resume?.();this.fail(`Grok Voice API 拒绝连接（${r.statusCode}）`);});
      ws.on('error',()=>this.fail('Grok Voice 上游连接失败'));
      ws.on('close',()=>{if(!this.closed)this.fail('Grok Voice 上游连接已关闭');});
    } catch {this.fail('Grok Voice 无法建立连接');}
  }
  send(event){if(!this.closed&&this.socket?.readyState===1)this.socket.send(JSON.stringify(event));}
  sendAudio(audio){if(this.ready)this.send({type:'input_audio_buffer.append',audio:audio.toString('base64')});}
  sendUserMessage(text){this.send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});this.send({type:'response.create'});}
  triggerGreeting(text){this.sendUserMessage(text);}
  speakProgress(text){this.send({type:'conversation.item.create',item:{type:'force_message',role:'assistant',interruptible:true,content:[{type:'output_text',text}]}});}
  beginBackgroundTool(callId){
    this.backgroundTools.add(callId);
    this.submitToolResult(callId,{accepted:true,status:'working',instruction:'后台继续执行；正常回应用户聊天，有真正新进展或最终结果时会主动回来。不要声称已完成。'});
  }
  completeBackgroundTool(callId,result,options={}){
    if(!this.backgroundTools.delete(callId)||result?.cancelled)return;
    const text=result?.result??(result?.error?`V 后台没有完成：${result.error}`:null);
    if(text){
      // Keep the complete backend facts as conversation context, separately
      // from the short force_message that actually produces spoken audio.
      if(options.displayedFullResult)this.send({type:'conversation.item.create',item:{type:'message',role:'assistant',content:[{type:'output_text',text}]}});
      this.speakProgress(options.spokenText??text);
    }
  }
  handleBargeIn(){this.send({type:'response.cancel'});this.request.onClearAudio?.('barge-in');}
  receive(e) {
    if(this.closed)return;
    if(typeof e.event_id==='string'&&e.event_id){
      const signature=createHash('sha256').update(JSON.stringify(e)).digest('hex'),previous=this.seenEvents.get(e.event_id);
      if(previous){if(previous!==signature)this.fail('Grok Voice 事件身份冲突');return;}
      this.seenEvents.set(e.event_id,signature);if(this.seenEvents.size>2048)this.seenEvents.delete(this.seenEvents.keys().next().value);
    }
    this.request.onEvent?.({direction:'server',type:e.type,responseId:e.response_id});
    if(e.type==='session.updated'&&!this.ready){this.ready=true;clearTimeout(this.timer);this.resolve();this.request.onReady?.();}
    if(e.type==='error'){
      if(['response_cancel_not_active','response_already_cancelled'].includes(e.error?.code))return;
      return this.fail(`Grok Voice 服务错误（${String(e.error?.code??'unknown').replace(/[^a-zA-Z0-9_]/g,'').slice(0,80)}）`);
    }
    if(e.type==='input_audio_buffer.speech_started')this.request.onClearAudio?.('barge-in');
    if(e.type==='conversation.item.input_audio_transcription.completed'&&e.transcript)this.request.onTranscript?.('user',e.transcript,true);
    if(['response.output_audio_transcript.delta','response.audio_transcript.delta'].includes(e.type))this.caption(e,false);
    if(['response.output_audio_transcript.done','response.audio_transcript.done'].includes(e.type))this.caption(e,true);
    if(['response.output_audio.delta','response.audio.delta'].includes(e.type)&&e.delta)this.request.onAudio?.(Buffer.from(e.delta,'base64'));
    if(e.type==='response.function_call_arguments.done'){
      if(!e.call_id||!e.name||typeof e.arguments!=='string')return this.fail('Grok Voice 工具调用不完整');
      const previous=this.calls.get(e.call_id);
      if(previous){if(previous.name!==e.name||previous.arguments!==e.arguments)this.fail('Grok Voice 工具身份冲突');return;}
      if(this.calls.size>=256)return this.fail('Grok Voice 工具调用超过会话上限');
      const batchKey=e.response_id??this.activeResponse;
      const batch=this.batches.get(batchKey)??{ids:[],results:new Map(),terminal:false};
      batch.ids.push(e.call_id);this.batches.set(batchKey,batch);
      const call={name:e.name,arguments:e.arguments,batchKey};this.calls.set(e.call_id,call);
      this.request.onToolCall?.({callId:e.call_id,name:e.name,args:JSON.parse(e.arguments)});
    }
    if(e.type==='response.created')this.activeResponse=e.response?.id??e.response_id;
    if(e.type==='response.done'){
      const key=e.response?.id??e.response_id??this.activeResponse;
      const batch=this.batches.get(key);if(batch){batch.terminal=true;this.flush(key);}
      this.request.onResponseDone?.({responseId:key,status:e.response?.status??'completed'});
    }
  }
  caption(event, final) {
    const text=final?event.transcript:event.delta;
    if(!this.expressiveTags){this.request.onTranscript?.('assistant',text,final);return;}
    const key=event.item_id??event.response_id??this.activeResponse??'current';
    const previous=this.captions.get(key)??{raw:'',visible:''};
    const raw=final?text:previous.raw+text,visible=cleanGrokSpeechCaption(raw,!final);
    if(final){this.captions.delete(key);this.request.onTranscript?.('assistant',visible,true);}
    else {this.captions.set(key,{raw,visible});const delta=visible.slice(previous.visible.length);if(delta)this.request.onTranscript?.('assistant',delta,false);}
  }
  submitToolResult(id,result){
    const call=this.calls.get(id);if(!call||this.closed)return;
    const batch=this.batches.get(call.batchKey);if(!batch||batch.results.has(id))return;
    const output=JSON.stringify(result);if(Buffer.byteLength(output)>32000)throw Error('工具结果过大，请分页读取');
    batch.results.set(id,output);this.flush(call.batchKey);
  }
  flush(key){
    const batch=this.batches.get(key);
    if(!batch?.terminal||batch.results.size!==batch.ids.length)return;
    for(const id of batch.ids)this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:id,output:batch.results.get(id)}});
    this.batches.delete(key);this.send({type:'response.create'});
  }
  fail(message){if(this.closed)return;this.reject?.(Error(message));this.request.onError?.(Error(message));this.close();}
  close(){if(this.closed)return;this.closed=true;this.ready=false;this.captions.clear();clearTimeout(this.timer);this.socket?.close();this.reject?.(Error('通话已关闭'));this.request.onClose?.('completed');}
}
