import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDeviceRequests} from './device-requests.mjs';import {normalizeDeviceActions,terminalContext} from './terminal-context.mjs';
const fixture=(sideEffect=false)=>{const sent=[];const b=createDeviceRequests({voiceSessionId:'a',send:e=>sent.push(e),operations:{'location.current':{timeoutMS:500,sideEffect,validateArguments:x=>x,validateResult:x=>{if(x?.valid!==true)throw Error();return x;}}},capabilities:{'location.current':{status:'prompt'}}});return {b,sent,reply:extra=>({type:'device.result',version:1,voiceSessionId:'a',operation:'location.current',requestId:sent.at(-1).requestId,status:'ok',result:{valid:true},...extra})};};
test('reject owner/replay, enforce denial across frontend and backend callers',async()=>{const f=fixture(),p=f.b.request('location.current');assert.equal(f.b.receive(f.reply({voiceSessionId:'other'})),false);f.b.receive(f.reply({status:'denied'}));assert.equal((await p).status,'denied');assert.equal((await f.b.request('location.current')).status,'denied');assert.equal(f.sent.length,1);assert.equal(f.b.receive(f.reply()),false);f.b.close();});
test('side effects without completion remain unknown, reads are cancelled',async()=>{for(const side of [true,false]){const f=fixture(side),p=f.b.request('location.current');f.b.close();assert.equal((await p).status,side?'unknown':'cancelled');}});
test('invalid result is never success and progress is not completion',async()=>{const f=fixture(),p=f.b.request('location.current');assert(f.b.receive(f.reply({status:'waiting_user'})));f.b.receive(f.reply({result:{valid:false}}));assert.equal((await p).status,'failed');f.b.close();});
test('capability input cannot inject actor/session/device identity',()=>{assert.throws(()=>normalizeDeviceActions({version:1,actor:'tianyi',capabilities:{}}));assert.deepEqual(Object.keys(normalizeDeviceActions({version:1,appleNotes:true}).capabilities),['notes.create','notes.append']);const c=terminalContext({voiceSessionId:'a',kind:'web',actor:{verified:false},session:{scope:'guest'}});assert.equal(c.actor.verified,false);assert.equal(c.session.scope,'guest');});

test('original arguments reach validator and cancellation retires a write without retry',async()=>{
 const sent=[],controller=new AbortController();let validated;
 const b=createDeviceRequests({voiceSessionId:'one',send:e=>sent.push(e),capabilities:{'notes.create':{status:'available'},'robot.move':{status:'available'}},operations:{'notes.create':{timeoutMS:500,sideEffect:true,validateArguments:x=>({title:x.title}),validateResult:(x,ctx)=>{validated=ctx;return x;}}}});
 assert.equal(b.state('robot.move'),'unavailable');
 const first=b.request('notes.create',{title:'fixture',discarded:true});const req=sent.at(-1);
 b.receive({...req,type:'device.result',status:'ok',result:{saved:true}});assert.equal((await first).status,'ok');assert.deepEqual(validated.arguments,{title:'fixture'});assert.equal(validated.requestId,req.requestId);
 const pending=b.request('notes.create',{title:'next'},{signal:controller.signal});controller.abort();
 assert.equal((await pending).status,'unknown');assert.equal(sent.at(-1).type,'device.cancel');assert.equal(sent.filter(e=>e.type==='device.request').length,2);
 assert.equal(b.receive({...sent[1],type:'device.result',status:'ok',result:{saved:true}}),false);b.close();
});
