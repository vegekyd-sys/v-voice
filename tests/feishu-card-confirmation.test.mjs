import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createFeishuCardConfirmation} from '../lib/feishu-card-confirmation.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
const phone=feishuConversationPhone('default','oc_group');
function fixture() {
 let time=1000000,denied=false,serial=0;const sent=[],admissions=[],completed=[];
 const bridge=createFeishuCardConfirmation({appId:'cli_app',appSecret:'fixture',accountId:'default',basePath:'/voice',now:()=>time,
 api:async(method,path,body)=>{
  if(method==='POST'){sent.push(body);return {message_id:'om_card'+(++serial)};}
  if(path.includes('/members?'))return {items:[{member_id:'ou_external',name:'外部成员'},{member_id:'ou_internal',name:'内部成员'}]};
  return {chat_mode:'group'};
 },admit:async(actor,p)=>{admissions.push({actor,p});if(denied)throw Error('denied');},
 complete:async(data,pending)=>{if(denied)throw Error('denied');completed.push({data,pending});return {location:'/voice/feishu?identified=once'};}});
 const prepare=(req={headers:{}})=>{let cookie;const setup=bridge.prepare(req,{setHeader:(_k,v)=>cookie=v},phone);return {...setup,req:{headers:{cookie:cookie.split(';')[0]}}};};
 const proof=(state,overrides={})=>({version:1,request:state,accountId:'default',appId:'cli_app',tenantKey:'externalTenant',openId:'ou_external',chatId:'oc_group',messageId:'om_card'+serial,issuedAt:time,...overrides});
 const callback=(p,signature)=>{const raw=JSON.stringify(p);return bridge.callback(raw,signature??createHmac('sha256','fixture').update('voice-card-confirm-v1\n'+raw).digest('base64url'));};
 return {bridge,prepare,proof,callback,sent,admissions,completed,advance:ms=>time+=ms,deny:()=>denied=true};
}
test('external and internal members confirm the same group URL without OAuth; only the initiating browser redeems',async()=>{
 const f=fixture();
 for(const [openId,tenantKey] of [['ou_external','externalTenant'],['ou_internal','internalTenant']]){
  const p=f.prepare();assert.equal((await f.bridge.start(p.req,p.state)).status,'waiting');
  assert.equal(f.sent.at(-1).receive_id,'oc_group');assert(!f.sent.at(-1).content.includes(p.req.headers.cookie));
  assert.equal((await f.callback(f.proof(p.state,{openId,tenantKey}))).confirmed,true);
  await assert.rejects(f.bridge.poll({headers:{}},{},p.state));
  const result=await f.bridge.poll(p.req,{},p.state);assert.equal(result.status,'complete');
  assert.equal(f.completed.at(-1).data.open_id,openId);assert.equal(f.completed.at(-1).pending.phoneId,phone);
  await assert.rejects(f.bridge.poll(p.req,{},p.state));await assert.rejects(f.callback(f.proof(p.state,{openId,tenantKey})));f.advance(61000);
 }
});
test('signed callback must match app, account, request, original group, exact card and fresh timestamp',async()=>{
 const f=fixture(),p=f.prepare();await f.bridge.start(p.req,p.state);
 for(const change of [{appId:'cli_other'},{accountId:'other'},{request:'b'.repeat(43)},{chatId:'oc_other'},{messageId:'om_forwarded'},{issuedAt:1},{issuedAt:1006000},{tenantKey:''},{openId:'ou_bad/owner'}])await assert.rejects(f.callback(f.proof(p.state,change)));
 await assert.rejects(f.callback(f.proof(p.state),'a'.repeat(43)));assert.equal(f.admissions.length,0);
 assert.equal((await f.callback(f.proof(p.state))).confirmed,true);
});
test('a second click is idempotent for the same actor; another member cannot overwrite confirmed identity',async()=>{
 const f=fixture(),p=f.prepare();await f.bridge.start(p.req,p.state);const proof=f.proof(p.state);
 await f.callback(proof);await f.callback(proof);assert.equal(f.admissions.length,1);
 await assert.rejects(f.callback({...proof,openId:'ou_internal'}));await f.bridge.poll(p.req,{},p.state);assert.equal(f.completed[0].data.open_id,'ou_external');
});
test('membership/policy denial does not authenticate; loss of membership before browser redemption also fails',async()=>{
 const f=fixture(),p=f.prepare();await f.bridge.start(p.req,p.state);f.deny();await assert.rejects(f.callback(f.proof(p.state)));assert.equal((await f.bridge.poll(p.req,{},p.state)).status,'waiting');assert.equal(f.completed.length,0);
 const g=fixture(),q=g.prepare();await g.bridge.start(q.req,q.state);await g.callback(g.proof(q.state));g.deny();await assert.rejects(g.bridge.poll(q.req,{},q.state));await assert.rejects(g.bridge.poll(q.req,{},q.state));
});
test('expired, replaced and foreign-browser requests cannot send or redeem; group sends are rate limited',async()=>{
 const f=fixture(),p=f.prepare();await assert.rejects(f.bridge.start({headers:{}},p.state));assert.equal(f.sent.length,0);
 await f.bridge.start(p.req,p.state);await f.bridge.start(p.req,p.state);assert.equal(f.sent.length,1);
 const q=f.prepare(p.req);await assert.rejects(f.callback(f.proof(p.state)));await f.bridge.start(q.req,q.state);
 const r=f.prepare();await f.bridge.start(r.req,r.state);const tooMany=f.prepare();await assert.rejects(f.bridge.start(tooMany.req,tooMany.state),/rate_limited/);
 f.advance(300001);await assert.rejects(f.bridge.start(q.req,q.state));assert.equal(f.completed.length,0);
});
