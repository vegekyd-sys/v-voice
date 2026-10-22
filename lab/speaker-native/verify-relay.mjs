import {readFile,writeFile} from 'node:fs/promises';import {WebSocket} from 'ws';import {setTimeout as delay} from 'node:timers/promises';import {pcm16to24} from './service.mjs';
import {dialogueAcceptance} from './dialogue-acceptance.mjs';
const policy=process.argv[2]??'speaker',scenario=process.argv[3]??'question',label=process.argv[4]??'probe';
if(!['native','speaker','text'].includes(policy)||!['question','dialogue','side','collective','steady','overlap'].includes(scenario)||!/^[-a-zA-Z0-9]+$/.test(label))throw Error('Invalid verification arguments');
const origin=(process.env.VOICE_VERIFY_ORIGIN??'http://127.0.0.1:26320').replace(/\/$/,''),requestOrigin=new URL(origin).origin,root=new URL('../../artifacts/speaker-native/',import.meta.url),manifest=JSON.parse(await readFile(new URL('fixtures.json',root))),spec=manifest.scenarios[scenario];
const events=[],audio=[],routingErrors=[];let ws,reservation,cookie,finished=false,failure,heartbeat;const zero=performance.now(),at=()=>Math.round(performance.now()-zero);let startAt,firstAudio,firstNativeAudio,lastAudio=0;
const post=async(route,body)=>{const r=await fetch(origin+'/api/'+route,{method:'POST',headers:{cookie,origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error??'HTTP '+r.status);return d;};
const wait=async(predicate,timeout=30000)=>{const end=performance.now()+timeout;while(performance.now()<end){if(failure)throw Error(failure);if(predicate())return;await delay(50);}throw Error('Verification deadline exceeded');};
try{
 if(policy==='text')ws=new WebSocket('ws://127.0.0.1:26319/stream',{origin:'http://127.0.0.1:26319'});
 else{
  const page=await fetch(origin+'/');await page.text();cookie=page.headers.get('set-cookie')?.split(';')[0]??'';
  const cookieFile=process.env.VOICE_VERIFY_COOKIE_FILE;
  if(cookieFile)cookie=(await readFile(cookieFile,'utf8').catch(()=>''))?.trim()||cookie;
  if(process.env.VOICE_VERIFY_ACCESS_FILE&&!cookie){const access=(await readFile(process.env.VOICE_VERIFY_ACCESS_FILE,'utf8')).trim();const login=await fetch(origin+'/api/access',{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify({access})});if(!login.ok)throw Error('Candidate admission failed: '+login.status);cookie=login.headers.get('set-cookie')?.split(';')[0]??'';if(cookieFile)await writeFile(cookieFile,cookie,{mode:0o600});}
  let status=await(await fetch(origin+'/api/status',{headers:{cookie}})).json();const readyDeadline=performance.now()+15000;
  while(!status.ready&&performance.now()<readyDeadline){await delay(100);status=await(await fetch(origin+'/api/status',{headers:{cookie}})).json();}
  if(status.activeCall||!status.ready)throw Error('Candidate busy or unavailable');
  reservation=await post('session',{model:'seeduplex',inputPolicy:policy});heartbeat=setInterval(()=>{void post('heartbeat',{voiceSessionId:reservation.voiceSessionId}).catch(e=>{failure??=e.message;});},15000);
  ws=new WebSocket(origin.replace(/^http/,'ws')+'/api/relay?'+new URLSearchParams({voiceSessionId:reservation.voiceSessionId,ticket:reservation.relayTicket}),{headers:{cookie,origin:requestOrigin}});
 }
 ws.on('message',raw=>{
  const e=JSON.parse(raw);if(['audio','speech-chunk'].includes(e.type)){
   const b=Buffer.from(e.audio,'base64');audio.push(b);lastAudio=at();if(firstAudio===undefined)firstAudio=at();if(firstNativeAudio===undefined&&!e.callId)firstNativeAudio=at();events.push({type:e.type,source:e.source,callId:e.callId,responseId:e.responseId,at:at(),bytes:b.length});return;
  }
  events.push({...e,at:at()});if(['error','identity-revision'].includes(e.type))failure=e.message;if(e.type==='speaker.error')routingErrors.push(e.message);
 });ws.on('error',e=>{failure=e.message;});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 if(policy==='text')ws.send(JSON.stringify({type:'start',mode:'auto'}));
 await wait(()=>events.some(e=>e.type==='ready'));
 const input16=await readFile(new URL(scenario+'-sequence.pcm',root)),pcm=policy==='text'?input16:pcm16to24(input16),frame=policy==='text'?640:960;
 startAt=at();events.push({type:'fixture.start',at:startAt});
 const playback=(async()=>{const t=performance.now();for(let offset=0;offset<pcm.length;offset+=frame){if(failure)throw Error(failure);if(ws.readyState!==1)throw Error('Audio transport closed');ws.send(pcm.subarray(offset,offset+frame));const ms=t+(offset/frame+1)*20-performance.now();if(ms>0)await delay(ms);}finished=true;events.push({type:'fixture.end',at:at()});})();
 await playback;
 // Continue silence so full-duplex native ASR/VAD can finish naturally.
 const silence=setInterval(()=>{if(ws.readyState===1)ws.send(Buffer.alloc(frame));},20);
 try{await wait(()=>events.some(e=>['audio.done','speech-end'].includes(e.type))&&(policy==='text'||events.some(e=>e.type==='transcript'&&e.role==='assistant'&&e.final&&!['tool-start','greeting'].includes(e.source)))&&at()-lastAudio>1500,35000);}finally{clearInterval(silence);}
 if(!audio.length&&scenario==='question')failure='No real model audio returned';
 if(events.some(e=>e.type==='tool.error')||events.some(e=>e.type==='transcript'&&e.role==='assistant'&&/harness.*unavailable|暂时不可用|工具.*失败/i.test(e.text??'')))failure??='Native product backend failed';
}catch(error){failure??=error.message;}
finally{
 clearInterval(heartbeat);
 if(ws?.readyState===1&&policy==='text')ws.send(JSON.stringify({type:'stop'}));ws?.close();if(reservation)try{await post('close',{voiceSessionId:reservation.voiceSessionId});}catch(e){failure??=e.message;}
 const speechEnd=startAt===undefined?null:startAt+spec.turns[0].endMs;
 const turnResponseTimes=startAt===undefined?[]:spec.turns.map((turn,i)=>{const end=startAt+turn.endMs,next=startAt+(spec.turns[i+1]?.startMs??Infinity),packet=events.find(e=>e.type==='audio'&&!e.callId&&e.at>=end&&e.at<next);return {id:turn.id,endMs:turn.endMs,firstNativeAudioAfterEndMs:packet?packet.at-end:null};});
 if(['steady','overlap'].includes(scenario)&&turnResponseTimes.some(t=>t.id==='ask-v2'&&t.firstNativeAudioAfterEndMs===null))failure??='A required question had no native audio before the next speaker turn';
 const qualityChecks=policy==='speaker'&&scenario==='dialogue'?{...dialogueAcceptance(events),storyNativeAudio:Number.isFinite(turnResponseTimes.find(t=>t.id==='child-question')?.firstNativeAudioAfterEndMs)}:undefined;
 if(qualityChecks&&Object.values(qualityChecks).some(v=>!v))failure??='Synthetic dialogue acceptance failed: '+Object.entries(qualityChecks).filter(([,v])=>!v).map(([k])=>k).join(', ');
 const result={policy,scenario,label,origin,syntheticOnly:true,passed:!failure&&!routingErrors.length,failure,routingErrors,inputCompleted:finished,turnResponseTimes,qualityChecks,firstAudioAfterEndMs:firstAudio===undefined||speechEnd===null?null:Math.round(firstAudio-speechEnd),firstNativeAudioAfterEndMs:firstNativeAudio===undefined||speechEnd===null?null:Math.round(firstNativeAudio-speechEnd),events,transcripts:events.filter(e=>e.type==='transcript'&&e.final),durationMs:at(),audioBytes:audio.reduce((n,b)=>n+b.length,0)};
 await writeFile(new URL(`${policy}-${scenario}-${label}.json`,root),JSON.stringify(result,null,2),{mode:0o600});if(audio.length)await writeFile(new URL(`${policy}-${scenario}-${label}.`+(policy==='text'?'mp3':'pcm'),root),Buffer.concat(audio),{mode:0o600});
 console.log(JSON.stringify({...result,events:undefined}));if(failure||routingErrors.length)process.exitCode=1;
}
