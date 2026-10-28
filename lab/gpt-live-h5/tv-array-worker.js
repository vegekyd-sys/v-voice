// PCM remains local memory. This worker has no transcript, model or network API.
importScripts('./assets/tv-aec/webrtcaec3-0.3.0.js');
let module,Processor,dsp,channels=0,closed=false,lastSequence=0,renderMs=0;
Promise.all([WebRtcAec3(),import('./tv-array-dsp.mjs')]).then(([m,p])=>{module=m;Processor=p.TvArrayEchoProcessor;postMessage({type:'ready'});}).catch(()=>postMessage({type:'error',message:'回声消除初始化失败'}));
self.onmessage=({data})=>{
 if(closed)return;
 try{
  if(data.type==='close'){closed=true;dsp?.close();self.close();return;}
  if(data.type==='configure'){if(!module||![4,6].includes(data.channels))throw Error('电视阵列格式无效');dsp?.close();channels=data.channels;const sampleRate=data.sampleRate??48000;if(![16000,48000].includes(sampleRate))throw Error('Invalid capture rate');const frameSize=sampleRate/50;dsp=new Processor(module,channels,sampleRate);
  // Exercise the actual WASM paths before opening the hardware route. The
  // temporary instance is discarded; synthetic warmup never enters the stream.
  const warmup=[];let seed=31;
  for(let f=0;f<64;f++){
   const render=new Float32Array(960),capture=new Int16Array(frameSize*channels);
   for(let i=0;i<960;i++){seed=(seed*1664525+1013904223)>>>0;render[i]=(seed/4294967296-.5)*.1;}
   for(let i=0;i<frameSize;i++)for(let c=0;c<channels;c++)capture[i*channels+c]=Math.round(render[Math.floor(i*48000/sampleRate)]*12000);
   const t=performance.now();dsp.render(render,48000);dsp.capture(capture);warmup.push(Math.round(performance.now()-t));
  }
  dsp.close();dsp=new Processor(module,channels,sampleRate);dsp.render(new Float32Array(960),48000);dsp.capture(new Int16Array(frameSize*channels));lastSequence=0;postMessage({type:'configured',channels,sampleRate,warmup});return;}
  if(!dsp)return;
  if(data.type==='render'){
   if(!(data.buffer instanceof ArrayBuffer)||data.buffer.byteLength>16384||![24000,44100,48000].includes(data.sampleRate))throw Error('回声参考格式无效');
   const t=performance.now();dsp.render(new Float32Array(data.buffer),data.sampleRate);renderMs+=performance.now()-t;return;
  }
  if(data.type!=='capture')return;
  if(!Number.isSafeInteger(data.sequence)||data.sequence!==lastSequence+1)throw Error('电视采集时序中断');lastSequence=data.sequence;
  const before=performance.now(),output=dsp.capture(new Int16Array(data.buffer));postMessage({type:'pcm',sequence:data.sequence,renderMs,processMs:performance.now()-before,...output},[output.buffer]);
 }catch(error){postMessage({type:'error',message:error.message});}
};
