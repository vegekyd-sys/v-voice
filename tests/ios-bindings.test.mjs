import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,chmod,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {createIosBindings,iosAppDownload,IOS_BINDING_TTL_MS,IOS_DEVICE_TTL_MS} from '../lib/ios-bindings.mjs';
const binding={id:'phone-session-a',sessionKey:'agent:makaron:feishu:group:oc_a',callerId:'tianyi',accountId:'lab',accessToken:'a'.repeat(40),displayName:'设计讨论',kind:'group'};
const principal={type:'feishu',tenantKey:'tenant',openId:'ou_tianyi',callerId:'tianyi'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;}}),cookie=res=>res.headers['set-cookie'].split(';')[0];
const token=result=>new URLSearchParams(new URL(result.bindingUrl).hash.slice(1)).get('bind');
const options={basePath:'/voice',publicOrigin:'https://voice.example.com',permits:()=>true};
test('one-use handoff does not expose entry bearer and grants only the bound session',async()=>{
 const store=createIosBindings(options),link=store.issue(binding,principal);
 assert.match(new URL(link.bindingUrl).search,/^\?phone=ios-[a-f0-9]{40}$/);assert(!link.bindingUrl.includes(binding.accessToken));assert(!JSON.stringify(link).includes('sessionKey'));
 await assert.rejects(store.redeem({...binding,id:'phone-session-b'},token(link)));
 const grant=await store.redeem(binding,token(link));await assert.rejects(store.redeem(binding,token(link)));
 const res=response();assert(store.authorize(binding,grant.deviceAccess,res));const req={headers:{cookie:cookie(res)}};
 assert(store.read(req,binding));assert.equal(store.read(req,{...binding,id:'phone-session-b'}),null);
 assert.equal(store.read(req,{...binding,sessionKey:'agent:makaron:feishu:group:oc_else'}),null);
 assert.equal(store.authorize(binding,binding.accessToken,response()),null);
 assert(!JSON.stringify(store.list(binding,principal)).includes(grant.deviceAccess));
});

test('verified profile refresh persists on old grants without changing identity, expiry or revocation',async t=>{
 const dir=await mkdtemp(tmpdir()+'/voice-identity-refresh-');t.after(()=>rm(dir,{recursive:true,force:true}));const file=dir+'/devices.json';
 let store=createIosBindings({...options,file});
 const live=await store.redeem(binding,token(store.issue(binding,principal)));
 const revoked=await store.redeem(binding,token(store.issue(binding,principal)));
 await store.revoke(binding,principal,store.list(binding,principal)[1].id);
 // Actual old format: no identity-scoped alias or profile fields.
 const before=JSON.parse(await readFile(file,'utf8'));for(const row of before.grants)delete row.phoneAlias;
 await writeFile(file,JSON.stringify(before));store=createIosBindings({...options,file});
 const res=response();store.authorize(binding,live.deviceAccess,res);const req={headers:{cookie:cookie(res)}};
 assert.match(cookie(res),/^v_voice_phone-session-a=/);
 await store.refreshIdentity(binding,{...principal,openId:'ou_other',displayName:'Wrong account'});
 assert.equal(store.principalFor(req,binding.id).displayName,undefined);
 await store.refreshIdentity(binding,{...principal,displayName:'Alice',userId:'alice-user',callerId:'must-not-change'});
 store=createIosBindings({...options,file});
 assert.deepEqual(store.principalFor(req,binding.id),{...principal,displayName:'Alice',userId:'alice-user'});
 assert(store.read(req,binding));assert.equal(store.authorize(binding,revoked.deviceAccess,response()),null);
 const after=JSON.parse(await readFile(file,'utf8'));
 assert.equal(after.grants[0].expiresAt,before.grants[0].expiresAt);assert.equal(after.grants[0].tokenHash,before.grants[0].tokenHash);
 assert.equal(after.grants[1].principal.displayName,undefined);assert.equal(after.grants[1].revoked,true);
});

test('native saved destinations distinguish guest and accounts but stay stable across profile changes',()=>{
 const store=createIosBindings(options),alias=p=>new URL(store.issue(binding,p).bindingUrl).searchParams.get('phone');
 const a=alias(principal),b=alias({...principal,openId:'ou_bob'}),guest=alias({type:'guest',visitorId:'visitor-a'});
 assert.equal(new Set([a,b,guest]).size,3);assert.equal(alias({...principal,displayName:'Updated'}),a);
 assert.equal(alias({type:'guest',visitorId:'visitor-a'}),guest);
 for(const p of [a,b,guest])assert.equal(store.canonicalPhone(p),binding.id);
});
test('expiry, revocation, rotated entry secret and removed actor reject existing device cookies',async()=>{
 let at=1000,allowed=true;const store=createIosBindings({...options,now:()=>at,permits:()=>allowed});
 const old=store.issue(binding,principal);at+=IOS_BINDING_TTL_MS;await assert.rejects(store.redeem(binding,token(old)));
 const grant=await store.redeem(binding,token(store.issue(binding,principal))),res=response();store.authorize(binding,grant.deviceAccess,res);const req={headers:{cookie:cookie(res)}};
 allowed=false;assert.equal(store.read(req,binding),null);assert.equal(store.authorize(binding,grant.deviceAccess,response()),null);allowed=true;
 assert.equal(store.read(req,{...binding,accessToken:'b'.repeat(40)}),null);
 const id=store.list(binding,principal)[0].id;assert.equal(await store.revoke(binding,{...principal,openId:'ou_other'},id),false);
 assert(await store.revoke(binding,principal,id));assert.equal(store.read(req,binding),null);
 const next=await store.redeem(binding,token(store.issue(binding,principal)));at+=IOS_DEVICE_TTL_MS;assert.equal(store.authorize(binding,next.deviceAccess,response()),null);
});
test('restart retains only hashed grants; private-file boundary is enforced',async t=>{
 const dir=await mkdtemp(tmpdir()+'/voice-ios-binding-');t.after(()=>rm(dir,{recursive:true,force:true}));const file=dir+'/devices.json';
 const a=createIosBindings({...options,file}),link=a.issue(binding,principal),grant=await a.redeem(binding,token(link)),res=response();a.authorize(binding,grant.deviceAccess,res);
 const bytes=await readFile(file,'utf8');assert(!bytes.includes(grant.deviceAccess));assert(!bytes.includes(token(link)));assert(!bytes.includes(binding.accessToken));
 const b=createIosBindings({...options,file});assert(b.read({headers:{cookie:cookie(res)}},binding));await assert.rejects(b.redeem(binding,token(link)));
 await chmod(file,0o644);assert.throws(()=>createIosBindings({...options,file}),/private/);
 await chmod(file,0o600);await symlink(file,dir+'/alias.json');assert.throws(()=>createIosBindings({...options,file:dir+'/alias.json'}),/private/);
});

test('app handoff preserves exact binding in a fragment and download links are real Apple destinations',()=>{
 const link=createIosBindings(options).issue(binding,principal),app=new URL(link.appUrl);
 assert.equal(app.protocol,'vvoice:');assert.equal(app.host,'settings');assert.equal(app.pathname,'/bind');assert.equal(app.search,'');
 assert.equal(new URLSearchParams(app.hash.slice(1)).get('url'),link.bindingUrl);
 assert.equal(iosAppDownload(undefined),null);
 assert.equal(iosAppDownload('https://testflight.apple.com/join/Ab12Cd34').label,'通过 TestFlight 下载');
 assert.equal(iosAppDownload('https://apps.apple.com/cn/app/v-voice/id123456789').label,'从 App Store 下载');
 for(const url of ['https://testflight.apple.com/','https://evil.example/join/123','http://testflight.apple.com/join/123','https://testflight.apple.com/join/123?redirect=evil'])assert.throws(()=>iosAppDownload(url));
});

test('legacy device migration requires the unchanged private binding, current actor permission and exact conversation',async t=>{
 const dir=await mkdtemp(tmpdir()+'/voice-binding-alias-');t.after(()=>rm(dir,{recursive:true,force:true}));const file=dir+'/grants.json';
 const old=createIosBindings({...options,file}),issued=old.issue(binding,principal),grant=await old.redeem(binding,token(issued));const res=response();old.authorize(binding,grant.deviceAccess,res);const req={headers:{cookie:cookie(res)}};
 const current={...binding,id:'canonical-phone',accountId:'default',callerId:'feishu-owner',accessToken:'new-current-secret'.repeat(3)};
 let legacy=binding,allowed=true;
 const store=createIosBindings({...options,file,canonicalPhone:p=>p===binding.id?current.id:p,legacyBinding:()=>legacy,permits:p=>allowed&&p.openId===principal.openId});
 assert(store.principalFor(req,current.id));assert(store.read(req,current));assert.equal(store.list(current,{...principal,displayName:'Updated name',callerId:'feishu-owner'}).length,1);
 assert.equal(store.read(req,{...current,sessionKey:'different'}),null);
 legacy={...binding,accessToken:'rotated-secret'.repeat(4)};assert.equal(store.principalFor(req,current.id),null);assert.equal(store.authorize(current,grant.deviceAccess,response()),null);
 legacy=null;assert.equal(store.read(req,current),null);
 legacy=binding;allowed=false;assert.equal(store.read(req,current),null);
});
