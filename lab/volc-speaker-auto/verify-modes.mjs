import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {SpeakerConversation,createArkEvaluator} from './decision.mjs';
const {Id:endpointId}=JSON.parse(await readFile('artifacts/volc-speaker/ark-endpoint.json','utf8'));
const real=await createArkEvaluator(await loadCredentials(),{endpointId}),results=[];
const conversation=mode=>{
 const c=new SpeakerConversation({mode,evaluate:real});c.register('0');c.register('1');c.turnCount=1;
 c.history=[{role:'participant',id:'u1',speaker:{id:'speaker:0'},text:'V，和我讨论产品设计，我们先看看怎么把功能入口做简单。'},{role:'assistant',reply:'我们先梳理最常用的任务。',addresseeIds:['speaker:0']}];return c;
};
const turn=(speakerId,text)=>({speakerId,text,startMs:0,endMs:1000});let failure;const checks={};
try{
 const a=conversation('adaptive'),g=conversation('group'),comment=turn('1','我觉得把入口做简单一点就好了。');
 const adaptive=await a.accept(comment),group=await g.accept(comment);results.push({case:'adaptive-comment',...adaptive},{case:'group-comment',...group});
 assert.equal(adaptive.decision.shouldRespond,false);assert.equal(adaptive.targetId,'speaker:0');assert.equal(group.decision.shouldRespond,true);assert.deepEqual(group.decision.addresseeIds,['speaker:0','speaker:1']);checks.sameCommentHasDifferentResponsePolicy=true;
 const directed=await a.accept(turn('1','V，我问你，你能举一个产品设计的例子吗？'));results.push({case:'directed-question',...directed});assert.equal(directed.decision.shouldRespond,true);assert.equal(directed.targetId,'speaker:0');assert.deepEqual(directed.decision.addresseeIds,['speaker:1']);checks.oneOffReplyDoesNotStealMainTarget=true;
 const focus=await a.accept(turn('0','你还是回答我的问题吧，不要理他了。'));results.push({case:'colloquial-focus',...focus});assert.equal(focus.mode,'exclusive');checks.colloquialFocusWorks=true;
 for(const text of ['没有了，无所谓。','嗯，没事，了解了。','那先这样，拜拜。']){const r=await a.accept(turn('0',text));results.push({case:'ordinary-closing',...r});assert.equal(r.mode,'exclusive');}checks.acknowledgementsDoNotBreakDialogue=true;
}catch(error){failure=error.message;}
await writeFile('artifacts/volc-speaker/auto/mode-verification.json',JSON.stringify({passed:!failure,textOnly:true,checks,failure,results},null,2),{mode:0o600});console.log(JSON.stringify({passed:!failure,textOnly:true,checks,failure,calls:results.length}));if(failure)process.exitCode=1;
