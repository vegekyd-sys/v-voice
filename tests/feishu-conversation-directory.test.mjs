import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeishuConversationDirectory,feishuConversationPhone,parseFeishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
import {createFeishuActorGateway} from '../lib/feishu-actor-gateway.mjs';
import {createFeishuPhoneLogin} from '../lib/feishu-phone-login.mjs';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {request} from 'node:http';
import {Readable} from 'node:stream';
import {verifyPhoneSession} from '../lib/phone-provisioning.mjs';
import WebSocket from 'ws';

const config={appId:'cli_fixture',appSecret:'fixture-app-secret',accountId:'lab'};
const identity={openId:'ou_alice',tenantKey:'tenant_fixture'};
const phone=feishuConversationPhone('lab','oc_groupA');
test('public conversation IDs contain no permission or caller and reject ambiguous encoding',()=>{
  assert.deepEqual(parseFeishuConversationPhone(phone),{accountId:'lab',chatId:'oc_groupA'});
  assert.equal(parseFeishuConversationPhone(phone+'='),null);
  assert.equal(parseFeishuConversationPhone('feishu_'+Buffer.from('["lab","oc_groupA","ignored"]').toString('base64url')),null);
});

test('two OAuth identities in two groups obtain distinct caller and access scopes',async()=>{
  const requests=[],gateway={request:async(method,params)=>{
    requests.push({method,params});const a=params.voiceActor.actor;
    return {sessionKey:'agent:makaron:feishu:group:'+a.chatId,agentId:'makaron',accountId:'lab',kind:'group'};
  }};
  const resolve=createFeishuConversationDirectory({...config,gateway});
  const records=[];
  for(const openId of ['ou_alice','ou_bob'])for(const chatId of ['oc_groupA','oc_groupB']){
    const entry=await resolve({...identity,openId},feishuConversationPhone('lab',chatId));records.push(entry);
    assert.equal(entry.sessionKey,'agent:makaron:feishu:group:'+chatId);
    assert.equal(entry.replyTarget.to,chatId);assert.equal(entry.actorPrincipal.openId,openId);
    await entry.gateway.request('tools.invoke',{name:'memory_search',args:{query:'fixture'}});
    const last=requests.at(-1);assert.equal(last.params.voiceActor.actor.openId,openId);assert.equal(last.params.sessionKey,entry.sessionKey);
    await assert.rejects(entry.gateway.request('chat.history',{sessionKey:'agent:makaron:feishu:group:oc_foreign'}),/cannot change/);
    await verifyPhoneSession(entry.gateway,entry);
  }
  assert.equal(new Set(records.map(r=>r.accessToken)).size,4);
  assert.equal(records[0].callerId,records[1].callerId);assert.notEqual(records[0].callerId,records[2].callerId);
  assert(!JSON.stringify(requests).includes(config.appSecret));
  await assert.rejects(resolve(identity,feishuConversationPhone('personal','oc_groupA')),/Unknown/);
});

test('browser cannot supply a signed identity or change a scoped request',async()=>{
  const scoped=createFeishuActorGateway({...config,identity,chatId:'oc_groupA',sessionKey:'canonical',gateway:{request:async()=>({})}});
  await assert.rejects(scoped.request('tools.invoke',{voiceActor:{openId:'ou_other'}}),/cannot be supplied/);
});

test('proof canonicalization matches JSON RPC wire semantics for optional undefined fields',async()=>{
  let actual;
  const scoped=createFeishuActorGateway({...config,identity,chatId:'oc_groupA',sessionKey:'canonical',gateway:{request:async(_,p)=>{actual=JSON.parse(JSON.stringify(p));}}});
  await scoped.request('tools.invoke',{name:'fixture',unused:undefined,args:{value:'fixture',unused:undefined}});
  assert.deepEqual(JSON.parse(actual.voiceActor.params),{sessionKey:'canonical',name:'fixture',args:{value:'fixture'}});
});

test('dynamic OAuth admits the verified provider fixture subject through Gateway and rechecks current permissions after restart',async()=>{
  let subject='ou_alice',admitted=true;const seen=[];
  const resolveConversation=async(a,p)=>{
    seen.push(a);if(!admitted)throw Error('revoked');
    return {id:p,callerId:a.openId,permissionProfile:'feishu-current',actorPrincipal:{openId:a.openId,tenantKey:a.tenantKey}};
  };
  const opts={...config,publicOrigin:'https://voice.example',basePath:'/voice',entries:{resolve:()=>null},resolveConversation,
    fetchImpl:async(url)=>({ok:true,status:200,json:async()=>url.endsWith('/token')?{code:0,access_token:'provider-token',token_type:'Bearer'}:
      {code:0,data:{open_id:subject,tenant_key:'tenant_fixture'}}})};
  for(subject of ['ou_alice','ou_bob']){
    const login=createFeishuPhoneLogin(opts),headers={},res={setHeader:(k,v)=>headers[k]=v};
    const url=new URL(login.begin({headers:{}},res,phone));
    const req={headers:{cookie:headers['set-cookie'].split(';')[0]}};
    await login.complete(req,res,new URL('https://voice.example/voice/feishu/callback?code=valid_code&state='+url.searchParams.get('state')));
    const cookie=headers['set-cookie'].split(';')[0],restarted=createFeishuPhoneLogin(opts);
    const authenticated={headers:{cookie}};
    const binding=await restarted.select(authenticated,phone);
    assert.equal(binding.callerId,subject);assert.equal(restarted.permits(authenticated,binding),true);
    assert.equal(restarted.actorPermits({openId:'ou_stranger',tenantKey:'tenant_fixture'},binding),false);
    assert(!cookie.includes(subject)&&!cookie.includes('provider-token'));
    admitted=false;await assert.rejects(restarted.select(authenticated,phone),/revoked/);admitted=true;
  }
  assert(seen.some(a=>a.openId==='ou_bob'));
});

test('HTTP OAuth and dialing preserve both fixture subjects, groups, and server-owned scoped Gateway requests',async t=>{
  let subject='ou_alice',sequence=0;const calls=[];
  const gateway={request:async(method,p)=>{
    calls.push({method,p});const a=p.voiceActor?.actor;
    if(method==='voice.feishu.resolve')return {sessionKey:'agent:makaron:feishu:group:'+a.chatId,agentId:'makaron',accountId:'lab',kind:'group'};
    if(method==='sessions.resolve')return {key:p.key,agentId:p.agentId};
    if(method==='talk.client.create')return {voiceSessionId:'fixture-'+(++sequence),clientSecret:'secret-'+sequence,model:'gpt-live-1-codex',offerUrl:'/plugins/openai/realtime/calls',transport:'webrtc'};
    return {ok:true};
  }};
  const origin='https://voice.example';
  const directVoice={models:()=>[],reserve:async p=>{
    await p.gateway.request('tools.catalog',{agentId:p.agentId,includePlugins:true});
    return {voiceSessionId:'direct-'+(++sequence),relayTicket:'fixture-ticket',provider:p.model};
  },attach:()=>true,close:async()=>{},dispose:async()=>{}};
  const bridge=createLiveH5Server({gateway,directVoice,publicOrigin:origin,basePath:'/voice',accessToken:'fixture-legacy-token'.repeat(3),
    feishuLogin:{...config,conversations:true,fetchImpl:async url=>Response.json(url.endsWith('/token')?
      {code:0,access_token:'fixture-token',token_type:'Bearer'}:{code:0,data:{open_id:subject,tenant_key:'tenant_fixture'}})}});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
  const get=(path,cookie='',body)=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:bridge.server.address().port,path,method:body?'POST':'GET',
      headers:{host:'voice.example',origin,cookie,'content-type':'application/json'}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));
    req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  const cookie=res=>res.headers.get('set-cookie').split(';')[0];
  const logins=[];
  for(const [user,chat] of [['ou_alice','oc_groupA'],['ou_bob','oc_groupB']]){
    subject=user;const phone=feishuConversationPhone('lab',chat),query='?phone='+phone;
    assert.equal((await get('/voice/api/status'+query)).status,401);
    const start=await get('/voice/feishu'+query),auth=new URL(start.headers.get('location'));
    const finish=await get('/voice/feishu/callback?code=valid&state='+auth.searchParams.get('state'),cookie(start));
    assert.equal(finish.status,302);const actorCookie=cookie(finish);
    const selected=await get(finish.headers.get('location'),actorCookie);assert.equal(selected.status,200);
    assert.match(await selected.text(),/voiceEntryStatus/u);
    const jar=actorCookie+'; '+cookie(selected);logins.push({jar,phone});
    const connected=await get('/voice/api/session'+query,jar,{sessionKey:'agent:makaron:main',callerId:'tianyi'});
    assert.equal(connected.status,200,connected.status===200?undefined:await connected.text());
    const actual=calls.filter(c=>c.method==='talk.client.create').at(-1);
    assert.equal(actual.p.sessionKey,'agent:makaron:feishu:group:'+chat);
    assert.equal(actual.p.voiceActor.actor.openId,user);
    await get('/voice/api/close'+query,jar,await connected.json());
    const reservation=await new Promise((resolve,reject)=>{
      const ws=new WebSocket(`ws://127.0.0.1:${bridge.server.address().port}/voice/api/dial${query}&model=grok&nativeRuntimeVersion=1&dialVersion=1`,
        {headers:{host:'voice.example',origin,cookie:jar}});
      const timer=setTimeout(()=>{ws.terminate();reject(Error('fixture dial timed out'));},2000);
      ws.on('error',reject);ws.on('message',raw=>{const value=JSON.parse(raw);clearTimeout(timer);ws.close();resolve(value);});
    });
    assert.equal(reservation.type,'reservation');
    const catalog=calls.filter(c=>c.method==='tools.catalog').at(-1);
    assert.equal(catalog.p.voiceActor.actor.openId,user);assert.equal(catalog.p.sessionKey,'agent:makaron:feishu:group:'+chat);
    await get('/voice/api/close'+query,jar,reservation);
  }
  assert.equal((await get('/voice/api/status?phone='+logins[0].phone,logins[1].jar)).status,401);
  assert.equal((await get('/voice/api/status?phone='+logins[1].phone,logins[0].jar)).status,401);
  assert(!JSON.stringify(calls).includes(config.appSecret));
});

test('wrong browser identity gets a safe recovery page and explicit retry can replace an existing login',async t=>{
  let subject='ou_alice',member='ou_alice';const methods=[];
  const origin='https://voice.example';
  const bridge=createLiveH5Server({gateway:{request:async(method,p)=>{
    methods.push(method);
    if(p.voiceActor.actor.openId!==member)throw Object.assign(Error('private gateway detail'),{details:{reason:'conversation_membership_required'}});
    return {sessionKey:'agent:makaron:feishu:direct:'+member,agentId:'makaron',accountId:'lab',kind:'dm'};
  }},publicOrigin:origin,basePath:'/voice',accessToken:'fixture-legacy-token'.repeat(3),
    feishuLogin:{...config,conversations:true,fetchImpl:async url=>Response.json(url.endsWith('/token')?
      {code:0,access_token:'private-provider-token',token_type:'Bearer'}:{code:0,data:{open_id:subject,tenant_key:'tenant_fixture'}})}});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
  const get=(path,cookie='')=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:bridge.server.address().port,path,headers:{host:'voice.example',origin,cookie}},
      res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));req.on('error',reject);req.end();
  });
  const cookie=res=>res.headers.get('set-cookie').split(';')[0];
  const finish=async start=>get('/voice/feishu/callback?code=private-code&state='+new URL(start.headers.get('location')).searchParams.get('state'),cookie(start));
  const signedIn=await finish(await get('/voice/feishu?phone='+phone)),oldCookie=cookie(signedIn);
  member='ou_bob';
  const denied=await get('/voice/feishu?phone='+phone,oldCookie),html=await denied.text();
  assert.equal(denied.status,200);assert.equal(denied.headers.get('set-cookie'),null);assert.match(html,/请切换到这个会话的飞书身份/);
  assert.match(html,/外部联系人/);assert.match(html,/retry=1/);
  for(const value of ['ou_alice','ou_bob','private-provider-token','private-code','private gateway detail'])assert(!html.includes(value));
  const retry=await get('/voice/feishu?phone='+phone+'&retry=1',oldCookie);
  assert.equal(new URL(retry.headers.get('location')).searchParams.get('prompt'),'consent');
  const wrongCallback=await finish(retry),callbackHtml=await wrongCallback.text();
  assert.equal(wrongCallback.status,200);assert.equal(wrongCallback.headers.get('set-cookie'),null);assert.match(callbackHtml,/retry=1/);
  assert(!callbackHtml.includes('private-code'));
  subject='ou_bob';const corrected=await finish(await get('/voice/feishu?phone='+phone+'&retry=1',oldCookie));
  assert.equal(corrected.status,302);
  assert.equal((await get(corrected.headers.get('location'),cookie(corrected))).status,200);
  assert(methods.every(m=>m==='voice.feishu.resolve'));
});
