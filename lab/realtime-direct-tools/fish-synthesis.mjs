import {randomUUID} from 'node:crypto';

// Existing Volc HTTP streaming TTS, PCM for the existing relay executor.
export async function streamFishReply(text,{apiKey,signal,onAudio,fetchImpl=fetch,onUsage=()=>{}}) {
  if(!text.trim()||text.length>2000)throw Error('Fish Candidate 语音输出过长');
  const response=await fetchImpl('https://openspeech.bytedance.com/api/v3/tts/unidirectional',{
    method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),
    headers:{'Content-Type':'application/json','X-Api-Key':apiKey,'X-Api-Resource-Id':'seed-tts-2.0','X-Api-Request-Id':randomUUID(),'X-Control-Require-Usage-Tokens-Return':'*'},
    body:JSON.stringify({req_params:{text,speaker:'zh_female_xiaohe_uranus_bigtts',audio_params:{format:'pcm',sample_rate:24000}}})});
  if(!response.ok)throw Error(`火山流式 TTS HTTP ${response.status}`);
  let pending='',complete=false,bytes=0;const decoder=new TextDecoder();
  const frame=line=>{
    if(!line.trim())return;const e=JSON.parse(line);
    if(![0,20000000].includes(e.code))throw Error(`火山流式 TTS 错误 ${Number(e.code)||'unknown'}`);
    if(e.data){const pcm=Buffer.from(e.data,'base64');if(pcm.length%2)throw Error('火山 PCM 对齐异常');if(!signal.aborted){bytes+=pcm.length;onAudio(pcm);}}
    if(e.usage)onUsage(e.usage);if(e.code===20000000)complete=true;
  };
  for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});if(pending.length>2097152)throw Error('火山 TTS 帧过大');let i;while((i=pending.indexOf('\n'))>=0){frame(pending.slice(0,i));pending=pending.slice(i+1);}}
  frame(pending+decoder.decode());
  if(!complete||!bytes)throw Error('火山 TTS 未完整返回 PCM');
  return {bytes};
}
