import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceLocation} from './device-location.mjs';
const setup=()=>{let t=1_800_000_000_000;const sent=[];const b=createDeviceLocation({voiceSessionId:'call-a',send:e=>sent.push(e),now:()=>t,timeoutMS:20});return {b,sent,advance:ms=>t+=ms,reply:extra=>({type:'device.location.result',version:1,voiceSessionId:'call-a',requestId:sent.at(-1).requestId,ok:true,latitude:31.2,longitude:121.4,horizontalAccuracyM:15,capturedAt:t,accuracyAuthorization:'full',coordinateSystem:'WGS84',...extra})};};
test('fresh phone location round-trips with metadata and explicit backend context',async()=>{
 const f=setup(),p=f.b.request();assert.equal(f.sent[0].type,'device.location.request');f.b.receive(f.reply());const r=await p;
 assert.equal(r.ok,true);assert.equal(r.pickupConfirmed,false);assert.equal(r.location.approximate,false);assert.match(f.b.context(),/WGS84/);
 f.advance(30_001);assert.throws(()=>f.b.context(),/过期/);f.b.close();
});
test('reject wrong call, unknown/replayed request, cancellation, and remove all context on close',async()=>{
 const f=setup(),ac=new AbortController(),p=f.b.request(ac.signal);
 assert.equal(f.b.receive(f.reply({voiceSessionId:'call-b'})),false);assert.equal(f.b.receive(f.reply({requestId:'other'})),false);
 ac.abort();assert.equal((await p).reason,'cancelled');assert.equal(f.b.receive(f.reply()),false);assert.throws(()=>f.b.context());
 const next=f.b.request();f.b.receive(f.reply());await next;f.b.close();assert.throws(()=>f.b.context());
});
test('new failed request clears previous fix; reduced accuracy stays approximate',async()=>{
 const f=setup(),p=f.b.request();f.b.receive(f.reply({accuracyAuthorization:'reduced',horizontalAccuracyM:2000}));assert.equal((await p).location.approximate,true);
 const next=f.b.request();f.b.receive(f.reply({ok:false,reason:'denied'}));assert.equal((await next).reason,'denied');assert.throws(()=>f.b.context());f.b.close();
});
test('reject stale/future/invalid/map-coordinates and report timeout/busy without guessing',async()=>{
 for(const extra of [{capturedAt:0},{capturedAt:1_900_000_000_000},{latitude:NaN},{longitude:181},{horizontalAccuracyM:-1},{coordinateSystem:'GCJ02'},{accuracyAuthorization:'unknown'}]){
  const f=setup(),p=f.b.request();f.b.receive(f.reply(extra));assert.equal((await p).ok,false);assert.throws(()=>f.b.context());f.b.close();
 }
 const f=setup(),p=f.b.request();assert.equal((await f.b.request()).reason,'busy');assert.equal((await p).reason,'timeout');f.b.close();
});
