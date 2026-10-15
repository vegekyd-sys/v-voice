import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {SpeakerConversation,createArkEvaluator} from './decision.mjs';
const env=await loadCredentials(),{Id:endpointId}=JSON.parse(await readFile('artifacts/volc-speaker/ark-endpoint.json','utf8'));
const invalid=[];const real=await createArkEvaluator(env,{endpointId,onInvalidDecision:(decision,error)=>invalid.push({decision,error:error.message})}),results=[];
const evaluate=async(p,o)=>{const r=await real(p,o);results.push({input:p,result:r});return r;};
const turn=(speakerId,text)=>({speakerId,text,startMs:0,endMs:1000});
let failure;const checks={};
try{
 const anonymous=new SpeakerConversation({evaluate});
 await anonymous.accept(turn('4','你好，能给我讲个故事吗？'));await anonymous.accept(turn('9','我也想听故事。'));
 assert.ok(anonymous.participants.every(p=>p.name===null&&p.role==='unknown'));checks.insufficientIdentityRemainsUnknown=true;
 const pending=new SpeakerConversation({evaluate});
 await pending.accept(turn('0','我是天意，是十二的爸爸。等十二开口以后，请你只和十二聊天。'));
 assert.equal(pending.mode,'adaptive');assert.match(pending.pendingFocus?.name,/十二|12/);assert.equal(pending.participants.length,1);checks.unheardChildNotBoundToFather=true;
 await pending.accept(turn('1','我叫十二，就是刚才提到的孩子，我想听月亮的故事。'));
 assert.equal(pending.targetId,'speaker:1');assert.equal(pending.mode,'exclusive');assert.equal(pending.pendingFocus,null);checks.pendingHandoffResolvedInDialogue=true;
 const correction=new SpeakerConversation({evaluate});
 await correction.accept(turn('0','我叫小林，先聊聊产品设计。'));
 await correction.accept(turn('0','纠正一下，刚才说错了，我叫小李，不叫小林。'));
 assert.equal(correction.participants[0].name,'小李');assert.equal(correction.participants[0].source,'correction');checks.spokenNameCorrection=true;
}catch(error){failure=error.message;}
await writeFile('artifacts/volc-speaker/auto/model-edges.json',JSON.stringify({passed:!failure,textOnly:true,checks,failure,results,invalid},null,2),{mode:0o600});
console.log(JSON.stringify({passed:!failure,textOnly:true,checks,failure,calls:results.length,tokens:results.reduce((n,r)=>n+(r.result.usage?.total_tokens??0),0)}));if(failure)process.exitCode=1;
