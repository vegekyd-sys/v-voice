import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';

// The call board for every caller (VOICE_BOARD_AUDIENCE=all): the owner's fixed entry, a Feishu
// guest and browser Public. Default ("owner") keeps it to the owner's entry, as before.
const fixed={id:'fixed-office',agentId:'makaron',accountId:'fixture-account',callerId:'tianyi',permissionProfile:'personal-tianyi',sessionKey:'agent:makaron:feishu:group:oc_fixed',kind:'group',displayName:'固定工作会话',accountLabel:'工作账号',accessToken:'f'.repeat(40)};
const dynamic=feishuConversationPhone('fixture-account','oc_dynamic');
async function fixture(t,audience){
 const dir=await mkdtemp(join(tmpdir(),'voice-board-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[],runs=[];
 const board={available:true,run:async args=>{runs.push(args);args.onOp({op:'sync',scene:{serial:1,rev:1,title:'t',blocks:[]}});return {reason:'drawn',rev:1,durationMs:1};},
  scene:()=>({serial:1,rev:1,title:'t',blocks:[{id:'p',t:'photo',query:'故宫'}]}),canvas:()=>({zones:[],active:''}),forget:()=>{}};
 const bridge=createLiveH5Server({enableGrok:true,basePath:'/voice',publicOrigin:'https://voice.example',accessToken:'p'.repeat(40),iosBindingsFile:join(dir,'grants.json'),iosPublicEntry:true,publicTools:true,conversationEntries:[fixed],
  board,boardAudience:audience,boardPhotos:{find:async()=>({type:'image/jpeg',bytes:Buffer.from('fixture')})},
  feishuLogin:{conversations:true,allowUnidentified:true,appId:'cli_fixture',appSecret:'fixture-secret',accountId:'fixture-account',actors:[]},
  gateway:{ready:true,request:async(method,params)=>{if(method==='tools.catalog')return {groups:[{tools:[{id:'web_search'},{id:'memory_search'},{id:'exec'}]}]};if(method==='sessions.describe')return {session:{key:params.key,agentId:'makaron'}};return {ok:true};}},
  directVoice:{models:()=>[{id:'seeduplex',available:true}],reserve:async args=>{calls.push(args);return {voiceSessionId:'fixture-'+calls.length,relayTicket:'fixture',provider:args.model};},close:async()=>{},dispose:async()=>{}}});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
 const send=(path,{body,cookie=''}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:bridge.server.address().port,path:'/voice'+path,method:body===undefined?'GET':'POST',headers:{host:'voice.example',origin:'https://voice.example',cookie,'content-type':'application/json'}},res=>{
   let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,json:()=>JSON.parse(text),cookie:(res.headers['set-cookie']??[]).map(v=>v.split(';')[0]).join('; ')}));
  });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 return {send,calls,runs};
}
const entries={
 owner:async f=>({phone:fixed.id,cookie:(await f.send('/api/access?phone='+fixed.id,{body:{access:fixed.accessToken}})).cookie}),
 'Feishu guest':async f=>({phone:dynamic,cookie:(await f.send('/feishu?phone='+dynamic+'&guest=1')).cookie}),
 Public:async f=>({phone:'public',cookie:(await f.send('/?phone=public')).cookie}),
};
const drawRequest=voiceSessionId=>({voiceSessionId,trigger:'user',rev:0,turns:[{role:'user',text:'给我讲讲故宫'}]});
for(const audience of ['owner','all'])for(const [name,open] of Object.entries(entries))test(`board with audience "${audience}": ${name}`,async t=>{
 const f=await fixture(t,audience),{phone,cookie}=await open(f);
 const shown=audience==='all'||name==='owner';
 const status=(await f.send('/api/status?phone='+phone,{cookie})).json();
 assert.equal(status.board===true,shown,'the page is told whether there is a board');
 const call=await f.send('/api/session?phone='+phone,{cookie,body:{model:'seeduplex'}});assert.equal(call.status,200,call.text);
 const drawn=await f.send('/api/board?phone='+phone,{cookie,body:drawRequest(call.json().voiceSessionId)});
 const photo=await f.send('/api/board-image?phone='+phone,{cookie,body:{voiceSessionId:call.json().voiceSessionId,query:'故宫'}});
 if(!shown){assert.equal(drawn.status,404);assert.equal(photo.status,404);assert.equal(f.runs.length,0);return;}
 assert.equal(drawn.status,200,drawn.text);assert.match(drawn.text,/"op":"done"/);
 assert.equal(f.runs.length,1);assert.equal(f.runs[0].quiet,name!=='owner','only the owner\'s calls keep their words in the board record');
 assert.equal(photo.status,200,'a photograph on this call\'s board is served');
 // Another call's board is not readable from here.
 assert.equal((await f.send('/api/board?phone='+phone,{cookie:'',body:drawRequest(call.json().voiceSessionId)})).status===200,false);
});

test('page features: the iOS App asks /api/page/<name> and gets the board\'s run and a photograph as JSON',async t=>{
 const f=await fixture(t,'all'),{phone,cookie}=await entries.Public(f);
 const call=await f.send('/api/session?phone='+phone,{cookie,body:{model:'seeduplex'}});
 const drawn=await f.send('/api/page/board?phone='+phone,{cookie,body:drawRequest(call.json().voiceSessionId)});
 assert.equal(drawn.status,200);assert.deepEqual(drawn.json().ops.map(op=>op.op),['sync','done']);
 const photo=await f.send('/api/page/board-image?phone='+phone,{cookie,body:{voiceSessionId:call.json().voiceSessionId,query:'故宫'}});
 assert.equal(photo.status,200);assert.deepEqual(photo.json(),{type:'image/jpeg',data:Buffer.from('fixture').toString('base64')});
});

test('page features: only the ones the service names exist, and each keeps its own access rule',async t=>{
 const f=await fixture(t,'owner'),{phone,cookie}=await entries.Public(f);
 const call=await f.send('/api/session?phone='+phone,{cookie,body:{model:'seeduplex'}});
 for(const name of ['nothing','__proto__','constructor','session'])assert.equal((await f.send('/api/page/'+name+'?phone='+phone,{cookie,body:{voiceSessionId:call.json().voiceSessionId}})).status,404,name);
 assert.equal((await f.send('/api/page/board?phone='+phone,{cookie,body:drawRequest(call.json().voiceSessionId)})).status,404,'the board is not open to Public here');
 // An avatar request is an avatar request: nothing rides on it.
 const avatar=await f.send('/api/avatar?phone='+phone,{cookie,body:{voiceSessionId:call.json().voiceSessionId,revision:1,turns:[],board:drawRequest('x')}});
 assert.equal(avatar.json().ops,undefined);
});
