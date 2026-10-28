// Loaded only by the opt-in loopback recovery fixture, never a release asset.
// Synthetic 4-channel PCM with a startup burst; no system microphone or model.
const scenario=await fetch('/__fixture/scenario').then(r=>r.json());
let timer,queue=[],seq=0,current;
const frame=()=>{
 const pcm=new Int16Array(1280);for(let i=0;i<320;i++)for(let c=1;c<4;c++)pcm[i*4+c]=Math.sin((seq*320+i)*2*Math.PI*240/16000)*1800;
 let raw='';for(const v of new Uint8Array(pcm.buffer))raw+=String.fromCharCode(v);
 queue.push({sequence:++seq,channels:4,pcm:btoa(raw)});
};
Object.defineProperty(window,'vTvAudioCapability',{value:{version:1,pageToken:'loopback-synthetic-only'},configurable:false});
window.VTVArray={
 start(token,id){current=id;seq=0;queue=[];return JSON.stringify({version:3,sampleRate:16000,channels:4,source:'synthetic-burst'});},
 begin(token,id){if(id!==current)return 'INVALID_OWNER';for(let n=0;n<12;n++)frame();timer=setInterval(frame,20);return 'ok';},
 pull(token,id){if(id!==current)return JSON.stringify({error:'TV_MIC_OWNER'});if(scenario.mode==='mic-route')return JSON.stringify({error:'TV_MIC_ROUTE'});return JSON.stringify({frames:queue.splice(0,4)});},
 stop(token,id){if(id===current){clearInterval(timer);queue=[];current=null;}}
};
