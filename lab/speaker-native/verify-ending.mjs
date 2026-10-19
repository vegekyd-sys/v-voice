import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {VerificationCall} from './verification-client.mjs';
const call=new VerificationCall(),checks={},turns=[];let failure;
try {
 await call.open();console.log(JSON.stringify({stage:'open',voiceSessionId:call.id}));
 call.ws.on('message',raw=>{const e=JSON.parse(raw);if(e.type==='end.accepted'){call.ws.send(JSON.stringify({type:'playback.drained',callId:e.callId}));call.ws.send(JSON.stringify({type:'playback.drained',callId:'foreign-farewell'}));}});
 for(const clip of ['bg-warm-a','bg-warm-b']){await call.decision(await call.speak(clip));await delay(7000);}
 for(const [clip,pattern]of [['end-no',/七|7/],['end-other',null],['end-quote',null],['end-more',/十一|11/]]){
  const turn=await call.speak(clip),d=await call.decision(turn);if(d.endCall||call.events.some(e=>e.type==='end.accepted'))throw Error('A non-ending utterance proposed ending');if(pattern)Object.assign(turn,await call.answer(turn,pattern));else await delay(7000);if(call.closed)throw Error('False hangup');turns.push({...turn,endCall:d.endCall});console.log(JSON.stringify({stage:'negative-passed',clip}));
 }
 checks.negativesStayOpen=turns.length===4;
 const farewell=await call.farewell();checks.farewellClosed=call.closed;checks.realNativeAudio=farewell.audioBytes>0;checks.waitedForCompletion=call.events.some(e=>e.type==='end.after-playback');checks.correctEndSpeaker=call.events.findLast(e=>e.type==='speaker.decision')?.turn.speakerId==='speaker:local0';
 console.log(JSON.stringify({stage:'farewell-closed',audioBytes:farewell.audioBytes}));
}catch(e){failure=e.message;}finally{await call.close();const result={syntheticOnly:true,checks,turns,passed:!failure&&Object.values(checks).every(Boolean),failure,...call.report()};await writeFile(new URL('../../artifacts/speaker-native/ending-api.private.json',import.meta.url),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({...result,events:undefined}));if(!result.passed)process.exitCode=1;}
