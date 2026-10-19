import {randomBytes} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {VolcAsrStream} from '../volc-speaker/volc-asr.mjs';
import {FinalUtterances} from '../volc-speaker/utterances.mjs';
import {Pcm24To16Resampler} from '../seeduplex-realtime-provider.mjs';
import {SpeakerRouter,decisionEvaluator,nativeSpeakerContext} from './decision.mjs';

export function pcm16to24(input){
  const out=Buffer.alloc(Math.floor(input.length/4)*6);
  for(let i=0,j=0;i+3<input.length;i+=4,j+=6){const a=input.readInt16LE(i),b=input.readInt16LE(i+2);out.writeInt16LE(a,j);out.writeInt16LE(Math.round((a+b)/2),j+2);out.writeInt16LE(b,j+4);}return out;
}
export class AudioWindow {
  constructor(maxMs=20000){this.maxMs=maxMs;this.chunks=[];this.bytes=0;}
  append(pcm){const start=this.bytes;this.bytes+=pcm.length;this.chunks.push({start,end:this.bytes,pcm:Buffer.from(pcm)});const cutoff=this.bytes-this.maxMs*32;while(this.chunks[0]?.end<cutoff)this.chunks.shift();}
  slice(startMs,endMs){const start=Math.max(0,Math.floor(startMs*16)*2),end=Math.floor(endMs*16)*2;if(end-start>this.maxMs*32||this.chunks[0]?.start>start)throw Error('发言超出临时音频窗口，请用较短的句子重试');return Buffer.concat(this.chunks.filter(c=>c.end>start&&c.start<end).map(c=>c.pcm.subarray(Math.max(0,start-c.start),Math.min(c.pcm.length,end-c.start))));}
}

/** Call-scoped speaker routing. Audio is streamed to ASR and selected native providers; it is never persisted. */
export function createSpeakerRoutingService({env,evaluate=decisionEvaluator(env),audit=()=>{},createAsr=options=>new VolcAsrStream(options)}={}){
  const sessions=new Map(),wss=new WebSocketServer({noServer:true,maxPayload:128*1024});
  let totalBytes=0,calls=0;
  const reserve=(id,{policy='speaker',model}={})=>{
    if(policy==='native')return null;
    if(policy!=='speaker')throw Error('没有这个输入策略');
    if(!['gpt-live','seeduplex'].includes(model))throw Error('自动多人对话当前仅接入 GPT Live 和小何');
    const s={id,model,ticket:randomBytes(24).toString('base64url'),router:new SpeakerRouter({evaluate:async(...args)=>{if(++calls>160)throw Error('本次 Decision 测试调用上限已到');return evaluate(...args);}}),tracker:new FinalUtterances(),window:new AudioWindow(),resampler:new Pcm24To16Resampler(),abort:new AbortController(),tail:Promise.resolve(),nativeTail:Promise.resolve(),closed:false,ready:false,lastAt:0,clock:[],listeners:new Set(),native:null};
    sessions.set(id,s);s.timer=setTimeout(()=>close(id),180000);s.timer.unref?.();
    return {voiceSessionId:id,ticket:s.ticket,model,transport:model==='gpt-live'?'speaker-gate':'relay',policy};
  };
  const send=(s,value)=>{if(s.closed)return;const e={...value,voiceSessionId:s.id};for(const fn of s.listeners)fn(e);if(s.ws?.readyState===1)s.ws.send(JSON.stringify(e));audit({...e,...e.audio?{audio:undefined,audioBytes:Buffer.from(e.audio,'base64').length}:{}});};
  const process=async(s,turn)=>{
    if(s.closed)return;
    const at=performance.now(),anchor=s.clock.find(c=>c.startMs<=turn.endMs&&c.endMs>=turn.endMs),endAt=anchor?anchor.at-(anchor.endMs-turn.endMs):at;
    const clip=s.window.slice(Math.max(0,turn.startMs-80),turn.endMs+80);
    send(s,{type:'speaker.utterance',turn});
    const result=await s.router.accept(turn,{signal:s.abort.signal});
    if(s.closed)return;
    const timings={asrMs:Math.round(at-endAt),decisionMs:result.decisionMs??0,afterEndMs:Math.round(performance.now()-endAt)};
    send(s,{type:'speaker.decision',...result,timings});
    if(!result.shouldRespond)return;
    const context=nativeSpeakerContext(result),pcm=Buffer.concat([clip,Buffer.alloc(3200)]);
    if(!s.native){send(s,{type:'speaker.replay',turnId:result.turn.id,context,audio:pcm.toString('base64'),sampleRate:16000,timings});return;}
    s.replayAbort?.abort();s.replayAbort=new AbortController();const controller=s.replayAbort;
    s.native.interrupt();
    s.native.context(context);
    const replay=async()=>{
      const audio=pcm16to24(pcm),start=performance.now();
      send(s,{type:'speaker.replay-start',turnId:result.turn.id,timings});
      for(let offset=0;offset<audio.length;offset+=960){
        if(s.closed||controller.signal.aborted)return;
        s.native.forward(audio.subarray(offset,offset+960));
        const wait=start+(offset/48)+20-performance.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
      }
      // Native endpoint needs a short tail to decide the caller finished.
      for(let i=0;i<35&&!s.closed&&!controller.signal.aborted;i++){s.native.forward(Buffer.alloc(960));await new Promise(r=>setTimeout(r,20));}
      send(s,{type:'speaker.replay-end',turnId:result.turn.id});
    };
    s.nativeTail=s.nativeTail.then(async()=>{s.replaying=true;try{await replay();}finally{s.replaying=false;}}).catch(e=>send(s,{type:'speaker.error',message:e.message}));
  };
  const start=async s=>{
    if(s.connecting)return s.connecting;
    s.connecting=(async()=>{
      s.asr=createAsr({apiKey:env.VOLCENGINE_ASR_API_KEY,onResult:event=>{
        for(const entry of s.tracker.consume(event)){
          if(entry.type==='identity-revision'){s.router.invalidate();s.replayAbort?.abort();s.abort.abort();send(s,{type:'speaker.error',message:'声线编号被识别服务修订，请重新拨号'});close(s.id);return;}
          s.tail=s.tail.then(()=>process(s,entry.turn)).catch(e=>send(s,{type:'speaker.error',message:e.message}));
        }
      },onClose:()=>{if(!s.closed){send(s,{type:'speaker.error',message:'说话人识别通道已关闭，请重新拨号'});close(s.id);}},onError:e=>{send(s,{type:'speaker.error',message:e.message});close(s.id);}});
      await s.asr.connect();if(s.closed){s.asr.close();return;}s.ready=true;send(s,{type:'speaker.ready'});
    })();return s.connecting;
  };
  const audio=(id,pcm24)=>{
    const s=sessions.get(id);if(!s||s.closed)return false;
    if(!s.ready)throw Error('说话人识别尚未就绪');
    if(pcm24.length%2||pcm24.length>48000)throw Error('分人音频格式无效');
    totalBytes+=pcm24.length;if(totalBytes>48000*1200)throw Error('本轮候选音频预算已达上限');
    const pcm=s.resampler.push(pcm24),at=performance.now(),startMs=s.window.bytes/32;
    s.window.append(pcm);s.clock.push({startMs,endMs:s.window.bytes/32,at});while(s.clock.length>1200)s.clock.shift();s.lastAt=at;s.asr.append(pcm);return true;
  };
  const close=id=>{const s=sessions.get(id);if(!s)return;s.closed=true;s.abort.abort();s.replayAbort?.abort();clearTimeout(s.timer);clearInterval(s.keepalive);s.asr?.close();s.ws?.close();s.listeners.clear();s.window.chunks=[];sessions.delete(id);};
  wss.on('connection',(ws,s)=>{s.ws=ws;ws.on('message',(data,binary)=>{try{if(binary)audio(s.id,Buffer.from(data));else {const value=JSON.parse(data);if(value.type==='speaker.assistant')s.router.assistant(value.text);else if(value.type==='speaker.finish')s.asr?.finish();}}catch(e){send(s,{type:'speaker.error',message:e.message});}});ws.on('close',()=>close(s.id));void start(s).catch(e=>{send(s,{type:'speaker.error',message:e.message});close(s.id);});});
  return {
    reserve,close,audio,
    has:id=>sessions.has(id),
    async bind(id,native,onEvent){const s=sessions.get(id);if(!s)return;s.native=native;s.listeners.add(onEvent);await start(s);if(!s.closed){s.keepalive=setInterval(()=>{if(!s.closed&&!s.replaying)s.native.forward(Buffer.alloc(960));},20);s.keepalive.unref?.();}},
    assistant(id,text){sessions.get(id)?.router.assistant(text);},
    upgrade(req,socket,head,id,ticket){const s=sessions.get(id);if(!s||s.model!=='gpt-live'||s.ticket!==ticket||s.ws){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,s));},
    snapshot(){return {enabled:true,activeSessions:sessions.size,decisionCalls:calls,inputSeconds:totalBytes/48000};},
    dispose(){for(const id of sessions.keys())close(id);wss.close();},
  };
}
