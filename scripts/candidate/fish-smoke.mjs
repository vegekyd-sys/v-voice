// Explicit paid smoke test. Synthetic text only, no microphone or private V
// context; never invokes Gateway or external-action tools. All output is local.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {WebSocket} from 'ws';
import {FishAsrStream,FISH_STT_URL,FISH_STT_MODEL} from '../../lab/realtime-direct-tools/fish-asr.mjs';
import {FishVoiceBridge,fishBudgetFromFile} from '../../lab/realtime-direct-tools/fish-provider.mjs';

const output=resolve(process.env.FISH_TEST_OUTPUT??'artifacts/fish-stt-private');
await mkdir(output,{recursive:true,mode:0o700});
const budget=fishBudgetFromFile(join(output,'budget.json'));
const report={at:new Date().toISOString(),input:'synthetic-public-test-text',fishModel:FISH_STT_MODEL,fish:[],dialog:[],microphoneUsed:false,gatewayInvoked:false,billedSpendVerified:false};
const createWebSocket=async(url,options)=>new WebSocket(url,options);
if(!process.env.FISH_API_KEY){
  report.fishStatus='blocked-missing-credential';
  report.unauthenticatedHandshake=await new Promise(resolve=>{
    const ws=new WebSocket(FISH_STT_URL,{handshakeTimeout:10000,headers:{model:FISH_STT_MODEL}});
    ws.on('unexpected-response',(_,r)=>{r.resume();resolve({status:r.statusCode,audioSent:false});ws.terminate();});
    ws.on('error',()=>resolve({status:'network-error',audioSent:false}));
    ws.on('open',()=>{resolve({status:101,audioSent:false});ws.close();});
  });
}else if(process.env.FISH_TEST_PCM){
  const {readFile}=await import('node:fs/promises');
  const pcm=await readFile(process.env.FISH_TEST_PCM),rate=16000;
  if(pcm.length>rate*2*60)throw Error('测试输入最多一分钟');
  budget.reserve(0.0196);
  const start=performance.now();let firstDraft,finalMs;
  const events=[];let finish;
  const done=new Promise(r=>{finish=r;});
  const asr=new FishAsrStream({apiKey:process.env.FISH_API_KEY,sampleRate:rate,createWebSocket,maxSessionMs:180000,onEvent:e=>{
    const atMs=Math.round(performance.now()-start);events.push({...e,atMs});
    if(e.type==='draft')firstDraft??=atMs;if(e.type==='committed')finalMs=atMs;
    if(e.type==='session_done')finish();
  },onError:e=>{report.fishError=e.message;finish();}});
  try{
    await asr.connect();const began=performance.now();
    for(let pos=0;pos<pcm.length;pos+=3200){asr.append(pcm.subarray(pos,pos+3200));await new Promise(r=>setTimeout(r,Math.max(0,(pos+3200)/32-(performance.now()-began))));}
    for(let i=0;i<30&&!asr.closed;i++){asr.append(Buffer.alloc(3200));await new Promise(r=>setTimeout(r,100));}
  }catch(e){report.fishError=e.message;}
  // audio_done commits any open turn; it cannot prove natural endpointing.
  asr.finish();let timeout;await Promise.race([done,new Promise(r=>{timeout=setTimeout(r,15000);})]);clearTimeout(timeout);asr.close();
  if(!events.some(e=>e.type==='session_done'))report.fishError??='Fish session_done 未收到';
  if(!events.some(e=>e.type==='committed'))report.fishError??='Fish 未返回最终转写';
  report.fishStatus=report.fishError?'failed':'api-tested';report.fish={events,firstDraftMs:firstDraft,finalMs,forcedFinalization:true};
}else report.fishStatus='credential-present-needs-synthetic-pcm';

if(process.env.DEEPSEEK_API_KEY&&(process.env.VOLCENGINE_TTS_API_KEY||process.env.DOUBAO_SPEECH_API_KEY)){
  const chunks=[],captions=[],usage=[];let complete,reject;
  const done=new Promise((r,j)=>{complete=r;reject=j;});
  const started=performance.now();let firstAudioMs;
  // Only this output leg is exercised without Fish. The report explicitly
  // distinguishes this from an end-to-end ASR call.
  const bridge=new FishVoiceBridge({inputSampleRate:24000,instructions:'你是中文语音测试助手。只给一句短回复，不调用工具，不涉及个人资料。',tools:[],
    onTranscript:(role,text,final)=>{if(final)captions.push({role,text});},
    onAudio:bytes=>{firstAudioMs??=Math.round(performance.now()-started);chunks.push(bytes);},
    onDiagnostic:e=>usage.push(e),onResponseDone:complete,onError:reject},
    {createWebSocket,apiKey:'output-leg-only-no-fish-call',dialogApiKey:process.env.DEEPSEEK_API_KEY,ttsApiKey:process.env.VOLCENGINE_TTS_API_KEY??process.env.DOUBAO_SPEECH_API_KEY,budget,
      asrFactory:()=>({agentSpeaking(){},context(){},close(){}})});
  try{
    bridge.sendUserMessage('请用一句中文说明：这段合成语音仅验证对话和语音输出，Fish实时识别尚需单独验收。');
    let timeout;try{await Promise.race([done,new Promise((_,j)=>{timeout=setTimeout(()=>j(Error('output leg timeout')),60000);})]);}finally{clearTimeout(timeout);}
    const pcm=Buffer.concat(chunks),header=Buffer.alloc(44);
    header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
    await writeFile(join(output,'output-leg.wav'),Buffer.concat([header,pcm]),{mode:0o600});
    report.dialog={status:'real-api-output-leg-only',model:'deepseek-flash',tts:'volc/seed-tts-2.0/xiaohe',firstPcmMs:firstAudioMs,durationMs:Math.round(pcm.length/48),bytes:pcm.length,captions,usage};
  }catch(e){report.dialog={status:'failed',error:e.message};}finally{bridge.close();}
}else report.dialog={status:'missing-existing-provider-credentials'};
report.budgetConservativeReservedUsd=budget.reservedUsd;
await writeFile(join(output,'smoke.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({fish:report.fishStatus,unauthenticatedHandshake:report.unauthenticatedHandshake,dialog:report.dialog.status,firstPcmMs:report.dialog.firstPcmMs,budgetConservativeReservedUsd:budget.reservedUsd,report:join(output,'smoke.json'),...(report.dialog.status==='real-api-output-leg-only'?{audio:join(output,'output-leg.wav')}:{})}));
