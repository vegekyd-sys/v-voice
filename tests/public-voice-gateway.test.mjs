import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicVoiceGateway} from '../lib/public-voice-gateway.mjs';

test('Public uses canonical independent storage and ordinary tools, with exact task ownership',async()=>{
 const calls=[];let authorized=true;
 const gateway={ready:true,async request(method,params){calls.push({method,params});
  if(method==='tools.catalog')return {groups:[{tools:[{id:'memory_search'},{id:'web_search'},{id:'exec'}]}]};
  if(method==='voice.product.task.start'||method==='voice.product.task.lookup')return {taskId:'owned',runId:'run'};
  return {ok:true};
 }};
 const sessionKey='voice:guest:'+'a'.repeat(64),a=createPublicVoiceGateway({gateway,sessionKey,isAuthorized:()=>authorized});
 const b=createPublicVoiceGateway({gateway,sessionKey:'voice:guest:'+'b'.repeat(64),isAuthorized:()=>true});
 assert.deepEqual((await a.request('tools.catalog')).groups[0].tools.map(t=>t.id),['memory_search','web_search']);
 await a.request('tools.invoke',{sessionKey,name:'memory_search',args:{query:'项目经验'}});
 await a.request('voice.product.task.start',{sessionKey,voiceSessionId:'call',callId:'tool',question:'查公开资料'});
 const mapped=calls[1].params.sessionKey;
 assert.equal(mapped,mapped.toLowerCase());assert.match(mapped,/^agent:makaron:feishu:direct:ou_voicepublic[a-f0-9]{64}$/);
 assert.equal(calls[2].params.sessionKey,mapped);assert.match(calls[2].params.question,/个人内容红线/);
 await a.request('voice.product.task.read',{taskId:'owned'});
 await assert.rejects(b.request('voice.product.task.read',{taskId:'owned'}),/unavailable/);
 await assert.rejects(a.request('tools.invoke',{name:'exec',args:{command:'private'}}),/unavailable/);
 await assert.rejects(a.request('tools.invoke',{sessionKey:'other',name:'memory_search'}),/cannot change/);
 await assert.rejects(a.request('send',{}),/unavailable/);
 authorized=false;
 await assert.rejects(a.request('voice.product.task.start',{voiceSessionId:'new',callId:'new',question:'new'}),/expired/);
 // Revocation cannot prevent cleanup of an already admitted task.
 await a.request('voice.product.task.cancel',{taskId:'owned'});
});

test('lost task admission is reconciled only by the original request, without relaunching',async()=>{
 let starts=0;
 const a=createPublicVoiceGateway({sessionKey:'voice:guest:'+'c'.repeat(64),isAuthorized:()=>true,gateway:{async request(method){
  if(method==='voice.product.task.start'){starts++;throw Error('lost reply');}
  if(method==='voice.product.task.lookup')return {taskId:'recovered',runs:['run']};
  return {taskId:'recovered',status:'ok'};
 }}});
 const identity={voiceSessionId:'call',callId:'tool'};
 await assert.rejects(a.request('voice.product.task.start',{...identity,question:'目标'}),/lost reply/);
 await assert.rejects(a.request('voice.product.task.lookup',{voiceSessionId:'other',callId:'tool'}),/unavailable/);
 await a.request('voice.product.task.lookup',identity);
 assert.equal((await a.request('voice.product.task.read',{taskId:'recovered'})).status,'ok');assert.equal(starts,1);
});
