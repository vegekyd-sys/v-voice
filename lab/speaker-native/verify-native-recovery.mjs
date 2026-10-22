import {readFile,writeFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
import {SeeduplexRealtimeVoiceBridge} from '../seeduplex-realtime-provider.mjs';
const env=JSON.parse(await readFile(process.env.VOICE_NATIVE_CREDENTIAL_FILE,'utf8')),audio=[],events=[];let failure,done,first;
const start=performance.now(),bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:env.VOLCENGINE_REALTIME_API_KEY,voice:'xiaohe'},instructions:'只播报主机提供的澄清提示，不调用工具。',tools:[],onAudio:b=>{first??=performance.now();audio.push(b);},onTranscript:(role,text,final)=>events.push({role,text,final}),onResponseDone:e=>{done=e;},onError:e=>{failure=e.message;},onClose(){}},{createWebSocket:async(url,o)=>new WebSocket(url,o)});
let requested;
try{await bridge.connect();requested=performance.now();bridge.speakProgress('刚才你们的声音重叠了，请轮流说，我在听。',{caption:true});const end=Date.now()+15000;while(!done&&!failure&&Date.now()<end)await new Promise(r=>setTimeout(r,50));if(!done||!audio.length)throw Error(failure??'No clarification audio');}catch(e){failure=e.message;}finally{bridge.close();}
const result={syntheticOnly:true,passed:!failure,failure,firstAudioMs:first&&requested?Math.round(first-requested):null,audioBytes:audio.reduce((n,b)=>n+b.length,0),events,durationMs:Math.round(performance.now()-start)};
await writeFile(new URL('../../artifacts/speaker-native/recovery-native.json',import.meta.url),JSON.stringify(result,null,2),{mode:0o600});if(audio.length)await writeFile(new URL('../../artifacts/speaker-native/recovery-native.pcm',import.meta.url),Buffer.concat(audio),{mode:0o600});console.log(JSON.stringify(result));if(failure)process.exitCode=1;
