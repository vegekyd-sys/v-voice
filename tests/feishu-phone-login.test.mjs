import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {Readable} from 'node:stream';
import {createConversationEntries} from '../lib/conversation-entries.mjs';
import {createFeishuPhoneLogin,readFeishuPhoneLoginFile,feishuPhoneLoginFailure} from '../lib/feishu-phone-login.mjs';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
const origin = 'https://voice.example.com';
const records = ['dm', 'group', 'other'].map((kind, i) => ({id:'phone-test-'+kind,
  agentId:'makaron', sessionKey:'agent:makaron:feishu:group:oc_test_'+i,
  accountId:'default', kind:kind === 'dm' ? 'dm' : 'group', callerId:'tianyi',
  permissionProfile:'personal-tianyi', accessToken:String(i + 1).repeat(40)}));
const actor = {openId:'ou_test', tenantKey:'tenant_test', callerId:'tianyi',
  defaultPhoneId:records[0].id, phoneIds:records.slice(0,2).map(r=>r.id)};
const cookie = res => res.headers['set-cookie'].split(';')[0];
const response = () => ({headers:{},setHeader(k,v){this.headers[k]=v;}});
test('server login configuration refuses public files and symlinks',async t=>{
  const dir=await mkdtemp(tmpdir()+'/voice-feishu-login-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=dir+'/login.json';await writeFile(path,JSON.stringify({appSecret:'server-only'}),{mode:0o600});
  assert.equal((await readFeishuPhoneLoginFile(path)).appSecret,'server-only');
  await chmod(path,0o644);await assert.rejects(readFeishuPhoneLoginFile(path));
  await chmod(path,0o600);await symlink(path,dir+'/alias.json');await assert.rejects(readFeishuPhoneLoginFile(dir+'/alias.json'));
});
function fixture(extra = {}) {
  const requests = [];
  const options = {appId:'cli_test', appSecret:'secret-for-test', actors:[actor], ...extra};
  options.fetchImpl ??= async (url, init) => {
    requests.push({url,init});
    return Response.json(url.includes('/token')
      ? {code:0,access_token:'private-user-token',token_type:'Bearer'}
      : {code:0,data:{open_id:actor.openId,tenant_key:actor.tenantKey}});
  };
  const login = createFeishuPhoneLogin({...options,publicOrigin:origin,basePath:'/voice',entries:createConversationEntries(records)});
  const begin = (phoneId) => {
    const res = response(), url = new URL(login.begin({headers:{}},res,phoneId));
    return {url,req:{headers:{cookie:cookie(res)}}, callback:new URL(`${origin}/voice/feishu/callback?state=${url.searchParams.get('state')}&code=valid-code`)};
  };
  return {options,login,begin,requests};
}
test('Feishu OAuth selects the trusted DM and group, uses PKCE, and retains no provider token', async () => {
  const f=fixture(), flow=f.begin(), res=response();
  assert.equal(flow.url.searchParams.get('scope'),null);
  assert.equal(flow.url.searchParams.get('prompt'),null);
  assert.equal(await f.login.complete(flow.req,res,flow.callback),'/voice/feishu?phone='+actor.defaultPhoneId);
  const req={headers:{cookie:cookie(res)}};
  assert.equal(f.login.select(req).id,actor.defaultPhoneId);
  assert.equal(f.login.select(req,records[1].id).id,records[1].id);
  assert.throws(()=>f.login.select(req,records[2].id));
  const tokenBody=JSON.parse(f.requests[0].init.body);
  assert.equal(createHash('sha256').update(tokenBody.code_verifier).digest('base64url'),flow.url.searchParams.get('code_challenge'));
  assert.equal(f.requests[0].url,'https://open.feishu.cn/open-apis/authen/v2/oauth/token');
  assert.equal(f.requests[0].init.headers['content-type'],'application/json; charset=utf-8');
  assert.equal(tokenBody.redirect_uri,origin+'/voice/feishu/callback');
  assert.equal(tokenBody.client_id,'cli_test');
  assert.equal(f.requests[1].init.headers.authorization,'Bearer private-user-token');
  assert.equal(JSON.stringify(f.login.read(req)).includes('private-user-token'),false);
  assert.match(res.headers['set-cookie'],/HttpOnly; Secure; SameSite=Lax/);
  await assert.rejects(f.login.complete(flow.req,response(),flow.callback));
});
test('forged identity, foreign tenant, browser state theft, denial and expiry never select a phone',async()=>{
  for(const data of [{open_id:'ou_foreign',tenant_key:actor.tenantKey},{open_id:actor.openId,tenant_key:'foreign'}]) {
    const f=fixture({fetchImpl:async u=>Response.json(u.includes('/token')?{code:0,access_token:'x',token_type:'Bearer'}:{code:0,data})}),flow=f.begin();
    await assert.rejects(f.login.complete(flow.req,response(),flow.callback));
  }
  const f=fixture(),flow=f.begin();
  await assert.rejects(f.login.complete({headers:{cookie:'v_feishu_phone_state=forged'}},response(),flow.callback));
  assert.equal(f.requests.length,0);
  flow.callback.searchParams.set('error','access_denied');
  await assert.rejects(f.login.complete(flow.req,response(),flow.callback));
  assert.equal(f.requests.length,0);
  let at=0;const expired=fixture({now:()=>at}),old=expired.begin();at=300001;
  await assert.rejects(expired.login.complete(old.req,response(),old.callback));
  assert.equal(expired.requests.length,0);
  assert.throws(()=>f.begin(records[2].id));
});
test('login cookies expire and actor configuration cannot grant another caller or an unknown entry',async()=>{
  let at=0;const f=fixture({now:()=>at}),flow=f.begin(),res=response();
  await f.login.complete(flow.req,res,flow.callback);const req={headers:{cookie:cookie(res)}};
  assert.ok(f.login.read(req));at=28800001;assert.equal(f.login.read(req),null);
  for(const change of [{callerId:'other'},{defaultPhoneId:records[1].id},{phoneIds:['missing-phone']}])assert.throws(()=>fixture({actors:[{...actor,...change}]}));
});
test('real HTTP login gates protected phone APIs, preserves legacy entry and never automatically creates media',async t=>{
  const f=fixture(),calls=[];
  const bridge=createLiveH5Server({gateway:{request:async(m,p)=>{calls.push({m,p});return {key:p.key,agentId:p.agentId};}},
    basePath:'/voice',publicOrigin:origin,accessToken:'legacy'.repeat(8),conversationEntries:records,feishuLogin:f.options});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
  const get=(path,jar='',body)=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:bridge.server.address().port,path,method:body?'POST':'GET',headers:{host:new URL(origin).host,origin,cookie:jar}},
      res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  assert.equal((await get('/voice/api/status?phone='+records[0].id)).status,401);
  assert.equal((await get('/voice/api/access?phone='+records[0].id,'',{access:records[0].accessToken})).status,401);
  const start=await get('/voice/feishu'),authorize=new URL(start.headers.get('location'));
  const stateCookie=start.headers.get('set-cookie').split(';')[0];
  const finish=await get('/voice/feishu/callback?code=valid-code&state='+authorize.searchParams.get('state'),stateCookie);
  assert.equal(finish.status,302);const actorCookie=finish.headers.get('set-cookie').split(';')[0];
  const selected=await get(finish.headers.get('location'),actorCookie);
  assert.equal(selected.status,302);assert.equal(selected.headers.get('location'),'/voice/?phone='+records[0].id);
  const accessCookie=selected.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/voice/api/status?phone='+records[0].id,actorCookie+'; '+accessCookie)).status,200);
  assert.equal((await get('/voice/api/status?phone='+records[0].id,accessCookie)).status,401);
  const group=await get('/voice/feishu?phone='+records[1].id,actorCookie);
  assert.equal(group.headers.get('location'),'/voice/?phone='+records[1].id);
  assert.equal((await get('/voice/feishu?phone='+records[2].id,actorCookie)).status,403);
  const legacy=await get('/voice/api/access','',{access:'legacy'.repeat(8)});
  assert.equal(legacy.status,200);
  assert.equal(calls.length,0);
});

test('login diagnostics identify failed stages without exposing provider credentials or user data',async()=>{
  const f=fixture({fetchImpl:async()=>Response.json({code:20049,error_description:'private-token-and-code'},{status:400})}),flow=f.begin();
  await assert.rejects(f.login.complete(flow.req,response(),flow.callback),error=>{
    assert.deepEqual(feishuPhoneLoginFailure(error),{reason:'provider_rejected',stage:'token',httpStatus:400,providerCode:20049});return true;
  });
  const g=fixture(),pending=g.begin();
  await assert.rejects(g.login.complete({headers:{}},response(),pending.callback),error=>{
    assert.deepEqual(feishuPhoneLoginFailure(error),{reason:'invalid_state',pending:true,browserMatched:false});return true;
  });
  assert.deepEqual(feishuPhoneLoginFailure(new Error('private-token')),{reason:'unexpected_login_failure'});
});
