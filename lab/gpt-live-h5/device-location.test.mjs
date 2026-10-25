import {test} from 'node:test';import assert from 'node:assert/strict';import {browserDeviceActions,createBrowserDeviceAdapter} from './device-location.mjs';
test('only secure browser capability, no implicit position read',async()=>{let reads=0;const n={geolocation:{getCurrentPosition(){reads++;}},permissions:{query:async()=>({state:'denied'})}};assert.equal((await browserDeviceActions(n,true)).capabilities['location.current'].status,'denied');assert.equal((await browserDeviceActions(n,false)).capabilities['location.current'].status,'unavailable');assert.equal(reads,0);});
test('actual geolocation adapter carries source/time/accuracy, no cross-call/late use',()=>{const sent=[];let receive;const n={geolocation:{getCurrentPosition:fn=>{receive=fn;}}};let current=true;const b=createBrowserDeviceAdapter({voiceSessionId:'one',send:x=>sent.push(x),isCurrent:()=>current,navigator:n});const frame={type:'device.request',version:1,voiceSessionId:'one',requestId:'x',operation:'location.current',deadline:Date.now()+2000};assert.equal(b.handle({...frame,voiceSessionId:'two'}),false);assert(b.handle(frame));receive({coords:{latitude:1,longitude:2,accuracy:30},timestamp:Date.now()});assert.equal(sent[0].result.source,'web_geolocation');assert.equal(sent[0].status,'ok');assert.equal(b.handle(frame),false);assert(b.handle({...frame,requestId:'y'}));current=false;receive({coords:{latitude:1,longitude:2,accuracy:30},timestamp:Date.now()});assert.equal(sent.length,1);b.close();});

test('browser reports permission changes for this call and removes its observer on close',async()=>{
 const sent=[];let listener,removed=false,current=true;
 const permission={state:'prompt',addEventListener:(name,fn)=>{listener=fn;},removeEventListener:(name,fn)=>{removed=fn===listener;}};
 const b=createBrowserDeviceAdapter({voiceSessionId:'current',isCurrent:()=>current,send:x=>sent.push(x),navigator:{permissions:{query:async()=>permission}}});
 await new Promise(r=>setImmediate(r));assert.equal(sent.length,0);
 permission.state='denied';listener();assert.equal(sent[0].capabilities['location.current'].status,'denied');assert.equal(sent[0].voiceSessionId,'current');
 permission.state='granted';listener();assert.equal(sent[1].revision,2);assert.equal(sent[1].capabilities['location.current'].status,'available');
 current=false;listener();assert.equal(sent.length,2);b.close();assert(removed);listener();assert.equal(sent.length,2);
});
