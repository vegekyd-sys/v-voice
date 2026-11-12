import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {createFeishuConversationDirectory,feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';

const config={appId:'cli_fixture',appSecret:'fixture-app-secret',accountId:'lab'};
const identity={openId:'ou_alice',tenantKey:'tenant_fixture'};
const phone=feishuConversationPhone('lab','oc_groupA');
const until=async(check,ms=1500)=>{for(const end=Date.now()+ms;Date.now()<end;await delay(2))if(check())return true;return check();};

test('a subject\'s early reads are offered only after an admission, only on request, and are signed as that subject',async()=>{
  let admit=true;const requests=[];
  const gateway={request:async(method,params)=>{
    requests.push({method,params});
    if(method!=='voice.feishu.resolve')return {ok:true};
    if(!admit)throw Object.assign(Error('not a member'),{details:{reason:'conversation_membership_required'}});
    return {sessionKey:'agent:makaron:feishu:group:'+params.voiceActor.actor.chatId,agentId:'makaron',accountId:'lab',kind:'group'};
  }};
  const resolve=createFeishuConversationDirectory({...config,gateway});
  const hints=[];const speculate=hint=>hints.push(hint);
  await resolve(identity,phone,{speculate});
  assert.equal(hints.length,0,'nothing is known before the first admission');
  await resolve(identity,phone);
  assert.equal(hints.length,0,'ordinary requests never start early reads');
  const binding=await resolve(identity,phone,{speculate});
  assert.equal(hints.length,1);
  assert.equal(hints[0].sessionKey,binding.sessionKey);assert.equal(hints[0].agentId,binding.agentId);
  await hints[0].gateway.request('tools.catalog',{agentId:'makaron'});
  const early=requests.at(-1);
  assert.equal(early.params.voiceActor.actor.openId,'ou_alice');assert.equal(early.params.voiceActor.actor.chatId,'oc_groupA');
  assert.equal(early.params.sessionKey,binding.sessionKey);
  await assert.rejects(hints[0].gateway.request('chat.history',{sessionKey:'agent:makaron:feishu:group:oc_other'}),/cannot change/);
  // Another subject, or the same subject in another conversation, has no hint.
  await resolve({...identity,openId:'ou_bob'},phone,{speculate});
  await resolve(identity,feishuConversationPhone('lab','oc_groupB'),{speculate});
  assert.equal(hints.length,1);
  // A refused admission forgets the conversation: the next dial reads nothing early.
  admit=false;
  await assert.rejects(resolve(identity,phone,{speculate}));
  assert.equal(hints.length,2,'the refused dial itself had started early reads; its entry discards them');
  admit=true;
  await resolve(identity,phone,{speculate});
  assert.equal(hints.length,2);
  // A throwing reader can never break admission.
  const safe=await resolve(identity,phone,{speculate:()=>{throw Error('reader failed');}});
  assert.equal(safe.sessionKey,binding.sessionKey);
});

test('a dial starts its reads before admission returns, hands them to the reserved call, and discards them when refused',async t=>{
  let holdResolve=null,resolves=0,refuse=false;const calls=[],prefetches=[],reserved=[];
  const gateway={request:async(method,p)=>{
    calls.push({method,p});const a=p.voiceActor?.actor;
    if(method==='voice.feishu.resolve'){
      resolves++;
      if(holdResolve)await holdResolve;
      if(refuse)throw Object.assign(Error('not a member'),{details:{reason:'conversation_membership_required'}});
      return {sessionKey:'agent:makaron:feishu:group:'+a.chatId,agentId:'makaron',accountId:'lab',kind:'group'};
    }
    if(method==='sessions.resolve')return {key:p.key,agentId:p.agentId};
    return {ok:true};
  }};
  const origin='https://voice.example';let sequence=0;
  const directVoice={models:()=>[],
    prefetch:hint=>{const row={...hint,adopted:false,discarded:0,resolvesAtStart:resolves,discard(){row.discarded++;}};prefetches.push(row);return row;},
    reserve:async p=>{reserved.push(p);if(p.prefetched)p.prefetched.adopted=true;return {voiceSessionId:'direct-'+(++sequence),relayTicket:'fixture-ticket',provider:p.model};},
    attach:()=>true,close:async()=>{},dispose:async()=>{}};
  const bridge=createLiveH5Server({enableGrok:true,gateway,directVoice,publicOrigin:origin,basePath:'/voice',accessToken:'fixture-legacy-token'.repeat(3),
    feishuLogin:{...config,conversations:true,allowUnidentified:true,fetchImpl:async url=>Response.json(url.endsWith('/token')?
      {code:0,access_token:'fixture-token',token_type:'Bearer'}:{code:0,data:{open_id:'ou_alice',tenant_key:'tenant_fixture'}})}});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
  const get=(path,cookie='')=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:bridge.server.address().port,path,method:'GET',headers:{host:'voice.example',origin,cookie}},
      res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));
    req.on('error',reject);req.end();
  });
  const cookie=res=>res.headers.get('set-cookie').split(';')[0];
  const query='?phone='+phone;
  const start=await get('/voice/feishu'+query+'&oauth=1'),auth=new URL(start.headers.get('location'));
  const finish=await get('/voice/feishu/callback?code=valid&state='+auth.searchParams.get('state'),cookie(start));
  const actorCookie=cookie(finish);
  const selected=await get(finish.headers.get('location'),actorCookie);assert.equal(selected.status,200);await selected.text();
  const jar=actorCookie+'; '+cookie(selected);
  assert.equal(prefetches.length,0,'opening the page reads nothing early');
  const dial=(model='seeduplex')=>new Promise(resolve=>{
    const ws=new WebSocket(`ws://127.0.0.1:${bridge.server.address().port}/voice/api/dial${query}&model=${model}&dialVersion=2`,{headers:{host:'voice.example',origin,cookie:jar}});
    const timer=setTimeout(()=>{ws.terminate();resolve({error:'timeout'});},2000);
    ws.on('unexpected-response',(_req,res)=>{clearTimeout(timer);res.resume();resolve({status:res.statusCode});});
    ws.on('error',()=>{});
    ws.on('message',raw=>{clearTimeout(timer);ws.close();resolve(JSON.parse(raw));});
  });
  // The page's own admission told the entry which conversation to expect.
  let release;holdResolve=new Promise(r=>{release=r;});
  const before=resolves,pending=dial();
  assert(await until(()=>prefetches.length===1),'reads start while admission is still in flight');
  assert.equal(resolves,before+1);assert.equal(reserved.length,0,'no call exists before admission returns');
  assert.equal(prefetches[0].sessionKey,'agent:makaron:feishu:group:oc_groupA');assert.equal(prefetches[0].model,'seeduplex');
  await prefetches[0].gateway.request('tools.catalog',{agentId:'makaron'});
  assert.equal(calls.at(-1).p.voiceActor.actor.openId,'ou_alice');
  release();holdResolve=null;
  const reservation=await pending;
  assert.equal(reservation.type,'reservation');
  assert.equal(reserved.at(-1).prefetched,prefetches[0]);assert.equal(prefetches[0].discarded,0);
  await get('/voice/api/close'+query,jar);
  // A dial whose admission is refused never reserves a call, and its reads are dropped.
  refuse=true;
  const refused=await dial();
  assert.notEqual(refused.type,'reservation');
  assert.equal(prefetches.length,2);assert.equal(prefetches[1].discarded,1);assert.equal(reserved.length,1);
  // Having been refused, the next dial reads nothing before it is admitted again.
  refuse=false;
  const again=await dial('grok');
  assert.equal(again.type,'reservation');assert.equal(prefetches.length,2);assert.equal(reserved.at(-1).prefetched,undefined);
});
