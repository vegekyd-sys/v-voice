import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
import {connectFeishuClient} from '../lab/gpt-live-h5/feishu-client-login.mjs';
import WebSocket from 'ws';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createIosBindings} from '../lib/ios-bindings.mjs';

const phone=feishuConversationPhone('lab','oc_groupa');
const group={id:'feishu-group-fixture',agentId:'makaron',sessionKey:'agent:makaron:feishu:group:oc_groupa',accountId:'cli_fixture',kind:'group',callerId:'tianyi',permissionProfile:'personal-tianyi',accessToken:'group-only-token'.repeat(4)};
const dm={...group,id:'feishu-dm-fixture',kind:'dm',sessionKey:'agent:makaron:feishu:direct:ou_alice',accessToken:'dm-only-token'.repeat(4)};
async function fixture(t,{file}={}) {
 let subject={open_id:'ou_alice',tenant_key:'fixture',name:'Alice Fixture'},reject=false,n=0;
 const calls=[],reservations=[],providerCalls=[];
 const gateway={request:async(method,p)=>{
  calls.push({method,p});
  if(method==='voice.feishu.resolve'){
   if(reject)throw Object.assign(Error('denied'),{details:{reason:'conversation_membership_required'}});
   return {sessionKey:group.sessionKey,agentId:'makaron',accountId:'lab',kind:'group'};
  }
  if(method==='talk.client.create')return {voiceSessionId:'gpt-'+(++n),model:'gpt-live-1-codex',transport:'webrtc',offerUrl:'/plugins/openai/realtime/calls',clientSecret:'private-fixture'};
  return {ok:true};
 }};
 const server=createLiveH5Server({gateway,iosBindingsFile:file,publicOrigin:'https://voice.example',basePath:'/voice',accessToken:'private-fixture-token'.repeat(4),conversationEntries:[group,dm],
  directVoice:{models:()=>[{id:'seeduplex',available:true},{id:'grok',available:true}],reserve:async p=>{reservations.push(p);return {voiceSessionId:'fixture-call-'+(++n),relayTicket:'fixture',provider:p.model};},attach:()=>true,close:async()=>{},dispose:async()=>{}},
  feishuLogin:{appId:'cli_fixture',appSecret:'fixture-private-secret',accountId:'lab',conversations:true,allowUnidentified:true,
   actors:[{openId:'ou_alice',tenantKey:'fixture',callerId:'tianyi',defaultPhoneId:dm.id,phoneIds:[group.id,dm.id]}],
   fetchImpl:async(url,init)=>{
    providerCalls.push({url,body:init?.body});
    if(url.includes('/app_access_token/'))return Response.json({code:0,app_access_token:'private-app-token',tenant_access_token:'private-tenant-token',expire:7200});
    if(url.includes('/im/v1/chats/'))return Response.json({code:0,data:{name:'真实群名称'}});
    if(url.endsWith('/access_token'))return Response.json({code:0,data:{access_token:'private-user-token',...subject}});
    if(url.endsWith('/token'))return Response.json({code:0,access_token:'private-user-token',token_type:'Bearer'});
    return Response.json({code:0,data:subject});
   }}});
 await new Promise(r=>server.server.listen(0,'127.0.0.1',r));t.after(()=>server.dispose());
 const jar=new Map();
 const send=(path,{body,ua='',cookies,origin='https://voice.example'}={})=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:server.server.address().port,path,method:body?'POST':'GET',headers:{host:'voice.example',origin,'user-agent':ua,cookie:cookies??[...jar].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json'}},res=>{
   for(const item of res.headers['set-cookie']??[]){const raw=item.split(';')[0],at=raw.indexOf('=');jar.set(raw.slice(0,at),raw.slice(at+1));}
   let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
 const clientLogin=async()=>{
  const entry=await send('/voice/feishu?phone='+phone,{ua:'Lark/7.0'});assert.equal(entry.status,302);assert.equal(entry.headers.location,'/voice/feishu/callback?phone='+phone);
  const page=await send(entry.headers.location,{ua:'Lark/7.0'});assert.equal(page.status,200);assert.match(page.text,/<title>和 V 通话<\/title>/);assert.doesNotMatch(page.text,/正在识别当前飞书账号/);assert.match(page.text,/<base href="\/voice\/">/);
  const state=JSON.parse(page.text.match(/id="login-config">(.*?)<\/script>/s)[1]).state;
  const finish=await send('/voice/feishu/client-login',{body:{state,code:'valid-code',name:'Forged Tianyi',callerId:'tianyi'}});
  assert.equal(finish.status,200);return {state,location:finish.json().location,status:finish.json().status};
 };
 return {send,jar,calls,reservations,providerCalls,clientLogin,port:server.server.address().port,setSubject:s=>subject=s,setDenied:v=>reject=v};
}

test('old group aliases and new group URLs use current account identity, including switching accounts in one browser',async t=>{
 const f=await fixture(t);
 const old=await f.send('/voice/feishu?phone='+group.id,{ua:'Lark'});assert.equal(old.headers.location,'/voice/feishu/callback?phone='+phone);
 assert.equal((await f.send('/voice/?phone='+group.id,{ua:'Lark'})).headers.location,old.headers.location);
 const personal=await f.send('/voice/feishu?phone='+dm.id);assert.match(personal.headers.location,/accounts.feishu.cn/);
 for(const [open_id,name] of [['ou_alice','Alice Fixture'],['ou_bob','Bob Fixture']]){
  f.setSubject({open_id,tenant_key:'fixture',name,email:'never-retain@example.com'});
  const {state,location}=await f.clientLogin();assert.match(location,/identified=/);
  const page=await f.send(location,{ua:'Lark/7.0'});assert.equal(page.status,200);assert.match(page.text,new RegExp(name));
  const status=await f.send('/voice/api/status?phone='+phone);assert.equal(status.json().accountLabel,name);
  const refresh=await f.send(location,{ua:'Lark/7.0'});assert.equal(refresh.status,302);assert.equal(refresh.headers.location,'/voice/feishu/callback?phone='+phone);
  const call=await f.send('/voice/api/session?phone='+phone,{body:{model:'grok',callerIdentity:{source:'feishu',displayName:'Fake Owner'},toolIdentity:{appId:'forged',openId:'ou_owner'}}});assert.equal(call.status,200,call.text);
  const actual=f.reservations.at(-1);assert.equal(actual.callerIdentity.displayName,name);assert.equal(actual.sessionKey,group.sessionKey);assert.equal(actual.actorScoped,true);assert.deepEqual(actual.toolIdentity,{appId:'cli_fixture',tenantKey:'fixture',openId:open_id});
  await actual.gateway.request('tools.invoke',{name:'read',args:{path:'fixture'}});
  const a=f.calls.at(-1).p.voiceActor.actor;assert.equal(a.openId,open_id);assert.equal(a.callerDisplayName,undefined);
  assert.equal(a.senderIsOwner,undefined);assert.equal(actual.unidentified,undefined);
  await f.send('/voice/api/close?phone='+phone,{body:call.json()});
  const gpt=await f.send('/voice/api/session?phone='+phone,{body:{model:'gpt-live',callerContext:{text:'Fake Owner'},callerIdentity:{source:'feishu',displayName:'Fake Owner'}}});assert.equal(gpt.status,200,gpt.text);
  assert.equal(gpt.json().callerContext.voiceSessionId,gpt.json().voiceSessionId);assert.match(gpt.json().callerContext.text,new RegExp(name));assert(!gpt.text.includes('Fake Owner'));
  const rpc=f.calls.findLast(c=>c.method==='talk.client.create');assert(!JSON.stringify(rpc.p).includes(name));assert.equal(rpc.p.voiceActor.actor.callerDisplayName,undefined);
  await f.send('/voice/api/close?phone='+phone,{body:{voiceSessionId:gpt.json().voiceSessionId}});
  assert.equal((await f.send('/voice/feishu/client-login',{body:{state,code:'replay'}})).status,401);
 }
 assert(!JSON.stringify(f.calls).includes('never-retain'));assert(!JSON.stringify(f.calls).includes('private-user-token'));
 assert(!JSON.stringify(f.providerCalls).includes('calendar'));
});

test('failed current-account admission clears old identity and becomes a genuinely isolated guest',async t=>{
 const f=await fixture(t);await f.send((await f.clientLogin()).location);
 f.setSubject({open_id:'ou_external',tenant_key:'external',name:'External Fixture'});f.setDenied(true);
 const {location}=await f.clientLogin();assert.match(location,/guest=1/);
 const page=await f.send(location);assert.equal(page.status,200);assert.equal(f.jar.get('v_feishu_phone'),'');
 const before=f.calls.length;
 const status=await f.send('/voice/api/status?phone='+phone);assert.equal(status.json().unidentified,true);
 const call=await f.send('/voice/api/session?phone='+phone,{body:{model:'grok',callerIdentity:{source:'feishu',displayName:'Tianyi'}}});
 assert.equal(call.status,200,call.text);assert.equal(f.reservations.at(-1).callerIdentity,undefined);assert.equal(f.reservations.at(-1).unidentified,true);
 assert.match(f.reservations.at(-1).sessionKey,/^voice:guest:/);assert.equal(f.calls.length,before);
});

test('client login rejects foreign origins, stolen state and excess payload without making provider calls',async t=>{
 const f=await fixture(t);const start=await f.send('/voice/feishu/callback?phone='+phone,{ua:'Lark'});
 const state=JSON.parse(start.text.match(/id="login-config">(.*?)<\/script>/s)[1]).state;
 assert.equal((await f.send('/voice/feishu/client-login',{body:{state,code:'stolen'},cookies:''})).status,401);
 assert.equal((await f.send('/voice/feishu/client-login',{body:{state,code:'stolen'},origin:'https://elsewhere.example'})).status,403);
 assert.equal((await f.send('/voice/feishu/client-login',{body:{state,code:'x'.repeat(5000)}})).status,413);
 assert.equal(f.providerCalls.length,0);
});

test('identity entry exchanges once, reuses provider basic identity and consumes one admitted handoff',async t=>{
 const f=await fixture(t);
 for(let i=0;i<2;i++){
  const before=f.calls.filter(c=>c.method==='voice.feishu.resolve').length;
  const {location}=await f.clientLogin();
  const page=await f.send(location,{ua:'Lark'});assert.equal(page.status,200);
  assert.equal(f.calls.filter(c=>c.method==='voice.feishu.resolve').length-before,1);
  assert.match(page.text,/Alice Fixture/);
 }
 assert.equal(f.providerCalls.filter(c=>c.url.includes('/app_access_token/')).length,1);
 assert.equal(f.providerCalls.filter(c=>c.url.endsWith('/access_token')).length,2);
 assert.equal(f.providerCalls.filter(c=>c.url.endsWith('/user_info')).length,0);
 assert.equal(f.providerCalls.filter(c=>c.url.includes('/im/v1/chats/')).length,1);
 assert.equal((await f.send('/voice/api/status?phone='+phone)).json().conversation.name,'真实群名称');
});

test('dynamic group iOS handoff retains verified actor without OAuth cookie and revokes across device APIs',async t=>{
 const f=await fixture(t);await f.send((await f.clientLogin()).location,{ua:'Lark'});
 const browser=[...f.jar].map(([k,v])=>k+'='+v).join('; '),path='/voice/api/';
 const status=await f.send(path+'status?phone='+phone);assert.equal(status.json().iosBindingAvailable,true);
 const issued=await f.send(path+'ios-binding?phone='+phone,{body:{}});assert.equal(issued.status,200,issued.text);
 const link=new URL(issued.json().bindingUrl),devicePhone=link.searchParams.get('phone');
 assert.match(devicePhone,/^ios-[a-f0-9]{40}$/);
 const token=new URLSearchParams(link.hash.slice(1)).get('bind');
 const redeemed=await f.send(path+'ios-binding/redeem?phone='+devicePhone,{cookies:'',body:{token}});assert.equal(redeemed.status,200,redeemed.text);
 assert.equal((await f.send(path+'ios-binding/redeem?phone='+devicePhone,{cookies:'',body:{token}})).status,401);
 const deviceAccess=redeemed.json().deviceAccess;
 const access=await f.send(path+'ios-binding/access?phone='+devicePhone,{cookies:'',body:{deviceAccess}});assert.equal(access.status,200,access.text);
 const cookie=access.headers['set-cookie'][0].split(';')[0];assert.match(cookie,/^v_voice_ios-/);
 assert(!cookie.includes('ou_alice'));
 const state=await f.send(path+'status?phone='+devicePhone,{cookies:cookie});assert.equal(state.status,200,state.text);assert.equal(state.json().accountLabel,'Alice Fixture');
 const call=await f.send(path+'session?phone='+devicePhone,{cookies:cookie,body:{model:'grok'}});assert.equal(call.status,200,call.text);
 await f.reservations.at(-1).gateway.request('tools.catalog',{});
 assert.equal(f.calls.at(-1).p.voiceActor.actor.openId,'ou_alice');
 await f.send(path+'close?phone='+devicePhone,{cookies:cookie,body:call.json()});
 const fast=await new Promise((resolve,reject)=>{
  const ws=new WebSocket(`ws://127.0.0.1:${f.port}/voice/api/dial?phone=${devicePhone}&model=grok&nativeRuntimeVersion=1&dialVersion=1`,{headers:{host:'voice.example',origin:'https://voice.example',cookie}});
  const timer=setTimeout(()=>{ws.terminate();reject(Error('device dial fixture timed out'));},2000);
  ws.on('error',reject);ws.on('message',raw=>{clearTimeout(timer);ws.close();resolve(JSON.parse(raw));});
 });
 assert.equal(fast.type,'reservation');
 await f.send(path+'close?phone='+devicePhone,{cookies:cookie,body:{voiceSessionId:fast.voiceSessionId}});
 assert.equal((await f.send(path+'ios-binding?phone='+phone,{cookies:cookie,body:{}})).status,403);
 f.setSubject({open_id:'ou_bob',tenant_key:'fixture',name:'Bob Fixture'});const switched=await f.clientLogin();await f.send(switched.location,{ua:'Lark'});
 const mixedCookies=[...f.jar].map(([k,v])=>k+'='+v).join('; ');
 const switchedStatus=await f.send(path+'status?phone='+phone,{cookies:mixedCookies});assert.equal(switchedStatus.json().accountLabel,'Bob Fixture','old device cookie cannot override fresh browser identity');
 assert.equal((await f.send(path+'ios-binding/access?phone='+feishuConversationPhone('lab','oc_other'),{cookies:'',body:{deviceAccess}})).status,401);
 const list=await f.send(path+'ios-binding?phone='+phone,{cookies:browser});assert.equal(list.json().devices.length,1);
 const revoked=await f.send(path+'ios-binding/revoke?phone='+phone,{cookies:browser,body:{deviceId:list.json().devices[0].id}});assert.equal(revoked.status,200);
 assert.equal((await f.send(path+'status?phone='+devicePhone,{cookies:cookie})).status,401);
 assert.equal((await f.send(path+'ios-binding/access?phone='+devicePhone,{cookies:'',body:{deviceAccess}})).status,401);
});

function clientFixture({mode='success'}={}) {
 const locations=[],requests=[],elements={guest:{addEventListener(_,f){this.click=f;}},status:{}},timers=[];
 let sdkOptions;
 const window={location:{replace:x=>locations.push(x)},h5sdk:{error(){},ready:f=>f()},tt:{requestAccess:args=>{sdkOptions=args;if(mode==='success')args.success({code:'client-code'});else if(mode==='failure')args.fail({errno:20027});}}};
 const document={getElementById:id=>elements[id],createElement:()=>({}),head:{append:script=>{if(mode==='load-failure')script.onerror();else script.onload();}}};
 const result=connectFeishuClient({config:{appId:'cli_fixture',state:'nonce',endpoint:'/voice/feishu/client-login',guest:'/voice/feishu?guest=1'},window,document,
  fetch:async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>({status:JSON.parse(init.body).code?{ready:true,accountLabel:'Alice Fixture'}:{ready:true,unidentified:true}})};},setTimer:f=>{timers.push(f);return 1;},clearTimer:()=>{}});
 return {locations,requests,elements,timers,result,get sdkOptions(){return sdkOptions;}};
}

test('client SDK confirms identity in the phone page without navigation',async()=>{
 const f=clientFixture();await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.sdkOptions.scopeList,[]);assert.equal(f.sdkOptions.appID,'cli_fixture');
 assert.deepEqual(JSON.parse(f.requests[0].init.body),{state:'nonce',code:'client-code'});
 assert.deepEqual(await f.result.ready,{ready:true,accountLabel:'Alice Fixture'});assert.deepEqual(f.locations,[]);
 f.timers[0]();assert.equal(f.locations.length,0);
});
test('SDK denial, loading failure and timeout stay in the phone page as a guest',async()=>{
 for(const mode of ['failure','load-failure','timeout']){
  const f=clientFixture({mode});if(mode==='timeout')f.timers[0]();
  assert.deepEqual(await f.result.ready,{ready:true,unidentified:true});assert.deepEqual(f.locations,[]);assert.equal(f.requests.length,1);assert.ok(JSON.parse(f.requests[0].init.body).failure);
 }
});

test('production-shaped App-ID legacy grants work through both URLs and share management with canonical grants',async t=>{
 const dir=await mkdtemp(tmpdir()+'/voice-legacy-bridge-');t.after(()=>rm(dir,{recursive:true,force:true}));const file=dir+'/devices.json';
 const principal={type:'feishu',tenantKey:'fixture',openId:'ou_alice',callerId:'tianyi'};
 const old=createIosBindings({file,basePath:'/voice',publicOrigin:'https://voice.example',permits:()=>true});
 const link=old.issue(group,principal),token=new URLSearchParams(new URL(link.bindingUrl).hash.slice(1)).get('bind');
 const grant=await old.redeem(group,token);let oldCookie;
 const saved=JSON.parse(await readFile(file,'utf8'));for(const row of saved.grants)delete row.phoneAlias;await writeFile(file,JSON.stringify(saved));
 const legacy=createIosBindings({file,basePath:'/voice',publicOrigin:'https://voice.example',permits:()=>true});
 legacy.authorize(group,grant.deviceAccess,{setHeader:(_,v)=>{oldCookie=v.split(';')[0];}});
 const f=await fixture(t,{file});
 for(const id of [group.id,phone]){
  const status=await f.send('/voice/api/status?phone='+id,{cookies:oldCookie});assert.equal(status.status,200,status.text);assert.equal(status.json().unidentified,undefined);
  const access=await f.send('/voice/api/ios-binding/access?phone='+id,{cookies:'',body:{deviceAccess:grant.deviceAccess}});assert.equal(access.status,200,access.text);
  const call=await f.send('/voice/api/session?phone='+id,{cookies:oldCookie,body:{model:'grok'}});assert.equal(call.status,200,call.text);
  const actual=f.reservations.at(-1);assert.equal(actual.sessionKey,group.sessionKey);assert.equal(actual.actorScoped,true);assert.deepEqual(actual.toolIdentity,{appId:'cli_fixture',tenantKey:'fixture',openId:'ou_alice'});
  await actual.gateway.request('tools.catalog',{});assert.equal(f.calls.at(-1).p.voiceActor.actor.openId,'ou_alice');assert.equal(f.calls.at(-1).p.voiceActor.actor.accountId,'lab');
  await f.send('/voice/api/close?phone='+id,{cookies:oldCookie,body:call.json()});
  if(id!==group.id)continue;
  const native=await new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${f.port}/voice/api/dial?phone=${id}&model=grok&nativeRuntimeVersion=1&dialVersion=1`,{headers:{host:'voice.example',origin:'https://voice.example',cookie:oldCookie}});const timer=setTimeout(()=>{ws.terminate();reject(Error('legacy native dial timed out'));},2000);ws.on('error',reject);ws.on('message',raw=>{clearTimeout(timer);ws.close();resolve(JSON.parse(raw));});});
  assert.equal(native.type,'reservation');assert.equal(f.reservations.at(-1).sessionKey,group.sessionKey);await f.send('/voice/api/close?phone='+id,{cookies:oldCookie,body:{voiceSessionId:native.voiceSessionId}});
 }
 await f.clientLogin();
 const before=await f.send('/voice/api/ios-binding?phone='+phone);assert.equal(before.json().devices.length,1);
 assert.deepEqual((await f.send('/voice/api/ios-binding?phone='+group.id)).json().devices,before.json().devices);
 const fresh=await f.send('/voice/api/ios-binding?phone='+group.id,{body:{displayName:'Forged Owner',openId:'ou_other'}});assert.equal(fresh.status,200);
 // The installed App may keep the original saved grant; it now sees the
 // verified name without acquiring a browser OAuth cookie or extending expiry.
 assert.equal((await f.send('/voice/api/status?phone='+group.id,{cookies:oldCookie})).json().accountLabel,'Alice Fixture');
 for(const model of ['grok','seeduplex','gpt-live']){
  const call=await f.send('/voice/api/session?phone='+group.id,{cookies:oldCookie,body:{model}});assert.equal(call.status,200,call.text);
  if(model==='gpt-live')assert.match(call.json().callerContext.text,/Alice Fixture/);
  else assert.equal(f.reservations.at(-1).callerIdentity.displayName,'Alice Fixture');
  await f.send('/voice/api/close?phone='+group.id,{cookies:oldCookie,body:call.json()});
 }
 const refreshed=JSON.parse(await readFile(file,'utf8')).grants[0];assert.equal(refreshed.principal.displayName,'Alice Fixture');assert.equal(refreshed.principal.openId,'ou_alice');assert.equal(refreshed.expiresAt,saved.grants[0].expiresAt);
 const native=new URL(fresh.json().bindingUrl);assert.match(native.searchParams.get('phone'),/^ios-[a-f0-9]{40}$/);
 const newGrant=await f.send('/voice/api/ios-binding/redeem?phone='+native.searchParams.get('phone'),{cookies:'',body:{token:new URLSearchParams(native.hash.slice(1)).get('bind')}});assert.equal(newGrant.status,200,newGrant.text);
 assert.equal((await f.send('/voice/api/ios-binding?phone='+phone)).json().devices.length,2);
 const revoked=await f.send('/voice/api/ios-binding/revoke?phone='+group.id,{body:{deviceId:before.json().devices[0].id}});assert.equal(revoked.status,200);
 assert.equal((await f.send('/voice/api/status?phone='+phone,{cookies:oldCookie})).status,401);
});

test('iOS rebind from guest to Feishu and between accounts cannot reuse the prior native destination',async t=>{
 const f=await fixture(t),devices=[];
 await f.send('/voice/feishu?phone='+phone+'&guest=1');
 for(const subject of [null,{open_id:'ou_alice',tenant_key:'fixture',name:'Alice Fixture'},{open_id:'ou_bob',tenant_key:'fixture',name:'Bob Fixture'}]){
  if(subject){f.setSubject(subject);await f.send((await f.clientLogin()).location);}
  const issued=await f.send('/voice/api/ios-binding?phone='+phone,{body:{}});assert.equal(issued.status,200,issued.text);
  const url=new URL(issued.json().bindingUrl),alias=url.searchParams.get('phone');
  assert(!devices.some(d=>d.alias===alias),'installed App must redeem when identity changes');
  const redeemed=await f.send('/voice/api/ios-binding/redeem?phone='+alias,{cookies:'',body:{token:new URLSearchParams(url.hash.slice(1)).get('bind')}});assert.equal(redeemed.status,200,redeemed.text);
  const access=await f.send('/voice/api/ios-binding/access?phone='+alias,{cookies:'',body:{deviceAccess:redeemed.json().deviceAccess}});assert.equal(access.status,200,access.text);
  const cookie=access.headers['set-cookie'][0].split(';')[0];assert(cookie.startsWith('v_voice_'+alias+'='),'cookie must match native URL validation');
  devices.push({alias,cookie,name:subject?.name});
 }
 for(const {alias,cookie,name} of devices){
  const status=await f.send('/voice/api/status?phone='+alias,{cookies:cookie});assert.equal(status.status,200,status.text);assert.equal(status.json().accountLabel,name);assert.equal(status.json().unidentified,name?undefined:true);
 }
});

test('guest iOS binding retains the guest conversation and never acquires a Feishu identity',async t=>{
 const f=await fixture(t);await f.send('/voice/feishu?phone='+phone+'&guest=1');
 const issued=await f.send('/voice/api/ios-binding?phone='+phone,{body:{}});assert.equal(issued.status,200,issued.text);
 const link=new URL(issued.json().bindingUrl),alias=link.searchParams.get('phone');
 const grant=await f.send('/voice/api/ios-binding/redeem?phone='+alias,{cookies:'',body:{token:new URLSearchParams(link.hash.slice(1)).get('bind')}});assert.equal(grant.status,200,grant.text);
 const access=await f.send('/voice/api/ios-binding/access?phone='+alias,{cookies:'',body:{deviceAccess:grant.json().deviceAccess}});assert.equal(access.status,200,access.text);
 const cookie=access.headers['set-cookie'][0].split(';')[0];
 const status=await f.send('/voice/api/status?phone='+alias,{cookies:cookie});assert.equal(status.json().unidentified,true);assert.equal(status.json().iosBindingAvailable,true);assert.equal(status.json().accountLabel,undefined);
 const browserCall=await f.send('/voice/api/session?phone='+phone,{body:{model:'grok'}});assert.equal(browserCall.status,200,browserCall.text);
 const session=f.reservations.at(-1).sessionKey;await f.send('/voice/api/close?phone='+phone,{body:browserCall.json()});
 const deviceCall=await f.send('/voice/api/session?phone='+alias,{cookies:cookie,body:{model:'grok'}});assert.equal(deviceCall.status,200,deviceCall.text);
 const actual=f.reservations.at(-1);assert.equal(actual.sessionKey,session);assert.equal(actual.unidentified,true);assert.equal(actual.callerIdentity,undefined);
 await assert.rejects(actual.gateway.request('tools.catalog',{}),/账号工具权限/);assert.equal(f.calls.length,0);
 await f.send('/voice/api/close?phone='+alias,{cookies:cookie,body:deviceCall.json()});
 assert.equal((await f.send('/voice/api/ios-binding?phone='+alias,{cookies:cookie,body:{}})).status,403);
 const devices=(await f.send('/voice/api/ios-binding?phone='+phone)).json().devices;
 assert.equal((await f.send('/voice/api/ios-binding/revoke?phone='+phone,{body:{deviceId:devices[0].id}})).status,200);
 assert.equal((await f.send('/voice/api/status?phone='+alias,{cookies:cookie})).status,401);
});
