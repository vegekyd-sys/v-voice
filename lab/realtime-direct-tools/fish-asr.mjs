import {encode,decode} from '@msgpack/msgpack';

export const FISH_STT_MODEL='transcribe-stream-1';
export const FISH_STT_URL='wss://api.fish.audio/v1/asr/realtime';
const RATES=new Set([8000,12000,16000,22050,24000,32000,44100,48000]);

// A server-only native Fish connection. No compatible/file-ASR fallback.
export class FishAsrStream {
  constructor({apiKey,sampleRate=24000,createWebSocket,onEvent=()=>{},onError=()=>{},onClose=()=>{},maxSessionMs=180000,connectTimeoutMs=15000}) {
    if(!RATES.has(sampleRate))throw Error('Fish 输入采样率不支持');
    if(maxSessionMs<1000||maxSessionMs>180000)throw Error('Fish Candidate 单次最多三分钟');
    Object.assign(this,{apiKey,sampleRate,createWebSocket,onEvent,onError,onClose,maxSessionMs,connectTimeoutMs});
    this.closed=false;this.ready=false;this.pending=Buffer.alloc(0);this.sentBytes=0;this.lastSeq=-1;
  }
  connect() {
    if(this.promise)return this.promise;
    this.promise=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    void this.open();return this.promise;
  }
  async open() {
    try {
      if(!this.apiKey)throw Error('Fish Audio API 凭据尚未配置');
      const ws=await this.createWebSocket(FISH_STT_URL,{headers:{Authorization:`Bearer ${this.apiKey}`,model:FISH_STT_MODEL},handshakeTimeout:this.connectTimeoutMs,maxPayload:1048576,perMessageDeflate:false});
      if(this.closed){ws.on('error',()=>{});ws.close();return;}this.socket=ws;
      this.connectTimer=setTimeout(()=>this.fail('Fish STT 连接超时'),this.connectTimeoutMs);
      ws.on('open',()=>{this.startedAt=performance.now();this.send({type:'config',audio:{format:'pcm_s16le',sample_rate:this.sampleRate,channels:1},turn_detection:{mode:'auto',eager:true},results:{drafts:true,diarize:false,ignore_timestamps:false}});});
      ws.on('message',(data,binary)=>{
        if(this.closed)return;
        try {
          if(!binary)throw Error('binary required');
          const e=decode(data);
          if(!e||typeof e.type!=='string')throw Error('invalid message');
          if(Number.isSafeInteger(e.seq)){
            if(e.seq!==this.lastSeq+1)throw Error('event sequence gap');
            this.lastSeq=e.seq;
          }
          if(e.type==='error')return this.fail(`Fish STT 错误（${/^[a-z_]{1,60}$/.test(e.error_type)?e.error_type:'upstream_error'}）`);
          if(e.type==='session_started'){
            const c=e.config;
            if(c?.audio?.sample_rate!==this.sampleRate||c?.audio?.format!=='pcm_s16le'||c?.audio?.channels!==1||c?.turn_detection?.mode!=='auto'||c?.results?.drafts!==true)throw Error('effective config mismatch');
            this.ready=true;clearTimeout(this.connectTimer);
            this.keepalive=setInterval(()=>this.send({type:'keepalive'}),10000);this.keepalive.unref?.();
            this.expiry=setTimeout(()=>this.fail('Fish Candidate 三分钟试用结束，请挂断'),this.maxSessionMs);this.expiry.unref?.();
            this.resolve(e);
          }
          this.onEvent(e);
          if(e.type==='session_done'){this.finished=true;this.close();this.onClose();}
        }catch{this.fail('Fish STT 协议或事件序号异常');}
      });
      ws.on('unexpected-response',(_,response)=>{response.resume?.();this.fail(`Fish STT API 拒绝连接（${response.statusCode}）`);});
      ws.on('error',()=>this.fail('Fish STT 上游连接失败'));
      ws.on('close',()=>{if(!this.closed)this.fail('Fish STT 连接中断；不能恢复旧会话，请挂断重拨');});
    }catch(error){this.fail(error.message==='Fish Audio API 凭据尚未配置'?error.message:'Fish STT 无法建立连接');}
  }
  send(e) {
    if(this.closed||this.socket?.readyState!==1)return;
    if(this.socket.bufferedAmount>192000)return this.fail('Fish STT 上传积压，已停止本次连接');
    this.socket.send(encode(e));
  }
  append(bytes) {
    if(!this.ready||this.closed)return;
    if(bytes.length%2||bytes.length>this.sampleRate*2)throw Error('Fish PCM 块格式不合法');
    this.sentBytes+=bytes.length;
    if(this.sentBytes>this.sampleRate*2*this.maxSessionMs/1000)return this.fail('Fish Candidate 音频额度已到');
    this.pending=Buffer.concat([this.pending,bytes]);
    const n=this.sampleRate/10*2;
    while(this.pending.length>=n&&!this.closed){this.send({type:'audio',data:this.pending.subarray(0,n)});this.pending=this.pending.subarray(n);}
  }
  agentSpeaking(speaking){if(this.ready&&!this.closed&&this.speaking!==speaking){this.speaking=speaking;this.send({type:'agent_speaking',speaking});}}
  context(text){if(this.ready&&text.trim())this.send({type:'context_add',items:[{role:'assistant',text:text.slice(0,2000)}]});}
  finish(){if(!this.ready||this.closed)return;if(this.pending.length)this.send({type:'audio',data:this.pending});this.pending=Buffer.alloc(0);this.send({type:'audio_done'});}
  fail(message){if(this.closed)return;const error=Error(message);this.reject?.(error);this.close();this.onError(error);}
  close(){if(this.closed)return;this.closed=true;this.ready=false;clearTimeout(this.connectTimer);clearTimeout(this.expiry);clearInterval(this.keepalive);this.pending=Buffer.alloc(0);this.socket?.close();this.reject?.(Error('Fish STT 已关闭'));}
}
