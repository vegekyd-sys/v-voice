import test from 'node:test';import assert from 'node:assert/strict';
import {createPageMicrophoneSession} from './microphone-session.mjs';
function fixture(){let prompts=0,stops=0;const track={readyState:'live',enabled:true},stream={getAudioTracks:()=>[track]};const page=createPageMicrophoneSession({capture:async()=>{prompts++;return {track,stream,snapshot:()=>({trackEnabled:track.enabled}),dispose(){stops++;track.readyState='ended';}};}});return {page,track,get prompts(){return prompts},get stops(){return stops}};}
test('one grant per page; hangup disables mic, redial reuses it, page close releases it',async()=>{
 const f=fixture(),first=await f.page.acquire();assert.equal(f.prompts,1);first.dispose();assert.equal(f.track.enabled,false);assert.equal(f.stops,0);const second=await f.page.acquire();assert.equal(f.prompts,1);assert.equal(second.stream,first.stream);assert.equal(f.track.enabled,true);first.dispose();assert.equal(f.track.enabled,true);second.dispose();assert.equal(f.track.enabled,false);f.page.close();assert.equal(f.stops,1);await assert.rejects(f.page.acquire(),/已结束/);
});
test('cancelled permission does not enable capture; a late old owner cannot mute a new dial',async()=>{
 let grant,prompts=0,stops=0;const track={readyState:'live',enabled:true},stream={getAudioTracks:()=>[track]},page=createPageMicrophoneSession({capture:()=>{prompts++;return new Promise(r=>grant=()=>r({track,stream,snapshot:()=>({enabled:track.enabled}),dispose(){stops++;track.readyState='ended'}}));}});
 const old=new AbortController(),first=page.acquire({signal:old.signal});old.abort();await assert.rejects(first,/已结束/);const second=page.acquire();grant();const call=await second;assert.equal(prompts,1);assert.equal(track.enabled,true);call.dispose();assert.equal(track.enabled,false);page.close();assert.equal(stops,1);
});
test('closing the page during permission resolution disposes the late stream',async()=>{
 let finish,disposed=0;const lifetime=[];const page=createPageMicrophoneSession({capture:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));finish=()=>resolve({track:{readyState:'live'},stream:{getAudioTracks:()=>[]},snapshot:()=>({}),dispose(){disposed++}});})});const opening=page.acquire();page.close();await assert.rejects(opening,/aborted/);finish();assert.equal(page.snapshot().closed,true);
});
test('redial replaces a live but system-muted capture instead of re-enabling silent input',async()=>{
 let grants=0;const tracks=[];
 const page=createPageMicrophoneSession({capture:async()=>{grants++;const track={readyState:'live',enabled:true,muted:false};tracks.push(track);return {track,stream:{getAudioTracks:()=>[track]},snapshot:()=>({trackMuted:track.muted}),dispose(){track.readyState='ended';}};}});
 const first=await page.acquire();first.dispose();tracks[0].muted=true;
 const second=await page.acquire();assert.equal(grants,2);assert.equal(tracks[0].readyState,'ended');assert.notEqual(second.track,first.track);assert.equal(second.track.muted,false);
 first.dispose();assert.equal(second.track.enabled,true);page.close();
});
