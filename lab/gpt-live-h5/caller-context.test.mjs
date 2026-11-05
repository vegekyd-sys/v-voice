import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallerContext} from './caller-context.mjs';
test('GPT sends the authenticated per-call context before microphone and greeting, once per call',()=>{
  const sent=[],tracks=[{enabled:true},{enabled:false}],timers=[];let ready=0,current=true;
  const channel={readyState:'connecting',send:x=>sent.push(JSON.parse(x))};
  const c=createCallerContext({context:{voiceSessionId:'call-a',text:'verified Alice'},voiceSessionId:'call-a',channel,tracks,isCurrent:()=>current,onReady:()=>ready++,onError:assert.fail,setTimer:f=>timers.push(f),clearTimer(){}});
  assert(tracks.every(t=>!t.enabled));c.observe({type:'session.context.appended'});assert.equal(ready,0);
  c.observe({type:'session.started'});assert.equal(sent.length,0);
  channel.readyState='open';c.open();c.open();assert.equal(sent.length,1);assert.equal(sent[0].channel,'developer');assert.match(sent[0].content[0].text,/verified Alice/);
  assert.equal(ready,0);c.observe({type:'session.context.appended'});assert.equal(ready,1);assert.deepEqual(tracks,[{enabled:true},{enabled:false}]);
  c.observe({type:'session.started'});timers[0]();assert.equal(sent.length,1);
  current=false;c.close();
});
test('retired calls and failed context delivery never enable a microphone or leak identity into the next call',()=>{
  let current=true,failed=0;const timers=[],track={enabled:true};
  const c=createCallerContext({context:{voiceSessionId:'call-a',text:'Alice'},voiceSessionId:'call-a',channel:{readyState:'open',send(){}},tracks:[track],isCurrent:()=>current,onReady:assert.fail,onError:()=>failed++,setTimer:f=>timers.push(f),clearTimer(){}});
  c.observe({type:'session.started'});timers[0]();assert.equal(failed,1);assert.equal(track.enabled,false);c.observe({type:'session.context.appended'});assert.equal(track.enabled,false);
  current=false;c.close();assert.throws(()=>createCallerContext({context:{voiceSessionId:'old',text:'Alice'},voiceSessionId:'new'}));
});

test('live terminal changes wait for initial context and stay quiet without reopening microphone or greeting',()=>{
 const sent=[],track={enabled:true};let ready=0,current=true;
 const c=createCallerContext({context:{voiceSessionId:'call',text:'initial'},voiceSessionId:'call',channel:{readyState:'open',send:x=>sent.push(JSON.parse(x))},tracks:[track],isCurrent:()=>current,onReady:()=>ready++,onError:assert.fail});
 c.observe({type:'session.started'});assert.equal(c.update({voiceSessionId:'foreign',text:'ignored'}),false);
 c.update({voiceSessionId:'call',text:'location denied'});assert.equal(sent.length,1);assert.equal(track.enabled,false);
 c.observe({type:'session.context.appended'});assert.equal(sent.length,2);assert.equal(ready,1);assert.equal(sent[1].channel,'developer');assert.match(sent[1].content[0].text,/location denied/);
 c.observe({type:'session.context.appended'});assert.equal(ready,1);
 c.update({voiceSessionId:'call',text:'location available'});assert.equal(sent.length,3);assert(sent.every(x=>x.type==='session.context.append'));
 current=false;c.update({voiceSessionId:'call',text:'retired'});assert.equal(sent.length,3);c.close();
});
