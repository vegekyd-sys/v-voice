import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,chmod,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {createIosBindings,IOS_BINDING_TTL_MS,IOS_DEVICE_TTL_MS} from '../lib/ios-bindings.mjs';
const binding={id:'phone-session-a',sessionKey:'agent:makaron:feishu:group:oc_a',callerId:'tianyi',accountId:'lab',accessToken:'a'.repeat(40),displayName:'设计讨论',kind:'group'};
const principal={type:'feishu',tenantKey:'tenant',openId:'ou_tianyi',callerId:'tianyi'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;}}),cookie=res=>res.headers['set-cookie'].split(';')[0];
const token=result=>new URLSearchParams(new URL(result.bindingUrl).hash.slice(1)).get('bind');
const options={basePath:'/voice',publicOrigin:'https://voice.example.com',permits:()=>true};
test('one-use handoff does not expose entry bearer and grants only the bound session',async()=>{
 const store=createIosBindings(options),link=store.issue(binding,principal);
 assert.equal(new URL(link.bindingUrl).search,'?phone=phone-session-a');assert(!link.bindingUrl.includes(binding.accessToken));assert(!JSON.stringify(link).includes('sessionKey'));
 await assert.rejects(store.redeem({...binding,id:'phone-session-b'},token(link)));
 const grant=await store.redeem(binding,token(link));await assert.rejects(store.redeem(binding,token(link)));
 const res=response();assert(store.authorize(binding,grant.deviceAccess,res));const req={headers:{cookie:cookie(res)}};
 assert(store.read(req,binding));assert.equal(store.read(req,{...binding,id:'phone-session-b'}),null);
 assert.equal(store.read(req,{...binding,sessionKey:'agent:makaron:feishu:group:oc_else'}),null);
 assert.equal(store.authorize(binding,binding.accessToken,response()),null);
 assert(!JSON.stringify(store.list(binding,principal)).includes(grant.deviceAccess));
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
