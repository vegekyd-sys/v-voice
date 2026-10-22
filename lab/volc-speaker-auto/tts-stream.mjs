import {randomUUID} from 'node:crypto';

export async function consumeTts(response,{onChunk=()=>{}}={}){
  if(!response.ok)throw Error(`火山 TTS HTTP ${response.status}`);
  let pending='',complete=false,usage,firstChunkMs=null;const chunks=[],started=performance.now(),decoder=new TextDecoder();
  const line=raw=>{
    if(!raw.trim())return;
    let frame;try{frame=JSON.parse(raw);}catch{throw Error('火山 TTS 返回格式异常');}
    if(![0,20000000].includes(frame.code))throw Error(`火山 TTS 错误 ${frame.code}`);
    if(frame.data){const chunk=Buffer.from(frame.data,'base64');if(chunk.length){firstChunkMs??=Math.round(performance.now()-started);chunks.push(chunk);onChunk(chunk);}}
    if(frame.usage)usage=frame.usage;
    if(frame.code===20000000)complete=true;
  };
  for await(const bytes of response.body){pending+=decoder.decode(bytes,{stream:true});let end;while((end=pending.indexOf('\n'))>=0){line(pending.slice(0,end));pending=pending.slice(end+1);}}
  pending+=decoder.decode();if(pending.trim())line(pending);
  const audio=Buffer.concat(chunks);if(!complete||!audio.length)throw Error('火山 TTS 未完整返回音频');
  return {audio,mime:'audio/mpeg',usage,firstChunkMs,elapsedMs:Math.round(performance.now()-started)};
}
export async function synthesizeReplyStream(apiKey,text,{signal,onChunk,speaker='zh_female_xiaohe_uranus_bigtts'}={}){
  if(!text?.trim()||text.length>500)throw Error('语音回复长度不合法');
  const response=await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional',{
    method:'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json','X-Api-Key':apiKey,'X-Api-Resource-Id':'seed-tts-2.0','X-Api-Request-Id':randomUUID(),'X-Control-Require-Usage-Tokens-Return':'*'},
    body:JSON.stringify({req_params:{text,speaker,audio_params:{format:'mp3',sample_rate:24000}}})});
  return consumeTts(response,{onChunk});
}
