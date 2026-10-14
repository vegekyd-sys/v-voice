import test from 'node:test';
import assert from 'node:assert/strict';
import {startVoiceEntry,publishVoiceTiming} from './entry-startup.mjs';
const location={pathname:'/voice/',search:'?entry=tianyi',hash:''};
test('entry status starts immediately without requesting a microphone or a voice session',async()=>{
 const requests=[],marks=[];let finish;
 const entry=startVoiceEntry({location,fetch:(url)=>{requests.push(url);return new Promise(resolve=>{finish=resolve;});},mark:name=>marks.push(name)});
 assert.deepEqual(requests,['./api/status?entry=tianyi']);
 finish({ok:true,json:async()=>({ready:true})});
 assert.equal((await entry).status.ready,true);
 assert.deepEqual(marks,['voice.entry.start','voice.status.start','voice.status.complete']);
});
test('private phone fragment exchange finishes before status; only the body carries access',async()=>{
 const requests=[],redirects=[];
 const result=await startVoiceEntry({location:{...location,search:'?phone=test-room',hash:'#access=fixture-only'},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({ready:true})};},replaceState:url=>redirects.push(url)});
 assert.equal(result.status.ready,true);
 assert.deepEqual(requests.map(r=>r.url),['./api/access?phone=test-room','./api/status?phone=test-room']);
 assert.equal(JSON.parse(requests[0].options.body).access,'fixture-only');
 assert.deepEqual(redirects,['/voice/?phone=test-room']);
});
test('a rejected access exchange cannot request status or retain a rejected preload promise',async()=>{
 const requests=[];
 const result=await startVoiceEntry({location:{...location,hash:'#access=fixture-only'},fetch:async url=>{requests.push(url);return {ok:false,json:async()=>({error:'入口失效'})};},replaceState:()=>assert.fail('must preserve fragment on failure')});
 assert.deepEqual(result,{error:'入口失效'});
 assert.deepEqual(requests,['./api/access?entry=tianyi']);
});
test('offline or denied status never fabricates readiness',async()=>{
 for(const fetch of [async()=>{throw new Error('offline');},async()=>({ok:false,json:async()=>({error:'denied'})})]){
  const result=await startVoiceEntry({location,fetch});assert.equal(typeof result.error,'string');assert.equal(result.status,undefined);
 }
});

test('authenticated HTML status avoids a second status round trip but an access fragment still exchanges first',async()=>{
 const initialStatus={ready:true,models:[{id:'grok',available:true}]};
 const cached=await startVoiceEntry({location,initialStatus,fetch:()=>assert.fail('snapshot must avoid status fetch')});
 assert.deepEqual(cached,{status:initialStatus});
 const urls=[];
 const fresh=await startVoiceEntry({location:{...location,hash:'#access=fixture-only'},initialStatus,replaceState:()=>{},fetch:async url=>{urls.push(url);return {ok:true,json:async()=>({ready:true})};}});
 assert.equal(fresh.status.ready,true);
 assert.deepEqual(urls,['./api/access?entry=tianyi','./api/status?entry=tianyi']);
});

test('DOM profiling exports whitelisted timestamps rather than arbitrary marks or payloads',t=>{
 const previous=globalThis.document;const root={dataset:{}};
 globalThis.document={documentElement:root};
 t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;performance.clearMarks('voice.dial.requested');performance.clearMarks('voice.private.SECRET');});
 performance.mark('voice.dial.requested');performance.mark('voice.private.SECRET');publishVoiceTiming();
 const value=JSON.parse(root.dataset.voiceTiming);
 assert(value.marks.some(m=>m.name==='voice.dial.requested'&&typeof m.ms==='number'));
 assert(!root.dataset.voiceTiming.includes('SECRET'));
 assert.deepEqual(Object.keys(value).sort(),['fcpMs','marks','ttfbMs']);
});
