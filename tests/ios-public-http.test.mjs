import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {createIosBindings,IOS_DEVICE_TTL_MS} from '../lib/ios-bindings.mjs';
import {createUnidentifiedPhoneDirectory} from '../lib/feishu-conversation-directory.mjs';
const keyA='a'.repeat(43),keyB='b'.repeat(43),origin='https://public.example';
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'voice-public-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'grants.json'),calls=[];
 if(options.prepareFile)await options.prepareFile(file);
 const bridge=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:'private-entry'.repeat(4),iosBindingsFile:file,iosPublicEntry:true,
  feishuLogin:{conversations:true,allowUnidentified:true,appId:'cli_test',appSecret:'test-secret',accountId:'default',actors:[]},
  gateway:{ready:true,request(){throw Error('Public must not reach private Gateway');}},
  directVoice:{models:()=>[{id:'seeduplex',available:true,nativeTransport:'pcm-relay'}],reserve:async args=>{calls.push(args);return {voiceSessionId:'public-'+calls.length,transport:'gateway-relay',provider:'seeduplex',relayTicket:'test'};},close:async()=>{},dispose:async()=>{}},...options});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
 const request=(route,body,cookie='',phone)=>new Promise((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:bridge.server.address().port,path:'/voice/api/'+route+(phone?'?phone='+phone:''),method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,origin,cookie,'content-type':'application/json'}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));
  req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 const bootstrap=async key=>{const r=await request('ios-public',{deviceKey:key});assert.equal(r.status,200);return r.json();};
 const access=async grant=>{const r=await request('ios-binding/access',{deviceAccess:grant.deviceAccess},'',grant.phone);assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 return {request,bootstrap,access,file,calls};
}
test('fresh Public uses isolated guest grants; no login/chat/token is required',async t=>{
 const f=await fixture(t),a=await f.bootstrap(keyA),b=await f.bootstrap(keyB),aa=await f.bootstrap(keyA);
 assert.deepEqual(aa,a);assert.notEqual(a.phone,b.phone);assert.equal(a.conversation.name,'Public');assert.equal(a.conversation.accountLabel,'独立访客');
 const ca=await f.access(a),cb=await f.access(b);
 const status=await f.request('status',undefined,ca,a.phone);assert.equal(status.status,200);assert.equal((await status.json()).unidentified,true);
 // A valid cookie from B cannot address A's phone or the personal entry.
 assert.notEqual((await f.request('status',undefined,cb,a.phone)).status,200);
 assert.notEqual((await f.request('status',undefined,ca)).status,200);
 for(const [g,c] of [[a,ca],[b,cb]]){
  assert.equal((await f.request('session',{model:'seeduplex',nativeRuntimeVersion:1},c,g.phone)).status,200);
  assert.notEqual((await f.request('tasks',{},c,g.phone)).status,200);
 }
 assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].sessionKey,f.calls[1].sessionKey);
 for(const call of f.calls){assert.equal(call.unidentified,true);assert.equal(call.inputPolicy,'native');assert.equal(call.replyTarget,undefined);assert.equal(call.toolIdentity,undefined);await assert.rejects(call.gateway.request('private-tool'));}
 const disk=await readFile(f.file,'utf8');assert.equal(JSON.parse(disk).grants.length,2);assert(!disk.includes(keyA));assert(!disk.includes(keyB));
});
test('Public is explicitly enabled, capacity bounded and bootstrap rejects identity injection',async t=>{
 const disabled=await fixture(t,{iosPublicEntry:false});assert.equal((await disabled.request('ios-public',{deviceKey:keyA})).status,503);
 const f=await fixture(t);
 assert.equal((await f.request('ios-public',{deviceKey:keyA,callerId:'tianyi'})).status,400);
 assert.equal((await f.request('ios-public',{deviceKey:'short'})).status,403);
 for(let i=0;i<4;i++)await f.request('ios-public',{deviceKey:keyA});
 assert.equal((await f.request('ios-public',{deviceKey:keyA})).status,429);
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).grants.length,1);
});
test('same installation survives concurrent bootstrap, service restart and device expiry without changing its guest',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-public-restart-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=1000;const file=join(dir,'grants.json'),bindingFor=id=>createUnidentifiedPhoneDirectory({publicEntry:true})({headers:{}},'public',{id});
 const options={file,basePath:'/voice',publicOrigin:origin,now:()=>now,permits:(p,b)=>p.type==='guest'&&p.visitorId===b.visitorId};
 const first=createIosBindings(options),[a,b]=await Promise.all([first.provisionPublic(keyA,bindingFor),first.provisionPublic(keyA,bindingFor)]);assert.deepEqual(a,b);
 now+=IOS_DEVICE_TTL_MS+1;const reopened=createIosBindings(options),renewed=await reopened.provisionPublic(keyA,bindingFor);
 assert.equal(renewed.phone,a.phone);assert.equal(JSON.parse(await readFile(file,'utf8')).grants.length,1);
 const principal=reopened.principalFor({headers:{}},'public',{deviceAccess:keyA}),binding=bindingFor(principal.visitorId);
 const id=reopened.list(binding,principal)[0].id;assert.equal(await reopened.revoke(binding,principal,id),true);
 await assert.rejects(reopened.provisionPublic(keyA,bindingFor));
});

test('expired Public HTTP device grant can renew the same guest using the installation credential',async t=>{
 let old;
 const f=await fixture(t,{prepareFile:async file=>{
  const bindingFor=id=>createUnidentifiedPhoneDirectory({publicEntry:true})({headers:{}},'public',{id});
  const store=createIosBindings({file,basePath:'/voice',publicOrigin:origin,now:()=>Date.now()-IOS_DEVICE_TTL_MS-1000,permits:()=>true});
  old=await store.provisionPublic(keyA,bindingFor);
 }});
 assert.equal((await f.request('ios-binding/access',{deviceAccess:keyA},'',old.phone)).status,401);
 const renewed=await f.bootstrap(keyA);assert.equal(renewed.phone,old.phone);
 const cookie=await f.access(renewed);assert.equal((await f.request('status',undefined,cookie,old.phone)).status,200);
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).grants.length,1);
});
