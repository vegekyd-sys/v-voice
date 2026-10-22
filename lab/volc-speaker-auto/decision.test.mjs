import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeakerConversation, validateDecision, shouldInterrupt } from './decision.mjs';
import { FinalUtterances } from '../volc-speaker/utterances.mjs';
const answer=(p,extra={})=>({shouldRespond:true,addresseeIds:[p.activeTargetId],nextTargetId:p.activeTargetId,nextMode:p.mode,policyChangeRequested:false,policyEvidence:null,pendingFocus:p.pendingFocus,identityUpdates:[],style:'neutral',reason:'回应当前问题',reply:'你好。',...extra});
const input=(id,text='你好')=>({speakerId:id,text,startMs:0,endMs:1000});
const update=(p,extra={})=>({speakerId:p.turn.speaker.id,name:'天懿',role:'adult',certainty:'stated',source:'self-introduction',evidence:[{turnId:p.turn.id,quote:p.turn.text}],reason:'本人告知',...extra});
const evaluator=fn=>async p=>({decision:answer(p,fn?.(p))});
test('no enrollment: anonymous speakers are independent and the first becomes initial audience',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator()});await c.accept(input('0'));await c.accept(input('1'));
 assert.deepEqual(c.participants.map(p=>[p.id,p.name,p.role]),[['speaker:0',null,'unknown'],['speaker:1',null,'unknown']]);assert.equal(c.targetId,'speaker:0');
});
test('exclusive locks first speaker and never sends bystander content to model',async()=>{
 const payloads=[];const c=new SpeakerConversation({mode:'exclusive',evaluate:async p=>{payloads.push(p);return{decision:answer(p)};}});
 await c.accept(input('0','我的问题'));assert.equal((await c.accept(input('1','SECRET BYSTANDER'))).modelCalled,false);
 await c.accept(input('0','接着聊'));assert.equal(payloads.length,2);assert.doesNotMatch(JSON.stringify(payloads),/SECRET/);
});
test('spoken self introduction associates name without changing acoustic id',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>({identityUpdates:[update(p)]}))});const r=await c.accept(input('7','我是天懿'));
 assert.equal(r.participants[0].name,'天懿');assert.equal(r.targetId,'speaker:7');assert.equal(r.participants[0].certainty,'stated');
});
test('a contextual guess stays suggested and cannot overwrite a stated identity',async()=>{
 let count=0;const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>({identityUpdates:[update(p,++count===1?{}:{name:'十二',certainty:'suggested',source:'context'})]}))});
 await c.accept(input('0','我是天懿'));await c.accept(input('0','也许呢'));assert.equal(c.participants[0].name,'天懿');assert.equal(c.participants[0].certainty,'stated');
});
test('explicit same-speaker correction can change a stated name',async()=>{
 let count=0;const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>({identityUpdates:[update(p,++count===1?{}:{name:'小天',source:'correction'})]}))});
 await c.accept(input('0','我是天懿'));await c.accept(input('0','纠正一下，我叫小天'));assert.equal(c.participants[0].name,'小天');assert.equal(c.targetId,'speaker:0');
});
test('unknown target can be pending without inventing a speaker',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(()=>({pendingFocus:{name:'十二',mode:'adaptive'}}))});await c.accept(input('0','等十二来就只和他聊'));
 assert.equal(c.participants.length,1);assert.equal(c.pendingFocus.name,'十二');assert.equal(c.mode,'adaptive');
});
test('explicit focus handoff then filters the former speaker',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>({nextMode:'exclusive',nextTargetId:'speaker:1',addresseeIds:['speaker:1'],policyChangeRequested:true,policyEvidence:{turnId:p.turn.id,quote:p.turn.text},style:'child'}))});
 c.register('0');c.register('1');await c.accept(input('0','现在只和十二聊天'));assert.equal(c.targetId,'speaker:1');assert.equal(c.history.length,0);
 assert.equal((await c.accept(input('0','SECRET AFTER HANDOFF'))).modelCalled,false);
});
test('undeclared mode or exclusive audience drift is contained without breaking ordinary dialogue',async()=>{
 const c=new SpeakerConversation({mode:'exclusive',evaluate:evaluator(()=>({nextTargetId:'speaker:1'}))});c.register('0');c.register('1');
 const r=await c.accept(input('0'));assert.equal(r.targetId,'speaker:0');assert.equal(r.decision.shouldRespond,false);assert.ok(r.policyGuard);
});
test('entering exclusive clears prior conversation while retaining identity roster',async()=>{
 const payloads=[];const c=new SpeakerConversation({mode:'adaptive',evaluate:async p=>{payloads.push(p);return{decision:answer(p)};}});
 await c.accept(input('1','SECRET OLD CONTEXT'));c.register('0');c.configure({mode:'exclusive',targetId:'speaker:0'});await c.accept(input('0','新问题'));
 assert.equal(payloads[1].history.length,0);assert.doesNotMatch(JSON.stringify(payloads[1]),/SECRET/);
});
test('fabricated identity evidence is quarantined without breaking a valid reply',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>({identityUpdates:[update(p,{evidence:[{turnId:p.turn.id,quote:'并未说过的名字'}]})]}))});
 const r=await c.accept(input('0'));assert.equal(r.identityWarnings.length,1);assert.equal(c.participants[0].name,null);assert.equal(r.decision.shouldRespond,true);
});
test('a self introduction cannot be sourced from another speaker',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>({identityUpdates:[update(p,{speakerId:'speaker:1'})]}))});c.register('1');
 const r=await c.accept(input('0','我是天懿'));assert.equal(r.identityWarnings.length,1);assert.equal(c.participants.find(p=>p.id==='speaker:1').name,null);
});
test('abort during evaluation cannot commit stale identities',async()=>{
 const controller=new AbortController();const c=new SpeakerConversation({mode:'adaptive',evaluate:async p=>{controller.abort();return{decision:answer(p,{identityUpdates:[update(p)]})};}});
 await assert.rejects(c.accept(input('0','我是天懿'),{signal:controller.signal}),/已变更/);assert.equal(c.participants[0].name,null);
});
test('malformed or invented speaker ids are rejected',()=>{
 const p={activeTargetId:'speaker:0',mode:'adaptive',pendingFocus:null};
 assert.throws(()=>validateDecision(answer(p,{nextTargetId:'invented'}),[{id:'speaker:0'}]),/有效/);
 assert.throws(()=>validateDecision(answer(p,{shouldRespond:false}),[{id:'speaker:0'}]),/有效/);
});
test('ASR revisions invalidate names and pause a revised active audience',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>({identityUpdates:[update(p)]}))});await c.accept(input('0','我是天懿'));c.invalidateSpeakers(['0','1']);
 assert.equal(c.participants[0].name,null);assert.equal(c.history.length,0);await assert.rejects(c.accept(input('1')),/重新开始/);
});
test('ASR records deduplicate and emit a speaker revision only once',()=>{
 const t=new FinalUtterances(),raw={definite:true,end_time:1000,words:[{start_time:100,end_time:900,text:'你好'}],additions:{speaker_id:'0'}};
 const event=r=>({body:{result:{utterances:[r]}}});assert.equal(t.consume(event(raw))[0].turn.text,'你好');assert.equal(t.consume(event(raw)).length,0);
 const revised={...raw,additions:{speaker_id:'1'}};assert.equal(t.consume(event(revised))[0].type,'identity-revision');assert.equal(t.consume(event(revised)).length,0);
});

test('exclusive does not reintroduce prior bystander speech through identity evidence',async()=>{
 const payloads=[];const c=new SpeakerConversation({mode:'adaptive',evaluate:async p=>{payloads.push(p);return{decision:answer(p,{identityUpdates:p.turn.text.includes('SECRET')?[update(p)]:[]})};}});
 await c.accept(input('1','我是天懿 SECRET IDENTITY QUOTE'));c.register('0');c.configure({mode:'exclusive',targetId:'speaker:0'});await c.accept(input('0','继续'));
 assert.doesNotMatch(JSON.stringify(payloads[1]),/SECRET/);assert.equal(c.participants[0].name,'天懿');
});

test('ordinary introduction cannot escalate pending focus or enter exclusive',async()=>{
 let n=0;const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>++n===1?{pendingFocus:{name:'十二',mode:'exclusive'}}:{nextMode:'exclusive',policyChangeRequested:true,policyEvidence:{turnId:p.turn.id,quote:p.turn.text}})});
 await c.accept(input('0','你先介绍一下自己'));assert.equal(c.pendingFocus.mode,'adaptive');
 const r=await c.accept(input('1','我是十二'));assert.equal(c.mode,'adaptive');assert.ok(r.policyGuard);
});
test('a pending exclusive request needs evidence and resolves only for the named speaker',async()=>{
 let n=0;const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(p=>++n===1?{pendingFocus:{name:'十二',mode:'exclusive'}}:{nextMode:'exclusive',nextTargetId:p.turn.speaker.id,addresseeIds:[p.turn.speaker.id],policyChangeRequested:true,identityUpdates:[update(p,{name:'十二',role:'child'})]})});
 await c.accept(input('0','等十二开口以后，只和十二聊天'));await c.accept(input('1','我叫十二'));assert.equal(c.mode,'exclusive');assert.equal(c.targetId,'speaker:1');
});

test('exclusive strips third-party quotes carried in the active speaker profile',async()=>{
 const payloads=[];const c=new SpeakerConversation({mode:'adaptive',evaluate:async p=>{payloads.push(p);return{decision:answer(p)};}});c.register('0');c.register('1');
 c.participants[1].evidence=[{turnId:'old',quote:'SECRET THIRD PARTY INTRODUCTION'}];c.configure({mode:'exclusive',targetId:'speaker:1'});
 await c.accept(input('1','你好'));await c.accept(input('1','接着聊'));assert.doesNotMatch(JSON.stringify(payloads),/SECRET/);
});

test('regression: model drift after a guarded switch cannot turn acknowledgements into repeated errors',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:evaluator(()=>({nextMode:'exclusive',policyChangeRequested:false}))});
 for(const text of ['没有，无所谓。','嗯，了解了。','那就结束吧。']){const r=await c.accept(input('0',text));assert.equal(r.mode,'adaptive');assert.ok(r.policyGuard);}
 assert.equal(c.history.some(t=>'reason'in t),false);
});
test('adaptive preserves main speaker for a one-off reply while group addresses everyone',async()=>{
 for(const mode of ['adaptive','group']){
  const c=new SpeakerConversation({mode,evaluate:evaluator(p=>({nextTargetId:p.turn.speaker.id,addresseeIds:['speaker:0','speaker:1']}))});c.register('0');c.register('1');
  const r=await c.accept(input('1','我也想问一个问题'));
  if(mode==='adaptive'){assert.equal(r.targetId,'speaker:0');assert.deepEqual(r.decision.addresseeIds,['speaker:1']);}
  else assert.deepEqual(r.decision.addresseeIds,['speaker:0','speaker:1']);
 }
});
test('compact model reply inherits mode and identities without repetitive metadata',async()=>{
 const c=new SpeakerConversation({mode:'group',evaluate:async()=>({decision:{reply:'我们一起想想。'}})});const r=await c.accept(input('0','你好'));
 assert.equal(r.mode,'group');assert.equal(r.decision.shouldRespond,true);assert.deepEqual(r.decision.addresseeIds,['speaker:0']);
});

test('same bystander comment is quiet in adaptive but joins the discussion in group',async()=>{
 for(const mode of ['adaptive','group']){
  const c=new SpeakerConversation({mode,evaluate:evaluator(p=>({addresseeIds:[p.turn.speaker.id]}))});c.register('0');c.register('1');
  const r=await c.accept(input('1','我觉得先把入口做简单。'));assert.equal(r.decision.shouldRespond,mode==='group');
 }
});
test('malformed optional policy evidence cannot break a normal compact reply',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:async()=>({decision:{reply:'你好。',policyEvidence:'not a citation',nextMode:'exclusive',policyChangeRequested:false}})});
 const r=await c.accept(input('0','嗯，知道了'));assert.equal(r.mode,'adaptive');assert.equal(r.decision.reply,'你好。');
});

test('compact exclusive handoff defaults reply audience and style to the new target',async()=>{
 const c=new SpeakerConversation({mode:'adaptive',evaluate:async p=>({decision:{reply:'十二，我们接着聊。',nextTargetId:'speaker:1',nextMode:'exclusive',policyChangeRequested:true}})});c.register('0');c.register('1');c.participants[1].role='child';
 const r=await c.accept(input('0','现在只和十二聊'));assert.deepEqual(r.decision.addresseeIds,['speaker:1']);assert.equal(r.decision.style,'child');assert.equal(r.decision.shouldRespond,true);
});

test('bystander comment does not interrupt main speech in adaptive or exclusive',()=>{
 const state={targetId:'speaker:0',speaker:{id:'speaker:1'}};
 assert.equal(shouldInterrupt({...state,mode:'adaptive'},'我觉得入口简单一些'),false);
 assert.equal(shouldInterrupt({...state,mode:'exclusive'},'V，我有问题'),false);
 assert.equal(shouldInterrupt({...state,mode:'adaptive'},'V，我有问题'),true);
 assert.equal(shouldInterrupt({...state,mode:'group'},'我觉得入口简单一些'),true);
});

test('auto is the default and preserves the model choice of one, many, or no addressees',async()=>{
 for(const choice of [{reply:'只回应第二位。',addresseeIds:['speaker:1']},{reply:'大家一起想想。',addresseeIds:['speaker:0','speaker:1']},{reply:''}]){
  const c=new SpeakerConversation({evaluate:async()=>({decision:choice})});c.register('0');c.register('1');
  const r=await c.accept(input('1','我觉得入口可以更简单。'));
  assert.equal(r.mode,'auto');assert.deepEqual(r.decision.addresseeIds,choice.addresseeIds??[]);assert.equal(r.decision.reply,choice.reply);
 }
});
test('auto does not pin a model-selected target or require question keywords',async()=>{
 const c=new SpeakerConversation({evaluate:async()=>({decision:{reply:'我们沿着这个思路看看。',addresseeIds:['speaker:1'],nextTargetId:'speaker:1'}})});c.register('0');
 const r=await c.accept(input('1','这个设计思路更好。'));assert.equal(r.targetId,'speaker:1');assert.equal(r.decision.shouldRespond,true);
});
test('auto lets the model ignore a question-like TV quote without interrupting speech',async()=>{
 const c=new SpeakerConversation({evaluate:async()=>({decision:{reply:''}})});c.register('0');
 const text='（电视节目）请问你知道为什么吗？';assert.equal(shouldInterrupt({mode:'auto',targetId:'speaker:0',speaker:{id:'speaker:1'}},text),false);
 assert.equal((await c.accept(input('1',text))).decision.shouldRespond,false);
});
test('returning to free conversation maps legacy model names to the single auto mode',async()=>{
 const c=new SpeakerConversation({mode:'exclusive',evaluate:async p=>({decision:{reply:'好，我们自由聊。',nextMode:'group',policyChangeRequested:true,policyEvidence:{turnId:p.turn.id,quote:p.turn.text}}})});
 const r=await c.accept(input('0','解除专注，大家自由聊吧'));assert.equal(r.mode,'auto');
});

test('omitted self-introduction owner is recovered only from its same-speaker evidence',async()=>{
 const c=new SpeakerConversation({evaluate:async p=>({decision:{reply:'你好。',identityUpdates:[{name:'小林',role:'unknown',certainty:'stated',source:'self-introduction',evidence:[{turnId:p.turn.id,quote:p.turn.text}]}]}})});
 await c.accept(input('9','我叫小林'));assert.equal(c.participants[0].id,'speaker:9');assert.equal(c.participants[0].name,'小林');
});

test('role-only contextual update does not invent a name or reject the reply',async()=>{
 const c=new SpeakerConversation({evaluate:async p=>({decision:{reply:'我们用小球来想一想。',identityUpdates:[{speakerId:p.turn.speaker.id,role:'child',certainty:'suggested',source:'context',evidence:[{turnId:p.turn.id,quote:p.turn.text}]}]}})});
 const r=await c.accept(input('1','爸爸，我想问问月亮'));assert.equal(r.participants[0].name,null);assert.equal(r.participants[0].role,'child');
});

test('quarantined identity cannot resolve a pending exclusive handoff',async()=>{
 let n=0;const c=new SpeakerConversation({evaluate:async p=>({decision:++n===1?{reply:'等他开口。',pendingFocus:{name:'十二',mode:'exclusive'},policyEvidence:{turnId:p.turn.id,quote:p.turn.text}}:{reply:'你好。',nextMode:'exclusive',nextTargetId:'speaker:1',policyChangeRequested:true,identityUpdates:[{speakerId:'speaker:1',name:'十二',role:'child',certainty:'stated',source:'self-introduction',evidence:[{turnId:p.turn.id,quote:'我并没有说过的名字'}]}]}})});
 await c.accept(input('0','等十二开口以后，只和十二聊天'));const r=await c.accept(input('1','你好'));
 assert.equal(r.mode,'auto');assert.equal(c.participants.find(p=>p.id==='speaker:1').name,null);assert.equal(r.identityWarnings.length,1);
});
