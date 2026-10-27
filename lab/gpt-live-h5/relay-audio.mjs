// Gateway-owned PCM transport shared by Seeduplex and Grok. No provider key
// or arbitrary tool request is accepted from this browser audio channel.
// Runs inside the audio rendering thread. A consumed sample is never replayed
// during starvation: silence and a short rebuffer replace the old waveform.
export class PcmPlaybackQueue {
  constructor(rate, prefillMs=120, maxFrames=8*1024*1024) {
    this.rate=rate;this.prefill=Math.ceil(rate*prefillMs/1000);this.maxFrames=maxFrames;this.clear();
  }
  clear(){this.chunks=[];this.head=0;this.offset=0;this.frames=0;this.phase=0;this.wait=0;this.playing=false;this.consumed=0;this.underflows=0;this.lastPlayedAt=null;this.complete=false;this.holdUntilComplete=false;this.paused=false;}
  hold(){this.holdUntilComplete=true;}
  end(){this.complete=true;this.holdUntilComplete=false;}
  push(pcm){this.complete=false;if(!(pcm instanceof Int16Array)||!pcm.length)throw Error('Invalid PCM');if(this.frames+pcm.length>this.maxFrames)throw Error('PCM queue overflow');this.chunks.push(pcm);this.frames+=pcm.length;}
  peek(offset){const c=this.chunks[this.head];const i=this.offset+offset;return i<c.length?c[i]:(this.chunks[this.head+1]?.[i-c.length]??c[c.length-1]);}
  advance(){this.offset++;this.frames--;this.consumed++;if(this.offset===this.chunks[this.head].length){this.chunks[this.head]=null;this.head++;this.offset=0;if(this.head>=32){this.chunks.splice(0,this.head);this.head=0;}}}
  render(out,at){
    out.fill(0);
    if(this.paused)return;
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
// Bundlers may rename this class or serialize it as an anonymous expression.
// Give the worklet its own stable binding instead of relying on the outer name.
export function relayWorkletSource(){return `const PcmPlaybackQueue = ${PcmPlaybackQueue.toString()};
class Speaker extends AudioWorkletProcessor {
 constructor(options){super();const prefill=options?.processorOptions?.prefillMs??120;
 if(!Number.isFinite(prefill)||prefill<0||prefill>1000)throw Error('Invalid playback buffer');
 this.queue=new PcmPlaybackQueue(sampleRate,prefill);this.epoch=0;this.tick=0;
 this.port.onmessage=({data:e})=>{if(e.type==='clear'){this.epoch=e.epoch;this.queue.clear();}
 else if(e.type==='hold'&&e.epoch===this.epoch)this.queue.hold();
 else if(e.type==='pause'&&e.epoch===this.epoch)this.queue.paused=e.paused===true;
 else if(e.type==='done'&&e.epoch===this.epoch)this.queue.end();
 else if(e.type==='audio'&&e.epoch===this.epoch){try{this.queue.push(new Int16Array(e.buffer));}catch{this.port.postMessage({type:'error',epoch:this.epoch});}}};}
 process(inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;
 const before=this.queue.frames;this.queue.render(out,currentTime);
 if(++this.tick%8===0||before>0&&this.queue.frames===0)this.port.postMessage({type:'playback',epoch:this.epoch,consumed:this.queue.consumed,underflows:this.queue.underflows,lastPlayedAt:this.queue.lastPlayedAt,playing:this.queue.playing&&!this.queue.paused});return true;}
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

// This is a reversible listening courtesy, never a turn/identity decision.
// Native recognition and the next response identity decide whether old speech
// is discarded. A rejected/noisy probe resumes the exact unconsumed samples.
export class NativeSpeechPause {
  constructor({minRms=.018,consecutiveOnset=false,trustNativeOnset=true,requireConfirmation=false,confirmationMS=2000}={}){this.requireConfirmation=requireConfirmation;this.confirmationMS=confirmationMS;this.minRms=minRms;this.consecutiveOnset=consecutiveOnset;this.trustNativeOnset=trustNativeOnset;this.reset();this.floor=.004;}
  reset(){this.pendingNativeStartAt=null;this.lastVoicedAt=null;this.voicedMs=0;this.quietMs=0;this.inUtterance=false;this.held=false;this.yielded=false;this.expires=0;this.hardExpires=0;this.locked=false;this.native=false;this.awaitingDecision=false;}
  nativeStarted(at){if(!this.trustNativeOnset&&!this.held){if(this.locked)return;if(this.lastVoicedAt===null||at<this.lastVoicedAt||at-this.lastVoicedAt>this.confirmationMS){this.pendingNativeStartAt=at;return;}}this.pendingNativeStartAt=null;this.held=true;this.yielded=true;this.native=true;this.expires=this.hardExpires=at+15000;}
  ignored(){this.pendingNativeStartAt=null;this.awaitingDecision=false;this.held=false;this.native=false;this.locked=true;this.yielded=false;}
  nativeStopped(at,recognized=true){this.pendingNativeStartAt=null;if(this.held){this.native=false;this.awaitingDecision||=recognized;this.expires=at+1800;}}
  generationDone(at){if(this.held&&!this.native)this.expires=Math.max(this.expires,Math.min(this.hardExpires,at+250));}
  observe(frame,enabled,at,generationComplete=true){
    const pcm=new Int16Array(frame);let sum=0,crossings=0;
    for(let i=0;i<pcm.length;i++){sum+=(pcm[i]/32768)**2;if(i&&((pcm[i]<0)!==(pcm[i-1]<0)))crossings++;}
    const rms=Math.sqrt(sum/Math.max(1,pcm.length)),ms=pcm.length/24,zcr=crossings/Math.max(1,pcm.length);
    // Post-AEC/NS audio only: reject DC, high-frequency broadband noise and
    // isolated clicks. The adaptive floor is bounded so quiet speech recovers.
    const voiced=rms>=Math.max(this.minRms,this.floor*3)&&zcr>.004&&zcr<.32;
    if(voiced){this.quietMs=0;this.voicedMs+=ms;if(this.voicedMs>=140)this.inUtterance=true;}
    else{this.quietMs+=ms;if(this.consecutiveOnset&&!this.inUtterance)this.voicedMs=0;if(this.quietMs>=400){this.voicedMs=0;this.inUtterance=false;this.locked=false;}}
    if(!enabled){
      // Track an ongoing utterance even before output arrives: otherwise an
      // early endpoint reply gets a fresh 140ms of playback over the caller.
      this.pendingNativeStartAt=null;this.held=false;this.yielded=false;this.expires=0;this.hardExpires=0;this.locked=false;this.native=false;this.awaitingDecision=false;return false;
    }
    if(this.inUtterance&&voiced)this.lastVoicedAt=at;
    if(this.pendingNativeStartAt!==null){
      if(at-this.pendingNativeStartAt>this.confirmationMS)this.pendingNativeStartAt=null;
      else if(at>=this.pendingNativeStartAt&&this.inUtterance&&voiced)this.nativeStarted(at);
    }
    // Assisted playback requires the service onset as well as local evidence.
    if(!this.requireConfirmation&&this.inUtterance&&!this.held&&!this.locked){this.held=true;this.yielded=true;this.hardExpires=at+12000;}
    if(this.held&&!this.native&&voiced)this.expires=Math.min(this.hardExpires,at+1800);
    // Output can begin in a gap between syllables of an already known turn.
    if(this.held&&!this.expires)this.expires=Math.min(this.hardExpires,at+1800-this.quietMs);
    if(!voiced&&!this.held)this.floor=Math.min(.012,this.floor*.98+Math.min(rms,.012)*.02);
    // Allow a small recognition handover while generation is still running.
    // Waiting for the entire generation made an ignored "mm-hm" mute a long
    // answer for seconds. Only native-confirmed speech earns the longer hold.
    const grace=!this.native&&!generationComplete?600:0;
    // Recognized speech is awaiting the model's decision, not a silence
    // timeout. Keep samples reversible for an ignored TV/bystander turn;
    // only explicit ignore, replacement or teardown releases this hold.
    if(this.held&&!this.awaitingDecision&&(at>=this.expires+grace||at>=this.hardExpires)){this.held=false;this.native=false;this.locked=true;}
    return this.held;
  }
}
export function createRelayAudio({context,stream,reservation,onEvent,onError,onClosed,onPlaybackActivity=()=>{},greeting=true,inputGated=false}) {
  // Recorded Grok packets: 245ms of speech, then a 595ms arrival gap.
  // 400ms protects that real startup cadence; Xiaohe retains its smaller lead.
  const startBufferMs=reservation.provider==='grok'?400:120;
  // Grok's short greeting can arrive as two sentences with a multi-second
  // network gap. Hold only that first response to its native completion;
  // later answers keep streaming with their normal lead, and the mic stays on.
  const backendOnset=new BackendSpeechOnset();let backendPlayback=false, backendResponseId=null;const retiredResponses=new Set();
  const nativeDuplex=reservation.nativeDuplex===true,assisted=reservation.nativePlaybackPolicy==='assisted',nativeCourtesy=nativeDuplex&&reservation.nativePlaybackPolicy!=='provider',nativePause=new NativeSpeechPause(assisted?{minRms:.035,consecutiveOnset:true,trustNativeOnset:false,requireConfirmation:true}:{});let nativePaused=false,currentResponseId=null;
  let greetingHeld=reservation.provider==='grok';
  const endpoint=new URL('./api/relay',globalThis.document?.baseURI??location.href);endpoint.protocol=location.protocol==='https:'?'wss:':'ws:';
  endpoint.search=new URLSearchParams({voiceSessionId:reservation.voiceSessionId,ticket:reservation.relayTicket});
  const phone=new URLSearchParams(location.search).get('phone');if(phone)endpoint.searchParams.set('phone',phone);
  const socket=new WebSocket(endpoint);socket.binaryType='arraybuffer';
  let recoveryAttempted=false;
  let closed=false,ready=false,node,speaker,source,quietGain,ending=null,tailTimer,epoch=0,written=0,lastPlayedAt=null,lastSequence=0,blocked=false,outputComplete=false,playbackActive=false,busy=false,lastReceiveAt=null,statsTimer,uploadFailed=false;
  const pendingOutput=[];
  const inputBatch=[];let inputBatchBytes=0;
  const flushInput=()=>{if(!inputBatchBytes)return;const bytes=new Uint8Array(inputBatchBytes);let at=0;for(const frame of inputBatch){bytes.set(new Uint8Array(frame),at);at+=frame.byteLength;}inputBatch.length=0;inputBatchBytes=0;socket.send(bytes.buffer);stats.inputBytes+=bytes.byteLength;stats.inputBatches++;};
  const maxQueuedOutputBytes=16*1024*1024;
  const inputTrack=stream.getAudioTracks?.()[0];
  const inputStartedAt=performance.now();let lastInputAt=null;
  const stats={inputFrames:0,inputActiveFrames:0,maxInputGapMs:0,inputIdleMs:0,inputBytes:0,outputBytes:0,queuedOutputBytes:0,peakQueuedOutputBytes:0,clears:0,duplicateFrames:0,underflows:0,maxReceiveGapMs:0,startBufferMs,contextState:context.state,contextSampleRate:context.sampleRate,playbackDrained:false,peakInputBufferedBytes:0,inputBatches:0,nativePauses:0,nativeResumes:0};
  const activity=value=>{if(playbackActive!==value){playbackActive=value;onPlaybackActivity(value);}};
  const send=e=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(e));};
  const reportBusy=()=>{const next=stats.queuedOutputBytes>0||playbackActive;if(next!==busy){busy=next;send({type:'playback.state',speaking:busy});}};
  const pause=paused=>{if(nativePaused===paused)return;nativePaused=paused;speaker?.port.postMessage({type:'pause',paused,epoch});stats[paused?'nativePauses':'nativeResumes']++;onEvent({type:paused?'playback.duplex-paused':'playback.duplex-resumed'});};
  const flush=()=>{backendPlayback=false;backendOnset.reset();nativePause.reset();nativePaused=false;epoch++;written=0;pendingOutput.length=0;outputComplete=false;greetingHeld=false;stats.queuedOutputBytes=0;lastPlayedAt=null;speaker?.port.postMessage({type:'clear',epoch});stats.clears++;activity(false);reportBusy();ending=null;clearTimeout(tailTimer);};
  const checkEnd=()=>{if(closed||!ending)return;
    if(context.state==='running'&&lastPlayedAt!==null&&stats.queuedOutputBytes===0&&context.currentTime>=lastPlayedAt+.75){stats.playbackDrained=true;send({type:'playback.drained',callId:ending});ending=null;}
    else tailTimer=setTimeout(checkEnd,100);
  };
  const stateChanged=()=>{if(closed)return;stats.contextState=context.state;
    if(context.state==='running'){recoveryAttempted=false;if(blocked){blocked=false;onEvent({type:'playback.resumed'});}}
    else {if(!blocked){blocked=true;activity(false);onEvent({type:'playback.blocked'});}
      if(context.state!=='closed'&&globalThis.document?.hidden!==true&&!recoveryAttempted){
        recoveryAttempted=true;void context.resume().catch(()=>{});
      }
    }
  };
  const visible=()=>{if(globalThis.document?.hidden!==true){recoveryAttempted=false;stateChanged();}};
  globalThis.document?.addEventListener?.('visibilitychange',visible);
  const reportStats=()=>{
    stats.inputBufferedBytes=socket.bufferedAmount;
    stats.contextState=context.state;stats.contextTimeMs=Math.round(context.currentTime*1000);
    stats.inputIdleMs=Math.round(performance.now()-(lastInputAt??inputStartedAt));
    stats.trackMuted=inputTrack?.muted===true;stats.trackEnabled=inputTrack?.enabled===true;stats.trackLive=inputTrack?.readyState==='live';
    stats.pageHidden=globalThis.document?.hidden===true;
    send({type:'playback.stats',...stats});
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
    if(nativeDuplex&&e.responseId&&currentResponseId&&e.responseId!==currentResponseId&&(reservation.nativePlaybackPolicy!=='courtesy'&&reservation.nativePlaybackPolicy!==undefined||nativePause.yielded)){
      retiredResponses.add(currentResponseId);if(retiredResponses.size>256)retiredResponses.delete(retiredResponses.values().next().value);
      flush();
    }
    if(e.responseId)currentResponseId=e.responseId;
    if(e.source==='injected-speech'){backendPlayback=true;backendResponseId=e.responseId??null;}
    outputComplete=false;written+=bytes.length/2;stats.queuedOutputBytes+=bytes.length;stats.peakQueuedOutputBytes=Math.max(stats.peakQueuedOutputBytes,stats.queuedOutputBytes);stats.outputBytes+=bytes.length;stats.playbackDrained=false;
    reportBusy();if(speaker)transfer(bytes.buffer);else pendingOutput.push(bytes.buffer);
    if(context.state!=='running')stateChanged();
  };
  const promise=new Promise((resolve,reject)=>{
    socket.onmessage=e=>{if(closed)return;try{
      const value=JSON.parse(e.data);if(value.voiceSessionId!==reservation.voiceSessionId)return;
      if(value.type==='ready'&&!ready){ready=true;resolve();if(greeting)send({type:'greeting'});reportBusy();statsTimer=setInterval(reportStats,2000);}
      if(value.type==='audio')play(value);
      if(value.type==='audio.clear'){
        if(typeof value.retiredResponseId==='string'){retiredResponses.add(value.retiredResponseId);if(retiredResponses.size>256)retiredResponses.delete(retiredResponses.values().next().value);if(nativeDuplex&&currentResponseId&&currentResponseId!==value.retiredResponseId)return;if(nativeDuplex)currentResponseId=null;}
        flush();
      }
      if(nativeCourtesy&&value.type==='input.speech.started'&&stats.queuedOutputBytes>0){nativePause.nativeStarted(performance.now());pause(nativePause.held);}
      if(nativeCourtesy&&value.type==='input.speech.stopped')nativePause.nativeStopped(performance.now(),value.recognized!==false);
      if(nativeCourtesy&&value.type==='input.speech.ignored'&&value.preservedResponseId===currentResponseId){nativePause.ignored();pause(false);}
      if(value.type==='audio.done'&&(!value.responseId||value.responseId===currentResponseId)){outputComplete=true;if(nativeCourtesy)nativePause.generationDone(performance.now());greetingHeld=false;speaker?.port.postMessage({type:'done',epoch});}
      if(value.type==='end.cancelled'){ending=null;clearTimeout(tailTimer);}
      if(value.type==='end.after-playback'){ending=value.callId;checkEnd();}
      if(value.type==='error'){reject(Error(value.message));onError(Error(value.message));}
      onEvent(value);
    }catch(error){reject(error);onError(error);}};
    socket.onerror=()=>{const error=Error('实时语音连接失败');reject(error);onError(error);};
    socket.onclose=()=>{reject(Error('实时语音连接已关闭'));if(!closed)onClosed();};
  });void promise.catch(()=>{});
  async function capture(){
    // A fulfilled dial-gesture resume does not survive Safari activating the
    // microphone or returning from another app. Check the current context.
    if(context.state!=='running')await context.resume();
    if(closed)return;
    if(context.state!=='running')throw Error('麦克风和声音已暂停，请轻点页面后重新拨号。');
    const url=URL.createObjectURL(new Blob([relayWorkletSource()],{type:'text/javascript'}));
    try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    if(closed)return;
    speaker=new AudioWorkletNode(context,'v-direct-speaker',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{prefillMs:startBufferMs}});
    speaker.port.postMessage({type:'clear',epoch});if(nativePaused)speaker.port.postMessage({type:'pause',paused:true,epoch});if(greetingHeld)speaker.port.postMessage({type:'hold',epoch});speaker.connect(context.destination);
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
    node.port.onmessage=e=>{if(closed||uploadFailed)return;const frame=e.data;
      const at=performance.now();if(lastInputAt!==null)stats.maxInputGapMs=Math.max(stats.maxInputGapMs,Math.round(at-lastInputAt));lastInputAt=at;stats.inputFrames++;
      // Count activity only; never retain samples, labels or device identifiers.
      const samples=new Int16Array(frame);let energy=0;for(const sample of samples)energy+=(sample/32768)**2;
      if(Math.sqrt(energy/Math.max(1,samples.length))>=.02)stats.inputActiveFrames++;
      if(ready&&socket.readyState===WebSocket.OPEN){
        if(nativeCourtesy)pause(nativePause.observe(frame,stats.queuedOutputBytes>0,at,outputComplete));
        if(!nativeDuplex&&!inputGated&&backendOnset.observe(frame,backendPlayback&&stats.queuedOutputBytes>0)){
          if(backendResponseId){retiredResponses.add(backendResponseId);if(retiredResponses.size>256)retiredResponses.delete(retiredResponses.values().next().value);}
          flush();send({type:'barge-in'});}
        stats.peakInputBufferedBytes=Math.max(stats.peakInputBufferedBytes,socket.bufferedAmount);
        if(socket.bufferedAmount>480000){uploadFailed=true;onEvent({type:'upload.backpressure',bufferedBytes:socket.bufferedAmount,inputBytes:stats.inputBytes});onError(Error('音频上传积压，请重新拨号'));return;}
        inputBatch.push(frame);inputBatchBytes+=frame.byteLength;
        // Preserve the native 20ms uplink cadence across hosted proxies.
        // A speaker decision still owns interruption; batching does not.
        flushInput();}
    };
  }
  return {ready:promise,stats,async start(){
      // Connecting is not yet a listening call. Starting capture beforehand
      // filled an eight-second PCM queue and aborted legitimate 20s connects.
      // Keep the page-owned microphone grant; attach audio nodes only after
      // the actual upstream ready event. Greeting PCM is retained above.
      await promise;if(!closed)await capture();
    },sendDeviceResult:value=>send(value),sendText:text=>send({type:'text',text}),
    dispose(){if(closed)return;reportStats();closed=true;clearInterval(statsTimer);clearTimeout(tailTimer);context.removeEventListener?.('statechange',stateChanged);globalThis.document?.removeEventListener?.('visibilitychange',visible);flush();node?.port.close();node?.disconnect();speaker?.port.close();speaker?.disconnect();source?.disconnect();quietGain?.disconnect();socket.close();}};
}
