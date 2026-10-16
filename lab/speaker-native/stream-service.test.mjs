import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamingSpeakerRoutingService,TurnOutputGate,speakerProfile} from './stream-service.mjs';

const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Test deadline');};
const answers=(questions,{action='respond',child=false}={})=>({answers:Object.fromEntries(Object.entries(questions).map(([id])=>[id,{type:'choice',choice:id==='action'?action:id.startsWith('role_')?(child?'child':'unknown'):id.startsWith('name_')&&child?'n_0':'keep'}]))});
const voice=()=>{const pcm=Buffer.alloc(57600);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(6000,i);return pcm;};
async function fixture(t,{evaluate,prepare=async()=>{}}={}){
  let asr;const events=[],forwarded=[],profiles=[];
  const service=createStreamingSpeakerRoutingService({env:{},embedding:{ready:Promise.resolve(),compute:async()=>({embedding:[1,0],inferenceMs:1})},evaluate:evaluate??(async(_s,q)=>answers(q)),createAsr:o=>{asr=o;return {connect:async()=>{},append(){},close(){}};}});
  service.reserve('call',{model:'seeduplex'});t.after(()=>service.dispose());
  await service.bind('call',{prepare:async(...args)=>{profiles.push(args);await prepare(...args);},forward:b=>forwarded.push(b),cancel(){},invalidate(){}},e=>events.push(e));
  service.audio('call',voice());
  const emit=(text='V，天空为什么是蓝色的？',start=0,end=1100)=>asr.onResult({body:{result:{utterances:[{definite:true,start_time:start,end_time:end,text,speaker_id:'wrong-cloud-id'}]}}});
  return {service,events,forwarded,profiles,emit};
}

test('pending native audio, captions and tools are discarded together; stale admission cannot reopen them',()=>{
  const gate=new TurnOutputGate(),effects=[];gate.begin('old');gate.dispatch(()=>effects.push('audio'),20);gate.dispatch(()=>effects.push('tool'));gate.begin('new');assert.equal(gate.allow('old'),false);gate.dispatch(()=>effects.push('caption'));gate.deny('new');assert.deepEqual(effects,[]);assert.equal(gate.allow('new'),false);
});
test('PCM is held until the native persona is actually prepared',async t=>{
  let resolve;const f=await fixture(t,{prepare:()=>new Promise(r=>{resolve=r;})});await wait(()=>resolve);await new Promise(r=>setTimeout(r,30));assert.equal(f.forwarded.length,0);resolve();await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));await wait(()=>f.forwarded.some(b=>b.some(x=>x!==0)));
});
test('semantic silence never releases speculative speech or invokes its tool',async t=>{
  let decide;const f=await fixture(t,{evaluate:(_s,q)=>new Promise(r=>{decide=()=>r(answers(q,{action:'quiet'}));})});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  const effects=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('audio'));f.service.dispatch('call','tool',{},()=>effects.push('tool'));f.emit();await wait(()=>decide);assert.deepEqual(effects,[]);decide();await wait(()=>f.events.some(e=>e.type==='speaker.decision'));f.service.dispatch('call','tool',{},()=>effects.push('late tool'));assert.deepEqual(effects,[]);
});
test('rejecting speculative audio does not leave the next utterance waiting behind a busy phantom reply',async t=>{
  const f=await fixture(t,{evaluate:async(_s,q)=>answers(q,{action:'quiet'})});
  await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  const effects=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('old'));
  f.emit('十二，把杯子递给我。');await wait(()=>f.events.some(e=>e.type==='speaker.decision'));
  // A cancellation can race an already-in-flight native audio packet.
  f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('late'));
  f.service.audio('call',Buffer.alloc(24000));f.service.audio('call',voice());
  await wait(()=>f.events.filter(e=>e.type==='speaker.stream-start').length===2);
  assert.deepEqual(effects,[]);assert.equal(f.profiles.length,2);
});
test('a matching decision releases the already-streamed answer without whole-utterance replay',async t=>{
  const f=await fixture(t);await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));const effects=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('audio'));f.service.dispatch('call','transcript',{},()=>effects.push('caption'));f.emit();await wait(()=>f.events.some(e=>e.type==='speaker.stream-accepted'));assert.deepEqual(effects,['audio','caption']);assert.equal(f.profiles.length,1);assert.equal(f.events.find(e=>e.type==='speaker.utterance').turn.speakerId,'local0');
});
test('late discovery of a child discards the anonymous answer and prepares the child before fallback input',async t=>{
  const f=await fixture(t,{evaluate:async(_s,q)=>answers(q,{child:true})});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));let oldAnswer=false;f.service.dispatch('call','audio',Buffer.alloc(10),()=>{oldAnswer=true;});f.emit('我叫十二，是个孩子。');await wait(()=>f.profiles.length===2);assert.equal(oldAnswer,false);assert.match(f.profiles[1][0],/十二/);assert.match(f.profiles[1][0],/child/);assert.ok(f.events.some(e=>e.type==='speaker.stream-fallback'));
});
test('closing during persona preparation prevents all old input and side effects',async t=>{
  let resolve;const f=await fixture(t,{prepare:()=>new Promise(r=>{resolve=r;})});await wait(()=>resolve);f.service.close('call');resolve();await new Promise(r=>setTimeout(r,30));assert.equal(f.forwarded.length,0);assert.equal(f.events.some(e=>e.type==='speaker.stream-start'),false);
});
test('a failed decision discards that turn and the same call can admit a later utterance',async t=>{
  let calls=0;
  const f=await fixture(t,{evaluate:async(_s,q)=>{if(++calls===1)throw Object.assign(Error('timeout'),{name:'TimeoutError'});return answers(q);}});
  await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  const effects=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('rejected'));
  f.emit();await wait(()=>f.events.some(e=>e.reason==='decision-timeout'));
  assert.equal(f.service.has('call'),true);assert.deepEqual(effects,[]);
  f.service.audio('call',Buffer.alloc(24000));f.service.audio('call',voice());
  f.emit('V，请再回答一次。',1800,2800);
  await wait(()=>f.events.some(e=>e.type==='speaker.decision'));
  await wait(()=>f.profiles.length>=2);
  f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('accepted'));
  assert.deepEqual(effects,['accepted']);assert.equal(calls,2);
});
test('ordinary focus changes do not restart an unchanged recipient; child role changes do',()=>{
  const p={id:'speaker:local0',name:'十二',role:'unknown',certainty:'stated'},base={speakerId:p.id,participants:[p],addresseeIds:[p.id],mode:'auto'};
  assert.equal(speakerProfile({...base,targetId:'a'}).key,speakerProfile({...base,targetId:'b'}).key);
  assert.notEqual(speakerProfile(base).key,speakerProfile({...base,participants:[{...p,role:'child'}]}).key);
});
