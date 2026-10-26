import {PcmPlaybackQueue} from './relay-audio.mjs';

// Explicit device capability, never inferred from a URL, account, transcript or model.
export const hasTvArrayCapture=()=>globalThis.vTvAudioCapability?.version===1&&typeof globalThis.VTVArray?.start==='function';
export const tvArraySupportsModel=model=>['seeduplex','grok'].includes(model);
export async function captureTvArray({context,signal,isCurrent=()=>true,onDiagnostics=()=>{},onError=()=>{}}={}){
  if(!hasTvArrayCapture())throw Error('电视阵列驱动未就绪');
  const token=globalThis.vTvAudioCapability.pageToken,id='capture-'+crypto.randomUUID();
  let closed=false,node,destination,metadata,sequence=0,outstanding=0;const worker=new Worker(new URL('./tv-array-worker.js',import.meta.url));
  const fail=error=>{if(closed)return;dispose();onError(error);};
  function dispose(){if(closed)return;closed=true;signal?.removeEventListener('abort',dispose);globalThis.VTVArray.stop(token,id);worker.terminate();node?.disconnect();node?.port.close();for(const track of destination?.stream.getTracks()??[])track.stop();if(globalThis.__vTvAudioFrame===frame)delete globalThis.__vTvAudioFrame;if(globalThis.__vTvAudioError===nativeError)delete globalThis.__vTvAudioError;}
  function frame(page,capture,seq,channels,encoded){
    if(closed||page!==token||capture!==id||!isCurrent()||signal?.aborted)return;
    if(seq!==sequence+1||channels!==metadata?.channels||typeof encoded!=='string'||encoded.length>16384){fail(Error('电视音频采集时序中断'));return;}sequence=seq;if(++outstanding>8){fail(Error("电视回声处理跟不上实时收音，请重新拨号"));return;}
    try{const bytes=Uint8Array.from(atob(encoded),x=>x.charCodeAt(0));if(bytes.length!==960*channels*2)throw Error('Invalid frame');worker.postMessage({type:'capture',sequence:seq,buffer:bytes.buffer},[bytes.buffer]);}catch{fail(Error('电视采集帧格式无效'));}
  }
  function nativeError(page,capture){if(page===token&&capture===id)fail(Error('电视本体收音已中断，请重新拨号'));}
  try{
    if(signal?.aborted||!isCurrent())throw Error('采集已结束');
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);};
      const aborted=()=>{cleanup();reject(Error('采集已结束'));};
      const timer=setTimeout(()=>{cleanup();reject(Error('回声消除启动超时'));},8000);
      signal?.addEventListener('abort',aborted,{once:true});
      worker.onmessage=({data})=>{if(data.type==='ready'){cleanup();resolve();}else if(data.type==='error'){cleanup();reject(Error(data.message));}};
      worker.onerror=()=>{cleanup();reject(Error('回声消除加载失败'));};
      if(signal?.aborted)aborted();
    });
    if(signal?.aborted||!isCurrent())throw Error('采集已结束');
    const worklet=`${PcmPlaybackQueue.toString()}\nclass ArrayInput extends AudioWorkletProcessor {constructor(){super();this.q=new PcmPlaybackQueue(sampleRate,20,24000);this.port.onmessage=({data})=>{try{this.q.push(new Int16Array(data));}catch{this.port.postMessage('overflow');}};}process(i,o){if(o[0]?.[0])this.q.render(o[0][0],currentTime);return true;}}registerProcessor('v-tv-array-input',ArrayInput);`;
    const url=URL.createObjectURL(new Blob([worklet],{type:'text/javascript'}));try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    if(signal?.aborted||!isCurrent())throw Error('采集已结束');
    destination=context.createMediaStreamDestination();node=new AudioWorkletNode(context,'v-tv-array-input',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});node.connect(destination);node.port.onmessage=()=>fail(Error('电视音频处理积压，请重新拨号'));
    globalThis.__vTvAudioFrame=frame;globalThis.__vTvAudioError=nativeError;
    worker.postMessage({type:'configure',channels:4});
    worker.onmessage=({data})=>{if(closed||!isCurrent())return;if(data.type==='error'){fail(Error(data.message));return;}if(data.type==='pcm'){outstanding--;node.port.postMessage(data.buffer,[data.buffer]);}};
    let diagnostics={kind:'tv-array-microphone',source:'pending',channels:null,sampleRate:48000,echoCancellation:'webrtc-aec3-render-reference',acousticEchoTestPassed:false};
    worker.onerror=()=>fail(Error('电视回声处理已中断'));
    signal?.addEventListener('abort',dispose,{once:true});
    if(signal?.aborted||!isCurrent())throw Error('采集已结束');
    return {stream:destination.stream,track:destination.stream.getAudioTracks()[0],diagnostics,snapshot:()=>diagnostics,dispose,
      startCapture(){
        if(closed||signal?.aborted||!isCurrent())throw Error('采集已结束');
        if(metadata)return;
        metadata=JSON.parse(globalThis.VTVArray.start(token,id));if(metadata.error)throw Error(metadata.error);if(metadata.version!==1||metadata.sampleRate!==48000||![4,6].includes(metadata.channels))throw Error('电视阵列不支持当前格式');
        if(metadata.channels!==4)worker.postMessage({type:'configure',channels:metadata.channels});
        diagnostics={...diagnostics,source:metadata.source,channels:metadata.channels};onDiagnostics(diagnostics);
      },
      renderReference(buffer,sampleRate){if(!closed&&isCurrent())worker.postMessage({type:'render',buffer,sampleRate},[buffer]);}};
  }catch(error){dispose();throw error;}
}
