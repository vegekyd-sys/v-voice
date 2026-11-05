import test from 'node:test';
import assert from 'node:assert/strict';
import {createBufferedPcmSpeaker} from './relay-audio.mjs';
function fixture(t){
 t.mock.timers.enable({apis:['setInterval']});const sources=[];let last;
 const c={currentTime:0,state:'running',createGain(){return{gain:{value:1},connect(){},disconnect(){}};},createBuffer(n,len,rate){const samples=new Float32Array(len);return{length:len,rate,samples,getChannelData(){return samples;}};},createBufferSource(){const s={connect(){},disconnect(){},start(at){this.at=at;},stop(){this.stoppedAt=c.currentTime;}};sources.push(s);return s;}};
 const s=createBufferedPcmSpeaker(c);s.port.onmessage=e=>last=e.data;
 const send=e=>s.port.postMessage({epoch:0,...e});const tick=time=>{c.currentTime=time;t.mock.timers.tick(20);return last;};
 return{c,s,sources,send,tick};
}
test('native buffer scheduling pauses mid-packet and resumes each unplayed sample once',t=>{
 const f=fixture(t),pcm=Int16Array.from({length:7200},(_,i)=>i-3600);f.send({type:'audio',buffer:pcm.buffer});f.send({type:'done'});
 f.tick(0);const initial=f.sources[0];assert.equal(initial.at,.02);assert.equal(initial.buffer.samples[0],-3600/32768);
 const snapshot=f.tick(.07);assert.equal(snapshot.consumed,1200);
 f.send({type:'pause',paused:true});assert.equal(initial.stoppedAt,.07);const n=f.sources.length;
 f.tick(.5);assert.equal(f.sources.length,n);f.send({type:'pause',paused:false});f.tick(.51);
 const next=f.sources[n];assert.equal(next.buffer.samples[0],pcm[1200]/32768);
 f.s.port.close();assert.ok(f.sources.every(s=>s.stoppedAt!==undefined));
});
test('clear stops scheduled audio and rejects stale epoch; hold releases on completion',t=>{
 const f=fixture(t);f.send({type:'hold'});f.send({type:'audio',buffer:new Int16Array(4800).fill(100).buffer});f.tick(1);assert.equal(f.sources.length,0);
 f.send({type:'done'});f.tick(1.02);assert.ok(f.sources.length>0);f.send({type:'clear',epoch:1});assert.ok(f.sources.every(s=>s.stoppedAt!==undefined));
 const count=f.sources.length;f.send({type:'audio',buffer:new Int16Array(480).fill(999).buffer});f.tick(2);assert.equal(f.sources.length,count);
 f.send({type:'audio',epoch:1,buffer:new Int16Array(480).fill(200).buffer});f.send({type:'done',epoch:1});f.tick(2.02);assert.equal(f.sources[count].buffer.samples[0],200/32768);
 f.s.disconnect();
});
test('playback metrics follow output time rather than the scheduling cursor and mute keeps advancing',t=>{
 const f=fixture(t);f.send({type:'audio',buffer:new Int16Array(24000).fill(100).buffer});f.send({type:'done'});
 assert.equal(f.tick(0).consumed,0);assert.equal(f.tick(.05).consumed,720);
 f.send({type:'output-mute',muted:true});assert.equal(f.s.gain.value,0);const m=f.tick(.1);assert.equal(m.playing,false);assert.equal(m.consumed,1920);
 f.send({type:'output-mute',muted:false});assert.equal(f.s.gain.value,1);assert.equal(f.tick(.15).playing,true);f.s.disconnect();
});

test('a missed scheduling deadline is counted even when completed PCM is still queued',t=>{
 const f=fixture(t);f.send({type:'audio',buffer:new Int16Array(24000).fill(100).buffer});f.send({type:'done'});f.tick(0);
 assert.equal(f.tick(.5).underflows,1);f.s.disconnect();
});
