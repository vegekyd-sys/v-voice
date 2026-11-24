// Gateway-owned PCM transport shared by Seeduplex and Grok. No provider key
// or arbitrary tool request is accepted from this browser audio channel.
// Runs inside the audio rendering thread. A consumed sample is never replayed
// during starvation: silence and a short rebuffer replace the old waveform.
import {UPLOAD_BACKPRESSURE} from './upload-backpressure.mjs';

export class PcmPlaybackQueue {
  // `growMs` / `maxMs`: a voice that arrives no faster than it plays (GPT Live) never gets ahead of
  // the network, so the window it starts with is all it has. Each time the queue runs dry in the
  // middle of a reply the window grows, up to `maxMs`, and stays grown for the call.
  constructor(rate, prefillMs=120, maxFrames=8*1024*1024, {growMs=0,maxMs=prefillMs}={}) {
    this.rate=rate;this.prefill=Math.ceil(rate*prefillMs/1000);this.grow=Math.ceil(rate*growMs/1000);this.maxPrefill=Math.ceil(rate*Math.max(prefillMs,maxMs)/1000);this.maxFrames=maxFrames;
    // A pause held for a voice that is behind (see `quietAhead`): what counts as quiet (about -42 dBFS), how
    // much quiet must already have played before it counts as a pause, and how long one pause may be held.
    // Kept on the instance: this class is also the source of the audio thread's copy.
    this.quietSample=260;this.pauseMin=Math.ceil(rate*.12);this.holdMax=Math.ceil(rate*.5);this.reserveMax=Math.ceil(rate*.2);this.stretched=0;this.clear();
  }
  starved(){this.underflows++;if(this.grow)this.prefill=Math.min(this.maxPrefill,this.prefill+this.grow);}
  // GPT Live's voice is sent a little slower than it plays (measured: 91 to 98 packets for every 100 due,
  // none lost, nothing left out of its timestamps), so a queue played at full speed is eaten until it runs
  // dry in the middle of a word and waits to fill again: one to three breaks in every long answer. A
  // player made for this stretches the sound a little. Here the pauses V makes anyway are held a little
  // longer instead: while less than the window is waiting, 120 ms of quiet have just played and what comes
  // next is quiet too, nothing is taken from the queue (half a second at most for one pause). The 120 ms
  // keep it out of words: the closure of a stop consonant is quiet as well, but shorter.
  // The window a reply starts with (a third of a second) lasts six seconds of speech at the slowest speed
  // measured, and a story can go longer than that without a pause. So a pause is also used to put a
  // little by: with the window full, up to 200 ms more of one pause, until the largest window is waiting.
  quietAhead(){
    const span=Math.min(this.frames,240); // 10 ms of the 24 kHz stream
    for(let i=0;i<span;i+=6)if(Math.abs(this.peek(i))>=this.quietSample)return false;
    return span>0;
  }
  clear(){this.chunks=[];this.head=0;this.offset=0;this.frames=0;this.phase=0;this.wait=0;this.playing=false;this.consumed=0;this.underflows=0;this.lastPlayedAt=null;this.complete=false;this.holdUntilComplete=false;this.paused=false;this.held=0;this.quietRun=0;}
  hold(){this.holdUntilComplete=true;}
  end(){this.complete=true;this.holdUntilComplete=false;}
  push(pcm){this.complete=false;if(!(pcm instanceof Int16Array)||!pcm.length)throw Error('Invalid PCM');if(this.frames+pcm.length>this.maxFrames)throw Error('PCM queue overflow');this.chunks.push(pcm);this.frames+=pcm.length;}
  peek(offset){const c=this.chunks[this.head];const i=this.offset+offset;return i<c.length?c[i]:(this.chunks[this.head+1]?.[i-c.length]??c[c.length-1]);}
  advance(){this.offset++;this.frames--;this.consumed++;if(this.offset===this.chunks[this.head].length){this.chunks[this.head]=null;this.head++;this.offset=0;if(this.head>=32){this.chunks.splice(0,this.head);this.head=0;}}}
  render(out,at){
    out.fill(0);
    if(this.paused)return;
    if(this.holdUntilComplete&&!this.complete)return;
    if(!this.frames){if(this.playing){if(!this.complete)this.starved();this.playing=false;this.wait=0;}return;}
    // Even a large first packet needs a real jitter window. Previously a
    // 244ms packet bypassed prefill and a next packet at 300ms caused a hole.
    // A complete response can start immediately: no more network frames await.
    if(!this.playing){this.wait+=out.length;if(!this.complete&&this.wait<this.prefill)return;this.playing=true;this.wait=0;}
    const step=24000/this.rate;
    const waiting=this.frames*this.rate/24000;
    if(this.grow&&!this.complete&&this.quietRun>=this.pauseMin&&this.held<(waiting<this.prefill?this.holdMax:waiting<this.maxPrefill?this.reserveMax:0)&&this.quietAhead()){this.held+=out.length;this.stretched+=out.length;return;}
    if(this.held&&!this.quietAhead())this.held=0;
    for(let i=0;i<out.length;i++){
      if(!this.frames){if(!this.complete)this.starved();this.playing=false;this.wait=0;break;}
      const a=this.peek(0),b=this.peek(1);out[i]=(a+(b-a)*this.phase)/32768;this.quietRun=Math.abs(a)<this.quietSample?this.quietRun+1:0;this.lastPlayedAt=at+(i+1)/this.rate;
      this.phase+=step;while(this.phase>=1&&this.frames){this.phase-=1;this.advance();}
      if(!this.frames)this.phase=0;
    }
  }
}
// Bundlers may rename this class or serialize it as an anonymous expression.
// Give the worklet its own stable binding instead of relying on the outer name.
export function relayWorkletSource(){return `const PcmPlaybackQueue = ${PcmPlaybackQueue.toString()};
class Speaker extends AudioWorkletProcessor {
 constructor(options){super();const prefill=options?.processorOptions?.prefillMs??120,growMs=options?.processorOptions?.prefillGrowMs??0,maxMs=options?.processorOptions?.prefillMaxMs??prefill;this.reference=options?.processorOptions?.renderReference===true;this.ref=new Float32Array(Math.round(sampleRate/50));this.refPos=0;
 if(!Number.isFinite(prefill)||prefill<0||prefill>1000||!Number.isFinite(growMs)||growMs<0||!Number.isFinite(maxMs)||maxMs>1000)throw Error('Invalid playback buffer');
 this.outputMuted=false;this.queue=new PcmPlaybackQueue(sampleRate,prefill,undefined,{growMs,maxMs});this.epoch=0;this.tick=0;this.firstNonzeroAt=null;
 this.port.onmessage=({data:e})=>{if(e.type==='clear'){this.epoch=e.epoch;this.queue.clear();}
 else if(e.type==='output-mute')this.outputMuted=e.muted===true;
 else if(e.type==='hold'&&e.epoch===this.epoch)this.queue.hold();
 else if(e.type==='pause'&&e.epoch===this.epoch)this.queue.paused=e.paused===true;
 else if(e.type==='done'&&e.epoch===this.epoch)this.queue.end();
 else if(e.type==='audio'&&e.epoch===this.epoch){try{this.queue.push(new Int16Array(e.buffer));}catch{this.port.postMessage({type:'error',epoch:this.epoch});}}};}
 process(inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;
 const before=this.queue.frames;this.queue.render(out,currentTime);if(this.outputMuted)out.fill(0);
 if(this.firstNonzeroAt===null){const index=out.findIndex(value=>value!==0);if(index>=0){this.firstNonzeroAt=currentTime+index/sampleRate;this.port.postMessage({type:'first-render',epoch:this.epoch,contextTime:this.firstNonzeroAt});}}
 if(this.reference)for(const value of out){this.ref[this.refPos++]=value;if(this.refPos===this.ref.length){this.port.postMessage({type:'render-reference',epoch:this.epoch,sampleRate,buffer:this.ref.buffer},[this.ref.buffer]);this.ref=new Float32Array(Math.round(sampleRate/50));this.refPos=0;}}
 if(++this.tick%8===0||before>0&&this.queue.frames===0)this.port.postMessage({type:'playback',epoch:this.epoch,consumed:this.queue.consumed,underflows:this.queue.underflows,stretchedMs:Math.round(this.queue.stretched*1000/sampleRate),lastPlayedAt:this.queue.lastPlayedAt,playing:this.queue.playing&&!this.queue.paused&&!this.outputMuted});return true;}
}
class Mic extends AudioWorkletProcessor {
 constructor(){super();this.sum=0;this.count=0;this.phase=0;this.frame=new Int16Array(480);this.index=0;}
 process(inputs){const data=inputs[0]?.[0];if(data)for(const value of data){this.sum+=value;this.count++;this.phase+=24000;
 if(this.phase>=sampleRate){this.phase-=sampleRate;const v=Math.max(-1,Math.min(1,this.sum/this.count));this.frame[this.index++]=Math.round(v*(v<0?32768:32767));this.sum=0;this.count=0;
 if(this.index===480){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Int16Array(480);this.index=0;}}}return true;}
}
registerProcessor('v-direct-speaker',Speaker);registerProcessor('v-direct-mic',Mic);`;}
// Some Android TV WebViews intermittently run AudioWorklet output at ~0.62x
// wall time. AudioBufferSource uses the browser's native renderer instead.
// Schedule only a short horizon; reclaim precisely the unplayed samples on
// pause/hold. Policy (turns, interruption, mute) remains in the shared relay.
export function createBufferedPcmSpeaker(context,{prefillMs=120,growMs=0,maxMs=prefillMs}={}){
  const output=context.createGain(),disconnect=output.disconnect.bind(output);
  let chunks=[],offset=0,frames=0,scheduled=[],consumed=0,epoch=0,nextAt=null,firstAt=null;
  let paused=false,held=false,complete=false,muted=false,closed=false,underflows=0,starved=false,lastPlayedAt=null;
  let firstAudibleAt=null,reportedFirstRender=false;
  const rate=24000,blockFrames=2400,lead=.72;
  const port={onmessage:null,postMessage:command,close:dispose};output.port=port;
  const futureFrames=(block,now)=>Math.max(0,block.pcm.length-Math.max(0,Math.min(block.pcm.length,Math.floor((now-block.at)*rate+1e-5))));
  function trim(now){scheduled=scheduled.filter(b=>b.at+b.pcm.length/rate>now);}
  function reclaim(){
    const now=context.currentTime,rest=[];let count=0;firstAudibleAt=null;
    for(const b of scheduled){const n=futureFrames(b,now);if(n){rest.push(b.pcm.subarray(b.pcm.length-n));count+=n;}try{b.node.stop();b.node.disconnect();}catch{}}
    if(offset&&chunks.length)chunks[0]=chunks[0].subarray(offset);
    chunks=rest.concat(chunks);offset=0;frames+=count;consumed-=count;scheduled=[];nextAt=null;firstAt=context.currentTime-prefillMs/1000;
  }
  function take(count){const out=new Int16Array(count);let n=0;while(n<count){const chunk=chunks[0],size=Math.min(count-n,chunk.length-offset);out.set(chunk.subarray(offset,offset+size),n);n+=size;offset+=size;frames-=size;if(offset===chunk.length){chunks.shift();offset=0;}}return out;}
  function notify(data){port.onmessage?.({data:{epoch,...data}});}
  function command(e){if(closed)return;
    if(e.type==='clear'){reclaim();chunks=[];offset=frames=consumed=underflows=0;epoch=e.epoch;nextAt=firstAt=lastPlayedAt=null;paused=held=complete=starved=false;return;}
    if(e.type==='output-mute'){muted=e.muted===true;if(muted)firstAudibleAt=null;output.gain.value=muted?0:1;return;}
    if(e.epoch!==epoch)return;
    if(e.type==='pause'){if(e.paused===true&&!paused)reclaim();paused=e.paused===true;return;}
    if(e.type==='hold'){if(!held)reclaim();held=true;return;}
    if(e.type==='done'){complete=true;held=false;return;}
    if(e.type==='audio'){
      const pcm=new Int16Array(e.buffer);
      const pending=scheduled.reduce((n,b)=>n+futureFrames(b,context.currentTime),0);
      if(!pcm.length||frames+pending+pcm.length>8*1024*1024){notify({type:'error'});return;}
      chunks.push(pcm);frames+=pcm.length;complete=false;if(firstAt===null&&nextAt===null)firstAt=context.currentTime;
    }
  }
  function tick(){if(closed)return;const now=context.currentTime;
    if(!reportedFirstRender&&!muted&&!paused&&context.state==='running'&&firstAudibleAt!==null&&now>=firstAudibleAt){
      reportedFirstRender=true;notify({type:'first-render',contextTime:firstAudibleAt});
    }
    let pending=0,playing=false;
    for(const b of scheduled){const left=futureFrames(b,now);pending+=left;if(now>=b.at&&left>0)playing=true;if(now>=b.at)lastPlayedAt=Math.min(now,b.at+b.pcm.length/rate);}
    trim(now);
    if(playing)starved=false;
    if(nextAt!==null&&now>nextAt+.005&&!paused&&!held&&(frames>0||!complete)&&!starved){underflows++;starved=true;if(growMs){prefillMs=Math.min(maxMs,prefillMs+growMs);firstAt=now;}}
    if(!paused&&!held&&context.state==='running'&&frames){
      if(nextAt===null||nextAt<now){nextAt=Math.max(now+.02,(firstAt??now)+(complete?0:prefillMs/1000));}
      while(frames&&nextAt<now+lead){
        const pcm=take(Math.min(blockFrames,frames)),buffer=context.createBuffer(1,pcm.length,rate),out=buffer.getChannelData(0);
        for(let i=0;i<pcm.length;i++)out[i]=pcm[i]/32768;
        if(!reportedFirstRender&&firstAudibleAt===null&&!muted){
          const first=pcm.findIndex(value=>value!==0);
          if(first>=0)firstAudibleAt=nextAt+first/rate;
        }
        const node=context.createBufferSource();node.buffer=buffer;node.connect(output);node.start(nextAt);
        node.onended=()=>{try{node.disconnect();}catch{}};
        scheduled.push({node,pcm,at:nextAt});nextAt+=pcm.length/rate;consumed+=pcm.length;pending+=pcm.length;
      }
    }
    if(!frames&&!scheduled.length){nextAt=null;firstAt=null;}
    notify({type:'playback',consumed:Math.max(0,consumed-pending),underflows,lastPlayedAt,playing:playing&&!paused&&!held&&!muted});
  }
  const timer=setInterval(tick,20);
  function dispose(){if(closed)return;reclaim();closed=true;clearInterval(timer);chunks=[];frames=0;}
  output.disconnect=(...args)=>{if(!args.length)dispose();return disconnect(...args);};
  return output;
}
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
// Observe the actual rendered output and live input without modifying either path.
// Only bounded RMS is published; buffers are overwritten and never retained.
export function observeAudioMeters({context,input,output,onLevel,inputLevel}) {
  const mic=context.createAnalyser(),speaker=context.createAnalyser();
  mic.fftSize=speaker.fftSize=1024;
  input?.connect(mic);output.connect(speaker);
  const a=new Float32Array(1024),b=new Float32Array(1024);
  const rms=(node,buffer)=>{node.getFloatTimeDomainData(buffer);let sum=0;for(const value of buffer)sum+=value*value;return Math.sqrt(sum/buffer.length);};
  const timer=setInterval(()=>onLevel(context.state==='running'?{input:inputLevel?inputLevel():rms(mic,a),output:rms(speaker,b)}:{input:0,output:0}),100);
  return ()=>{clearInterval(timer);try{input?.disconnect(mic);output.disconnect(speaker);}catch{}mic.disconnect();speaker.disconnect();};
}
const {shedBytes:UPLOAD_SHED_BYTES,resumeBytes:UPLOAD_RESUME_BYTES,stallMS:UPLOAD_STALL_MS}=UPLOAD_BACKPRESSURE;
export function createRelayAudio({context,stream,reservation,connection,dialStartedAt=performance.now(),onTiming=()=>{},onEvent,onError,onClosed,onPlaybackActivity=()=>{},onAudioLevel,renderReference,startCapture,subscribePcm,prepareCapture,bufferedOutput=false,greeting=true,inputGated=false}) {
  let stopMeter,stopPcm,pcmLevel=0,pcmLevelAt=0,outputMuted=false;
  const timing=name=>{try{onTiming(name);}catch{}};
  // Recorded Grok packets: 245ms of speech, then a 595ms arrival gap.
  // 400ms protects that real startup cadence; Xiaohe retains its smaller lead.
  // GPT Live's voice arrives at the speed it plays (20 ms at a time, over the relay): with 120 ms in
  // hand the queue ran dry about every three seconds on a real call (61 times in 167 s of speech, packets
  // up to 0.6 s apart). It starts with more and widens when the network asks for it.
  const realtimeVoice=reservation.provider==='gpt-live-11';
  const startBufferMs=reservation.provider==='grok'?400:realtimeVoice?320:120,bufferGrowMs=realtimeVoice?120:0,bufferMaxMs=realtimeVoice?680:startBufferMs;
  // Grok's short greeting can arrive as two sentences with a multi-second
  // network gap. Hold only that first response to its native completion;
  // later answers keep streaming with their normal lead, and the mic stays on.
  const backendOnset=new BackendSpeechOnset();let backendPlayback=false, backendResponseId=null;const retiredResponses=new Set();
  const nativeDuplex=reservation.nativeDuplex===true,assisted=reservation.nativePlaybackPolicy==='assisted',nativeCourtesy=nativeDuplex&&reservation.nativePlaybackPolicy!=='provider',nativePause=new NativeSpeechPause(assisted?{minRms:.035,consecutiveOnset:true,trustNativeOnset:false,requireConfirmation:true}:{});let nativePaused=false,currentResponseId=null;
  let greetingHeld=reservation.provider==='grok';
  const endpoint=new URL('./api/relay',globalThis.document?.baseURI??location.href);endpoint.protocol=location.protocol==='https:'?'wss:':'ws:';
  endpoint.search=new URLSearchParams({voiceSessionId:reservation.voiceSessionId,ticket:reservation.relayTicket});
  const phone=new URLSearchParams(location.search).get('phone');if(phone)endpoint.searchParams.set('phone',phone);
  const socket=connection?.socket??new WebSocket(endpoint);socket.binaryType='arraybuffer';
  let recoveryAttempted=false;
  let lastMessageAt=null;
  let closed=false,ready=false,node,speaker,source,quietGain,ending=null,tailTimer,epoch=0,written=0,lastPlayedAt=null,lastSequence=0,blocked=false,outputComplete=false,playbackActive=false,busy=false,lastReceiveAt=null,statsTimer,uploadFailed=false;
  const pendingOutput=[];
  const inputBatch=[];let inputBatchBytes=0;
  const flushInput=()=>{if(!inputBatchBytes)return;const bytes=new Uint8Array(inputBatchBytes);let at=0;for(const frame of inputBatch){bytes.set(new Uint8Array(frame),at);at+=frame.byteLength;}inputBatch.length=0;inputBatchBytes=0;socket.send(bytes.buffer);stats.inputBytes+=bytes.byteLength;stats.inputBatches++;};
  const maxQueuedOutputBytes=16*1024*1024;
  let inputTrack=stream?.getAudioTracks?.()[0];
  const inputStartedAt=performance.now();let lastInputAt=null;
  let uploadStalledAt=null;
  const stats={droppedInputFrames:0,inputFrames:0,inputActiveFrames:0,maxInputGapMs:0,inputIdleMs:0,inputBytes:0,outputBytes:0,queuedOutputBytes:0,peakQueuedOutputBytes:0,clears:0,duplicateFrames:0,underflows:0,maxReceiveGapMs:0,startBufferMs,contextState:context.state,contextSampleRate:context.sampleRate,playbackDrained:false,peakInputBufferedBytes:0,inputBatches:0,nativePauses:0,nativeResumes:0};
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
  let clockSample={wall:performance.now(),audio:context.currentTime,running:context.state==='running'};
  const reportStats=()=>{
    const now=performance.now(),audioNow=context.currentTime,wallMs=now-clockSample.wall;
    if(clockSample.running&&context.state==='running'&&wallMs>=500){stats.outputClockWallMs=Math.round(wallMs);stats.outputClockAudioMs=Math.round((audioNow-clockSample.audio)*1000);stats.outputClockRatio=Math.round(stats.outputClockAudioMs/wallMs*1000)/1000;}
    else{delete stats.outputClockWallMs;delete stats.outputClockAudioMs;delete stats.outputClockRatio;}
    clockSample={wall:now,audio:audioNow,running:context.state==='running'};
    stats.inputBufferedBytes=socket.bufferedAmount;
    stats.contextState=context.state;stats.contextTimeMs=Math.round(context.currentTime*1000);
    stats.inputIdleMs=Math.round(performance.now()-(lastInputAt??inputStartedAt));
    stats.trackMuted=inputTrack?.muted===true;stats.trackEnabled=inputTrack?.enabled===true;stats.trackLive=inputTrack?.readyState==='live';
    stats.pageHidden=globalThis.document?.hidden===true;
    if(globalThis.document?.documentElement?.dataset.tv==='true')document.documentElement.dataset.voicePlaybackClock=JSON.stringify({wallMs:stats.outputClockWallMs,audioMs:stats.outputClockAudioMs,ratio:stats.outputClockRatio,buffered:stats.bufferedOutput===1,underflows:stats.underflows,queuedBytes:stats.queuedOutputBytes,outputBytes:stats.outputBytes});
    send({type:'playback.stats',...stats});
  };
  context.addEventListener?.('statechange',stateChanged);
  const transfer=buffer=>speaker.port.postMessage({type:'audio',buffer,epoch},[buffer]);
  const play=e=>{
    // Only a transport identity can establish duplication. Never compare PCM:
    // identical silence and repeated syllables are valid audio.
    if(Number.isSafeInteger(e.sequence)&&e.sequence>0){if(e.sequence<=lastSequence){stats.duplicateFrames++;return;}lastSequence=e.sequence;}
    // Avoid allocating a JavaScript element for every byte of the lecture audio.
    const binary=atob(e.audio),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    if(!bytes.length||bytes.length%2||bytes.length>480000||e.sampleRate!==24000)throw Error('语音帧格式无效');
    if(stats.dialToFirstPcmMs===undefined){stats.dialToFirstPcmMs=Math.round(performance.now()-dialStartedAt);timing('voice.output.received');}
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
    socket.onmessage=e=>{if(closed)return;lastMessageAt=performance.now();try{
      const value=JSON.parse(e.data);if(value.voiceSessionId!==reservation.voiceSessionId)return;
      if(value.type==='ready'&&!ready){ready=true;stats.dialToReadyMs=Math.round(performance.now()-dialStartedAt);resolve();if(greeting)send({type:'greeting'});reportBusy();statsTimer=setInterval(reportStats,2000);}
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
    // (How it closed goes with the report: a call cut off is dialled again, and the next call's record says what the page saw.)
    socket.onclose=event=>{reject(Error('实时语音连接已关闭'));if(!closed)onClosed({code:Number.isInteger(event?.code)?event.code:null,clean:event?.wasClean===true,quietMs:lastReceiveAt==null?null:Math.round(performance.now()-lastReceiveAt),
      // (`quietMs` counts from V's last sound; this from the last line of anything, the service's keepalive included.)
      silentMs:lastMessageAt==null?null:Math.round(performance.now()-lastMessageAt)});};
  });void promise.catch(()=>{});
  connection?.adopt();
  // Received PCM is retained until the speaker node exists, so a dial that
  // already owns its socket asks for the greeting now; the server speaks it at
  // ready. The ready handler repeats the request for a server that ignored this.
  if(connection&&greeting)send({type:'greeting'});
  async function capture(){
    if(prepareCapture){
      const input=await prepareCapture();
      if(closed){input?.dispose?.();return;}
      ({stream,renderReference,startCapture,subscribePcm}=input);inputTrack=stream?.getAudioTracks?.()[0];
    }

    // A fulfilled dial-gesture resume does not survive Safari activating the
    // microphone or returning from another app. Check the current context.
    if(context.state!=='running')await context.resume();
    if(closed)return;
    if(context.state!=='running')throw Error('麦克风和声音已暂停，请轻点页面后重新拨号。');
    const buffered=bufferedOutput&&typeof subscribePcm==='function'&&typeof renderReference!=='function';
    stats.bufferedOutput=buffered?1:0;
    if(buffered){
      stats.startBufferMs=Math.max(startBufferMs,240);
      speaker=createBufferedPcmSpeaker(context,{prefillMs:stats.startBufferMs,growMs:bufferGrowMs||100,maxMs:Math.max(bufferMaxMs,640)});
    }
    else {
      const url=URL.createObjectURL(new Blob([relayWorkletSource()],{type:'text/javascript'}));
      try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
      if(closed)return;
      speaker=new AudioWorkletNode(context,'v-direct-speaker',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{prefillMs:startBufferMs,prefillGrowMs:bufferGrowMs,prefillMaxMs:bufferMaxMs,renderReference:typeof renderReference==='function'}});
    }
    speaker.port.postMessage({type:'output-mute',muted:outputMuted});speaker.port.postMessage({type:'clear',epoch});if(nativePaused)speaker.port.postMessage({type:'pause',paused:true,epoch});if(greetingHeld)speaker.port.postMessage({type:'hold',epoch});speaker.connect(context.destination);
    speaker.port.onmessage=({data:e})=>{
      if(closed)return;
      // A render-thread nonzero PCM receipt excludes pickup cues and silent
      // packets. This is an observation upper bound, not physical audibility.
      if(e.type==='first-render'&&stats.dialToFirstRenderObservedMs===undefined){stats.dialToFirstRenderObservedMs=Math.round(performance.now()-dialStartedAt);timing('voice.output.rendered');
        if(buffered)console.info('VTVAudio stats '+JSON.stringify({firstVoiceRenderMs:stats.dialToFirstRenderObservedMs,readyMs:stats.dialToReadyMs,firstPcmMs:stats.dialToFirstPcmMs,preconnected:connection?.preconnected===true}));
        reportStats();return;}
      if(e.epoch!==epoch)return;
      if(e.type==='render-reference'){renderReference?.(e.buffer,e.sampleRate);return;}
      if(e.type==='error'){onError(Error('语音缓存过大，请重新拨号'));return;}
      if(e.type!=='playback')return;
      stats.queuedOutputBytes=Math.max(0,written-e.consumed)*2;stats.underflows=e.underflows;if(Number.isFinite(e.stretchedMs))stats.stretchedMs=e.stretchedMs;lastPlayedAt=e.lastPlayedAt;
      if(stats.queuedOutputBytes===0&&!e.playing)backendPlayback=false;
      activity(e.playing&&context.state==='running');reportBusy();
    };
    for(const buffer of pendingOutput)transfer(buffer);pendingOutput.length=0;if(outputComplete)speaker.port.postMessage({type:'done',epoch});
    const receiveInput=(buffer,lastInBatch=true)=>{if(closed||uploadFailed)return;
      if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==960){onError(Error('麦克风音频帧格式无效'));return;}
      // The hardware adapter already supplies 24 kHz PCM. Do not play it into
      // a MediaStream and capture it again on the output audio clock.
      const frame=inputTrack?.enabled===false?new ArrayBuffer(buffer.byteLength):buffer;
      const at=performance.now();if(lastInputAt!==null)stats.maxInputGapMs=Math.max(stats.maxInputGapMs,Math.round(at-lastInputAt));lastInputAt=at;stats.inputFrames++;
      // Count activity only; never retain samples, labels or device identifiers.
      const samples=new Int16Array(frame);let energy=0;for(const sample of samples)energy+=(sample/32768)**2;
      pcmLevel=Math.sqrt(energy/Math.max(1,samples.length));pcmLevelAt=at;
      if(pcmLevel>=.02)stats.inputActiveFrames++;
      if(ready&&socket.readyState===WebSocket.OPEN){
        if(nativeCourtesy)pause(nativePause.observe(frame,stats.queuedOutputBytes>0,at,outputComplete));
        if(!nativeDuplex&&!inputGated&&backendOnset.observe(frame,backendPlayback&&stats.queuedOutputBytes>0)){
          if(backendResponseId){retiredResponses.add(backendResponseId);if(retiredResponses.size>256)retiredResponses.delete(retiredResponses.values().next().value);}
          flush();send({type:'barge-in'});}
        stats.peakInputBufferedBytes=Math.max(stats.peakInputBufferedBytes,socket.bufferedAmount);
        // A slow uplink (a large download on the same link, say) sheds microphone
        // frames so speech stays current; only an uplink that never drains ends the call.
        if(uploadStalledAt===null?socket.bufferedAmount>UPLOAD_SHED_BYTES:socket.bufferedAmount>UPLOAD_RESUME_BYTES){
          uploadStalledAt??=at;stats.droppedInputFrames++;
          if(at-uploadStalledAt>UPLOAD_STALL_MS){uploadFailed=true;onEvent({type:'upload.backpressure',bufferedBytes:socket.bufferedAmount,inputBytes:stats.inputBytes});onError(Error('音频上传积压，请重新拨号'));}
          return;
        }
        uploadStalledAt=null;
        inputBatch.push(frame);inputBatchBytes+=frame.byteLength;
        // All three frames of a hardware packet arrive in the same callback.
        // Keep the per-frame speech detector, then send these samples together.
        if(lastInBatch||inputBatch.length>=3)flushInput();}
    };
    if(typeof subscribePcm==='function')stopPcm=subscribePcm(receiveInput);
    else {
      node=new AudioWorkletNode(context,'v-direct-mic');source=context.createMediaStreamSource(stream);
      quietGain=context.createGain();quietGain.gain.value=0;source.connect(node);node.connect(quietGain);quietGain.connect(context.destination);
      node.port.onmessage=e=>receiveInput(e.data);
    }
    if(onAudioLevel)stopMeter=observeAudioMeters({context,input:source,output:speaker,onLevel:onAudioLevel,
      inputLevel:subscribePcm?()=>performance.now()-pcmLevelAt<250?pcmLevel:0:undefined});
  }
  return {ready:promise,stats,setOutputMuted(value){outputMuted=value===true;speaker?.port.postMessage({type:'output-mute',muted:outputMuted});if(outputMuted)activity(false);},async start(){
      // Connecting is not yet a listening call. Starting capture beforehand
      // filled an eight-second PCM queue and aborted legitimate 20s connects.
      // Keep the page-owned microphone grant; attach audio nodes only after
      // the actual upstream ready event. Greeting PCM is retained above.
      await promise;if(!closed)await capture();if(!closed)await startCapture?.();
    },sendDeviceResult:value=>send(value),sendText:text=>send({type:'text',text}),
    dispose(){if(closed)return;stopPcm?.();stopMeter?.();reportStats();closed=true;clearInterval(statsTimer);clearTimeout(tailTimer);context.removeEventListener?.('statechange',stateChanged);globalThis.document?.removeEventListener?.('visibilitychange',visible);flush();node?.port.close();node?.disconnect();speaker?.port.close();speaker?.disconnect();source?.disconnect();quietGain?.disconnect();socket.close();}};
}
