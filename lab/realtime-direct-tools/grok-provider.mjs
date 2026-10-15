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
export class GrokVoiceBridge {
  constructor(request, {createWebSocket, apiKey, model = GROK_VOICE_MODEL, voice = 'eve', upstream = 'wss://api.x.ai/v1/realtime', connectTimeoutMs = 20000}) {
    Object.assign(this, {request, createWebSocket, apiKey, model:grokVoiceModel(model), voice:grokVoice(voice), upstream, connectTimeoutMs});
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
        instructions:this.request.instructions,reasoning:{effort:'high'},
        audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{language_hint:'zh'}},output:{format:{type:'audio/pcm',rate:24000}}},
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
    if(['response.output_audio_transcript.delta','response.audio_transcript.delta'].includes(e.type))this.request.onTranscript?.('assistant',e.delta,false);
    if(['response.output_audio_transcript.done','response.audio_transcript.done'].includes(e.type))this.request.onTranscript?.('assistant',e.transcript,true);
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
  close(){if(this.closed)return;this.closed=true;this.ready=false;clearTimeout(this.timer);this.socket?.close();this.reject?.(Error('通话已关闭'));this.request.onClose?.('completed');}
}
