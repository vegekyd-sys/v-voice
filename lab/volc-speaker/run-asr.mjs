import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { VolcAsrStream } from './volc-asr.mjs';
import { loadCredentials } from './credentials.mjs';
import { normalizedTurns } from './utterances.mjs';

export async function recognizePcm(pcm,{apiKey,voiceprints,identifyOnly=false,realtime=true,timeoutMs=30000,onEvent=()=>{}}={}) {
  const started=performance.now(),events=[];let settle,fail;
  const done=new Promise((resolve,reject)=>{settle=resolve;fail=reject;});
  // A rejection while sending must be observed immediately.
  done.catch(()=>{});
  const timer=setTimeout(()=>fail(Error('ASR result deadline exceeded')),timeoutMs+pcm.length/32);
  const stream=new VolcAsrStream({apiKey,voiceprints,identifyOnly,
    onResult:event=>{const entry={...event,atMs:Math.round(performance.now()-started)};events.push(entry);onEvent(entry);if(event.final)settle();},
    onError:fail,onClose:()=>{if(!events.some(e=>e.final))fail(Error('ASR closed before final result'));}});
  try{
    await stream.connect();
    const chunk=6400;
    for(let offset=0;offset<pcm.length;offset+=chunk){
      stream.append(pcm.subarray(offset,offset+chunk));
      if(realtime)await new Promise(r=>setTimeout(r,chunk/32));
    }
    stream.finish();await done;
    return {requestId:stream.requestId,logId:stream.logId,durationMs:pcm.length/32,elapsedMs:Math.round(performance.now()-started),events};
  }finally{clearTimeout(timer);stream.close();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
  const env=await loadCredentials(),input=process.argv[2],output=process.argv[3];
  const result=await recognizePcm(await readFile(input),{apiKey:env.VOLCENGINE_ASR_API_KEY,
    onEvent:e=>{if(e.final)console.log(JSON.stringify({atMs:e.atMs,final:true,speakers:[...new Set((e.body.result?.utterances??[]).map(u=>u.additions?.speaker_id))]}));}});
  await writeFile(output,JSON.stringify(result,null,2),{mode:0o600});
  await writeFile(output.replace(/\.json$/,'')+'-turns.json',JSON.stringify(normalizedTurns(result),null,2),{mode:0o600});
  console.log(JSON.stringify({requestId:result.requestId,durationMs:result.durationMs,elapsedMs:result.elapsedMs}));
}
