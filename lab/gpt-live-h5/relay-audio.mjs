// Gateway-owned PCM transport shared by Seeduplex and Grok. No provider key
// or arbitrary tool request is accepted from this browser audio channel.
// Runs inside the audio rendering thread. A consumed sample is never replayed
// during starvation: silence and a short rebuffer replace the old waveform.
export class PcmPlaybackQueue {
  constructor(rate, prefillMs=120, maxFrames=8*1024*1024) {
    this.rate=rate;this.prefill=Math.ceil(rate*prefillMs/1000);this.maxFrames=maxFrames;this.clear();
  }
  clear(){this.chunks=[];this.head=0;this.offset=0;this.frames=0;this.phase=0;this.wait=0;this.playing=false;this.consumed=0;this.underflows=0;this.lastPlayedAt=null;this.complete=false;this.holdUntilComplete=false;}
  hold(){this.holdUntilComplete=true;}
  end(){this.complete=true;this.holdUntilComplete=false;}
  push(pcm){this.complete=false;if(!(pcm instanceof Int16Array)||!pcm.length)throw Error('Invalid PCM');if(this.frames+pcm.length>this.maxFrames)throw Error('PCM queue overflow');this.chunks.push(pcm);this.frames+=pcm.length;}
  peek(offset){const c=this.chunks[this.head];const i=this.offset+offset;return i<c.length?c[i]:(this.chunks[this.head+1]?.[i-c.length]??c[c.length-1]);}
  advance(){this.offset++;this.frames--;this.consumed++;if(this.offset===this.chunks[this.head].length){this.chunks[this.head]=null;this.head++;this.offset=0;if(this.head>=32){this.chunks.splice(0,this.head);this.head=0;}}}
  render(out,at){
    out.fill(0);
    if(this.holdUntilComplete&&!this.complete)return;
    if(!this.frames){if(this.playing){if(!this.complete)this.underflows++;this.playing=false;this.wait=0;}return;}
    // Even a large first packet needs a real jitter window. Previously a
    // 244ms packet bypassed prefill and a next packet at 300ms caused a hole.
    // A complete response can start immediately: no more network frames await.
    if(!this.playing){this.wait+=out.length;if(!this.complete&&this.wait<this.prefill)return;this.playing=true;this.wait=0;}
    const step=24000/this.rate;
    for(let i=0;i<out.length;i++){
      if(!this.frames){if(!this.complete)this.underflows++;this.playing=false;this.wait=0;break;}
      const a=this.peek(0),b=this.peek(1);out[i]=(a+(b-a)*this.phase)/32768;this.lastPlayedAt=at+(i+1)/this.rate;
      this.phase+=step;while(this.phase>=1&&this.frames){this.phase-=1;this.advance();}
      if(!this.frames)this.phase=0;
    }
  }
}
export function relayWorkletSource(){return `${PcmPlaybackQueue.toString()}
class Speaker extends AudioWorkletProcessor {
 constructor(options){super();const prefill=options?.processorOptions?.prefillMs??120;
 if(!Number.isFinite(prefill)||prefill<0||prefill>1000)throw Error('Invalid playback buffer');
 this.queue=new PcmPlaybackQueue(sampleRate,prefill);this.epoch=0;this.tick=0;
 this.port.onmessage=({data:e})=>{if(e.type==='clear'){this.epoch=e.epoch;this.queue.clear();}
 else if(e.type==='hold'&&e.epoch===this.epoch)this.queue.hold();
 else if(e.type==='done'&&e.epoch===this.epoch)this.queue.end();
 else if(e.type==='audio'&&e.epoch===this.epoch){try{this.queue.push(new Int16Array(e.buffer));}catch{this.port.postMessage({type:'error',epoch:this.epoch});}}};}
 process(inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;
 const before=this.queue.frames;this.queue.render(out,currentTime);
 if(++this.tick%8===0||before>0&&this.queue.frames===0)this.port.postMessage({type:'playback',epoch:this.epoch,consumed:this.queue.consumed,underflows:this.queue.underflows,lastPlayedAt:this.queue.lastPlayedAt,playing:this.queue.playing});return true;}
}
class Mic extends AudioWorkletProcessor {
 constructor(){super();this.sum=0;this.count=0;this.phase=0;this.frame=new Int16Array(480);this.index=0;}
 process(inputs){const data=inputs[0]?.[0];if(data)for(const value of data){this.sum+=value;this.count++;this.phase+=24000;
 if(this.phase>=sampleRate){this.phase-=sampleRate;const v=Math.max(-1,Math.min(1,this.sum/this.count));this.frame[this.index++]=Math.round(v*(v<0?32768:32767));this.sum=0;this.count=0;
 if(this.index===480){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Int16Array(480);this.index=0;}}}return true;}
}
registerProcessor('v-direct-speaker',Speaker);registerProcessor('v-direct-mic',Mic);`;}
// Only fixed backend speech needs client onset detection: its upstream ASR can
// be delayed behind synthesis. Frames are the existing post-AEC microphone PCM.
export class BackendSpeechOnset {
  constructor(){this.reset();}
  reset(){this.voicedMs=0;this.fired=false;this.quietMs=0;}
  observe(frame, enabled){
    if(!enabled){this.reset();return false;}
    const samples=new Int16Array(frame);let energy=0;
    for(const sample of samples)energy+=(sample/32768)**2;
    const ms=samples.length/24,voiced=Math.sqrt(energy/Math.max(1,samples.length))>=.025;
    if(!voiced){this.voicedMs=0;this.quietMs+=ms;if(this.quietMs>=300)this.fired=false;return false;}
    this.quietMs=0;this.voicedMs+=ms;
    if(!this.fired&&this.voicedMs>=80){this.fired=true;return true;}return false;
  }
}
export function createRelayAudio({context,stream,reservation,onEvent,onError,onClosed,onPlaybackActivity=()=>{}}) {
  // Recorded Grok packets: 245ms of speech, then a 595ms arrival gap.
  // 400ms protects that real startup cadence; Xiaohe retains its smaller lead.
  const startBufferMs=reservation.provider==='grok'?400:120;
  // Grok's short greeting can arrive as two sentences with a multi-second
  // network gap. Hold only that first response to its native completion;
  // later answers keep streaming with their normal lead, and the mic stays on.
  const backendOnset=new BackendSpeechOnset();let backendPlayback=false, backendResponseId=null;const retiredResponses=new Set();
  let greetingHeld=reservation.provider==='grok';
  const endpoint=new URL('./api/relay',location.href);endpoint.protocol=location.protocol==='https:'?'wss:':'ws:';
  endpoint.search=new URLSearchParams({voiceSessionId:reservation.voiceSessionId,ticket:reservation.relayTicket});
  const socket=new WebSocket(endpoint);socket.binaryType='arraybuffer';
  let closed=false,ready=false,node,speaker,source,quietGain,ending=null,tailTimer,epoch=0,written=0,lastPlayedAt=null,lastSequence=0,blocked=false,outputComplete=false,playbackActive=false,busy=false,lastReceiveAt=null,statsTimer;
  const pendingOutput=[];
  const maxQueuedOutputBytes=16*1024*1024;
  const stats={inputBytes:0,outputBytes:0,queuedOutputBytes:0,peakQueuedOutputBytes:0,clears:0,duplicateFrames:0,underflows:0,maxReceiveGapMs:0,startBufferMs,contextState:context.state,contextSampleRate:context.sampleRate,playbackDrained:false};
  const activity=value=>{if(playbackActive!==value){playbackActive=value;onPlaybackActivity(value);}};
  const send=e=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(e));};
  const reportBusy=()=>{const next=stats.queuedOutputBytes>0||playbackActive;if(next!==busy){busy=next;send({type:'playback.state',speaking:busy});}};
  const flush=()=>{backendPlayback=false;backendOnset.reset();epoch++;written=0;pendingOutput.length=0;outputComplete=false;greetingHeld=false;stats.queuedOutputBytes=0;lastPlayedAt=null;speaker?.port.postMessage({type:'clear',epoch});stats.clears++;activity(false);reportBusy();ending=null;clearTimeout(tailTimer);};
  const checkEnd=()=>{if(closed||!ending)return;
    if(context.state==='running'&&lastPlayedAt!==null&&stats.queuedOutputBytes===0&&context.currentTime>=lastPlayedAt+.75){stats.playbackDrained=true;send({type:'playback.drained',callId:ending});ending=null;}
    else tailTimer=setTimeout(checkEnd,100);
  };
  const stateChanged=()=>{if(closed)return;stats.contextState=context.state;
    if(context.state==='running'){if(blocked){blocked=false;onEvent({type:'playback.resumed'});}}
    else if(!blocked){blocked=true;activity(false);onEvent({type:'playback.blocked'});}
  };
  context.addEventListener?.('statechange',stateChanged);
  const transfer=buffer=>speaker.port.postMessage({type:'audio',buffer,epoch},[buffer]);
  const play=e=>{
    // Only a transport identity can establish duplication. Never compare PCM:
    // identical silence and repeated syllables are valid audio.
    if(Number.isSafeInteger(e.sequence)&&e.sequence>0){if(e.sequence<=lastSequence){stats.duplicateFrames++;return;}lastSequence=e.sequence;}
    const bytes=Uint8Array.from(atob(e.audio),c=>c.charCodeAt(0));
    if(!bytes.length||bytes.length%2||bytes.length>480000||e.sampleRate!==24000)throw Error('语音帧格式无效');
    if(stats.queuedOutputBytes+bytes.length>maxQueuedOutputBytes)throw Error('语音缓存过大，请重新拨号');
    const receivedAt=performance.now();if(lastReceiveAt!==null&&stats.queuedOutputBytes>0)stats.maxReceiveGapMs=Math.max(stats.maxReceiveGapMs,receivedAt-lastReceiveAt);lastReceiveAt=receivedAt;
    if(e.responseId&&retiredResponses.has(e.responseId))return;
    if(e.source==='injected-speech'){backendPlayback=true;backendResponseId=e.responseId??null;}
    outputComplete=false;written+=bytes.length/2;stats.queuedOutputBytes+=bytes.length;stats.peakQueuedOutputBytes=Math.max(stats.peakQueuedOutputBytes,stats.queuedOutputBytes);stats.outputBytes+=bytes.length;stats.playbackDrained=false;
    reportBusy();if(speaker)transfer(bytes.buffer);else pendingOutput.push(bytes.buffer);
    if(context.state!=='running')stateChanged();
  };
  const promise=new Promise((resolve,reject)=>{
    socket.onmessage=e=>{if(closed)return;try{
      const value=JSON.parse(e.data);if(value.voiceSessionId!==reservation.voiceSessionId)return;
      if(value.type==='ready'&&!ready){ready=true;resolve();send({type:'greeting'});reportBusy();statsTimer=setInterval(()=>send({type:'playback.stats',...stats}),2000);}
      if(value.type==='audio')play(value);
      if(value.type==='audio.clear')flush();
      if(value.type==='audio.done'){outputComplete=true;greetingHeld=false;speaker?.port.postMessage({type:'done',epoch});}
      if(value.type==='end.cancelled'){ending=null;clearTimeout(tailTimer);}
      if(value.type==='end.after-playback'){ending=value.callId;checkEnd();}
      if(value.type==='error'){reject(Error(value.message));onError(Error(value.message));}
      onEvent(value);
    }catch(error){reject(error);onError(error);}};
    socket.onerror=()=>{const error=Error('实时语音连接失败');reject(error);onError(error);};
    socket.onclose=()=>{reject(Error('实时语音连接已关闭'));if(!closed)onClosed();};
  });void promise.catch(()=>{});
  async function capture(){
    const url=URL.createObjectURL(new Blob([relayWorkletSource()],{type:'text/javascript'}));
    try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    if(closed)return;
    speaker=new AudioWorkletNode(context,'v-direct-speaker',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{prefillMs:startBufferMs}});
    speaker.port.postMessage({type:'clear',epoch});if(greetingHeld)speaker.port.postMessage({type:'hold',epoch});speaker.connect(context.destination);
    speaker.port.onmessage=({data:e})=>{
      if(closed||e.epoch!==epoch)return;
      if(e.type==='error'){onError(Error('语音缓存过大，请重新拨号'));return;}
      if(e.type!=='playback')return;
      stats.queuedOutputBytes=Math.max(0,written-e.consumed)*2;stats.underflows=e.underflows;lastPlayedAt=e.lastPlayedAt;
      if(stats.queuedOutputBytes===0&&!e.playing)backendPlayback=false;
      activity(e.playing&&context.state==='running');reportBusy();
    };
    for(const buffer of pendingOutput)transfer(buffer);pendingOutput.length=0;if(outputComplete)speaker.port.postMessage({type:'done',epoch});
    node=new AudioWorkletNode(context,'v-direct-mic');source=context.createMediaStreamSource(stream);
    quietGain=context.createGain();quietGain.gain.value=0;source.connect(node);node.connect(quietGain);quietGain.connect(context.destination);
    node.port.onmessage=e=>{if(closed)return;const frame=e.data;
      if(ready&&socket.readyState===WebSocket.OPEN){
        if(backendOnset.observe(frame,backendPlayback&&stats.queuedOutputBytes>0)){
          if(backendResponseId){retiredResponses.add(backendResponseId);if(retiredResponses.size>256)retiredResponses.delete(retiredResponses.values().next().value);}
          flush();send({type:'barge-in'});}
        if(socket.bufferedAmount>480000){onError(Error('音频上传积压，请重新拨号'));return;}socket.send(frame);stats.inputBytes+=frame.byteLength;}
    };
  }
  return {ready:promise,stats,async start(){
      // Connecting is not yet a listening call. Starting capture beforehand
      // filled an eight-second PCM queue and aborted legitimate 20s connects.
      // Keep the page-owned microphone grant; attach audio nodes only after
      // the actual upstream ready event. Greeting PCM is retained above.
      await promise;if(!closed)await capture();
    },sendText:text=>send({type:'text',text}),
    dispose(){send({type:'playback.stats',...stats});closed=true;clearInterval(statsTimer);clearTimeout(tailTimer);context.removeEventListener?.('statechange',stateChanged);flush();node?.port.close();node?.disconnect();speaker?.port.close();speaker?.disconnect();source?.disconnect();quietGain?.disconnect();socket.close();}};
}
