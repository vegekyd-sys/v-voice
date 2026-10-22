import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {SpeakerConversation,createArkEvaluator} from './decision.mjs';
const {Id:endpointId}=JSON.parse(await readFile('artifacts/volc-speaker/ark-endpoint.json','utf8'));
const invalid=[];const real=await createArkEvaluator(await loadCredentials(),{endpointId,onInvalidDecision:(decision,error)=>invalid.push({decision,error:error.message})}),results=[];
const c=new SpeakerConversation({evaluate:real});
const say=async(speakerId,text)=>{const r=await c.accept({speakerId,text,startMs:0,endMs:1000});results.push({input:{speakerId,text},...r});return r;};
let failure;const checks={};
try{
 await say('0','我是天懿，是十二的爸爸。V，我们一起想想如何把产品入口做简单。');
 await say('1','爸爸，我也想问，月亮为什么会变成弯弯的小船？');
 await say('1','我叫十二，是刚才提到的孩子，我也参加讨论。');
 const collective=await say('1','V，爸爸和我刚才说的点子，你帮我们比较一下，并分别给我们一个建议。');
 assert.equal(collective.mode,'auto');assert.equal(collective.decision.shouldRespond,true);assert.ok(collective.decision.addresseeIds.includes('speaker:0'));assert.ok(collective.decision.addresseeIds.includes('speaker:1'));checks.modelCanAddressMultiplePeople=true;
 const comment=await say('1','我补充一个想法，常用按钮放在首页第一屏就够了。');assert.equal(comment.decision.shouldRespond,true);checks.commentCanReceiveAnAnswer=true;
 const side=await say('0','十二，杯子在左边那个抽屉，你把它拿出来递给我。');assert.equal(side.decision.shouldRespond,false);checks.sideConversationCanRemainQuiet=true;
 const tv=await say('2','电视机前的观众朋友们，欢迎收看今天的晚间新闻，广告之后马上回来。');assert.equal(tv.decision.shouldRespond,false);checks.tvLikeTranscriptCanRemainQuiet=true;
 const directed=await say('1','V，我回来啦，给我解释一下什么叫高频功能，好吗？');assert.equal(directed.decision.shouldRespond,true);assert.deepEqual(directed.decision.addresseeIds,['speaker:1']);checks.modelCanAddressOnePerson=true;
}catch(error){failure=error.message;}
await writeFile('artifacts/volc-speaker/auto/auto-model-verification.json',JSON.stringify({passed:!failure,textOnly:true,checks,failure,results,invalid},null,2),{mode:0o600});
console.log(JSON.stringify({passed:!failure,textOnly:true,checks,failure,calls:results.length,choices:results.map(r=>({respond:r.decision?.shouldRespond,to:r.decision?.addresseeIds,target:r.targetId,mode:r.mode}))}));if(failure)process.exitCode=1;
