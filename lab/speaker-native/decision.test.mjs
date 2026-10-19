import test from 'node:test';import assert from 'node:assert/strict';
import {SpeakerRouter,nameCandidates,nativeSpeakerContext,routingQuestions} from './decision.mjs';
import {AudioWindow,pcm16to24} from './service.mjs';
const evaluator=select=>async(state,questions)=>({model:'fixture',answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,q.type==='noul'?{type:'noul',noul:select(id,state,q)??0}:{type:'choice',choice:select(id,state,q)??(id.startsWith('role_')?'unknown':id==='endIntent'?'continue':id==='action'?'respond':id==='audience'?'to_'+((1<<state.participants.length)-1):'keep')}]))});
const say=(c,speakerId,text)=>c.accept({speakerId,text,startMs:0,endMs:1000});
test('only selects actions and source names; it never generates spoken text',async()=>{
  const c=new SpeakerRouter({evaluate:evaluator((id,s)=>id==='name_0'&&s.turn.text.includes('我叫天懿')?'n_0':undefined)});
  const r=await say(c,'0','V，我叫天懿。请介绍一下你自己。');assert.equal(r.participants[0].name,'天懿');assert.equal(r.participants[0].certainty,'stated');assert.equal(r.shouldRespond,true);assert.equal(Object.hasOwn(r,'reply'),false);assert.match(nativeSpeakerContext(r),/天懿/);
});
test('model silence does not force a reply and model can select both people',async()=>{
  const c=new SpeakerRouter({evaluate:evaluator((id,s)=>id==='action'?(s.turn.text==='旁聊'?'quiet':'respond'):undefined)});
  await say(c,'0','你好');const quiet=await say(c,'1','旁聊');assert.equal(quiet.shouldRespond,false);assert.deepEqual(quiet.addresseeIds,[]);
  assert.deepEqual((await say(c,'1','分别回答我们')).addresseeIds,['speaker:0','speaker:1']);
});
test('exclusive handoff requires a real user instruction, and other voices stay before the model',async()=>{
  let calls=0;const e=evaluator((id,s)=>id==='constraint'&&s.participants.length===2?'only_speaker:1':undefined);
  const c=new SpeakerRouter({evaluate:async(...args)=>{calls++;return e(...args);}});
  await say(c,'0','你好');await say(c,'1','我是十二');assert.equal(c.mode,'auto');
  await say(c,'0','只跟十二聊');assert.equal(c.mode,'exclusive');assert.equal(c.targetId,'speaker:1');const before=calls;
  assert.equal((await say(c,'0','我在旁边说话')).status,'withheld');assert.equal(calls,before);
});
test('stale decisions and invalid candidate values cannot forward audio',async()=>{
  let done;const c=new SpeakerRouter({evaluate:()=>new Promise(resolve=>{done=resolve;})});const pending=say(c,'0','你好');c.invalidate();done({answers:{}});await assert.rejects(pending,/取消/);
  const bad=new SpeakerRouter({evaluate:evaluator(id=>id==='action'?'unknown-person':undefined)});await assert.rejects(say(bad,'0','你好'),/无效/);
});
test('a child name mentioned by the father never becomes the fathers stated self-introduction',async()=>{
  const names=nameCandidates([{id:'1',speakerId:'speaker:0',text:'我是天懿，是十二的爸爸。'}]);assert.ok(names.some(c=>c.name==='天懿'&&c.source==='self'));assert.ok(names.some(c=>c.name==='十二'&&c.source==='context'));
});
test('temporary audio clips preserve exact samples and enforce bounded retention',()=>{
  const w=new AudioWindow(100);const pcm=Buffer.alloc(3200);for(let i=0;i<1600;i++)pcm.writeInt16LE(i,i*2);w.append(pcm);assert.deepEqual(w.slice(20,60),pcm.subarray(640,1920));w.append(pcm);w.append(pcm);assert.throws(()=>w.slice(0,50),/窗口/);assert.equal(pcm16to24(pcm).length,4800);
});
test('anonymous turns never send an invalid one-option name choice to the provider',()=>{
  const q=routingQuestions({participants:[{id:'speaker:0',label:'Speaker A'}],nameCandidates:[]});assert.equal(q.name_0,undefined);for(const value of Object.values(q))if(value.type==='choice')assert.ok(Object.keys(value.criteria).length>=2);
});
test('a verified focus request is acknowledged even when quiet refers to the other people',async()=>{
 const c=new SpeakerRouter({evaluate:evaluator((id,s)=>id==='action'&&s.turn.text.includes('只跟')?'quiet':id==='constraint'&&s.turn.text.includes('只跟')?'only_speaker:1':undefined)});await say(c,'0','我是天懿。');await say(c,'1','我是十二。');const r=await say(c,'0','V，接下来只跟十二聊，其他人说话不用回答。');assert.equal(r.mode,'exclusive');assert.equal(r.shouldRespond,true);assert.deepEqual(r.addresseeIds,['speaker:1']);
});
test('uncertain quiet in open conversation can respond, confident bystander silence is preserved',async()=>{
 const evaluate=async(s,q)=>{const r=await evaluator((id)=>id==='action'?'quiet':id==='audience'?'to_1':undefined)(s,q);r.answers.action.probabilities={quiet:s.turn.text==='旁聊'?.98:.65,respond:s.turn.text==='旁聊'?.02:.35};return r;};
 const c=new SpeakerRouter({evaluate});assert.equal((await say(c,'0','天空为什么是蓝色的？')).shouldRespond,true);assert.equal((await say(c,'0','旁聊')).shouldRespond,false);
});
test('a high confidence direct request overrules contradictory quiet without opening exclusive admission',async()=>{
 const evaluate=async(s,q)=>{const r=await evaluator(id=>id==='action'?'quiet':undefined)(s,q);r.answers.action.probabilities={quiet:.92,respond:.08};r.answers.addressed={type:'choice',choice:'v',probabilities:{v:.98,other:.02}};return r;};const c=new SpeakerRouter({evaluate});const r=await say(c,'0','V，你能帮我拿东西吗？');assert.equal(r.shouldRespond,true);assert.equal(r.admission.reason,'direct-request');
});

test('ending requires both an explicit end choice and confidence that the latest speech addresses V',async()=>{
 for(const [probability,address,choice] of [[0,1,'end'],[.89,1,'end'],[.9,.8,'end'],[1,1,'end'],[NaN,1,'end'],[.99,.79,'end'],[1,1,'other']]){
  const c=new SpeakerRouter({evaluate:async(s,q)=>{const r=await evaluator(id=>id==='action'?'quiet':undefined)(s,q);r.answers.endIntent={type:'choice',choice,probabilities:{end:probability}};r.answers.addressed={type:'choice',choice:'v',probabilities:{v:address}};return r;}});const r=await say(c,'0','好，那就这样吧，拜拜。');assert.equal(r.endCall,probability>=.9&&address>=.8&&choice==='end');
 }
});
test('a non-target farewell cannot end an exclusive call',async()=>{
 const c=new SpeakerRouter({evaluate:evaluator((id,s)=>id==='endConfidence'?0:id==='constraint'&&s.turn.text.includes('只跟')?'only_speaker:1':undefined)});await say(c,'0','你好');await say(c,'1','我是十二');await say(c,'0','只跟十二聊');const r=await say(c,'0','拜拜');assert.equal(r.status,'withheld');assert.equal(r.endCall,undefined);
});
test('uncertain farewell gets current-utterance confirmation without passing old focus or background history',async()=>{
 const calls=[];const evaluate=async(s,q)=>{calls.push(s);if(s.request)return {answers:{endIntent:{type:'choice',choice:'end',probabilities:{end:.99}},addressed:{type:'choice',choice:'v',probabilities:{v:.99}}},usage:{cost:.01}};const r=await evaluator(id=>id==='action'?'quiet':undefined)(s,q);r.answers.endIntent={type:'choice',choice:'end',probabilities:{end:.71}};r.answers.addressed={type:'choice',choice:'v',probabilities:{v:.81}};r.usage={cost:.02};return r;};const c=new SpeakerRouter({evaluate});c.history=[{role:'assistant',text:'后台继续，现在跟孩子聊天。'}];const r=await say(c,'0','后台继续做，我们先挂电话，拜拜。');assert.equal(r.endCall,true);assert.equal(r.endVerification,'confirmed');assert.equal(r.usage.cost,.03);assert.equal(calls.length,2);assert.equal(calls[1].history,undefined);assert.equal(calls[1].activeTargetId,undefined);
});
test('unavailable end confirmation stays open and a non-ending turn has no extra request',async()=>{
 let calls=0;const c=new SpeakerRouter({evaluate:async(s,q)=>{calls++;if(s.request)throw Error('Confirmation unavailable');const r=await evaluator(()=>undefined)(s,q);r.answers.endIntent={type:'choice',choice:'end',probabilities:{end:.7}};return r;}});const r=await say(c,'0','拜拜。');assert.equal(r.endCall,false);assert.equal(r.endVerification,'unavailable');assert.equal(calls,2);
 let ordinary=0;await say(new SpeakerRouter({evaluate:async(s,q)=>{ordinary++;return evaluator(()=>undefined)(s,q);}}),'0','继续聊天');assert.equal(ordinary,1);
});
test('a recycled voice leaves the roster and a new voice can join with a fresh label',async()=>{
  const c=new SpeakerRouter({evaluate:evaluator(()=>undefined)});
  for(const id of ['0','1','2','3','4'])await say(c,id,'你好');
  await assert.rejects(say(c,'5','你好'),/上限/);
  assert.equal(c.forget('speaker:2'),true);
  const r=await say(c,'5','你好');assert.equal(r.participants.length,5);assert.equal(r.participants.at(-1).label,'Speaker F');
  assert.equal(new Set(r.participants.map(p=>p.label)).size,5);
});
test('an exclusive focus target is never forgotten',async()=>{
  const e=evaluator((id,s)=>id==='constraint'&&s.participants.length===2?'only_speaker:1':undefined);
  const c=new SpeakerRouter({evaluate:e});await say(c,'0','你好');await say(c,'1','我是十二');await say(c,'0','只跟十二聊');
  assert.equal(c.forget('speaker:1'),false);assert.equal(c.forget('speaker:0'),true);
});
