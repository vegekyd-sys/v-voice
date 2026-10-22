import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createReleaseGate, listenReleaseControl, workIsIdle} from '../lib/release-control.mjs';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';

const idle = () => ({known:true,activeCalls:0,creatingSessions:0,backgroundTasks:0,deviceOperations:0});

test('unknown, creating, active, delivery and camera work all veto a hold; a crashed publisher cannot leave admission closed', () => {
  let state = idle(), now = 1000;
  const gate = createReleaseGate({readiness:()=>state,now:()=>now});
  for (const key of ['activeCalls','creatingSessions','backgroundTasks','deviceOperations']) {
    state = {...idle(),[key]:1};assert.equal(gate.hold(),null);assert.equal(gate.blocked(),false);
  }
  for (const state of [{}, {...idle(),known:false}, {...idle(),activeCalls:'0'}]) assert.equal(workIsIdle(state),false);
  state=idle();const lease=gate.hold();assert(lease);assert(gate.blocked());
  assert.equal(gate.hold(),null);assert.equal(gate.resume('another publisher'),false);
  now=lease.expiresAt;assert.equal(gate.blocked(),false);assert(gate.hold());
});

test('in-flight web creation and existing call survive a release attempt; hold rejects new calls on an existing visitor', async t => {
  let finishCreate, closes=0;
  const bridge=createLiveH5Server({gateway:{request:async method=>{
    if(method==='talk.client.create')return new Promise(resolve=>{finishCreate=()=>resolve({voiceSessionId:'fixture',model:'gpt-live-1-codex',transport:'webrtc',offerUrl:'/plugins/openai/realtime/calls'});});
    if(method==='talk.client.close')closes++;
    return {};
  }},avatarEvaluate:async()=>null});
  await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));t.after(()=>bridge.dispose());
  const url=`http://127.0.0.1:${bridge.server.address().port}`;
  const page=await fetch(url),cookie=page.headers.get('set-cookie').split(';')[0];await page.text();
  const call=()=>fetch(url+'/api/session',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});
  const pending=call();
  while(!finishCreate)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(bridge.releaseReadiness().creatingSessions,1);assert.equal(bridge.releaseGate.hold(),null);
  finishCreate();assert.equal((await pending).status,200);
  assert.equal(bridge.releaseGate.hold(),null);assert.equal(closes,0);
  await fetch(url+'/api/close',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({voiceSessionId:'fixture'})});
  assert.equal(bridge.releaseReadiness().activeCalls,0);
  const lease=bridge.releaseGate.hold();assert(lease);assert.equal((await call()).status,503);
  assert(bridge.releaseGate.resume(lease.id));
});

test('administration is a private Unix socket; it reports exact process/release and cannot steal an existing socket', async t => {
  const directory=await mkdtemp(join(tmpdir(),'voice-release-')),path=join(directory,'control.sock');
  const gate=createReleaseGate({readiness:idle});
  const bridge={releaseReadiness:idle,releaseGate:gate,deviceInventory:()=>[]};
  const control=await listenReleaseControl({socketPath:path,bridge,release:{commit:'fixture'}});
  t.after(async()=>{await control.close();await rm(directory,{recursive:true});});
  assert.equal((await stat(path)).mode & 0o777,0o600);
  await assert.rejects(listenReleaseControl({socketPath:path,bridge}),/already exists/);
  const get=(method,url,body)=>new Promise((resolve,reject)=>{
    const req=request({socketPath:path,method,path:url},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});
    req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  const status=await get('GET','/status');assert.equal(status.body.pid,process.pid);assert.equal(status.body.release.commit,'fixture');
  const held=await get('POST','/hold',{});assert.equal(held.status,200);
  assert.equal((await get('POST','/resume',{id:'wrong'})).status,409);assert(gate.blocked());
  assert.equal((await get('POST','/resume',{id:held.body.lease.id})).status,200);assert(!gate.blocked());
});
