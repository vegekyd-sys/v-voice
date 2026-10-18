import test from 'node:test';import assert from 'node:assert/strict';
import {SpeakerRouter,nameCandidates,nativeSpeakerContext,routingQuestions} from './decision.mjs';
import {AudioWindow,pcm16to24} from './service.mjs';
const evaluator=select=>async(state,questions)=>({model:'fixture',answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,q.type==='noul'?{type:'noul',noul:select(id,state,q)??1}:{type:'choice',choice:select(id,state,q)??(id.startsWith('role_')?'unknown':id==='action'?'respond':id==='audience'?'to_'+((1<<state.participants.length)-1):'keep')}]))});
const say=(c,speakerId,text)=>c.accept({speakerId,text,startMs:0,endMs:1000});
test('only selects actions and source names; it never generates spoken text',async()=>{
  const c=new SpeakerRouter({evaluate:evaluator((id,s)=>id==='name_0'&&s.turn.text.includes('我叫天意')?'n_0':undefined)});
  const r=await say(c,'0','V，我叫天意。请介绍一下你自己。');assert.equal(r.participants[0].name,'天意');assert.equal(r.participants[0].certainty,'stated');assert.equal(r.shouldRespond,true);assert.equal(Object.hasOwn(r,'reply'),false);assert.match(nativeSpeakerContext(r),/天意/);
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
  const names=nameCandidates([{id:'1',speakerId:'speaker:0',text:'我是天意，是十二的爸爸。'}]);assert.ok(names.some(c=>c.name==='天意'&&c.source==='self'));assert.ok(names.some(c=>c.name==='十二'&&c.source==='context'));
});
test('temporary audio clips preserve exact samples and enforce bounded retention',()=>{
  const w=new AudioWindow(100);const pcm=Buffer.alloc(3200);for(let i=0;i<1600;i++)pcm.writeInt16LE(i,i*2);w.append(pcm);assert.deepEqual(w.slice(20,60),pcm.subarray(640,1920));w.append(pcm);w.append(pcm);assert.throws(()=>w.slice(0,50),/窗口/);assert.equal(pcm16to24(pcm).length,4800);
});
test('anonymous turns never send an invalid one-option name choice to the provider',()=>{
  const q=routingQuestions({participants:[{id:'speaker:0',label:'Speaker A'}],nameCandidates:[]});assert.equal(q.name_0,undefined);for(const value of Object.values(q))if(value.type==='choice')assert.ok(Object.keys(value.criteria).length>=2);
});
test('a verified focus request is acknowledged even when quiet refers to the other people',async()=>{
 const c=new SpeakerRouter({evaluate:evaluator((id,s)=>id==='action'&&s.turn.text.includes('只跟')?'quiet':id==='constraint'&&s.turn.text.includes('只跟')?'only_speaker:1':undefined)});await say(c,'0','我是天意。');await say(c,'1','我是十二。');const r=await say(c,'0','V，接下来只跟十二聊，其他人说话不用回答。');assert.equal(r.mode,'exclusive');assert.equal(r.shouldRespond,true);assert.deepEqual(r.addresseeIds,['speaker:1']);
});
test('uncertain quiet in open conversation can respond, confident bystander silence is preserved',async()=>{
 const evaluate=async(s,q)=>{const r=await evaluator((id)=>id==='action'?'quiet':id==='audience'?'to_1':undefined)(s,q);r.answers.action.probabilities={quiet:s.turn.text==='旁聊'?.98:.65,respond:s.turn.text==='旁聊'?.02:.35};return r;};
 const c=new SpeakerRouter({evaluate});assert.equal((await say(c,'0','天空为什么是蓝色的？')).shouldRespond,true);assert.equal((await say(c,'0','旁聊')).shouldRespond,false);
});
test('a high confidence direct request overrules contradictory quiet without opening exclusive admission',async()=>{
 const evaluate=async(s,q)=>{const r=await evaluator(id=>id==='action'?'quiet':undefined)(s,q);r.answers.action.probabilities={quiet:.92,respond:.08};r.answers.addressed={type:'choice',choice:'v',probabilities:{v:.98,other:.02}};return r;};const c=new SpeakerRouter({evaluate});const r=await say(c,'0','V，你能帮我拿东西吗？');assert.equal(r.shouldRespond,true);assert.equal(r.admission.reason,'direct-request');
});
