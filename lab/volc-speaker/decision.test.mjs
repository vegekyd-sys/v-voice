import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeakerConversation, validateDecision } from './decision.mjs';
import { FinalUtterances } from './utterances.mjs';

const answer={shouldRespond:true,addresseeIds:['tianyi'],nextTargetId:'tianyi',style:'adult',reason:'回应当前问题',reply:'先保留最常用的功能。'};
test('exclusive withholds unknown and other people before any conversational model call',async()=>{
  const payloads=[];const c=new SpeakerConversation({mode:'exclusive',targetId:'tianyi',evaluate:async p=>{payloads.push(p);return {decision:answer};}});
  assert.equal((await c.accept({speaker:{id:'shier'},text:'SECRET BYSTANDER'})).modelCalled,false);
  assert.equal((await c.accept({speaker:{id:'unknown'},text:'SECRET UNKNOWN'})).modelCalled,false);
  await c.accept({speaker:{id:'tianyi'},text:'我的问题'});
  assert.equal(payloads.length,1);assert.doesNotMatch(JSON.stringify(payloads),/SECRET/);
});
test('entering exclusive mode clears prior multiparty context',async()=>{
  const payloads=[];const c=new SpeakerConversation({evaluate:async p=>{payloads.push(structuredClone(p));return{decision:answer};}});
  await c.accept({speaker:{id:'shier'},text:'旧模式中的孩子内容'});
  c.configure({mode:'exclusive',targetId:'tianyi'});
  await c.accept({speaker:{id:'tianyi'},text:'新的问题'});
  assert.equal(payloads[1].history.length,0);
});
test('adaptive receives speaker metadata and commits the model-selected child audience',async()=>{
  const c=new SpeakerConversation({evaluate:async p=>{assert.equal(p.turn.speaker.id,'tianyi');return {decision:{...answer,addresseeIds:['shier'],nextTargetId:'shier',style:'child',reply:'十二，我们用小球来想一想。'}};}});
  const r=await c.accept({speaker:{id:'tianyi',source:'session-binding'},text:'接下来和十二聊'});
  assert.equal(r.targetId,'shier');assert.equal(c.history.at(-1).style,'child');
});
test('exclusive rejects a model response aimed at someone else',async()=>{
  const c=new SpeakerConversation({mode:'exclusive',evaluate:async()=>({decision:{...answer,nextTargetId:'shier'}})});
  await assert.rejects(c.accept({speaker:{id:'tianyi'},text:'你好'}),/违反专注/);
});
test('explicit handoff can change an exclusive target, then former speaker is filtered',async()=>{
  const c=new SpeakerConversation({mode:'exclusive',evaluate:async()=>({decision:{...answer,addresseeIds:['shier'],nextTargetId:'shier',nextMode:'exclusive',policyChangeRequested:true,style:'child',reply:'十二，我们接着聊。'}})});
  await c.accept({speaker:{id:'tianyi'},text:'现在只和十二讲话'});
  assert.equal(c.targetId,'shier');assert.equal(c.mode,'exclusive');assert.equal(c.history.some(x=>x.role==='participant'),false);
  assert.equal((await c.accept({speaker:{id:'tianyi'},text:'旁人话语'})).modelCalled,false);
});
test('uncertain/malformed model output does not become a spoken response',()=>{
  assert.throws(()=>validateDecision({...answer,shouldRespond:false}),/有效/);
  assert.throws(()=>validateDecision({...answer,nextTargetId:'invented-child'}),/有效/);
});
test('final ASR records are deduplicated and a later identity change is exposed',()=>{
  const tracker=new FinalUtterances();
  const raw={definite:true,end_time:1000,words:[{start_time:100,end_time:900,text:'你好'}],additions:{speaker_id:'0'}};
  const event={body:{result:{utterances:[raw]}}};
  assert.equal(tracker.consume(event)[0].turn.text,'你好');
  assert.equal(tracker.consume(event).length,0);
  assert.equal(tracker.consume({body:{result:{utterances:[{...raw,additions:{speaker_id:'1'}}]}}})[0].type,'identity-revision');
});
