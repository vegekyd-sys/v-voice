import test from 'node:test';import assert from 'node:assert/strict';
import {createSpeakerRoutingService} from './service.mjs';
const answer=(questions,action)=>({model:'fixture',answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,q.type==='noul'?{type:'noul',noul:1}:{type:'choice',choice:id==='action'?action:id.startsWith('role_')?'unknown':'keep'}]))});
const utterance={body:{result:{utterances:[{definite:true,speaker_id:0,text:'V，你好。',start_time:0,end_time:800}]}}};
async function setup(t,evaluate){
  let asr;const events=[],forwarded=[],contexts=[];let interrupts=0;
  const service=createSpeakerRoutingService({env:{},evaluate,createAsr:options=>{asr=options;return {connect:async()=>{},append(){},close(){}};}});t.after(()=>service.dispose());
  service.reserve('call',{model:'seeduplex'});await service.bind('call',{forward:b=>forwarded.push(b),context:text=>contexts.push(text),interrupt:()=>interrupts++},e=>events.push(e));
  service.audio('call',Buffer.alloc(48000,1));
  const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('fixture deadline');};
  return {service,events,forwarded,contexts,interrupts:()=>interrupts,emit:()=>asr.onResult(utterance),wait};
}
test('silence withholds the actual PCM and leaves existing native speech untouched',async t=>{
  const f=await setup(t,async(_s,q)=>answer(q,'quiet'));f.emit();await f.wait(()=>f.events.some(e=>e.type==='speaker.decision'));await new Promise(r=>setTimeout(r,45));assert(f.forwarded.length>0);assert(f.forwarded.every(b=>b.every(v=>v===0)));assert.equal(f.contexts.length,0);assert.equal(f.interrupts(),0);
});
test('an allowed turn injects context before forwarding original audio, without generated reply text',async t=>{
  const f=await setup(t,async(_s,q)=>answer(q,'respond'));f.emit();await f.wait(()=>f.forwarded.length>0);assert.equal(f.contexts.length,1);assert.match(f.contexts[0],/V，你好/);assert.equal(f.interrupts(),1);assert.ok(f.forwarded[0].some(v=>v!==0));assert.ok(f.events.some(e=>e.type==='speaker.replay-start'));f.service.close('call');
});
test('a closed call discards an in-flight decision and can never forward its old PCM',async t=>{
  let resolve;const f=await setup(t,(_s,q)=>new Promise(r=>{resolve=()=>r(answer(q,'respond'));}));f.emit();await f.wait(()=>Boolean(resolve));f.service.close('call');resolve();await new Promise(r=>setTimeout(r,10));assert(f.forwarded.every(b=>b.every(v=>v===0)));assert.equal(f.contexts.length,0);assert.equal(f.interrupts(),0);
});
