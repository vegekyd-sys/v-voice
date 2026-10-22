import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {GatewayClient} from '../../lib/gateway-client.mjs';
import {createDirectVoiceService} from '../realtime-direct-tools/session.mjs';
import {createEmbeddingWorker} from './online-speaker.mjs';
import {createStreamingSpeakerRoutingService} from './stream-service.mjs';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {VerificationCall} from './verification-client.mjs';
// Tests two media pipelines on an INTERNAL loopback harness. This does not
// remove product admission's one-active-device-per-person protection.
const receipt=JSON.parse(await readFile(process.env.VOICE_SPEAKER_GATEWAY_RECEIPT,'utf8'));
if(receipt.root!=='/var/lib/v-voice-candidates/speaker-product-20261019'||receipt.gatewayPort!==26369)throw Error('Private candidate required');
const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE);Object.assign(env,JSON.parse(await readFile(process.env.VOICE_NATIVE_CREDENTIAL_FILE,'utf8')));
let ready;const connected=new Promise(r=>ready=r);const audit=[];
const gateway=new GatewayClient({url:'ws://127.0.0.1:26369',token:receipt.gatewayToken,onHelloOk:ready});gateway.start();
await Promise.race([connected,new Promise((_,j)=>setTimeout(()=>j(Error('Private Gateway deadline')),15000))]);
const embedding=createEmbeddingWorker({python:process.env.VOICE_SPEAKER_PYTHON??new URL('../../artifacts/speaker-native/embedding-venv/bin/python',import.meta.url).pathname,model:process.env.VOICE_SPEAKER_MODEL??new URL('../../artifacts/speaker-native/speaker-embedding.onnx',import.meta.url).pathname});await embedding.ready;
const routing=createStreamingSpeakerRoutingService({env,embedding});
const upstreamSockets=[];class ObservedSocket extends WebSocket{constructor(...args){super(...args);upstreamSockets.push(this);}}
const direct=createDirectVoiceService({gateway,wsModule:{WebSocket:ObservedSocket,WebSocketServer},speakerRouting:routing,apiKeys:{seeduplex:env.VOLCENGINE_REALTIME_API_KEY},loadContext:async()=>'',audit:e=>audit.push(e)});
const server=createServer((_q,res)=>{res.writeHead(404);res.end();});
server.on('upgrade',(req,socket,head)=>{const u=new URL(req.url,'http://localhost');direct.upgrade(req,socket,head,u.searchParams.get('voiceSessionId'),u.searchParams.get('ticket'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,calls=[],checks={};let failure;
try{
 for(const suffix of ['a','b']){const call=new VerificationCall({cookie:'internal-synthetic',origin,wire:origin});call.request=async route=>{
  if(route==='/api/session')return direct.reserve({model:'seeduplex',inputPolicy:'speaker',sessionKey:'agent:makaron:explicit:voice-capacity-synthetic-'+suffix});
  if(route==='/api/status')return {ready:true};if(route==='/api/close'){if(call.id)await direct.close(call.id);return {};}
  return {};
 };calls.push(call);}
 await Promise.all(calls.map(c=>c.open()));checks.distinctSessions=calls[0].id!==calls[1].id;
 await Promise.all(calls.map((c,i)=>c.speak(i?'bg-warm-b':'bg-warm-a').then(t=>c.decision(t))));await delay(8000);
 await Promise.all(calls.map((c,i)=>c.speak(i?'bg-warm-a':'bg-warm-b').then(t=>c.decision(t))));await delay(8000);
 const results=await Promise.all(calls.map(async(c,i)=>{const turn=await c.speak(i?'bg-switch-two':'bg-switch-one');const d=await c.decision(turn);const answer=await c.answer(turn,i?/十一|11/:/七|7/);return {voiceSessionId:c.id,...answer,speaker:d.turn.speakerId,to:d.addresseeIds,people:d.participants.length};}));
 checks.independentPeople=results.every(x=>x.people===2&&x.speaker==='speaker:local1'&&x.to.length===1&&x.to[0]==='speaker:local1');checks.bothRealAudio=calls.every(c=>c.audioBytes>0);checks.noFatal=calls.every(c=>!c.events.some(e=>e.type==='error'));
 if(process.env.VOICE_VERIFY_NATIVE_DROP==='1'){
  const active=upstreamSockets.filter(s=>s.readyState===WebSocket.OPEN);checks.twoNativeConnectionsDropped=active.length===2;for(const socket of active)socket.terminate();await delay(1800);
  await Promise.all(calls.map(async(c,i)=>{const t=await c.speak(i?'bg-switch-two':'bg-switch-one');await c.answer(t,i?/十一|11/:/七|7/);}));checks.bothContinueAfterNativeDisconnect=true;
 }
 await calls[0].close();checks.secondSurvivesOtherClose=!calls[1].closed;await calls[1].answer(await calls[1].speak('bg-switch-two'),/十一|11/);checks.secondContinues=true;
 if(process.env.VOICE_VERIFY_BACKGROUND_END==='1'){
  await calls[1].speak('bg-request');await calls[1].wait(()=>audit.some(e=>e.type==='backend.started'),35000);checks.backendAdmitted=true;
  await calls[1].farewell();checks.endedWhileBackendPending=!audit.some(e=>e.type==='backend.completed');
  await calls[1].wait(()=>audit.some(e=>e.type==='backend.completed'),120000,{allowClosed:true});
  const completed=audit.find(e=>e.type==='backend.completed');checks.realTaskFinishedAfterHangup=typeof completed?.result==='string'&&completed.result.length>500;checks.noImplicitBackendCancel=!audit.some(e=>e.type==='backend.cancel-requested');
 }
 console.log(JSON.stringify({results,checks}));
}catch(e){failure=e.message;}finally{
 await Promise.all(calls.map(c=>c.close()));await direct.dispose();routing.dispose();embedding.close();gateway.stop();await new Promise(r=>server.close(r));
 const result={syntheticOnly:true,scope:'two internal native media pipelines; product admission unchanged',checks,passed:!failure&&Object.values(checks).every(Boolean),failure,audit:process.env.VOICE_VERIFY_BACKGROUND_END==='1'?audit.filter(e=>e.type.startsWith('backend.')):undefined,calls:calls.map(c=>c.report())};await writeFile(new URL('../../artifacts/speaker-native/native-concurrency.private.json',import.meta.url),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({...result,audit:undefined,calls:result.calls.map(({events,...r})=>r)}));if(!result.passed)process.exitCode=1;
}
