import { randomUUID } from 'node:crypto';

export async function synthesizeReply(apiKey,text,{signal,speaker='zh_female_xiaohe_uranus_bigtts'}={}){
  if(!text?.trim()||text.length>500)throw Error('语音回复长度不合法');
  const response=await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional',{
    method:'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json','X-Api-Key':apiKey,'X-Api-Resource-Id':'seed-tts-2.0','X-Api-Request-Id':randomUUID(),'X-Control-Require-Usage-Tokens-Return':'*'},
    body:JSON.stringify({req_params:{text,speaker,audio_params:{format:'mp3',sample_rate:24000}}})});
  if(!response.ok)throw Error(`火山 TTS HTTP ${response.status}`);
  const raw=await response.text(),chunks=[];let complete=false,usage;
  for(const line of raw.split(/\r?\n/).filter(x=>x.trim())){
    let frame;try{frame=JSON.parse(line);}catch{throw Error('火山 TTS 返回格式异常');}
    if(![0,20000000].includes(frame.code))throw Error(`火山 TTS 错误 ${frame.code}`);
    if(frame.data)chunks.push(Buffer.from(frame.data,'base64'));
    if(frame.usage)usage=frame.usage;
    if(frame.code===20000000)complete=true;
  }
  const audio=Buffer.concat(chunks);
  if(!complete||!audio.length)throw Error('火山 TTS 未完整返回音频');
  return {audio,mime:'audio/mpeg',usage};
}
