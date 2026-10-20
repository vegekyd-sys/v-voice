import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamingSpeakerRoutingService,TurnOutputGate,speakerProfile,echoOf} from './stream-service.mjs';

const wait=async predicate=>{for(let i=0;i<600;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Test deadline');};
const answers=(questions,{action='respond',child=false}={})=>({answers:Object.fromEntries(Object.entries(questions).map(([id])=>[id,{type:'choice',choice:id==='action'?action:id.startsWith('role_')?(child?'child':'unknown'):id.startsWith('name_')&&child?'n_0':'keep'}]))});
const voice=()=>{const pcm=Buffer.alloc(57600);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(6000,i);return pcm;};
async function fixture(t,{evaluate,prepare=async()=>{},limits,reserve={},initialAudio=true}={}){
  let asr;const events=[],forwarded=[],profiles=[],clarifications=[],endings=[],rejectedEnds=[],greetings=[];
  const service=createStreamingSpeakerRoutingService({env:{},embedding:{ready:Promise.resolve(),compute:async()=>({embedding:[1,0],inferenceMs:1})},evaluate:evaluate??(async(_s,q)=>answers(q)),limits,createAsr:o=>{asr=o;return {connect:async()=>{},append(){},close(){}};}});
  service.reserve('call',{model:'seeduplex',...reserve});t.after(()=>service.dispose());
  await service.bind('call',{prepare:async(...args)=>{profiles.push(args);await prepare(...args);},forward:b=>forwarded.push(b),cancel(){},invalidate(){},greet:()=>greetings.push(true),clarify:text=>clarifications.push(text),end:value=>endings.push(value),cancelEnd:()=>endings.push({revoked:true}),rejectNativeEnd:call=>rejectedEnds.push(call)},e=>events.push(e));
  if(initialAudio)service.audio('call',reserve.inputSampleRate===16000?voice().subarray(0,38400):voice());
  const emit=(text='V，天空为什么是蓝色的？',start=0,end=1100)=>asr.onResult({body:{result:{utterances:[{definite:true,start_time:start,end_time:end,text,speaker_id:'wrong-cloud-id',...(start===null?{start_time:undefined}:{})}]}}});
  return {service,events,forwarded,profiles,emit,clarifications,endings,rejectedEnds,greetings,disconnectAsr:()=>asr.onClose()};
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

test('decision arriving during the same persona connection reuses preparation without replay',async t=>{
 let resolve;const f=await fixture(t,{prepare:()=>new Promise(r=>{resolve=r;})});await wait(()=>resolve);f.emit();await wait(()=>f.events.some(e=>e.type==='speaker.decision'));assert.equal(f.profiles.length,1);resolve();await wait(()=>f.events.some(e=>e.type==='speaker.stream-accepted'));assert.equal(f.profiles.length,1);
});
test('decision budget belongs to each call rather than the whole server lifetime',async t=>{
 const f=await fixture(t,{limits:{decisionCalls:1}});f.emit();await wait(()=>f.events.some(e=>e.type==='speaker.decision'));f.service.close('call');f.service.reserve('call',{model:'seeduplex'});await f.service.bind('call',{prepare:async()=>{},forward(){},cancel(){},invalidate(){},context(){}},e=>f.events.push(e));f.service.audio('call',voice());f.emit();await wait(()=>f.events.filter(e=>e.type==='speaker.decision').length===2);assert.equal(f.events.some(e=>e.reason==='decision-unavailable'),false);
});
test('unidentifiable short speech produces native clarification rather than an immortal pending turn',async t=>{
 const f=await fixture(t);const before=f.profiles.length;f.emit('什么？',1300,1500);await wait(()=>f.events.some(e=>e.type==='speaker.recovery'));assert.ok(f.profiles.length>before);assert.match(f.profiles.at(-1)[0],/不猜身份/);await wait(()=>f.clarifications.length===1);assert.match(f.clarifications[0],/没听清/);f.emit('什么？',1300,1500);assert.equal(f.events.filter(e=>e.type==='speaker.recovery').length,1);
});
test('a delayed older decision never cancels or releases the newer final utterance',async t=>{
 let resolve,calls=0;const f=await fixture(t,{evaluate:async(_s,q)=>{if(++calls===1)await new Promise(r=>{resolve=r;});return answers(q);}});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));f.emit();await wait(()=>resolve);f.service.audio('call',Buffer.alloc(24000));f.service.audio('call',voice());f.emit('V，给我讲故事。',1800,2800);resolve();await wait(()=>f.events.some(e=>e.type==='speaker.superseded'));await wait(()=>f.events.filter(e=>e.type==='speaker.decision').length===2);assert.ok(f.events.some(e=>e.type==='speaker.stream-accepted'||e.type==='speaker.stream-fallback'));
});
test('an admitted native turn with no audio or tool has a bounded spoken recovery',async t=>{
 const f=await fixture(t,{limits:{responseMs:30}});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));f.emit();await wait(()=>f.events.some(e=>e.type==='speaker.stream-accepted'));
 f.service.audio('call',Buffer.alloc(48000));await wait(()=>f.events.some(e=>e.type==='speaker.native-input-complete'));await wait(()=>f.events.some(e=>e.type==='speaker.recovery'&&e.reason==='native-no-output'));await wait(()=>f.clarifications.length===1);
});

test('a first utterance whose zero start_time is omitted still reaches speaker decision and native admission',async t=>{
 const f=await fixture(t);await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));f.emit('V，听得到吗？',null,1100);await wait(()=>f.events.some(e=>e.type==='speaker.decision'));assert.equal(f.events.find(e=>e.type==='speaker.utterance').turn.startMs,0);
});

test('ASR reconnect retains the live call and restores absolute timestamps instead of leaving an open dead uploader',async t=>{
 const f=await fixture(t);f.disconnectAsr();assert.equal(f.service.has('call'),true);await wait(()=>f.events.some(e=>e.type==='speaker.asr-recovered'));f.service.audio('call',Buffer.alloc(24000));f.service.audio('call',voice());f.emit('V，继续聊。',0,1100);await wait(()=>f.events.some(e=>e.type==='speaker.decision'));assert.equal(f.events.find(e=>e.type==='speaker.utterance').turn.startMs,800);assert.equal(f.events.some(e=>e.type==='error'),false);
});

test('an accepted farewell speaks through native control without replaying the user audio; new speech revokes it',async t=>{
 const f=await fixture(t,{evaluate:async(_s,q)=>{const r=answers(q,{action:'quiet'});r.answers.endIntent={type:'choice',choice:'end',probabilities:{end:1}};r.answers.addressed={type:'choice',choice:'v',probabilities:{v:1}};return r;}});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));f.emit('好，就这样吧，拜拜。');await wait(()=>f.endings.length===1);assert.equal(f.endings[0].turnId,'sp1');assert(f.profiles.some(p=>p[1]==='speaker-end:sp1'));assert.equal(f.events.some(e=>e.type==='speaker.stream-accepted'),false);
 f.service.audio('call',Buffer.alloc(24000));f.service.audio('call',voice());assert.equal(f.endings.at(-1).revoked,true);assert(f.events.some(e=>e.type==='speaker.end-revoked'));
});
test('continued speech during farewell connection preparation prevents ending the ongoing question',async t=>{
 let finish,preparing=false;const f=await fixture(t,{evaluate:async(_s,q)=>{const r=answers(q);r.answers.endIntent={type:'choice',choice:'end',probabilities:{end:1}};r.answers.addressed={type:'choice',choice:'v',probabilities:{v:1}};return r;},prepare:async(_instructions,key)=>{if(key.startsWith('speaker-end:')){preparing=true;await new Promise(r=>finish=r);}}});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));f.emit('拜拜。');await wait(()=>preparing);f.service.audio('call',voice());finish();await wait(()=>f.events.some(e=>e.type==='speaker.end-revoked'));assert.equal(f.endings.length,0);
});
test('missing farewell audio revokes ending and keeps the call available for retry',async t=>{
 const f=await fixture(t,{limits:{farewellMs:30},evaluate:async(_s,q)=>{const r=answers(q);r.answers.endIntent={type:'choice',choice:'end',probabilities:{end:1}};r.answers.addressed={type:'choice',choice:'v',probabilities:{v:1}};return r;}});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));f.emit('拜拜。');await wait(()=>f.events.some(e=>e.reason==='farewell-no-audio'));assert.equal(f.service.has('call'),true);assert(f.endings.some(e=>e.revoked));
});
test('repeated ASR disconnects exhaust a bounded retry budget and close routing instead of bypassing it',async t=>{
 const f=await fixture(t);f.disconnectAsr();await wait(()=>f.events.filter(e=>e.type==='speaker.asr-recovered').length===1);f.disconnectAsr();await wait(()=>f.events.filter(e=>e.type==='speaker.asr-recovered').length===2);f.disconnectAsr();await wait(()=>f.events.some(e=>e.type==='error'));assert.equal(f.service.has('call'),false);assert(f.events.some(e=>e.type==='speaker.error'&&e.fatal&&e.reason==='asr-disconnected'));
});
test('call duration expiry closes its route and releases the anonymous roster',async t=>{
 const f=await fixture(t,{limits:{durationMs:40}});await wait(()=>f.events.some(e=>e.type==='error'));assert.equal(f.service.has('call'),false);assert.equal(f.service.snapshot().activeSessions,0);assert(f.events.some(e=>e.type==='speaker.closed'));
});

test('an ordinary admitted reply cannot execute the native models competing end_call',async t=>{
 const f=await fixture(t);await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));let executed=false;f.service.dispatch('call','tool',{name:'end_call',callId:'native-end'},()=>{executed=true;});assert.equal(f.rejectedEnds.length,0);f.emit('谢谢，拜拜。对了，五加六等于几？');await wait(()=>f.rejectedEnds.length===1);assert.equal(executed,false);assert.equal(f.service.has('call'),true);assert(f.events.some(e=>e.type==='speaker.end-withheld'));
});

const device={surface:'speaker',inputSampleRate:16000};
test('a household device streams its 16 kHz uplink to the native model without resampling',async t=>{
  const f=await fixture(t,{reserve:device});await wait(()=>f.forwarded.some(b=>b.some(x=>x!==0)));
  assert.ok(f.forwarded.length>0);assert.ok(f.forwarded.every(b=>b.length===640));
});
test('a phone keeps its 24 kHz native input frames',async t=>{
  const f=await fixture(t);await wait(()=>f.forwarded.some(b=>b.some(x=>x!==0)));assert.ok(f.forwarded.every(b=>b.length===960));
});
test('V own reply heard back through a device microphone is dropped before Decision',async t=>{
  let calls=0;const f=await fixture(t,{reserve:device,evaluate:async(_s,q)=>{calls++;return answers(q);}});
  await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  f.service.assistant('call','天空看起来是蓝色的，是因为瑞利散射，蓝光更容易被空气散射开。');
  const effects=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('speculative'));
  f.emit('蓝光更容易被空气散射开');
  await wait(()=>f.events.some(e=>e.type==='speaker.echo-dropped'));
  assert.equal(calls,0);assert.equal(f.events.some(e=>e.type==='speaker.utterance'),false);assert.deepEqual(effects,[]);
  f.emit('那晚霞为什么是红的？',1200,2000);await wait(()=>f.events.some(e=>e.type==='speaker.decision'));assert.equal(calls,1);
});
test('echo matching tolerates ASR slips but keeps real replies to V',()=>{
  const said=['我给你讲一个小兔子找胡萝卜的故事'];
  assert.equal(echoOf('小兔子找胡萝卜的故事',said),true);
  assert.equal(echoOf('小兔子找胡箩卜的故事',said),true);
  assert.equal(echoOf('我想听小猪佩奇的故事',said),false);
  assert.equal(echoOf('好的',['好的好的']),false);
});
test('a device stays silent on short or unattributable room speech instead of asking to repeat',async t=>{
  const f=await fixture(t,{reserve:device});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  const effects=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('speculative'));
  f.emit('什么？',1300,1500);await wait(()=>f.events.some(e=>e.type==='speaker.recovery-suppressed'));
  assert.equal(f.events.some(e=>e.type==='speaker.recovery'),false);assert.deepEqual(f.clarifications,[]);
  // The speculative input is released, so background results are not held behind it.
  assert.equal(f.service.pending('call'),false);assert.deepEqual(effects,[]);
});
test('an unresolved speculative stream holds host speech only while the room may still be talking',async t=>{
  const f=await fixture(t,{limits:{pendingQuietMs:60}});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  // Mid-utterance: a background result waits.
  assert.equal(f.service.pending('call'),true);
  f.service.audio('call',Buffer.alloc(48000));
  assert.equal(f.service.pending('call'),true);
  // No final ever arrives for this stream; once the room is quiet it stops holding.
  await new Promise(r=>setTimeout(r,90));
  assert.equal(f.service.pending('call'),false);
  assert.equal(await f.service.hostSpeech('call','夜班模式小图已经做好了。'),true);
  assert.deepEqual(f.clarifications,['夜班模式小图已经做好了。']);
});
test('a speculative stream left open by continuous sound stops holding host speech after a bound',async t=>{
  const f=await fixture(t,{limits:{pendingMaxMs:60}});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  assert.equal(f.service.pending('call'),true);
  await new Promise(r=>setTimeout(r,90));f.service.audio('call',voice());
  assert.equal(f.service.pending('call'),false);
});
test('a device parting line passes the gate as host speech without Decision',async t=>{
  let calls=0;const f=await fixture(t,{reserve:device,evaluate:async(_s,q)=>{calls++;return answers(q);}});
  await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  assert.equal(await f.service.hostSpeech('call','你们先聊，需要我再叫我'),true);
  assert.deepEqual(f.clarifications,['你们先聊，需要我再叫我']);
  const effects=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>effects.push('line'));assert.deepEqual(effects,['line']);assert.equal(calls,0);
});
test('device instructions name the host-selected person while keeping the entry identity',async t=>{
  const f=await fixture(t,{reserve:device});
  const text=f.service.initialInstructions('call','你是 V，现在你通过家里的智能音箱和 Tianyi（天懿）本人进行测试；当前设备只开放本人使用');
  assert.match(text,/主机当前指定的人物/);assert.match(text,/账号与工具仍属于原入口/);assert.match(text,/当前设备只开放本人使用/);
});
test('a device call keeps its native path when the voice worker has died',()=>{
  const events=[],service=createStreamingSpeakerRoutingService({env:{},embedding:{ready:Promise.resolve(),closed:true,compute:async()=>{throw Error('closed');}},evaluate:async()=>({}),onAudit:e=>events.push(e),createAsr:()=>({connect:async()=>{},append(){},close(){}})});
  assert.equal(service.reserve('device-call',{model:'seeduplex',...device}),null);assert.equal(events[0].reason,'embedding-closed');
  service.dispose();
});

test('streaming pickup greets exactly once without a caller voiceprint, transcript or decision',async t=>{
 const f=await fixture(t,{initialAudio:false});await f.service.greet('call');await f.service.greet('call');
 assert.equal(f.greetings.length,1);assert.equal(f.profiles.length,1);assert.equal(f.events.some(e=>e.type==='speaker.decision'),false);
 const delivered=[];f.service.dispatch('call','audio',Buffer.alloc(20),()=>delivered.push('audio'));f.service.dispatch('call','tool',{name:'web_search'},()=>delivered.push('tool'));assert.deepEqual(delivered,['audio']);
 f.service.audio('call',voice());await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));f.emit();await wait(()=>f.events.some(e=>e.type==='speaker.stream-accepted'||e.type==='speaker.stream-fallback'));
 assert(f.events.some(e=>e.type==='speaker.greeting-cancelled'));assert.equal(f.service.has('call'),true);
});
test('speech during pickup preparation prevents the late greeting from interrupting the caller',async t=>{
 let release;const f=await fixture(t,{initialAudio:false,prepare:async(_i,key)=>{if(key==='speaker-greeting')await new Promise(r=>release=r);}});
 const work=f.service.greet('call');await wait(()=>release);f.service.audio('call',voice());release();await work;
 await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));assert.equal(f.greetings.length,0);assert.equal(f.service.has('call'),true);
});


test('learning a name releases the original audio without replay, while still waiting for semantic admission',async t=>{
 let admit;const f=await fixture(t,{evaluate:(_s,q)=>new Promise(resolve=>{admit=()=>{const r=answers(q);r.answers.name_0={type:'choice',choice:'n_0'};resolve(r);};})});await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
 const output=[];f.service.dispatch('call','audio',Buffer.alloc(10),()=>output.push('real reply'));f.emit('我叫天懿，三加四等于几？');await wait(()=>admit);assert.deepEqual(output,[]);admit();
 await wait(()=>f.events.some(e=>e.type==='speaker.stream-accepted'));assert.deepEqual(output,['real reply']);assert.equal(f.profiles.length,1);assert.equal(f.events.find(e=>e.type==='speaker.decision').participants[0].name,'天懿');assert.equal(f.events.some(e=>e.type==='speaker.stream-fallback'),false);
});

test('while V is answering or waiting on a lookup, unclear speech never asks to repeat or cancels the answer',async t=>{
  const f=await fixture(t);f.emit();
  await wait(()=>f.events.some(e=>e.type==='speaker.admitted'));
  f.service.dispatch('call','tool',{name:'web_search'},()=>{});
  f.emit('什么？',1300,1500);
  await wait(()=>f.events.some(e=>e.type==='speaker.recovery-suppressed'));
  assert.equal(f.events.some(e=>e.type==='speaker.recovery'),false);assert.deepEqual(f.clarifications,[]);
  f.service.dispatch('call','done',null,()=>{});
  f.emit('嗯？',1600,1800);
  await wait(()=>f.events.filter(e=>e.type==='speaker.recovery-suppressed').length===2);
  assert.deepEqual(f.clarifications,[],'just after V answered, a stray fragment stays quiet');
});

test('with one voice in the call, an unverified sentence is still that person instead of a request to repeat',async t=>{
  let unsure=false,asr;const events=[],clarifications=[];
  const service=createStreamingSpeakerRoutingService({env:{},embedding:{ready:Promise.resolve(),compute:async()=>({embedding:unsure?[0,1]:[1,0],inferenceMs:1})},evaluate:async(_s,q)=>answers(q),createAsr:o=>{asr=o;return {connect:async()=>{},append(){},close(){}};}});
  service.reserve('call',{model:'seeduplex'});t.after(()=>service.dispose());
  await service.bind('call',{prepare:async()=>{},forward(){},cancel(){},invalidate(){},greet(){},clarify:text=>clarifications.push(text)},e=>events.push(e));
  service.audio('call',voice());service.audio('call',Buffer.alloc(48000*3));
  await wait(()=>events.some(e=>e.type==='speaker.identity'));
  unsure=true;
  asr.onResult({body:{result:{utterances:[{definite:true,start_time:2000,end_time:3200,text:'库里能上场吗？'}]}}});
  await wait(()=>events.some(e=>e.type==='speaker.decision'));
  assert.equal(events.find(e=>e.type==='speaker.decision').turn.speakerId,'speaker:local0');
  assert.equal(events.some(e=>e.type==='speaker.recovery'||e.type==='speaker.error'),false);assert.deepEqual(clarifications,[]);
});

test('on a phone, the greeting heard back through the speaker is not taken as the caller',async t=>{
  let calls=0;const f=await fixture(t,{evaluate:async(_s,q)=>{calls++;return answers(q);}});
  await wait(()=>f.events.some(e=>e.type==='speaker.stream-start'));
  f.service.assistant('call','天懿，你好，我是 V，在呢。');
  f.emit('你好，我是V，在呢');
  await wait(()=>f.events.some(e=>e.type==='speaker.echo-dropped'));
  assert.equal(calls,0);assert.equal(f.events.some(e=>e.type==='speaker.utterance'),false);
  f.emit('你好，听得见吗？我想问个问题。',1200,2600);await wait(()=>f.events.some(e=>e.type==='speaker.decision'));assert.equal(calls,1);
});
