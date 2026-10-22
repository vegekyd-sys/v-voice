import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {VerificationCall} from './verification-client.mjs';
const root=new URL('../../artifacts/speaker-native/',import.meta.url),a=await readFile(new URL('bg-switch-one.pcm',root)),b=await readFile(new URL('bg-switch-two.pcm',root));
const mix=Buffer.alloc(Math.max(a.length,b.length));for(let i=0;i<mix.length;i+=2)mix.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(((i<a.length?a.readInt16LE(i):0)+(i<b.length?b.readInt16LE(i):0))*.65))),i);
await writeFile(new URL('overlap-mixed.pcm',root),mix,{mode:0o600});
const call=new VerificationCall(),checks={},turns=[];let failure;
try{
 await call.open();for(const clip of ['bg-warm-a','bg-warm-b']){await call.decision(await call.speak(clip));await delay(7000);}
 await call.speak('overlap-mixed');await delay(9000);checks.overlapDidNotClose=!call.closed;
 for(const [clip,expected,pattern]of [['bg-switch-one','speaker:local1',/七|7/],['bg-switch-two','speaker:local0',/十一|11/]]){const turn=await call.speak(clip),d=await call.decision(turn);const answer=await call.answer(turn,pattern);if(d.turn.speakerId!==expected||!d.addresseeIds.includes(expected))throw Error('Clear voice was not restored after overlap');turns.push({...answer,speaker:d.turn.speakerId,people:d.participants.length});}
 checks.clearDialogueRestored=turns.length===2;await call.farewell();checks.farewellStillWorks=call.closed;
}catch(e){failure=e.message;}finally{await call.close();const result={syntheticOnly:true,checks,turns,passed:!failure&&Object.values(checks).every(Boolean),failure,overlapPeopleMax:Math.max(0,...call.events.filter(e=>e.type==='speaker.decision').map(e=>e.participants.length)),...call.report()};await writeFile(new URL('overlap-recovery.private.json',root),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({...result,events:undefined}));if(!result.passed)process.exitCode=1;}
