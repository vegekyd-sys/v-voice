import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
import {voiceAccessContext,resolveFixedDeviceRecord} from '../lib/access-context.mjs';
import {parseDeviceEntries} from '../lab/realtime-direct-tools/device-endpoint.mjs';
const fixed={id:'fixed-office',agentId:'makaron',accountId:'fixture-account',callerId:'tianyi',permissionProfile:'personal-tianyi',sessionKey:'agent:makaron:feishu:group:oc_fixed',kind:'group',displayName:'固定工作会话',accountLabel:'工作账号',accessToken:'f'.repeat(40)};
const dynamic=feishuConversationPhone('fixture-account','oc_dynamic');
async function fixture(t,{enabled=true}={}){
 const dir=await mkdtemp(join(tmpdir(),'voice-unified-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[],rpc=[];
 const bridge=createLiveH5Server({basePath:'/voice',publicOrigin:'https://voice.example',accessToken:'p'.repeat(40),iosBindingsFile:join(dir,'grants.json'),iosPublicEntry:enabled,publicTools:true,conversationEntries:[fixed],
  feishuLogin:{conversations:true,allowUnidentified:true,appId:'cli_fixture',appSecret:'fixture-secret',accountId:'fixture-account',actors:[]},
  gateway:{ready:true,request:async(method,params)=>{rpc.push({method,params});if(method==='tools.catalog')return {groups:[{tools:[{id:'web_search'},{id:'memory_search'},{id:'exec'}]}]};if(method==='sessions.describe')return {session:{key:params.key,agentId:'makaron'}};return {ok:true};}},
  directVoice:{models:()=>[{id:'seeduplex',available:true},{id:'grok',available:true}],reserve:async args=>{calls.push(args);return {voiceSessionId:'fixture-'+calls.length,relayTicket:'fixture',provider:args.model};},close:async()=>{},dispose:async()=>{}}});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
 const send=(path,{body,cookie='',origin='https://voice.example'}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:bridge.server.address().port,path:'/voice'+path,method:body===undefined?'GET':'POST',headers:{host:'voice.example',origin,cookie,'content-type':'application/json'}},res=>{
   let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers,json:()=>JSON.parse(text),cookie:(res.headers['set-cookie']??[]).map(v=>v.split(';')[0]).join('; ')}));
  });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });return {send,calls,rpc};
}
for(const entry of ['standalone browser','Feishu guest'])test(entry+' uses the same Public tool contract with an isolated conversation',async t=>{
 const f=await fixture(t),phone=entry==='Feishu guest'?dynamic:'public';
 const page=await f.send(entry==='Feishu guest'?'/feishu?phone='+phone+'&guest=1':'/?phone=public');assert.equal(page.status,200);
 assert.match(page.text,/"mode":"public"/);assert.match(page.text,/Public/);
 const opts={cookie:page.cookie};const status=(await f.send('/api/status?phone='+phone,opts)).json();
 assert.deepEqual(status.accessContext.capabilities,['conversation','web_search','memory_search','background_tasks','show_content']);
 assert.equal(status.conversation.name,'Public');assert.equal(status.models.find(m=>m.id==='gpt-live').available,false);
 assert.equal((await f.send('/api/session?phone='+phone,{...opts,body:{model:'seeduplex',callerId:'tianyi',sessionKey:fixed.sessionKey}})).status,200);
 const call=f.calls.at(-1);assert.equal(call.gateway.publicVoice,true);assert.match(call.sessionKey,/^voice:guest:/);assert.notEqual(call.sessionKey,fixed.sessionKey);assert.equal(call.toolIdentity,undefined);assert.equal(call.replyTarget,undefined);
 const catalog=await call.gateway.request('tools.catalog');assert.deepEqual(catalog.groups[0].tools.map(t=>t.id),['web_search','memory_search']);
 await assert.rejects(call.gateway.request('tools.invoke',{name:'exec',args:{command:'not allowed'}}),/unavailable/);
 assert.equal((await f.send('/api/session?phone='+phone,{...opts,origin:'https://foreign.example',body:{model:'grok'}})).status,403);
 const second=await f.send('/?phone=public');await f.send('/api/session?phone=public',{cookie:second.cookie,body:{model:'grok'}});
 assert.notEqual(f.calls.at(-1).sessionKey,call.sessionKey);
 assert.equal((await f.send('/api/status?phone='+fixed.id,opts)).status,401);
});
test('private failure offers Public without authorizing or replaying the fixed operation',async t=>{
 const f=await fixture(t);
 const invalid=await f.send('/api/access?phone='+fixed.id,{body:{access:'wrong'}});assert.equal(invalid.status,403);assert.equal(invalid.json().publicHref,'/voice/?phone=public');assert.equal(f.calls.length,0);
 const access=await f.send('/api/access?phone='+fixed.id,{body:{access:fixed.accessToken}});
 const status=(await f.send('/api/status?phone='+fixed.id,{cookie:access.cookie})).json();assert.equal(status.accessContext.entryKind,'fixed');assert.equal(status.accessContext.accountLabel,'工作账号');
 await f.send('/api/session?phone='+fixed.id,{cookie:access.cookie,body:{model:'seeduplex'}});
 assert.equal(f.calls.at(-1).sessionKey,fixed.sessionKey);assert.equal(f.calls.at(-1).unidentified,undefined);
 const publicPage=await f.send('/?phone=public');assert.equal(f.calls.length,1,'choosing Public never dials or replays a task');
 assert.equal((await f.send('/api/status?phone='+fixed.id,{cookie:access.cookie})).status,200,'Public preparation keeps the original fixed grant');
 assert.equal((await f.send('/api/status?phone='+fixed.id,{cookie:publicPage.cookie})).status,401);
});
test('Public rollback flag removes browser admission and tool enablement',async t=>{
 const f=await fixture(t,{enabled:false});assert.notEqual((await f.send('/?phone=public')).status,200);
 const page=await f.send('/feishu?phone='+dynamic+'&guest=1');assert.equal(page.status,200);
 await f.send('/api/session?phone='+dynamic,{cookie:page.cookie,body:{model:'grok'}});
 assert.notEqual(f.calls.at(-1).gateway.publicVoice,true);await assert.rejects(f.calls.at(-1).gateway.request('tools.catalog'));
});
test('fixed web and hardware share mapping while rejecting overrides, disabled entries and identity leakage',()=>{
 const input={id:'speaker-fixture',phoneEntry:fixed.id,token:'device-token'.repeat(4),model:'seeduplex'};
 const mapped=resolveFixedDeviceRecord(input,[fixed]);assert.equal(mapped.callerId,fixed.callerId);assert.equal(mapped.sessionKey,fixed.sessionKey);assert.equal(mapped.accountId,fixed.accountId);
 const [device]=parseDeviceEntries([input],[fixed]);assert.equal(device.sessionKey,fixed.sessionKey);assert.deepEqual(device.accessContext,voiceAccessContext(fixed));
 for(const patch of [{sessionKey:'agent:makaron:feishu:direct:ou_other'},{callerId:'other'},{accountId:'other'}])assert.throws(()=>parseDeviceEntries([{...input,...patch}],[fixed]),/Conflicting/);
 assert.throws(()=>parseDeviceEntries([input],[{...fixed,disabled:true}]),/unavailable/);
 assert.throws(()=>parseDeviceEntries([input],[]),/unavailable/);
 const presentation=JSON.stringify(device.accessContext);for(const secret of [fixed.sessionKey,fixed.accessToken,input.token,'oc_fixed'])assert(!presentation.includes(secret));
});

test('browser Public cannot replace a missing or revoked native grant through its alias',async t=>{
 const f=await fixture(t),page=await f.send('/?phone=public'),cookie=page.cookie;
 const handoff=(await f.send('/api/ios-binding?phone=public',{cookie,body:{}})).json();
 const link=new URL(handoff.bindingUrl),alias=link.searchParams.get('phone'),token=new URLSearchParams(link.hash.slice(1)).get('bind');
 assert(alias.startsWith('ios-'));
 assert.notEqual((await f.send('/api/status?phone='+alias,{cookie})).status,200,'a browser cookie cannot stand in for a native grant');
 const grant=(await f.send('/api/ios-binding/redeem?phone='+alias,{body:{token}})).json();
 const native=await f.send('/api/ios-binding/access?phone='+alias,{body:{deviceAccess:grant.deviceAccess}});assert.equal(native.status,200);
 const devices=(await f.send('/api/ios-binding?phone=public',{cookie})).json().devices;
 assert.equal((await f.send('/api/ios-binding/revoke?phone=public',{cookie,body:{deviceId:devices[0].id}})).status,200);
 assert.notEqual((await f.send('/api/status?phone='+alias,{cookie:cookie+'; '+native.cookie})).status,200,'revoked alias stays rejected even with a valid browser guest cookie');
 assert.equal((await f.send('/api/status?phone=public',{cookie})).status,200,'explicit browser Public remains usable');
});
