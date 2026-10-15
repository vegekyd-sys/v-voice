import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeakerConversation, validateDecision } from './decision.mjs';
import { FinalUtterances } from '../volc-speaker/utterances.mjs';
const answer=(p,extra={})=>({shouldRespond:true,addresseeIds:[p.activeTargetId],nextTargetId:p.activeTargetId,nextMode:p.mode,policyChangeRequested:false,policyEvidence:null,pendingFocus:p.pendingFocus,identityUpdates:[],style:'neutral',reason:'回应当前问题',reply:'你好。',...extra});
const input=(id,text='你好')=>({speakerId:id,text,startMs:0,endMs:1000});
const update=(p,extra={})=>({speakerId:p.turn.speaker.id,name:'天意',role:'adult',certainty:'stated',source:'self-introduction',evidence:[{turnId:p.turn.id,quote:p.turn.text}],reason:'本人告知',...extra});
const evaluator=fn=>async p=>({decision:answer(p,fn?.(p))});
test('no enrollment: anonymous speakers are independent and the first becomes initial audience',async()=>{
 const c=new SpeakerConversation({evaluate:evaluator()});await c.accept(input('0'));await c.accept(input('1'));
 assert.deepEqual(c.participants.map(p=>[p.id,p.name,p.role]),[['speaker:0',null,'unknown'],['speaker:1',null,'unknown']]);assert.equal(c.targetId,'speaker:0');
});
test('exclusive locks first speaker and never sends bystander content to model',async()=>{
 const payloads=[];const c=new SpeakerConversation({mode:'exclusive',evaluate:async p=>{payloads.push(p);return{decision:answer(p)};}});
 await c.accept(input('0','我的问题'));assert.equal((await c.accept(input('1','SECRET BYSTANDER'))).modelCalled,false);
 await c.accept(input('0','接着聊'));assert.equal(payloads.length,2);assert.doesNotMatch(JSON.stringify(payloads),/SECRET/);
});
test('spoken self introduction associates name without changing acoustic id',async()=>{
 const c=new SpeakerConversation({evaluate:evaluator(p=>({identityUpdates:[update(p)]}))});const r=await c.accept(input('7','我是天意'));
 assert.equal(r.participants[0].name,'天意');assert.equal(r.targetId,'speaker:7');assert.equal(r.participants[0].certainty,'stated');
});
test('a contextual guess stays suggested and cannot overwrite a stated identity',async()=>{
 let count=0;const c=new SpeakerConversation({evaluate:evaluator(p=>({identityUpdates:[update(p,++count===1?{}:{name:'十二',certainty:'suggested',source:'context'})]}))});
 await c.accept(input('0','我是天意'));await c.accept(input('0','也许呢'));assert.equal(c.participants[0].name,'天意');assert.equal(c.participants[0].certainty,'stated');
});
test('explicit same-speaker correction can change a stated name',async()=>{
 let count=0;const c=new SpeakerConversation({evaluate:evaluator(p=>({identityUpdates:[update(p,++count===1?{}:{name:'小天',source:'correction'})]}))});
 await c.accept(input('0','我是天意'));await c.accept(input('0','纠正一下，我叫小天'));assert.equal(c.participants[0].name,'小天');assert.equal(c.targetId,'speaker:0');
});
test('unknown target can be pending without inventing a speaker',async()=>{
 const c=new SpeakerConversation({evaluate:evaluator(()=>({pendingFocus:{name:'十二',mode:'adaptive'}}))});await c.accept(input('0','等十二来就只和他聊'));
 assert.equal(c.participants.length,1);assert.equal(c.pendingFocus.name,'十二');assert.equal(c.mode,'adaptive');
});
test('explicit focus handoff then filters the former speaker',async()=>{
 const c=new SpeakerConversation({evaluate:evaluator(p=>({nextMode:'exclusive',nextTargetId:'speaker:1',addresseeIds:['speaker:1'],policyChangeRequested:true,policyEvidence:{turnId:p.turn.id,quote:p.turn.text},style:'child'}))});
 c.register('0');c.register('1');await c.accept(input('0','现在只和十二聊天'));assert.equal(c.targetId,'speaker:1');assert.equal(c.history.length,0);
 assert.equal((await c.accept(input('0','SECRET AFTER HANDOFF'))).modelCalled,false);
});
test('exclusive rejects undeclared audience or mode changes',async()=>{
 const c=new SpeakerConversation({mode:'exclusive',evaluate:evaluator(()=>({nextTargetId:'speaker:1'}))});c.register('0');c.register('1');
 await assert.rejects(c.accept(input('0')),/未声明|违反专注/);
});
test('entering exclusive clears prior conversation while retaining identity roster',async()=>{
 const payloads=[];const c=new SpeakerConversation({evaluate:async p=>{payloads.push(p);return{decision:answer(p)};}});
 await c.accept(input('1','SECRET OLD CONTEXT'));c.register('0');c.configure({mode:'exclusive',targetId:'speaker:0'});await c.accept(input('0','新问题'));
 assert.equal(payloads[1].history.length,0);assert.doesNotMatch(JSON.stringify(payloads[1]),/SECRET/);
});
test('fabricated identity evidence rejects the whole result without a partial commit',async()=>{
 const c=new SpeakerConversation({evaluate:evaluator(p=>({identityUpdates:[update(p,{evidence:[{turnId:p.turn.id,quote:'并未说过的名字'}]})]}))});
 await assert.rejects(c.accept(input('0')),/不存在/);assert.equal(c.participants[0].name,null);assert.equal(c.history.length,0);
});
test('a self introduction cannot be sourced from another speaker',async()=>{
 const c=new SpeakerConversation({evaluate:evaluator(p=>({identityUpdates:[update(p,{speakerId:'speaker:1'})]}))});c.register('1');
 await assert.rejects(c.accept(input('0','我是天意')),/另一声线/);
});
test('abort during evaluation cannot commit stale identities',async()=>{
 const controller=new AbortController();const c=new SpeakerConversation({evaluate:async p=>{controller.abort();return{decision:answer(p,{identityUpdates:[update(p)]})};}});
 await assert.rejects(c.accept(input('0','我是天意'),{signal:controller.signal}),/已变更/);assert.equal(c.participants[0].name,null);
});
test('malformed or invented speaker ids are rejected',()=>{
 const p={activeTargetId:'speaker:0',mode:'adaptive',pendingFocus:null};
 assert.throws(()=>validateDecision(answer(p,{nextTargetId:'invented'}),[{id:'speaker:0'}]),/有效/);
 assert.throws(()=>validateDecision(answer(p,{shouldRespond:false}),[{id:'speaker:0'}]),/有效/);
});
test('ASR revisions invalidate names and pause a revised active audience',async()=>{
 const c=new SpeakerConversation({evaluate:evaluator(p=>({identityUpdates:[update(p)]}))});await c.accept(input('0','我是天意'));c.invalidateSpeakers(['0','1']);
 assert.equal(c.participants[0].name,null);assert.equal(c.history.length,0);await assert.rejects(c.accept(input('1')),/重新开始/);
});
test('ASR records deduplicate and emit a speaker revision only once',()=>{
 const t=new FinalUtterances(),raw={definite:true,end_time:1000,words:[{start_time:100,end_time:900,text:'你好'}],additions:{speaker_id:'0'}};
 const event=r=>({body:{result:{utterances:[r]}}});assert.equal(t.consume(event(raw))[0].turn.text,'你好');assert.equal(t.consume(event(raw)).length,0);
 const revised={...raw,additions:{speaker_id:'1'}};assert.equal(t.consume(event(revised))[0].type,'identity-revision');assert.equal(t.consume(event(revised)).length,0);
});

test('exclusive does not reintroduce prior bystander speech through identity evidence',async()=>{
 const payloads=[];const c=new SpeakerConversation({evaluate:async p=>{payloads.push(p);return{decision:answer(p,{identityUpdates:p.turn.text.includes('SECRET')?[update(p)]:[]})};}});
 await c.accept(input('1','我是天意 SECRET IDENTITY QUOTE'));c.register('0');c.configure({mode:'exclusive',targetId:'speaker:0'});await c.accept(input('0','继续'));
 assert.doesNotMatch(JSON.stringify(payloads[1]),/SECRET/);assert.equal(c.participants[0].name,'天意');
});

test('ordinary introduction cannot escalate pending focus or enter exclusive',async()=>{
 let n=0;const c=new SpeakerConversation({evaluate:evaluator(p=>++n===1?{pendingFocus:{name:'十二',mode:'exclusive'}}:{nextMode:'exclusive',policyChangeRequested:true,policyEvidence:{turnId:p.turn.id,quote:p.turn.text}})});
 await c.accept(input('0','你先介绍一下自己'));assert.equal(c.pendingFocus.mode,'adaptive');
 const r=await c.accept(input('1','我是十二'));assert.equal(c.mode,'adaptive');assert.ok(r.policyGuard);
});
test('a pending exclusive request needs evidence and resolves only for the named speaker',async()=>{
 let n=0;const c=new SpeakerConversation({evaluate:evaluator(p=>++n===1?{pendingFocus:{name:'十二',mode:'exclusive'}}:{nextMode:'exclusive',nextTargetId:p.turn.speaker.id,addresseeIds:[p.turn.speaker.id],policyChangeRequested:true,identityUpdates:[update(p,{name:'十二',role:'child'})]})});
 await c.accept(input('0','等十二开口以后，只和十二聊天'));await c.accept(input('1','我叫十二'));assert.equal(c.mode,'exclusive');assert.equal(c.targetId,'speaker:1');
});

test('exclusive strips third-party quotes carried in the active speaker profile',async()=>{
 const payloads=[];const c=new SpeakerConversation({evaluate:async p=>{payloads.push(p);return{decision:answer(p)};}});c.register('0');c.register('1');
 c.participants[1].evidence=[{turnId:'old',quote:'SECRET THIRD PARTY INTRODUCTION'}];c.configure({mode:'exclusive',targetId:'speaker:1'});
 await c.accept(input('1','你好'));await c.accept(input('1','接着聊'));assert.doesNotMatch(JSON.stringify(payloads),/SECRET/);
});
