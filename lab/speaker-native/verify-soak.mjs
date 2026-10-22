import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {VerificationCall} from './verification-client.mjs';
const minutes=Number(process.env.VOICE_VERIFY_SOAK_MINUTES??29),label=process.argv[2]??'soak';
if(!Number.isFinite(minutes)||minutes<2||minutes>29||!/^[-\w]+$/.test(label))throw Error('Invalid bounded soak');
const call=new VerificationCall(),checks={},samples=[];let failure;
try {
 await call.open();const started=Date.now();console.log(JSON.stringify({stage:'started',voiceSessionId:call.id,minutes}));
 await call.decision(await call.speak('bg-warm-a'));await delay(7000);await call.decision(await call.speak('bg-warm-b'));await delay(8000);
 for(let i=0;Date.now()-started<minutes*60000-15000;i++){
  const clip=i%2?'bg-switch-two':'bg-switch-one',turn=await call.speak(clip),d=await call.decision(turn);const answer=await call.answer(turn,i%2?/十一|11/:/七|7/);
  const expected=i%2?'speaker:local0':'speaker:local1';if(d.turn.speakerId!==expected||d.addresseeIds?.[0]!==expected||d.participants.length!==2)throw Error('Speaker isolation changed during soak');
  samples.push({elapsedMs:Date.now()-started,...answer});console.log(JSON.stringify({stage:'sample',...samples.at(-1)}));
  if(i===0){call.paused=true;await delay(3000);call.paused=false;}
  const next=Math.min(started+minutes*60000-15000,started+(i+1)*120000);while(Date.now()<next){if(call.failure||call.closed)throw Error(call.failure??'Closed during idle');await delay(1000);}
 }
 checks.survivedDuration=Date.now()-started>=(minutes*60-16)*1000;checks.answersContinued=samples.length>=2;checks.realAsrRecovered=call.events.some(e=>e.type==='speaker.asr-recovered');checks.noFatal=!call.events.some(e=>e.type==='error');
 const farewell=await call.farewell();checks.farewellClosed=call.closed&&farewell.audioBytes>0;
}catch(e){failure=e.message;}finally{await call.close();const result={syntheticOnly:true,checks,passed:!failure&&Object.values(checks).every(Boolean),failure,samples,...call.report()};await writeFile(new URL('../../artifacts/speaker-native/'+label+'.private.json',import.meta.url),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({...result,events:undefined}));if(!result.passed)process.exitCode=1;}
