#!/usr/bin/env node
// One-off: speak short listening sounds through a separate native Xiaohe connection and
// store trimmed, slightly quieter PCM with provenance. Each line is one short billed
// Seeduplex TTS turn; run only on a host that already holds the key in its environment.
//   node scripts/generate-backchannel-clips.mjs --out <dir>
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {SeeduplexRealtimeVoiceBridge,resolveSeeduplexApiKey} from '../lab/seeduplex-realtime-provider.mjs';

const LINES={mm:'嗯。',mmhm:'嗯嗯。',oh:'哦。',really:'这样啊。'};
const args=process.argv.slice(2);
const out=resolve(args.includes('--out')?args[args.indexOf('--out')+1]:join(import.meta.dirname,'../lab/realtime-direct-tools/assets'));
if(!resolveSeeduplexApiKey({}))throw Error('No Seeduplex key in this environment');

async function speak(text){
  const pcm=[];let bridge;
  const done=new Promise((resolveDone,reject)=>{
    const timer=setTimeout(()=>reject(Error(`No speech for: ${text}`)),30000);
    const finish=()=>{if(pcm.length){clearTimeout(timer);resolveDone();}};
    bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{voice:'xiaohe',model:'1.2.6.1'},language:'zh-CN',tools:[],inputSampleRate:24000,
      instructions:'只朗读系统给定的句子。',greetingText:text,onAudio:audio=>pcm.push(Buffer.from(audio)),onAudioSegmentDone:finish,onResponseDone:finish,onError:error=>{clearTimeout(timer);reject(error);}});
  });
  try{await bridge.connect();bridge.triggerGreeting('');await done;}finally{bridge.close();}
  return Buffer.concat(pcm);
}
// Keep only the voiced part: a clip in a short pause cannot afford leading silence.
function shape(pcm,gain=0.7){
  const samples=pcm.length/2,win=240;let first=samples,last=0;
  for(let i=0;i+win<=samples;i+=win){let sum=0;for(let j=0;j<win;j++)sum+=(pcm.readInt16LE((i+j)*2)/32768)**2;if(Math.sqrt(sum/win)>0.01){first=Math.min(first,i);last=i+win;}}
  if(last<=first)throw Error('Clip has no voiced audio');
  const start=Math.max(0,first-120),end=Math.min(samples,last+480),fade=240,result=Buffer.alloc((end-start)*2);
  for(let i=start;i<end;i++){const k=i-start,env=Math.min(1,k/fade,(end-1-i)/fade);result.writeInt16LE(Math.round(pcm.readInt16LE(i*2)*gain*env),k*2);}
  return result;
}
await mkdir(out,{recursive:true});
const clips={};
for(const [key,text] of Object.entries(LINES)){
  const pcm=shape(await speak(text));
  await writeFile(join(out,`backchannel-${key}.pcm`),pcm);
  clips[key]={text,bytes:pcm.length,seconds:pcm.length/2/24000,sha256:createHash('sha256').update(pcm).digest('hex')};
  console.log(key,text,clips[key].seconds.toFixed(3));
}
await writeFile(join(out,'backchannel-provenance.json'),JSON.stringify({provider:'seeduplex',voice:'xiaohe',model:'1.2.6.1',sampleRate:24000,format:'pcm16le',createdAt:new Date().toISOString(),source:'Actual native SayHello TTS, trimmed to the voiced part at 0.7 gain, generated separately from any call',clips},null,2)+'\n');
