import test from 'node:test';import assert from 'node:assert/strict';import {OnlineSpeakerTracker} from './online-speaker.mjs';
const vector=x=>[x,Math.sqrt(1-x*x)];
const seg=ms=>({id:'test',startMs:0,endMs:ms,frames:[Buffer.alloc(ms*32)],speakerId:null});
test('a changing prefix cannot create several speakers inside one admitted acoustic segment',async()=>{
 let v=[1,0];const events=[],tracker=new OnlineSpeakerTracker({embed:async()=>({embedding:v}),onEvent:e=>events.push(e)}),s=seg(1000);await tracker.classify(s);v=[0,1];s.frames=[Buffer.alloc(2000*32)];await tracker.classify(s);assert.equal(s.speakerId,'local0');assert.equal(tracker.prototypes.length,1);assert.equal(events.filter(e=>e.type==='revision').length,0);
});
test('a different speaker is enrolled only after two consistent windows; noisy prefixes stay unassigned',async()=>{
 let v=[1,0];const tracker=new OnlineSpeakerTracker({embed:async()=>({embedding:v})});await tracker.classify(seg(1000));
 v=[0,1];const b=seg(1000);await tracker.classify(b);assert.equal(b.speakerId,null);assert.equal(tracker.prototypes.length,1);
 b.frames=[Buffer.alloc(1600*32)];await tracker.classify(b);assert.equal(b.speakerId,'local1');assert.equal(tracker.prototypes.length,2);
});
test('a marginally different delivery of the same voice does not enroll a new person',async()=>{
 let v=[1,0];const tracker=new OnlineSpeakerTracker({embed:async()=>({embedding:v})});await tracker.classify(seg(1000));v=vector(.44);const s=seg(1000);await tracker.classify(s);assert.equal(s.speakerId,null);v=vector(.52);s.frames=[Buffer.alloc(1600*32)];await tracker.classify(s);assert.equal(s.speakerId,'local0');assert.equal(tracker.prototypes.length,1);
});
test('speaker capacity never silently assigns an unknown voice to an existing person',async()=>{
 let v=[1,0];const tracker=new OnlineSpeakerTracker({maxPeople:1,embed:async()=>({embedding:v})});await tracker.classify(seg(1000));v=[0,1];const s=seg(1600);await tracker.classify(s);await tracker.classify(s);assert.equal(s.speakerId,null);assert.equal(await tracker.verifyWindow(Buffer.alloc(32000)),null);
});
test('a device recycles the longest-unheard voice that never addressed V; a pinned person keeps the slot',async()=>{
 let v=[1,0];const events=[],tracker=new OnlineSpeakerTracker({maxPeople:1,recycle:true,recycleIdleMs:0,embed:async()=>({embedding:v}),onEvent:e=>events.push(e)});
 await tracker.classify(seg(1000));assert.equal(tracker.prototypes[0].id,'local0');
 v=[0,1];const tv=seg(1600);await tracker.classify(tv);await tracker.classify(tv);
 assert.equal(tv.speakerId,'local1');assert.deepEqual(events.filter(e=>e.type==='evicted').map(e=>e.speakerId),['local0']);
 tracker.pin('local1');v=[1,0];const next=seg(1600);await tracker.classify(next);await tracker.classify(next);
 assert.equal(next.speakerId,null);assert.equal(tracker.prototypes[0].id,'local1');
});
test('a voice heard recently is not recycled even when it never addressed V',async()=>{
 let v=[1,0];const tracker=new OnlineSpeakerTracker({maxPeople:1,recycle:true,embed:async()=>({embedding:v})});
 await tracker.classify(seg(1000));v=[0,1];const s=seg(1600);await tracker.classify(s);await tracker.classify(s);assert.equal(s.speakerId,null);
});
