import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioDeliveryMetrics} from './audio-delivery-metrics.mjs';

test('an already-delivered response distinguishes first audio, packet gaps and final summary',()=>{
  let at=0;const rows=[],m=createAudioDeliveryMetrics({now:()=>at,report:r=>rows.push(r)});
  m.packet(16384,'reply');at=100;m.packet(16384,'reply');at=2100;m.packet(16384,'reply');at=2200;m.finish('done');
  assert.deepEqual(rows.map(r=>r.phase),['first','gap','summary']);
  assert.equal(rows[1].gapMs,2000);assert.equal(rows[2].maxGapMs,2000);
  assert.equal(rows[2].audioMs,1024);assert.equal(rows[2].elapsedMs,2200);
  assert.equal(rows[2].packets,3);assert.equal(rows[2].bytes,49152);
  assert.equal(rows[2].reason,'done');
});
test('replaced, cleared and closed responses cannot contaminate each other',()=>{
  let at=0;const rows=[],m=createAudioDeliveryMetrics({now:()=>at,report:r=>rows.push(r)});
  m.packet(960,'a');at=5000;m.packet(960,'b');m.finish('clear');m.finish('closed');
  at=10000;m.packet(960);m.finish('closed');
  assert.deepEqual(rows.filter(r=>r.phase==='summary').map(r=>[r.responseId,r.reason,r.gaps]),[['a','replaced',0],['b','clear',0],[undefined,'closed',0]]);
});
test('gap logs are bounded while the summary keeps the complete count',()=>{
  let at=0;const rows=[],m=createAudioDeliveryMetrics({now:()=>at,report:r=>rows.push(r)});
  for(let i=0;i<101;i++){m.packet(960,'reply');at+=1000;}
  m.finish('done');
  assert.equal(rows.length,10);assert.equal(rows.at(-1).gaps,100);
  for(const bytes of [0,-2,3,NaN,Infinity,'960'])m.packet(bytes,'invalid');
  assert.equal(rows.length,10);
});
