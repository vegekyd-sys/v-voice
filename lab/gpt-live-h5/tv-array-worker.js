// PCM remains local memory. This worker has no transcript, model or network API.
importScripts('./assets/tv-aec/webrtcaec3-0.3.0.js');
let module,Processor,dsp,channels=0,closed=false,lastSequence=0;
Promise.all([WebRtcAec3(),import('./tv-array-dsp.mjs')]).then(([m,p])=>{module=m;Processor=p.TvArrayEchoProcessor;postMessage({type:'ready'});}).catch(()=>postMessage({type:'error',message:'回声消除初始化失败'}));
self.onmessage=({data})=>{
 if(closed)return;
 try{
  if(data.type==='close'){closed=true;dsp?.close();self.close();return;}
  if(data.type==='configure'){if(!module||![4,6].includes(data.channels))throw Error('电视阵列格式无效');dsp?.close();channels=data.channels;dsp=new Processor(module,channels);dsp.render(new Float32Array(960),48000);dsp.capture(new Int16Array(960*channels));lastSequence=0;postMessage({type:'configured',channels});return;}
  if(!dsp)return;
  if(data.type==='render'){
   if(!(data.buffer instanceof ArrayBuffer)||data.buffer.byteLength>16384||![24000,44100,48000].includes(data.sampleRate))throw Error('回声参考格式无效');
   dsp.render(new Float32Array(data.buffer),data.sampleRate);return;
  }
  if(data.type!=='capture')return;
  if(!Number.isSafeInteger(data.sequence)||data.sequence!==lastSequence+1)throw Error('电视采集时序中断');lastSequence=data.sequence;
  const output=dsp.capture(new Int16Array(data.buffer));postMessage({type:'pcm',...output},[output.buffer]);
 }catch(error){postMessage({type:'error',message:error.message});}
};
