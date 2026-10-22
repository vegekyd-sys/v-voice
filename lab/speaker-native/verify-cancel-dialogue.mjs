import {writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {VerificationCall} from './verification-client.mjs';
const call=new VerificationCall(),checks={};let failure;
try{
 await call.open();await call.decision(await call.speak('bg-warm-a'));await delay(8000);
 await call.speak('bg-request');await call.wait(()=>call.events.some(e=>e.type==='tool.call'&&e.name==='delegate_to_v'),35000);checks.realDelegation=true;
 const request=await call.speak('end-cancel'),d=await call.decision(request);checks.cancelAdmitted=d.shouldRespond&&!d.endCall;
 if(!checks.cancelAdmitted)throw Error('Explicit task cancellation was suppressed');
 await call.wait(()=>call.events.some(e=>e.type==='tool.result'&&['cancel_task','openclaw_agent_control'].includes(e.name)),45000);checks.realCancelProof=true;checks.phoneStayedOpen=!call.closed;
 await call.answer(await call.speak('bg-switch-two'),/十一|11/);checks.dialogueContinues=true;await call.farewell();checks.onlyFarewellEnds=true;
 if(process.env.VOICE_VERIFY_DIAGNOSTICS_FILE){const rows=(await readFile(process.env.VOICE_VERIFY_DIAGNOSTICS_FILE,'utf8')).split('\n').filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.voiceSessionId===call.id);checks.cancelCompletionConfirmed=rows.some(e=>e.type==='tool.delivered'&&e.cancelled===true);checks.backendAdmitted=rows.some(e=>e.type==='backend.started');checks.explicitBackendCancellation=rows.some(e=>e.type==='backend.cancel-requested');}
}catch(e){failure=e.message;}finally{await call.close();const result={syntheticOnly:true,checks,passed:!failure&&Object.values(checks).every(Boolean),failure,...call.report()};await writeFile(new URL('../../artifacts/speaker-native/cancel-dialogue.private.json',import.meta.url),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({...result,events:undefined}));if(!result.passed)process.exitCode=1;}
