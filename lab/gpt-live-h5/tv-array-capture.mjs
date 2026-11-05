import {TvInputGain} from './tv-array-dsp.mjs';
import {PcmPlaybackQueue} from './relay-audio.mjs';

export const hasTvArrayCapture=()=>globalThis.vTvAudioCapability?.version===1&&typeof globalThis.VTVArray?.start==='function';
export const tvArraySupportsModel=model=>['seeduplex','grok'].includes(model);
const fault=(code,message)=>Object.assign(Error(message),{code});
export async function captureTvArray({context,signal,isCurrent=()=>true,onDiagnostics=()=>{},onError=()=>{},directPcm=false}={}){
  if(!hasTvArrayCapture())throw fault('TV_MIC_CAPABILITY','电视收音尚未就绪，请重试');
  const bridge=globalThis.VTVArray,token=globalThis.vTvAudioCapability.pageToken,id='capture-'+crypto.randomUUID();
  let closed=false,capturing=false,node,destination,metadata,sequence=0,outstanding=0,poll,configured=0,configureWait,pcmSink,streamWait,portListener;
  const inputGain=new TvInputGain();
  const metrics={dspFrames:0,dspMs:0,maxDspMs:0,pullCount:0,maxPullGapMs:0,elapsedMs:0,decodeMs:0,bridgeMs:0,renderMs:0,maxRoundtripMs:0};const submitted=new Map();let beganAt=0,lastPull=0;
  const worker=new Worker(new URL('./tv-array-worker.js',import.meta.url));
  const fail=error=>{if(closed)return;dispose();onError(error);};
  const current=()=>!closed&&!signal?.aborted&&isCurrent();
  function dispose(){
    if(closed)return;closed=true;clearTimeout(poll);
    if(beganAt){metrics.elapsedMs=Math.round(performance.now()-beganAt);console.info('VTVAudio stats '+JSON.stringify({...metrics,transport:metadata?.version===4?'worker-port':'ui-pull'}));}signal?.removeEventListener('abort',dispose);
    configureWait?.reject(fault('TV_MIC_CANCELLED','采集已结束'));configureWait=null;streamWait?.reject(fault('TV_MIC_CANCELLED','采集已结束'));streamWait=null;
    if(portListener)globalThis.removeEventListener('message',portListener);
    bridge.stop(token,id);worker.terminate();node?.disconnect();node?.port.close();
    for(const track of destination?.stream.getTracks()??[])track.stop();
    if(globalThis.__vTvAudioFrame===frame)delete globalThis.__vTvAudioFrame;
    if(globalThis.__vTvAudioError===nativeError)delete globalThis.__vTvAudioError;
  }
  function frame(page,capture,seq,channels,encoded){
    if(!current()||page!==token||capture!==id)return;
    if(seq!==sequence+1||channels!==metadata?.channels||typeof encoded!=='string'||encoded.length>16384){fail(fault('TV_MIC_SEQUENCE','电视收音中断，请重试'));return;}
    sequence=seq;
    if(++outstanding>8){fail(fault('TV_DSP_BACKPRESSURE','电视音频处理繁忙，请重试'));return;}
    try{
      const decodeStart=performance.now(),binary=atob(encoded),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      metrics.decodeMs+=Math.round(performance.now()-decodeStart);
      if(bytes.length!==(metadata.sampleRate/50)*channels*2)throw Error();
      submitted.set(seq,performance.now());worker.postMessage({type:'capture',sequence:seq,buffer:bytes.buffer},[bytes.buffer]);
    }catch{fail(fault('TV_MIC_FORMAT','电视收音格式异常，请重试'));}
  }
  function nativeError(page,capture){if(page===token&&capture===id)fail(fault('TV_MIC_READ','电视本体收音中断，请重试'));}
  function schedulePull(delay){clearTimeout(poll);if(current())poll=setTimeout(pull,delay);}
  function pull(){
    if(!current())return;
    try{
      // Overlap one bounded read batch with DSP work; at most eight frames
      // can be in flight, retaining the existing fail-closed upper bound.
      if(outstanding<=4){
        const now=performance.now();if(lastPull)metrics.maxPullGapMs=Math.max(metrics.maxPullGapMs,Math.round(now-lastPull));lastPull=now;metrics.pullCount++;
        const pullStart=performance.now(),batch=JSON.parse(bridge.pull(token,id));metrics.bridgeMs+=Math.round(performance.now()-pullStart);
        if(batch.error)throw fault(/^[A-Z0-9_]{1,64}$/.test(batch.error)?batch.error:'TV_MIC_READ','电视收音暂不可用，请重试');
        if(!Array.isArray(batch.frames)||batch.frames.length>4)throw fault('TV_MIC_FORMAT','电视收音格式异常，请重试');
        for(const f of batch.frames)frame(token,id,f.sequence,f.channels,f.pcm);
      }
      schedulePull(20);
    }catch(error){fail(error);}
  }
  function openWorkerStream(){
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timeout);if(portListener)globalThis.removeEventListener('message',portListener);portListener=null;};
      const timeout=setTimeout(()=>{cleanup();streamWait=null;reject(fault('TV_MIC_STREAM','电视收音连接超时，请重试'));},8000);
      streamWait={resolve:()=>{cleanup();resolve();},reject:error=>{cleanup();reject(error);}};
      portListener=event=>{
        if(!current()||typeof event.data!=='string'||event.data.length>512||event.ports?.length!==1)return;
        let message;try{message=JSON.parse(event.data);}catch{return;}
        if(message.type!=='v-tv-array-port'||message.version!==1||message.pageToken!==token||message.captureId!==id)return;
        // Native delivers only to the checked top-frame origin. The per-page
        // token and capture id reject late or unrelated channel transfers.
        globalThis.removeEventListener('message',portListener);portListener=null;
        worker.postMessage({type:'bind-port',port:event.ports[0]},[event.ports[0]]);
      };
      globalThis.addEventListener('message',portListener);
      if(typeof bridge.openStream!=='function'||bridge.openStream(token,id)!=='ok'){
        cleanup();streamWait=null;reject(fault('TV_MIC_STREAM','电视收音连接失败，请重试'));
      }
    });
  }
  function configure(channels,sampleRate=48000){
    if(configured===`${channels}:${sampleRate}`)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{configureWait=null;reject(fault('TV_DSP_TIMEOUT','电视音频准备超时，请重试'));},8000);
      configureWait={resolve:()=>{clearTimeout(timeout);resolve();},reject:e=>{clearTimeout(timeout);reject(e);}};
      worker.postMessage({type:'configure',channels,sampleRate,channelLayout:metadata?.channelLayout});
    });
  }
  try{
    if(!current())throw fault('TV_MIC_CANCELLED','采集已结束');
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);};
      const aborted=()=>{cleanup();reject(fault('TV_MIC_CANCELLED','采集已结束'));};
      const timer=setTimeout(()=>{cleanup();reject(fault('TV_DSP_TIMEOUT','电视音频准备超时，请重试'));},8000);
      signal?.addEventListener('abort',aborted,{once:true});
      worker.onmessage=({data})=>{if(data.type==='ready'){cleanup();resolve();}else if(data.type==='error'){cleanup();reject(fault('TV_DSP_INIT','电视音频准备失败，请重试'));}};
      worker.onerror=()=>{cleanup();reject(fault('TV_DSP_LOAD','电视音频加载失败，请重试'));};
      if(signal?.aborted)aborted();
    });
    if(!current())throw fault('TV_MIC_CANCELLED','采集已结束');
    worker.onmessage=({data})=>{
      if(!current())return;
      if(data.type==='error'){const e=fault(/^[A-Z0-9_]{1,64}$/.test(data.code??'')?data.code:'TV_DSP_PROCESS','电视音频处理中断，请重试');configureWait?.reject(e);configureWait=null;streamWait?.reject(e);streamWait=null;fail(e);return;}
      if(data.type==='stream-ready'){streamWait?.resolve();streamWait=null;return;}
      if(data.type==='metrics'){console.info('VTVAudio stats '+JSON.stringify(data));return;}
      if(data.type==='configured'){if(Array.isArray(data.warmup))console.info('VTVAudio stats '+JSON.stringify({warmup:data.warmup}));configured=`${data.channels}:${data.sampleRate??48000}`;configureWait?.resolve();configureWait=null;return;}
      if(data.type==='pcm'){if(submitted.has(data.sequence)){metrics.maxRoundtripMs=Math.max(metrics.maxRoundtripMs,Math.round(performance.now()-submitted.get(data.sequence)));submitted.delete(data.sequence);}metrics.renderMs=Math.round(data.renderMs??0);metrics.dspFrames++;if(Number.isFinite(data.processMs)){metrics.dspMs+=Math.round(data.processMs);metrics.maxDspMs=Math.max(metrics.maxDspMs,Math.round(data.processMs));}if(metadata?.version!==4)outstanding--;if(metadata?.channelLayout)inputGain.process(data.buffer);if(pcmSink)pcmSink(data.buffer);else node?.port.postMessage(data.buffer,[data.buffer]);if(metadata?.version===4)worker.postMessage({type:'consumed',sequence:data.sequence});else if(metadata?.version>=2&&outstanding<=4)schedulePull(0);}
    };
    worker.onerror=()=>fail(fault('TV_DSP_PROCESS','电视音频处理中断，请重试'));
    signal?.addEventListener('abort',dispose,{once:true});
    // Warm all AEC instances and resampling buffers before any hardware frames.
    // Version 2+ separates prepare from recording. Legacy version 1 starts
    // immediately, so retain its deferred start and prewarm the old format.
    if(typeof bridge.begin==='function'){
      metadata=JSON.parse(bridge.start(token,id));
      if(metadata.error)throw fault('TV_MIC_START',metadata.error);
      if(![2,3,4].includes(metadata.version)||![16000,48000].includes(metadata.sampleRate)||![4,6].includes(metadata.channels))throw fault('TV_MIC_FORMAT','电视阵列不支持当前格式');
      await configure(metadata.channels,metadata.sampleRate);
      if(metadata.version===4)await openWorkerStream();
    }else await configure(4);
    if(!directPcm){
    const worklet=`const PcmPlaybackQueue=${PcmPlaybackQueue.toString()};\nclass ArrayInput extends AudioWorkletProcessor {constructor(){super();this.q=new PcmPlaybackQueue(sampleRate,20,24000);this.tick=0;this.peak=0;this.port.onmessage=({data})=>{try{this.q.push(new Int16Array(data));this.peak=Math.max(this.peak,this.q.frames);}catch{this.port.postMessage({type:'overflow',frames:this.q.frames,consumed:this.q.consumed,at:currentTime});}};}process(i,o){if(o[0]?.[0])this.q.render(o[0][0],currentTime);if(++this.tick%375===0){this.port.postMessage({type:'queue',frames:this.q.frames,peak:this.peak,consumed:this.q.consumed,at:currentTime,underflows:this.q.underflows});this.peak=0;}return true;}}registerProcessor('v-tv-array-input',ArrayInput);`;
    const url=URL.createObjectURL(new Blob([worklet],{type:'text/javascript'}));try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    if(!current())throw fault('TV_MIC_CANCELLED','采集已结束');
    destination=context.createMediaStreamDestination();node=new AudioWorkletNode(context,'v-tv-array-input',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});node.connect(destination);
    node.port.onmessage=({data})=>{console.info('VTVAudio stats '+JSON.stringify({...data,contextState:context.state}));if(data?.type==='overflow')fail(fault('TV_MIC_QUEUE','电视音频处理积压，请重试'));};
    }else destination=context.createMediaStreamDestination();
    globalThis.__vTvAudioFrame=frame;globalThis.__vTvAudioError=nativeError;
    let diagnostics={kind:'tv-array-microphone',source:'pending',channels:null,sampleRate:48000,echoCancellation:'webrtc-aec3-render-reference',acousticEchoTestPassed:false};
    return {stream:destination.stream,track:destination.stream.getAudioTracks()[0],diagnostics,snapshot:()=>diagnostics,dispose,
      subscribePcm:directPcm?listener=>{if(closed||pcmSink||typeof listener!=='function')throw Error('Invalid PCM owner');pcmSink=listener;return ()=>{if(pcmSink===listener)pcmSink=null;};}:undefined,
      async startCapture(){
        if(!current())throw fault('TV_MIC_CANCELLED','采集已结束');
        if(capturing)return;
        capturing=true;
        if(!metadata){
          metadata=JSON.parse(bridge.start(token,id));
          if(metadata.error)throw fault('TV_MIC_START',metadata.error);
          if(metadata.version!==1||metadata.sampleRate!==48000||![4,6].includes(metadata.channels))throw fault('TV_MIC_FORMAT','电视阵列不支持当前格式');
          await configure(metadata.channels,metadata.sampleRate);
        }
        if(!current())throw fault('TV_MIC_CANCELLED','采集已结束');
        if(metadata.version>=2){
          if(typeof bridge.begin!=='function'||typeof bridge.pull!=='function')throw fault('TV_MIC_CAPABILITY','请更新电视收音组件');
          beganAt=performance.now();const result=bridge.begin(token,id);if(result!=='ok')throw fault('TV_MIC_START','电视本体麦克风暂不可用，请重试');
          if(metadata.version!==4)pull();
        }
        diagnostics={...diagnostics,source:metadata.source,channels:metadata.channels,sampleRate:metadata.sampleRate,transport:metadata.version===4?'worker-port':'ui-pull'};onDiagnostics(diagnostics);
      },
      renderReference:metadata?.channelLayout?undefined:(buffer,sampleRate)=>{if(current())worker.postMessage({type:'render',buffer,sampleRate},[buffer]);}};
  }catch(error){dispose();throw error;}
}
