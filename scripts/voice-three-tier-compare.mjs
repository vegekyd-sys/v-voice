#!/usr/bin/env node
// Same continuous PCM and fixed timing, real provider + deployed Speaker code.
// Only the browser socket/playback clock and Gateway are simulated. No tools
// or personal context leave this experiment, and no phone service is started.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const root=resolve(process.env.VOICE_EVAL_ROOT??new URL('..',import.meta.url).pathname),baseline=process.env.VOICE_BASELINE_ROOT;
if(!process.argv[2]||!baseline)throw Error('Study directory and VOICE_BASELINE_ROOT are required');
const directory=resolve(process.argv[2]),bytes=await readFile(join(directory,'study.json')),study=JSON.parse(bytes);
if(study.synthetic!==true||study.sampleRate!==16000)throw Error('Synthetic 16 kHz study required');
const digest=x=>createHash('sha256').update(x).digest('hex');
const output=join(directory,'comparison');await mkdir(output,{recursive:true,mode:0o700});
const nativeModule=await import(pathToFileURL(join(root,'lab/realtime-direct-tools/session.mjs'))),speakerModule=await import(pathToFileURL(join(baseline,'lab/realtime-direct-tools/session.mjs')));
const production=await import(pathToFileURL(join(baseline,'lab/speaker-native/production.mjs')));
const ws=(await import(pathToFileURL(join(root,'node_modules/ws/wrapper.mjs'))));
const key=process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY;
if(!key)throw Error('Native API credential missing');
const provenance={studySha256:digest(bytes),runnerSha256:digest(await readFile(new URL(import.meta.url))),nativeRoot:root,speakerRoot:baseline,speakerModuleSha256:digest(await readFile(join(baseline,'lab/speaker-native/stream-service.mjs'))),nativeBridgeSha256:digest(await readFile(join(root,'lab/seeduplex-realtime-provider.mjs'))),speakerDecisionModel:process.env.VOICE_OPENAI_DECISIONS_MODEL??'openai/gpt-6-luna-decisions',lookahead:process.env.VOICE_STREAM_LOOKAHEAD==='1',physicalPlayback:false,gateway:'denying-stub',nativeInterruptionAsr:false};
class Server{handleUpgrade(_req,socket,_head,done){done(socket);}close(){}}
async function engine(path,scenario){
 const result={path,events:[],protocol:[],audit:[],errors:[],unexpectedGatewayRequests:[],inputBytes:0,audioBytes:0,outputChunks:0,upstreamConnections:0},audio=[],inputHash=createHash('sha256');
 let service,productionSpeaker,started=performance.now(),queueUntil=0,busy=false;
 const now=()=>performance.now()-started,sendState=()=>{const next=queueUntil>performance.now();if(next!==busy){busy=next;client.emit('message',Buffer.from(JSON.stringify({type:'playback.state',speaking:busy})),false);}};
 class Client extends EventEmitter{
  readyState=1;
  send(raw){const e=JSON.parse(raw);if(e.type==='audio'){
    const pcm=Buffer.from(e.audio,'base64');audio.push(pcm);result.audioBytes+=pcm.length;result.outputChunks++;queueUntil=Math.max(performance.now(),queueUntil)+pcm.length/48;
    result.events.push({at:now(),type:'audio',responseId:e.responseId,source:e.source,bytes:pcm.length,sampleRate:e.sampleRate});sendState();
   }else{result.events.push({...e,at:now()});if(e.type==='audio.clear'){queueUntil=0;sendState();}if(e.type==='error')result.errors.push(e.message??'Client error');
    if(e.type==='transcript'&&e.role==='assistant'&&e.final)console.log(JSON.stringify({case:scenario.id,path,stage:'reply',at:Math.round(now()),text:e.text}));
   }}
  close(){if(this.readyState!==1)return;this.readyState=3;this.emit('close');}
 }
 const client=new Client();
 class ObservedWebSocket extends ws.WebSocket{
  constructor(...args){super(...args);const connection=++result.upstreamConnections;this.on('message',(raw,binary)=>{if(binary)return;try{const e=JSON.parse(raw);if(e.type==='response.output_audio.delta')return;
    result.protocol.push({at:now(),connection,type:e.type,questionId:e.question_id,responseId:e.response_id??e.response?.id,text:e.text??e.transcript,itemId:e.item_id??e.item?.id,ids:Object.fromEntries(Object.entries(e).filter(([k,v])=>/id$/i.test(k)&&typeof v==='string')),...e.type==='error'?{code:e.error?.code??e.code}:{}});
   }catch{}});}
 }
 const audit=e=>result.audit.push({...e,at:now()});
 const gateway={request:async(method)=>{if(method==='tools.catalog')return {groups:[]};result.unexpectedGatewayRequests.push(method);throw Error('External Gateway requests disabled for synthetic comparison');}};
 try{
  if(path==='speaker'){
   const env={...process.env,VOICE_SPEAKER_DIAGNOSTICS_DIR:join(directory,'speaker-diagnostics',scenario.id)};
   productionSpeaker=await production.createProductionSpeaker({env,audit});if(!productionSpeaker)throw Error('Deployed Speaker configuration unavailable');
  }
  service=(path==='speaker'?speakerModule:nativeModule).createDirectVoiceService({gateway,wsModule:{WebSocket:ObservedWebSocket,WebSocketServer:Server},apiKeys:{seeduplex:key},speakerRouting:productionSpeaker?.service,audit,loadContext:async()=>study.instructions});
  const reservation=await service.reserve({model:'seeduplex',sessionKey:'synthetic-three-tier-comparison',inputSampleRate:16000,inputPolicy:path==='native'?'native':'speaker'});
  service.upgrade({},client,Buffer.alloc(0),reservation.voiceSessionId,reservation.relayTicket);
  const deadline=Date.now()+45000;while(!result.events.some(e=>e.type==='ready')&&!result.errors.length&&Date.now()<deadline)await delay(25);
  if(!result.events.some(e=>e.type==='ready'))throw Error('Engine application readiness failed');
  return {result,audio,resetClock(){started=performance.now();result.events=[];result.audit=[];queueUntil=0;busy=false;},
   marker(type,turn){result.events.push({type:'fixture.input.'+type,turnId:turn.id,at:now()});},
   frame(pcm){result.offeredInputBytes=(result.offeredInputBytes??0)+pcm.length;if(client.readyState===1){inputHash.update(pcm);result.inputBytes+=pcm.length;client.emit('message',pcm,true);}else result.droppedInputBytes=(result.droppedInputBytes??0)+pcm.length;},tick:sendState,
   async close(){result.inputSha256=inputHash.digest('hex');await service.close(reservation.voiceSessionId);await service.dispose();productionSpeaker?.close();},
  };
 }catch(error){await service?.dispose().catch(()=>{});productionSpeaker?.close();throw error;}
}
const only=process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:null;
for(const scenario of study.cases.filter(c=>!only||c.id===only)){
 const target=join(output,scenario.id+'.json');if(existsSync(target)){const previous=JSON.parse(await readFile(target,'utf8'));if(previous.provenance.studySha256!==provenance.studySha256)throw Error('Existing comparison belongs to a different corpus');if(previous.complete){console.log(JSON.stringify({case:scenario.id,stage:'cached'}));continue;}}
 const pcm=await readFile(join(directory,scenario.file));if(digest(pcm)!==scenario.sha256)throw Error('Corpus hash mismatch');
 console.log(JSON.stringify({case:scenario.id,stage:'connecting',seconds:scenario.durationMs/1000}));
 let engines=[];const result={schema:'voice-three-tier-paired-v1',case:scenario.id,provenance,scenario,complete:false};
 try{
  // Initialize sequentially: readiness cannot race another engine's frames.
  engines.push(await engine('native',scenario));engines.push(await engine('speaker',scenario));for(const e of engines)e.resetClock();
  let offset=0,maxGapMs=0,last=performance.now(),announced=new Set(),ended=new Set();const began=performance.now();
  await new Promise(resolve=>{const timer=setInterval(()=>{
   const at=performance.now();maxGapMs=Math.max(maxGapMs,at-last);last=at;
   const audioMs=offset/32;
   for(const t of scenario.turns){
    if(audioMs>=t.startMs&&!announced.has(t.id)){announced.add(t.id);for(const e of engines)e.marker('start',t);console.log(JSON.stringify({case:scenario.id,stage:'input',id:t.id,kind:t.kind,person:t.person,at:Math.round(audioMs)}));}
    if(audioMs>=t.endMs&&!ended.has(t.id)){ended.add(t.id);for(const e of engines)e.marker('end',t);}
   }
   const frame=pcm.subarray(offset,offset+640);for(const e of engines){e.frame(frame);e.tick();}
   offset+=frame.length;if(offset>=pcm.length){clearInterval(timer);resolve();}
  },20);});
  result.feed={durationMs:performance.now()-began,maxFrameGapMs:maxGapMs,bytes:pcm.length};result.complete=true;
 }catch(error){result.error=error.message;}
 finally{
  for(const e of engines)await e.close().catch(error=>e.result.errors.push(error.message));
  result.engines=Object.fromEntries(engines.map(e=>[e.result.path,e.result]));
  if(engines.length===2)result.identicalInputs=engines.every(e=>e.result.inputSha256===scenario.sha256);
  await writeFile(target,JSON.stringify(result,null,2),{mode:0o600});
  for(const e of engines)await writeFile(join(output,scenario.id+'-'+e.result.path+'-output.pcm'),Buffer.concat(e.audio),{mode:0o600});
 }
 console.log(JSON.stringify({case:scenario.id,stage:'complete',complete:result.complete,identicalInputs:result.identicalInputs,error:result.error,engines:Object.fromEntries(engines.map(e=>[e.result.path,{audioBytes:e.result.audioBytes,errors:e.result.errors}]))}));
 if(!result.complete)process.exitCode=1;
}
