import test from 'node:test';
import assert from 'node:assert/strict';
import {captureTvArray} from './tv-array-capture.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));

// Emulate slow device initialization and Android delivering its first buffered
// frames together. Use the real capture controller, no microphone or provider.
async function fixture(channels=4,sampleRate=48000){
 const events=[],errors=[],workers=[],queue=[];let sequence=0,stops=0,started=false,inflight=0,peak=0;
 const originals=new Map(['Worker','AudioWorkletNode','VTVArray','vTvAudioCapability'].map(k=>[k,globalThis[k]]));
 class Worker {
  constructor(){workers.push(this);setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),0);}
  postMessage(d){
   if(d.type==='configure'){events.push('configure:'+d.channels);setTimeout(()=>{if(!this.closed){events.push('warm:'+d.channels);this.onmessage?.({data:{type:'configured',channels:d.channels,sampleRate:d.sampleRate}});}},100);}
   if(d.type==='capture'){inflight++;peak=Math.max(peak,inflight);setTimeout(()=>{if(!this.closed){inflight--;events.push('frame:'+d.sequence);this.onmessage?.({data:{type:'pcm',buffer:new Int16Array(480).buffer}});}},60);}
  }
  terminate(){this.closed=true;}
 }
 globalThis.Worker=Worker;
 globalThis.AudioWorkletNode=class {port={postMessage(){},close(){}};connect(){}disconnect(){}};
 globalThis.vTvAudioCapability={version:1,pageToken:'test'};
 globalThis.VTVArray={
  start(){events.push('prepare');return JSON.stringify({version:sampleRate===16000?3:2,channels,sampleRate,source:'synthetic'});},
  begin(){events.push('begin');started=true;for(let n=0;n<12;n++)queue.push({sequence:++sequence,channels,pcm:Buffer.alloc((sampleRate/50)*channels*2).toString('base64')});return 'ok';},
  pull(){return JSON.stringify({frames:queue.splice(0,4)});},
  stop(){stops++;},
 };
 const track={readyState:'live',stop(){this.readyState='ended';}},stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
 const context={audioWorklet:{addModule:async()=>{}},createMediaStreamDestination:()=>({stream})};
 const abort=new AbortController();
 return {events,errors,abort,track,bridge:globalThis.VTVArray,
  create:()=>captureTvArray({context,signal:abort.signal,onError:e=>errors.push(e)}),
  get started(){return started;},get peak(){return peak;},get stops(){return stops;},
  restore(){for(const w of workers)w.terminate();for(const [k,v]of originals){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}};
}
for(const sampleRate of [16000,48000])for(const channels of [4,6])test(`TV ${channels} channels at ${sampleRate} Hz warm before capture and process a 240ms startup burst without flooding DSP`,async()=>{
 const f=await fixture(channels,sampleRate);let cap;
 try{
  cap=await f.create();assert.equal(f.started,false);
  await cap.startCapture();assert.equal(cap.snapshot().sampleRate,sampleRate);assert(f.events.indexOf('warm:'+channels)<f.events.indexOf('begin'));
  await delay(330);
  assert.equal(f.errors.length,0);assert.equal(f.peak,4);
  assert.deepEqual(f.events.filter(e=>e.startsWith('frame:')),Array.from({length:12},(_,i)=>'frame:'+(i+1)));
  cap.dispose();cap.dispose();assert.equal(f.stops,1);assert.equal(f.track.readyState,'ended');
 }finally{cap?.dispose();f.restore();}
});
test('TV cancellation during DSP warmup never starts the microphone',async()=>{
 const f=await fixture();try{const pending=f.create();await delay(20);f.abort.abort();await assert.rejects(pending,{code:'TV_MIC_CANCELLED'});assert.equal(f.started,false);assert.equal(f.stops,1);}finally{f.restore();}
});
test('TV input route failures preserve a bounded diagnostic and close capture once',async()=>{
 const f=await fixture();let cap;try{cap=await f.create();f.bridge.pull=()=>JSON.stringify({error:'TV_MIC_ROUTE'});await cap.startCapture();assert.equal(f.errors[0].code,'TV_MIC_ROUTE');assert.equal(f.track.readyState,'ended');cap.dispose();assert.equal(f.stops,1);}finally{cap?.dispose();f.restore();}
});
