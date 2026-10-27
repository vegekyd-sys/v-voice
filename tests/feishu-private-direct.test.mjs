import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {request} from 'node:http';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {createPrivatePhoneLocator} from '../lib/feishu-private-conversations.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
import {startVoiceEntry} from '../lab/gpt-live-h5/entry-startup.mjs';

test('private locator isolates actors/apps, rejects ambiguous/public/symlink directories',async t=>{
  const dir=await mkdtemp(tmpdir()+'/v-direct-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=dir+'/directory.json',at=Date.now();
  const row={appId:'cli_app',openId:'ou_old',chatId:'oc_old',updatedAt:at};
  const write=bindings=>writeFile(file,JSON.stringify({version:1,bindings}),{mode:0o600});
  const locate=createPrivatePhoneLocator({file,appId:'cli_app',accountId:'default',now:()=>at});
  await write([row,{...row,appId:'cli_other',chatId:'oc_other'}]);
  assert.equal(await locate({openId:'ou_old'}),feishuConversationPhone('default','oc_old'));
  await assert.rejects(locate({openId:'ou_new'}));
  await write([row,{...row,chatId:'oc_other'}]);await assert.rejects(locate({openId:'ou_old'}));
  await write([row]);await chmod(file,0o644);await assert.rejects(locate({openId:'ou_old'}));
  await chmod(file,0o600);await symlink(file,dir+'/link');await assert.rejects(createPrivatePhoneLocator({file:dir+'/link',appId:'cli_app',accountId:'default'})({openId:'ou_old'}));
});

test('a first entry waits for its native event without user retry, but never waits past the bound',async t=>{
  const dir=await mkdtemp(tmpdir()+'/v-direct-race-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=dir+'/directory.json',locate=createPrivatePhoneLocator({file,appId:'cli_app',accountId:'default',waitMs:600});
  const timer=setTimeout(()=>void writeFile(file,JSON.stringify({version:1,bindings:[{appId:'cli_app',openId:'ou_new',chatId:'oc_new',updatedAt:Date.now()}]}),{mode:0o600}),50);t.after(()=>clearTimeout(timer));
  assert.equal(await locate({openId:'ou_new'}),feishuConversationPhone('default','oc_new'));
  const at=performance.now();await assert.rejects(locate({openId:'ou_unknown'}));assert(performance.now()-at<900);
});

async function fixture(t,{deny=false,kind='dm'}={}){
  const dir=await mkdtemp(tmpdir()+'/v-direct-http-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=dir+'/directory.json',at=Date.now();
  await writeFile(file,JSON.stringify({version:1,bindings:['old','new'].map(who=>({appId:'cli_app',openId:'ou_'+who,chatId:'oc_'+who,updatedAt:at}))}),{mode:0o600});
  const api=[],rpc=[],dial=[];
  const live=createLiveH5Server({basePath:'/voice',publicOrigin:'https://voice.example',accessToken:'a'.repeat(40),iosPublicEntry:true,iosBindingsFile:dir+'/ios.json',
    feishuLogin:{appId:'cli_app',appSecret:'fixture',accountId:'default',actors:[],conversations:true,allowUnidentified:true,cardConfirmation:true,privateConversationsFile:file,
      fetchImpl:async(url,init)=>{api.push({url,init});
        if(url.includes('/app_access_token/'))return Response.json({code:0,app_access_token:'fixture-app',tenant_access_token:'fixture-tenant',expire:7200});
        if(url.endsWith('/access_token')){const who=JSON.parse(init.body).code;return Response.json({code:0,data:{access_token:'fixture-user',open_id:'ou_'+who,tenant_key:'tenant',name:who}});}
        throw Error('Unexpected API (including any outbound card/message)');
      }},
    gateway:{ready:true,request:async(method,params)=>{rpc.push({method,params});
      assert(method==='voice.feishu.resolve'||method==='sessions.describe');
      const a=params.voiceActor.actor;assert.equal(a.chatId,'oc_'+a.openId.slice(3));
      if(deny)throw Object.assign(Error('denied'),{details:{reason:'conversation_membership_required'}});
      return {sessionKey:'agent:makaron:feishu:direct:'+a.openId,agentId:'makaron',accountId:'default',kind};
    }},directVoice:{models:()=>[{id:'seeduplex',available:true}],reserve:async()=>dial.push('unexpected'),dispose:async()=>{}}});
  await new Promise(r=>live.server.listen(0,'127.0.0.1',r));t.after(()=>live.dispose());
  const browser=()=>{
    const jar=new Map();
    const send=(path,body)=>new Promise((resolve,reject)=>{
      const req=request({host:'127.0.0.1',port:live.server.address().port,path:'/voice'+path,method:body?'POST':'GET',headers:{host:'voice.example',origin:'https://voice.example','user-agent':'Lark/7.60',cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json'}},res=>{
        for(const line of res.headers['set-cookie']??[]){const [k,...v]=line.split(';')[0].split('=');jar.set(k,v.join('='));}
        let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers,json:()=>JSON.parse(text)}));
      });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
    });
    return {send,jar};
  };
  const open=async b=>{
    const redirect=await b.send('/feishu?phone=feishu_self');assert.equal(redirect.status,302);
    const page=await b.send(redirect.headers.location.slice(6));assert.equal(page.status,200,page.text);
    const config=JSON.parse(/id="login-config">([^<]+)/u.exec(page.text)[1]);assert.equal(config.privateEntry,true);
    return config.state;
  };
  return {browser,open,api,rpc,dial};
}

test('fresh old/new private entry uses common SDK phone page and live admission, sends no card and starts no media',async t=>{
  const f=await fixture(t);
  for(const who of ['old','new']){
    const b=f.browser(),before=f.rpc.length,state=await f.open(b);
    assert.equal(f.rpc.length,before,'unverified browser cannot query a private session');
    const result=await b.send('/feishu/client-login',{state,code:who});assert.equal(result.status,200,result.text);
    const body=result.json(),phone=feishuConversationPhone('default','oc_'+who);
    assert.equal(body.phone,phone);assert.equal(body.status.accountLabel,who);assert.equal(body.status.conversation.kind,'dm');
    assert.equal(body.status.unidentified,undefined);
    assert(!result.text.includes('fixture-user'));
  }
  assert.equal(f.dial.length,0);assert(!f.api.some(r=>r.url.includes('/messages')));
});

test('SDK refusal, wrong browser, missing DM and denied/group admission never fall back to another session',async t=>{
  for(const options of [{deny:true},{kind:'group'},{}]){
    const f=await fixture(t,options),b=f.browser(),state=await f.open(b);
    assert.equal((await f.browser().send('/feishu/client-login',{state,code:'old'})).status,401);
    const result=await b.send('/feishu/client-login',{state,code:options.deny||options.kind?'old':'missing'});
    assert.equal(result.status,403);assert(!f.api.some(r=>r.url.includes('/messages')));assert.equal(f.dial.length,0);
  }
  const f=await fixture(t),b=f.browser(),state=await f.open(b);
  assert.equal((await b.send('/feishu/client-login',{state,failure:{code:20027}})).status,403);
  assert.equal(f.rpc.length,0);assert.equal(f.api.length,0);
});

test('canonical private entry retargets in place; failure keeps dialing disabled instead of selecting Public',async()=>{
  let location;const phone=feishuConversationPhone('default','oc_new');
  const result=await startVoiceEntry({location:{search:'?phone=feishu_self',hash:'',pathname:'/voice/feishu/callback'},replaceState:p=>{location=p;},fetch:()=>{throw Error('No extra request');},identity:Promise.resolve({ready:true,canonicalPhone:phone})});
  assert.equal(result.status.canonicalPhone,phone);assert.equal(location,'/voice/feishu/callback?phone='+phone);
  const failed=await startVoiceEntry({location:{search:'?phone=feishu_self',hash:''},replaceState:()=>{},fetch:()=>{},identity:Promise.resolve({error:'not verified'})});
  assert.equal(failed.error,'not verified');assert.equal(failed.status,undefined);
});
