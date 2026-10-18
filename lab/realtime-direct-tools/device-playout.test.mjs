import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDevicePlayout} from './device-playout.mjs';
function fixture(){let at=0;const sent=[],events=[];const p=createDevicePlayout({now:()=>at,sendAudio:b=>sent.push(Buffer.from(b)),sendEvent:e=>events.push(e),tickMs:1000000});return {p,sent,events,advance:ms=>{at+=ms;p.pump();}};}
test('a long answer has a bounded wire lead while preserving every sample',t=>{
 const f=fixture();t.after(()=>f.p.dispose());const pcm=Buffer.alloc(48000*30);for(let i=0;i<pcm.length;i++)pcm[i]=i%251;
 assert(f.p.push(pcm));assert.equal(Buffer.concat(f.sent).length,480*48);
 for(let i=0;i<1500;i++)f.advance(20);
 assert.deepEqual(Buffer.concat(f.sent),pcm);assert.equal(f.p.pendingBytes(),0);
});
test('an interruption discards unsent PCM without waiting for the old answer',t=>{
 const f=fixture();t.after(()=>f.p.dispose());f.p.push(Buffer.alloc(48000*20,1));f.p.event({type:'end.after-playback',callId:'old'});
 const sent=f.sent.length;f.p.clear();f.p.push(Buffer.alloc(960,2));f.advance(10000);
 assert(f.sent.slice(sent).every(b=>b.every(x=>x===2)));assert(!f.events.some(e=>e.callId==='old'));
});
test('ending and source metadata stay ordered with their actual PCM',t=>{
 let at=0;const timeline=[];const p=createDevicePlayout({now:()=>at,sendAudio:b=>timeline.push({audio:b.length}),sendEvent:e=>timeline.push(e),tickMs:1000000});t.after(()=>p.dispose());
 p.push(Buffer.alloc(48000),{backendSpeech:true});p.event({type:'audio.done'});p.event({type:'end.after-playback',callId:'end'});
 assert.deepEqual(timeline[0],{type:'audio.source',backendSpeech:true});assert(!timeline.some(x=>x.type==='audio.done'));
 at=1000;p.pump();const done=timeline.findIndex(x=>x.type==='audio.done');assert(done>0);assert(timeline.slice(done+1).every(x=>!x.audio));assert.equal(timeline.at(-1).callId,'end');
});
test('a stalled socket and queued audio share one memory limit',t=>{
 const p=createDevicePlayout({sendAudio:()=>{},sendEvent:()=>{},bufferedBytes:()=>900,maxBytes:1000});t.after(()=>p.dispose());assert.equal(p.push(Buffer.alloc(102)),false);
});

test('a later turn cannot spend old silence as an oversized sending window',t=>{
 const f=fixture();t.after(()=>f.p.dispose());f.p.push(Buffer.alloc(960));f.advance(60000);const before=f.sent.reduce((n,b)=>n+b.length,0);
 f.p.push(Buffer.alloc(48000*20));assert.equal(f.sent.reduce((n,b)=>n+b.length,0)-before,480*48);
});

test('socket backpressure cannot grow the wire queue beyond the short lead',t=>{
 let pending=24000;const sent=[];const p=createDevicePlayout({sendAudio:b=>sent.push(b),sendEvent:()=>{},bufferedBytes:()=>pending,tickMs:1000000});t.after(()=>p.dispose());
 assert(p.push(Buffer.alloc(48000)));assert.equal(sent.length,0);pending=0;p.pump();assert.equal(sent.reduce((n,b)=>n+b.length,0),480*48);
});

test('a minutes-long answer queues whole; only a speaker that stops reading counts as stalled',t=>{
 let at=0,pending=0;const sent=[];const p=createDevicePlayout({now:()=>at,sendAudio:b=>sent.push(b.length),sendEvent:()=>{},bufferedBytes:()=>pending,tickMs:1000000});t.after(()=>p.dispose());
 // Two minutes of generated speech arrives in a few seconds of model time.
 for(let i=0;i<120;i++)assert(p.push(Buffer.alloc(48000)),`second ${i} queued`);
 for(let i=0;i<500;i++){at+=20;p.pump();}
 assert.equal(p.stalledMs(),0,'paced playback is progress, not a stall');
 pending=1e6;at+=30000;p.pump();assert.equal(p.stalledMs(),30000);
 pending=0;p.pump();assert.equal(p.stalledMs(),0);
 p.clear();assert.equal(p.stalledMs(),0);
});
