import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
import {connectFeishuClient} from '../lab/gpt-live-h5/feishu-client-login.mjs';

const phone=feishuConversationPhone('lab','oc_groupa');
const group={id:'feishu-group-fixture',agentId:'makaron',sessionKey:'agent:makaron:feishu:group:oc_groupa',accountId:'lab',kind:'group',callerId:'tianyi',permissionProfile:'personal-tianyi',accessToken:'group-only-token'.repeat(4)};
const dm={...group,id:'feishu-dm-fixture',kind:'dm',sessionKey:'agent:makaron:feishu:direct:ou_alice',accessToken:'dm-only-token'.repeat(4)};
async function fixture(t) {
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
 const server=createLiveH5Server({gateway,publicOrigin:'https://voice.example',basePath:'/voice',accessToken:'private-fixture-token'.repeat(4),conversationEntries:[group,dm],
  directVoice:{models:()=>[{id:'seeduplex',available:true},{id:'grok',available:true}],reserve:async p=>{reservations.push(p);return {voiceSessionId:'fixture-call-'+(++n),relayTicket:'fixture',provider:p.model};},close:async()=>{},dispose:async()=>{}},
  feishuLogin:{appId:'cli_fixture',appSecret:'fixture-private-secret',accountId:'lab',conversations:true,allowUnidentified:true,
   actors:[{openId:'ou_alice',tenantKey:'fixture',callerId:'tianyi',defaultPhoneId:dm.id,phoneIds:[group.id,dm.id]}],
   fetchImpl:async(url,init)=>{
    providerCalls.push({url,body:init?.body});
    if(url.includes('/app_access_token/'))return Response.json({code:0,app_access_token:'private-app-token',expire:7200});
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
  const page=await send('/voice/feishu?phone='+phone,{ua:'Lark/7.0'});assert.equal(page.status,200);assert.match(page.text,/正在识别当前飞书账号/);
  const state=JSON.parse(page.text.match(/id="login-config">(.*?)<\/script>/s)[1]).state;
  const finish=await send('/voice/feishu/client-login',{body:{state,code:'valid-code',name:'Forged Tianyi',callerId:'tianyi'}});
  assert.equal(finish.status,200);return {state,location:finish.json().location};
 };
 return {send,jar,calls,reservations,providerCalls,clientLogin,setSubject:s=>subject=s,setDenied:v=>reject=v};
}

test('old group aliases and new group URLs use current account identity, including switching accounts in one browser',async t=>{
 const f=await fixture(t);
 const old=await f.send('/voice/feishu?phone='+group.id);assert.equal(old.headers.location,'/voice/feishu?phone='+phone+'#');
 assert.equal((await f.send('/voice/?phone='+group.id)).headers.location,'/voice/feishu?phone='+phone+'#');
 const personal=await f.send('/voice/feishu?phone='+dm.id);assert.match(personal.headers.location,/accounts.feishu.cn/);
 for(const [open_id,name] of [['ou_alice','Alice Fixture'],['ou_bob','Bob Fixture']]){
  f.setSubject({open_id,tenant_key:'fixture',name,email:'never-retain@example.com'});
  const {state,location}=await f.clientLogin();assert.match(location,/identified=/);
  const page=await f.send(location,{ua:'Lark/7.0'});assert.equal(page.status,200);assert.match(page.text,new RegExp(name));
  const status=await f.send('/voice/api/status?phone='+phone);assert.equal(status.json().accountLabel,name);
  const refresh=await f.send(location,{ua:'Lark/7.0'});assert.equal(refresh.status,200);assert.match(refresh.text,/正在识别当前飞书账号/);
  const call=await f.send('/voice/api/session?phone='+phone,{body:{model:'grok',callerIdentity:{source:'feishu',displayName:'Fake Owner'}}});assert.equal(call.status,200,call.text);
  const actual=f.reservations.at(-1);assert.equal(actual.callerIdentity.displayName,name);assert.equal(actual.sessionKey,group.sessionKey);assert.equal(actual.actorScoped,true);
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
 const f=await fixture(t);const start=await f.send('/voice/feishu?phone='+phone,{ua:'Lark'});
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
  fetch:async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>({location:'/voice/feishu?identified=1'})};},setTimer:f=>{timers.push(f);return 1;},clearTimer:()=>{}});
 return {locations,requests,elements,timers,result,get sdkOptions(){return sdkOptions;}};
}

test('client SDK requests basic identity and only sends the code, then follows verified server result',async()=>{
 const f=clientFixture();await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.sdkOptions.scopeList,[]);assert.equal(f.sdkOptions.appID,'cli_fixture');
 assert.deepEqual(JSON.parse(f.requests[0].init.body),{state:'nonce',code:'client-code'});
 assert.deepEqual(f.locations,['/voice/feishu?identified=1']);
 f.timers[0]();assert.equal(f.locations.length,1);
});
test('SDK denial, loading failure and timeout fall back once, without reusing the old account',()=>{
 for(const mode of ['failure','load-failure','timeout']){
  const f=clientFixture({mode});f.timers[0]();f.timers[0]();
  assert.deepEqual(f.locations,['/voice/feishu?guest=1']);assert.equal(f.requests.length,0);
 }
});
