import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
const phone=feishuConversationPhone('default','oc_group'),origin='https://voice.example';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'voice-card-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'ios.json'),api=[],rpc=[],reservations=[];let denied=false,clientIdentity=null,time=Date.now();
 const server=createLiveH5Server({enableGrok:true,basePath:'/voice',publicOrigin:origin,accessToken:'f'.repeat(40),iosBindingsFile:file,iosPublicEntry:true,
  feishuLogin:{conversations:true,allowUnidentified:true,cardConfirmation:true,appId:'cli_app',appSecret:'fixture',accountId:'default',actors:[],now:()=>time,fetchImpl:async(url,init)=>{
   api.push({url,init});if(url.includes('/app_access_token/'))return Response.json({code:0,app_access_token:'private-app',tenant_access_token:'private-tenant',expire:7200});
   if(url.includes('/members?'))return Response.json({code:0,data:{items:[{member_id:'ou_external',name:'外部测试成员'}]}});
   if(url.includes('/messages?'))return Response.json({code:0,data:{message_id:'om_card'}});
   if(url.includes('/chats/oc_group'))return Response.json({code:0,data:{chat_mode:'group',name:'内外部成员测试群'}});
   if(url.endsWith('/access_token')&&clientIdentity)return Response.json({code:0,data:{access_token:'private-user-token',...clientIdentity}});
   throw Error('OAuth must not be called');
  }},gateway:{ready:true,request:async(method,params)=>{
   rpc.push({method,params});if(denied)throw Object.assign(Error('denied'),{details:{reason:'conversation_membership_required'}});
   if(method==='voice.feishu.resolve')return {sessionKey:'agent:makaron:feishu:group:oc_group',agentId:'makaron',accountId:'default',kind:'group'};
   if(method==='sessions.describe')return {session:{key:params.key,agentId:'makaron'}};
   if(method==='tools.catalog')return {groups:[{tools:[{id:'read'}]}]};return {ok:true};
  }},directVoice:{models:()=>[{id:'grok',available:true}],reserve:async params=>{reservations.push(params);return {voiceSessionId:'fixture-'+reservations.length,provider:'grok',relayTicket:'fixture'};},attach:(_id,_ticket,client)=>{client.send(JSON.stringify({type:'ready'}));return true;},close:async()=>{},dispose:async()=>{}}});
 await new Promise(r=>server.server.listen(0,'127.0.0.1',r));t.after(()=>server.dispose());
 const jar=new Map();
 const send=(path,{body,raw,cookies=jar,requestOrigin=origin,headers={},delayBodyMs=0}={})=>new Promise((resolve,reject)=>{
  const cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');
  const req=httpRequest({host:'127.0.0.1',port:server.server.address().port,path:path.startsWith('/voice')?path:'/voice'+path,method:body===undefined&&raw===undefined?'GET':'POST',headers:{host:'voice.example',...(requestOrigin?{origin:requestOrigin}:{}),cookie,'content-type':'application/json',...headers}},res=>{
   for(const item of res.headers['set-cookie']??[]){const [k,...v]=item.split(';')[0].split('=');cookies.set(k,v.join('='));}
   let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers,json:()=>JSON.parse(text)}));
  });req.on('error',reject);
  if(delayBodyMs){req.flushHeaders();setTimeout(()=>req.end(raw??JSON.stringify(body)),delayBodyMs);}
  else req.end(raw??(body===undefined?undefined:JSON.stringify(body)));
 });
 const prepare=async()=>{const response=await send('/feishu/confirm/prepare?phone='+phone,{body:{}});assert.equal(response.status,200,response.text);assert.equal(response.json().entry.unidentified,true);return response.json().state;};
 const confirm=async(state,overrides={})=>{const raw=JSON.stringify({version:1,request:state,accountId:'default',appId:'cli_app',tenantKey:'external',openId:'ou_external',chatId:'oc_group',messageId:'om_card',issuedAt:Date.now(),...overrides});return send('/feishu/confirm/callback',{raw,requestOrigin:null,headers:{'x-voice-confirm-signature':createHmac('sha256','fixture').update('voice-card-confirm-v1\n'+raw).digest('base64url')}});};
 const login=async()=>{const state=await prepare();await send('/feishu/confirm/start',{body:{state}});assert.equal((await confirm(state)).status,200);assert.equal((await send('/feishu/confirm/status',{body:{state}})).json().status,'complete');};
 const reopen=async()=>{
  const start=await send('/feishu?phone='+phone,{headers:{'user-agent':'Lark/7.0'}});assert.equal(start.status,302);
  const page=await send(start.headers.location,{headers:{'user-agent':'Lark/7.0'}});assert.equal(page.status,200);
  return JSON.parse(page.text.match(/id="login-config">(.*?)<\/script>/s)[1]).state;
 };
 return {send,prepare,confirm,login,reopen,jar,api,rpc,reservations,file,port:server.server.address().port,deny:()=>denied=true,setClientIdentity:value=>clientIdentity=value,advance:ms=>time+=ms};
}

test('HTTP and native one-connection dialing reuse only their own fresh membership admission',async t=>{
 const f=await fixture(t);await f.login();
 const count=()=>f.rpc.filter(r=>r.method==='voice.feishu.resolve').length;
 let before=count();
 const first=await f.send('/api/session?phone='+phone,{body:{model:'grok'}});
 assert.equal(first.status,200,first.text);assert.equal(count()-before,1);
 await f.send('/api/close?phone='+phone,{body:first.json()});before=count();
 const reservation=await new Promise((resolve,reject)=>{
  const client=new WebSocket(`ws://127.0.0.1:${f.port}/voice/api/dial?phone=${phone}&model=grok&nativeRuntimeVersion=1&dialVersion=1`,
   {headers:{host:'voice.example',origin,cookie:[...f.jar].map(([k,v])=>k+'='+v).join('; ')}});
  const timer=setTimeout(()=>{client.terminate();reject(Error('fixture timeout'));},2000);
  client.on('error',reject);client.on('message',raw=>{const value=JSON.parse(raw);if(value.type==='reservation'){clearTimeout(timer);client.close();resolve(value);}});
 });
 assert.equal(count()-before,1);await f.send('/api/close?phone='+phone,{body:reservation});
 f.deny();const denied=await f.send('/api/session?phone='+phone,{body:{model:'grok'}});
 assert.equal(denied.status,200);assert.equal(f.reservations.at(-1).unidentified,true);
 assert.equal(f.reservations.at(-1).toolIdentity,undefined,'revoked browser may only use its existing isolated guest path');
 assert.equal(count()-before,3,'close and the next request each re-admit; no cross-request reuse');
});

test('slow request bodies cannot reuse a stale membership admission',async t=>{
 const f=await fixture(t);await f.login();
 const before=f.rpc.length;
 const pending=f.send('/api/session?phone='+phone,{body:{model:'grok'},delayBodyMs:1200});
 while(f.rpc.length===before)await new Promise(r=>setTimeout(r,5));
 f.deny();assert.notEqual((await pending).status,200);assert.equal(f.reservations.length,0);
 assert.equal(f.rpc.slice(before).filter(r=>r.method==='voice.feishu.resolve').length,2);
});

test('card-confirmed browser survives reopening and external SDK refusal without renewing its grant',async t=>{
 const f=await fixture(t);await f.login();const saved=f.jar.get('v_feishu_phone');
 for(let i=0;i<2;i++){
  const state=await f.reopen();
  assert.equal(f.jar.get('v_feishu_phone'),saved,'opening the phone must not erase the explicit browser confirmation');
  const response=await f.send('/feishu/client-login',{body:{state,failure:{code:20027}}});assert.equal(response.status,200);
  assert.equal(response.json().status.accountLabel,'外部测试成员');assert.equal(response.json().status.unidentified,undefined);
  assert.equal(response.json().status.conversation.replySync,true);assert.equal(response.json().status.confirmationAvailable,true);
  assert.match(response.json().status.accountLoginHref,/\/feishu\/confirm\?/);
  assert.equal(f.jar.get('v_feishu_phone'),saved,'resume neither replaces the cookie nor extends the 30-day expiry');
  assert.equal((await f.send('/api/status?phone='+phone)).json().accountLabel,'外部测试成员');
 }
 assert.equal(f.api.filter(x=>x.init.method==='POST'&&x.url.includes('/messages')).length,1,'no new confirmation card on reopening');
 assert.equal(f.reservations.length,0,'reopening never starts a call');
});

test('resuming a card-confirmed browser still checks live membership and fails closed',async t=>{
 const f=await fixture(t);await f.login();const state=await f.reopen();f.deny();
 const response=await f.send('/feishu/client-login',{body:{state,failure:{code:20027}}});assert.equal(response.status,200);
 assert.equal(response.json().status.unidentified,true);assert.equal(response.json().status.accountLabel,undefined);
 assert.equal(f.jar.get('v_feishu_phone'),'');
});

test('cached browser code carries no account status and never caches membership admission',async t=>{
 const f=await fixture(t);await f.login();
 const page=await f.send('/feishu?phone='+phone);
 assert.equal(page.headers['cache-control'],'no-store');
 const path=page.text.match(/src="\.\/(app-bundle\.mjs\?v=[a-f0-9]{64})"/)?.[1];assert(path);
 const code=await f.send('/'+path);assert.equal(code.status,200);
 assert.match(code.headers['cache-control'],/private.*immutable/);
 assert(!code.text.includes('外部测试成员')&&!code.text.includes('oc_group')&&!code.text.includes('ou_external'));
 const before=f.rpc.filter(r=>r.method==='voice.feishu.resolve').length;
 assert.equal((await f.send('/api/status?phone='+phone)).json().accountLabel,'外部测试成员');
 assert.equal(f.rpc.filter(r=>r.method==='voice.feishu.resolve').length,before+1);
 f.deny();const denied=await f.send('/api/status?phone='+phone);
 assert.equal(denied.headers['cache-control'],'no-store');assert.equal(denied.json().accountLabel,undefined);
 assert.equal(denied.json().unidentified,true);
 assert.equal(f.reservations.length,0);
});

test('card login survives a new server instance but expires after its original 30 days',async t=>{
 const first=await fixture(t);await first.login();
 const restarted=await fixture(t);for(const [key,value] of first.jar)restarted.jar.set(key,value);
 const state=await restarted.reopen();const resumed=await restarted.send('/feishu/client-login',{body:{state,failure:{code:20027}}});
 assert.equal(resumed.json().status.accountLabel,'外部测试成员');
 assert.equal(restarted.api.filter(x=>x.url.includes('/messages')).length,0);
 restarted.advance(31*86400000);
 const expired=await restarted.reopen();const guest=await restarted.send('/feishu/client-login',{body:{state:expired,failure:{code:20027}}});
 assert.equal(guest.json().status.unidentified,true);assert.equal(restarted.jar.get('v_feishu_phone'),'');
});

test('explicit reconnect clears the saved card identity; a stale SDK request cannot restore it',async t=>{
 const f=await fixture(t);await f.login();const state=await f.reopen();await f.prepare();
 const response=await f.send('/feishu/client-login',{body:{state,failure:{code:20027}}});assert.equal(response.status,200);
 assert.equal(response.json().status.unidentified,true);assert.equal(f.jar.get('v_feishu_phone'),'');
});

test('Public stays isolated and offers an explicit route back to the saved account',async t=>{
 const f=await fixture(t);await f.login();const saved=f.jar.get('v_feishu_phone');
 const page=await f.send('/?phone=public');assert.equal(page.status,200);
 const status=(await f.send('/api/status?phone=public')).json();
 assert.equal(status.unidentified,true);assert.equal(status.accessContext.mode,'public');assert.equal(status.conversation.replySync,false);
 assert.equal(status.returnToAccountHref,'/voice/feishu?phone='+phone);assert.equal(status.accountLabel,undefined);
 assert(page.text.includes('returnToAccountHref'));assert.equal(f.jar.get('v_feishu_phone'),saved);
 const state=await f.reopen();const resumed=await f.send('/feishu/client-login',{body:{state,failure:{code:20027}}});
 assert.equal(resumed.json().status.accountLabel,'外部测试成员');
 const stranger=await f.send('/?phone=public',{cookies:new Map()});assert(!stranger.text.includes('returnToAccountHref'));
});

test('fresh SDK identity replaces a saved card identity and cannot be resumed after a later SDK refusal',async t=>{
 const f=await fixture(t);await f.login();const state=await f.reopen();
 f.setClientIdentity({open_id:'ou_internal',tenant_key:'internal',name:'内部测试成员'});
 const identified=await f.send('/feishu/client-login',{body:{state,code:'valid-code'}});
 assert.equal(identified.json().status.accountLabel,'内部测试成员');
 const next=await f.reopen();const failed=await f.send('/feishu/client-login',{body:{state:next,failure:{code:20027}}});
 assert.equal(failed.json().status.unidentified,true);assert.equal(failed.json().status.accountLabel,undefined);
 assert.equal(f.jar.get('v_feishu_phone'),'');
});
test('real HTTP confirmation creates an external principal; iOS retains actor and group, rejects injected identity and revocation',async t=>{
 const f=await fixture(t);await f.send('/feishu?phone='+phone+'&guest=1');
 const status=(await f.send('/api/status?phone='+phone)).json();assert.match(status.accountLoginHref,/\/feishu\/confirm\?/);
 const state=await f.prepare();assert.equal(f.jar.get('v_feishu_phone'),'');assert.equal((await f.send('/feishu/confirm/start',{body:{state}})).status,200);
 assert.equal(f.api.filter(x=>x.init.method==='POST'&&x.url.includes('/messages')).length,1);
 assert.equal((await f.confirm(state)).status,200);
 assert.equal((await f.send('/feishu/confirm/status',{body:{state},cookies:new Map()})).status,403);
 const poll=await f.send('/feishu/confirm/status',{body:{state}});assert.equal(poll.status,200,poll.text);assert.equal(poll.json().status,'complete');assert.equal(poll.json().entry.accountLabel,'外部测试成员');
 const identified=(await f.send('/api/status?phone='+phone)).json();assert.equal(identified.accountLabel,'外部测试成员');assert.equal(identified.conversation.name,'内外部成员测试群');assert.equal(identified.conversation.replySync,true);
 assert(!f.api.some(x=>x.url.includes('/user_info')||x.url.includes('/oauth/')||x.url.includes('/authen/')));
 assert.equal((await f.confirm(state)).status,403);
 const issued=await f.send('/api/ios-binding?phone='+phone,{body:{}});assert.equal(issued.status,200,issued.text);
 const link=new URL(issued.json().bindingUrl),alias=link.searchParams.get('phone'),token=new URLSearchParams(link.hash.slice(1)).get('bind');
 const native=new Map();const grant=await f.send('/api/ios-binding/redeem?phone='+alias,{cookies:native,body:{token}});assert.equal(grant.status,200,grant.text);
 assert.match(grant.json().conversation.accountLabel,/^外部测试成员 · [a-f0-9]{8}$/);assert.equal(grant.json().conversation.kind,'group');
 assert.equal((await f.send('/api/ios-binding/access?phone='+alias,{cookies:native,body:{deviceAccess:grant.json().deviceAccess}})).status,200);
 const deviceStatus=(await f.send('/api/status?phone='+alias,{cookies:native})).json();assert.equal(deviceStatus.accountLabel,'外部测试成员');assert.equal(deviceStatus.conversation.name,'内外部成员测试群');
 const call=await f.send('/api/session?phone='+alias,{cookies:native,body:{model:'grok',callerId:'tianyi',sessionKey:'owner',callerIdentity:{displayName:'Owner'},toolIdentity:{openId:'ou_owner'}}});assert.equal(call.status,200,call.text);
 const reservation=f.reservations.at(-1);assert.equal(reservation.callerIdentity.displayName,'外部测试成员');assert.equal(reservation.sessionKey,'agent:makaron:feishu:group:oc_group');assert.equal(reservation.toolIdentity.openId,'ou_external');
 await reservation.gateway.request('tools.catalog',{});assert.equal(f.rpc.at(-1).params.voiceActor.actor.openId,'ou_external');assert.equal(f.rpc.at(-1).params.voiceActor.actor.chatId,'oc_group');
 await f.send('/api/close?phone='+alias,{cookies:native,body:call.json()});
 const persisted=JSON.parse(await readFile(f.file,'utf8'));assert.equal(persisted.grants[0].principal.openId,'ou_external');assert.equal(persisted.grants[0].principal.displayName,'外部测试成员');
 assert(!JSON.stringify(persisted).includes('private-tenant'));
 const devices=(await f.send('/api/ios-binding?phone='+phone)).json().devices;assert.equal(devices.length,1);
 assert.equal((await f.send('/api/ios-binding/revoke?phone='+phone,{body:{deviceId:devices[0].id}})).status,200);
 assert.notEqual((await f.send('/api/status?phone='+alias,{cookies:native})).status,200);
});
test('HTTP origin protection, body fields and callback authentication cannot be bypassed',async t=>{
 const f=await fixture(t),state=await f.prepare();
 assert.equal((await f.send('/feishu/confirm/prepare?phone='+phone,{body:{openId:'ou_owner'}})).status,400);
 assert.equal((await f.send('/feishu/confirm/start',{body:{state},requestOrigin:'https://attacker.example'})).status,403);
 assert.equal((await f.send('/feishu/confirm/start',{body:{state,openId:'ou_owner'}})).status,400);
 assert.equal((await f.send('/feishu/confirm/callback',{body:{state}})).status,403);
 assert.equal((await f.send('/feishu/confirm/callback',{raw:'{}',requestOrigin:null})).status,403);assert.equal(f.rpc.length,0);
});
test('membership revoked after confirmation blocks browser redemption and cannot retain old identity',async t=>{
 const f=await fixture(t),state=await f.prepare();await f.send('/feishu/confirm/start',{body:{state}});await f.confirm(state);f.deny();
 assert.equal((await f.send('/feishu/confirm/status',{body:{state}})).status,403);assert.equal(f.jar.get('v_feishu_phone'),'');
});

test('legacy link serves the phone; inline prepare and cancel are protected and never grant identity',async t=>{
 const f=await fixture(t);
 const page=await f.send('/feishu/confirm?phone='+phone);assert.equal(page.status,200);assert.match(page.text,/ui-bundle|app.js/);assert(!page.text.includes('id="start">发送确认卡片'));
 assert.equal(f.api.filter(x=>x.init.method==='POST'&&x.url.includes('/messages')).length,0);
 assert.equal((await f.send('/feishu/confirm/prepare?phone='+phone,{body:{},requestOrigin:'https://attacker.example'})).status,403);
 const state=await f.prepare();await f.send('/feishu/confirm/start',{body:{state}});
 assert.equal((await f.send('/feishu/confirm/cancel',{body:{state}})).status,200);
 assert.equal((await f.confirm(state)).status,403);
 assert.equal((await f.send('/api/status?phone='+phone)).json().unidentified,true);
});
