import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
const phone=feishuConversationPhone('default','oc_group'),origin='https://voice.example';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'voice-card-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'ios.json'),api=[],rpc=[],reservations=[];let denied=false;
 const server=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:'f'.repeat(40),iosBindingsFile:file,iosPublicEntry:true,
  feishuLogin:{conversations:true,allowUnidentified:true,cardConfirmation:true,appId:'cli_app',appSecret:'fixture',accountId:'default',actors:[],fetchImpl:async(url,init)=>{
   api.push({url,init});if(url.includes('/app_access_token/'))return Response.json({code:0,app_access_token:'private-app',tenant_access_token:'private-tenant',expire:7200});
   if(url.includes('/members?'))return Response.json({code:0,data:{items:[{member_id:'ou_external',name:'外部测试成员'}]}});
   if(url.includes('/messages?'))return Response.json({code:0,data:{message_id:'om_card'}});
   if(url.includes('/chats/oc_group'))return Response.json({code:0,data:{chat_mode:'group',name:'内外部成员测试群'}});
   throw Error('OAuth must not be called');
  }},gateway:{ready:true,request:async(method,params)=>{
   rpc.push({method,params});if(denied)throw Object.assign(Error('denied'),{details:{reason:'conversation_membership_required'}});
   if(method==='voice.feishu.resolve')return {sessionKey:'agent:makaron:feishu:group:oc_group',agentId:'makaron',accountId:'default',kind:'group'};
   if(method==='sessions.describe')return {session:{key:params.key,agentId:'makaron'}};
   if(method==='tools.catalog')return {groups:[{tools:[{id:'read'}]}]};return {ok:true};
  }},directVoice:{models:()=>[{id:'grok',available:true}],reserve:async params=>{reservations.push(params);return {voiceSessionId:'fixture-'+reservations.length,provider:'grok',relayTicket:'fixture'};},close:async()=>{},dispose:async()=>{}}});
 await new Promise(r=>server.server.listen(0,'127.0.0.1',r));t.after(()=>server.dispose());
 const jar=new Map();
 const send=(path,{body,raw,cookies=jar,requestOrigin=origin,headers={}}={})=>new Promise((resolve,reject)=>{
  const cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');
  const req=httpRequest({host:'127.0.0.1',port:server.server.address().port,path:path.startsWith('/voice')?path:'/voice'+path,method:body===undefined&&raw===undefined?'GET':'POST',headers:{host:'voice.example',...(requestOrigin?{origin:requestOrigin}:{}),cookie,'content-type':'application/json',...headers}},res=>{
   for(const item of res.headers['set-cookie']??[]){const [k,...v]=item.split(';')[0].split('=');cookies.set(k,v.join('='));}
   let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers,json:()=>JSON.parse(text)}));
  });req.on('error',reject);req.end(raw??(body===undefined?undefined:JSON.stringify(body)));
 });
 const prepare=async()=>{const page=await send('/feishu/confirm?phone='+phone);assert.equal(page.status,200,page.text);return JSON.parse(page.text.match(/const c=(.*?),b=document/)[1]).state;};
 const confirm=async(state,overrides={})=>{const raw=JSON.stringify({version:1,request:state,accountId:'default',appId:'cli_app',tenantKey:'external',openId:'ou_external',chatId:'oc_group',messageId:'om_card',issuedAt:Date.now(),...overrides});return send('/feishu/confirm/callback',{raw,requestOrigin:null,headers:{'x-voice-confirm-signature':createHmac('sha256','fixture').update('voice-card-confirm-v1\n'+raw).digest('base64url')}});};
 return {send,prepare,confirm,jar,api,rpc,reservations,file,deny:()=>denied=true};
}
test('real HTTP confirmation creates an external principal; iOS retains actor and group, rejects injected identity and revocation',async t=>{
 const f=await fixture(t);await f.send('/feishu?phone='+phone+'&guest=1');
 const status=(await f.send('/api/status?phone='+phone)).json();assert.match(status.accountLoginHref,/\/feishu\/confirm\?/);
 const state=await f.prepare();assert.equal(f.jar.get('v_feishu_phone'),'');assert.equal((await f.send('/feishu/confirm/start',{body:{state}})).status,200);
 assert.equal(f.api.filter(x=>x.init.method==='POST'&&x.url.includes('/messages')).length,1);
 assert.equal((await f.confirm(state)).status,200);
 assert.equal((await f.send('/feishu/confirm/status',{body:{state},cookies:new Map()})).status,403);
 const poll=await f.send('/feishu/confirm/status',{body:{state}});assert.equal(poll.status,200,poll.text);assert.equal(poll.json().status,'complete');await f.send(poll.json().location);
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
 assert.equal((await f.send('/feishu/confirm/start',{body:{state},requestOrigin:'https://attacker.example'})).status,403);
 assert.equal((await f.send('/feishu/confirm/start',{body:{state,openId:'ou_owner'}})).status,400);
 assert.equal((await f.send('/feishu/confirm/callback',{body:{state}})).status,403);
 assert.equal((await f.send('/feishu/confirm/callback',{raw:'{}',requestOrigin:null})).status,403);assert.equal(f.rpc.length,0);
});
test('membership revoked after confirmation blocks browser redemption and cannot retain old identity',async t=>{
 const f=await fixture(t),state=await f.prepare();await f.send('/feishu/confirm/start',{body:{state}});await f.confirm(state);f.deny();
 assert.equal((await f.send('/feishu/confirm/status',{body:{state}})).status,403);assert.equal(f.jar.get('v_feishu_phone'),'');
});
