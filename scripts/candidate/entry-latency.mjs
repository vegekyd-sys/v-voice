// Local-only browser timing fixture. No real Gateway/provider/card/model calls.
// Usage: node scripts/candidate/entry-latency.mjs /absolute/source/root 28732
import {createServer,request} from 'node:http';
import {createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.argv[2],port=Number(process.argv[3]);
const {createLiveH5Server}=await import(pathToFileURL(root+'/lab/gpt-live-h5/server.mjs'));
const {ENTRY_LATENCY_CANDIDATE_UPDATE}=await import(pathToFileURL(root+'/lab/gpt-live-h5/changelog.mjs'));
const {feishuConversationPhone}=await import(pathToFileURL(root+'/lib/feishu-conversation-directory.mjs'));
const phone=feishuConversationPhone('default','oc_fixture'),origin='https://voice.example';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let rpc=0,provider=0,calls=0,scenario="setup";
const app=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:'fixture'.repeat(8),iosPublicEntry:true,iosBindingsFile:`/tmp/voice-entry-latency-ios-${port}.json`,candidateRelease:ENTRY_LATENCY_CANDIDATE_UPDATE,
  gateway:{ready:true,request:async method=>{rpc++;if(method!=='voice.feishu.resolve')throw Error('forbidden:'+method);await sleep(550);return {sessionKey:'agent:fixture:feishu:group:oc_fixture',agentId:'fixture',accountId:'default',kind:'group'};}},
  directVoice:{models:()=>[{id:'seeduplex',label:'小何',available:true}],reserve:async()=>{calls++;throw Error('NO CALLS');},dispose:async()=>{}},
  feishuLogin:{appId:'cli_fixture',appSecret:'fixture',accountId:'default',actors:[],conversations:true,allowUnidentified:true,cardConfirmation:true,
    fetchImpl:async (url,init)=>{provider++;await sleep(200);
      if(url.includes('app_access_token'))return Response.json({code:0,app_access_token:'fixture-app',tenant_access_token:'fixture-tenant',expire:7200});
      if(url.endsWith('/token'))return Response.json({code:0,access_token:'fixture-user',token_type:'Bearer'});
      if(url.endsWith('/access_token'))return Response.json({code:0,data:{access_token:'fixture-user',open_id:'ou_fixture',tenant_key:'fixture',name:'候选测试账号'}});
      if(url.endsWith('/user_info'))return Response.json({code:0,data:{open_id:'ou_fixture',tenant_key:'fixture',name:'候选测试账号'}});
      if(url.includes('/members?'))return Response.json({code:0,data:{items:[{member_id:'ou_fixture',name:'候选测试账号'}]}});
      if(url.includes('/messages?')){
        if(scenario==='card-first'){
          const card=JSON.parse(JSON.parse(init.body).content),state=card.body.elements[1].behaviors[0].value.request;
          setTimeout(async()=>{
            const proof={version:1,request:state,accountId:'default',appId:'cli_fixture',tenantKey:'fixture',openId:'ou_fixture',chatId:'oc_fixture',messageId:'om_fixture',issuedAt:Date.now()};
            const raw=JSON.stringify(proof);
            await internal('/voice/feishu/confirm/callback',new Map(),proof,{origin:'','x-voice-confirm-signature':createHmac('sha256','fixture').update('voice-card-confirm-v1\n'+raw).digest('base64url')});
          },800);
        }
        return Response.json({code:0,data:{message_id:'om_fixture'}});
      }
      return Response.json({code:0,data:{chat_mode:'group',name:'候选测试群'}});
    }}});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const internal=(path,jar,body,extra={})=>new Promise((resolve,reject)=>{
 const req=request({hostname:'127.0.0.1',port:app.server.address().port,path,method:body?'POST':'GET',headers:{host:'voice.example',origin,...extra,cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json'}},res=>{
  for(const cookie of res.headers['set-cookie']??[]){const [k,...v]=cookie.split(';')[0].split('=');jar.set(k,v.join('='));}
  let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({headers:res.headers,status:res.statusCode,text,json:()=>JSON.parse(text)}));
 });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});
const jars=new Map();
for(const kind of ['return','sdk-return','card-return']){
 const jar=new Map();
 if(kind==='card-return'){
  const p=(await internal('/voice/feishu/confirm/prepare?phone='+phone,jar,{})).json();
  await internal('/voice/feishu/confirm/start',jar,{state:p.state});
  const raw=JSON.stringify({version:1,request:p.state,accountId:'default',appId:'cli_fixture',tenantKey:'fixture',openId:'ou_fixture',chatId:'oc_fixture',messageId:'om_fixture',issuedAt:Date.now()});
  await internal('/voice/feishu/confirm/callback',jar,JSON.parse(raw),{origin:'','x-voice-confirm-signature':createHmac('sha256','fixture').update('voice-card-confirm-v1\n'+raw).digest('base64url')});
  await internal('/voice/feishu/confirm/status',jar,{state:p.state});
 }else{
  const begin=await internal('/voice/feishu?phone='+phone+'&oauth=1',jar);
  await internal('/voice/feishu/callback?code=fixture&state='+new URL(begin.headers.location).searchParams.get('state'),jar);
 }
 jars.set(kind,jar);
}
const accountJar=jars.get('card-return');
const binding=(await internal('/voice/api/ios-binding?phone='+phone,accountJar,{})).json();
const bindingURL=new URL(binding.bindingUrl),devicePhone=bindingURL.searchParams.get('phone');
const nativeJar=new Map(),token=new URLSearchParams(bindingURL.hash.slice(1)).get('bind');
const grant=(await internal('/voice/api/ios-binding/redeem?phone='+devicePhone,nativeJar,{token})).json();
await internal('/voice/api/ios-binding/access?phone='+devicePhone,nativeJar,{deviceAccess:grant.deviceAccess});
jars.set('ios-return',nativeJar);scenario='first';
const sdk=`window.h5sdk={error:()=>{},ready:fn=>fn()};window.tt={requestAccess:opts=>setTimeout(()=>${'SCENARIO'}==='card-return'?opts.fail({errno:20027}):opts.success({code:'fixture-code'}),500)};`;
const proxy=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){
  res.setHeader('content-type','text/html; charset=utf-8');res.end('<h1>Voice 进入延迟 Candidate</h1><p>本地模拟身份与 Gateway；禁止通话。</p>'+['first','return','sdk-first','sdk-return','card-return','card-first','ios-return'].map(s=>`<p><a href="/launch?scenario=${s}">${s}</a></p>`).join(''));return;
 }
 if(url.pathname==='/launch'){
  scenario=url.searchParams.get('scenario');const jar=jars.get(scenario)??new Map();
  res.setHeader('set-cookie',['v_feishu_phone','v_feishu_phone_state','v_feishu_confirm','v_voice_access','v_voice_guest'].map(k=>`${k}=; Path=/voice/; Max-Age=0`).concat([...jar].map(([k,v])=>`${k}=${v}; Path=/voice/; HttpOnly; SameSite=Lax`)));
  res.writeHead(302,{location:scenario==='ios-return'?'/voice/?phone='+devicePhone:'/voice/feishu?phone='+phone});res.end();return;
 }
 if(url.pathname==='/sdk.js'){res.setHeader('content-type','text/javascript');res.end(sdk.replace('SCENARIO',JSON.stringify(scenario)));return;}
 if(url.pathname==='/fixture-stats'){res.setHeader('content-type','application/json');res.end(JSON.stringify({rpc,provider,calls}));return;}
 if(url.pathname==='/voice/api/entry-timing'){res.setHeader('content-type','application/json');res.end('{"ok":true}');return;}
 await sleep(150);
 const headers={...req.headers,host:'voice.example',...(req.headers.origin?{origin}:{}),...(/sdk-|card-return/.test(scenario)?{'user-agent':'Lark/7.0'}:{'user-agent':'fixture-browser'})};
 const target=request({hostname:'127.0.0.1',port:app.server.address().port,path:req.url,method:req.method,headers},up=>{
  const chunks=[];up.on('data',c=>chunks.push(c));up.on('end',()=>{
   let data=Buffer.concat(chunks);const h={...up.headers};delete h['content-length'];
   if(h['set-cookie'])h['set-cookie']=h['set-cookie'].map(c=>c.replace(/; Secure/g,''));
   if(/javascript|text\/html/.test(h['content-type']??''))data=Buffer.from(data.toString().replaceAll('https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js','/sdk.js'));
   res.writeHead(up.statusCode,h);res.end(data);
  });
 });target.on('error',()=>{res.writeHead(502);res.end();});req.pipe(target);
});
await new Promise(r=>proxy.listen(port,'127.0.0.1',r));
console.log(JSON.stringify({port,root,phone,ready:true}));
