import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request} from 'node:http';
import {GatewayClient} from '../lib/gateway-client.mjs';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';
import {parseDeviceEntries} from '../lab/realtime-direct-tools/device-endpoint.mjs';

// Explicit integration probe: real read-only Gateway RPC; no provider calls,
// task creation, conversation writes or channel delivery. Never part of npm test.
test('candidate browser Public and fixed hardware mapping integrate with unchanged VLab Gateway',async()=>{
 const config=JSON.parse(await readFile(process.env.VLAB_SHARED_CONFIG_PATH,'utf8'));
 const token=config.gateway.auth.token.replace(/\$\{([^}]+)\}/gu,(_,key)=>process.env[key]??'');
 assert(token);let client,bridge;const methods=[];
 const dir=await mkdtemp(join(tmpdir(),'voice-unified-probe-'));
 try{
  await new Promise((resolve,reject)=>{client=new GatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token,scopes:['operator.read'],caps:[],onHelloOk:resolve,onConnectError:reject});client.start();});
  const gateway={get ready(){return client.ready;},request:(method,args,options)=>{
   assert(['sessions.list','sessions.describe','tools.catalog'].includes(method),'Read-only probe boundary');methods.push(method);return client.request(method,args,options);
  }};
  const listed=await gateway.request('sessions.list',{agentId:'makaron',limit:100,includeLastMessage:false});
  const sessions=listed.sessions??listed.items??[];
  const targets=[':feishu:direct:',':feishu:group:'].map(kind=>sessions.find(s=>String(s.key??s.sessionKey).includes(kind)));
  assert(targets.every(Boolean),'Known DM and group must be present');
  const fixed=targets.map((s,i)=>({id:'fixed-probe-'+i,sessionKey:s.key??s.sessionKey,agentId:'makaron',accountId:'probe-account',callerId:'tianyi',permissionProfile:'personal-tianyi',kind:i?'group':'dm',displayName:'Probe '+i,accountLabel:'Probe account',accessToken:'test-only-fixed-token-'+String(i).repeat(40)}));
  for(const entry of fixed)await gateway.request('sessions.describe',{key:entry.sessionKey});
  const calls=[];
  bridge=createLiveH5Server({gateway,maxActiveSessionsPerIp:4,basePath:'/voice',publicOrigin:'https://voice.example',accessToken:'probe-only'.repeat(5),conversationEntries:fixed,iosBindingsFile:join(dir,'grants.json'),iosPublicEntry:true,publicTools:true,
   feishuLogin:{conversations:true,allowUnidentified:true,appId:'cli_fixture',appSecret:'probe-only',accountId:'probe-account',actors:[]},
   directVoice:{models:()=>[{id:'seeduplex',available:true}],reserve:async args=>{calls.push(args);return {voiceSessionId:'probe-fixture-'+calls.length,provider:'seeduplex',relayTicket:'fixture'};},close:async()=>{},dispose:async()=>{}}});
  await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));
  const send=(path,{body,cookie=''}={})=>new Promise((resolve,reject)=>{
   const req=request({host:'127.0.0.1',port:bridge.server.address().port,path:'/voice'+path,method:body===undefined?'GET':'POST',headers:{host:'voice.example',origin:'https://voice.example',cookie,'content-type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,cookie:(res.headers['set-cookie']??[]).map(c=>c.split(';')[0]).join('; ')}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  for(const phone of ['public',feishuConversationPhone('probe-account','oc_fixture')]){
   const page=await send(phone==='public'?'/?phone=public':'/feishu?phone='+phone+'&guest=1');assert.equal(page.status,200);
   assert.equal((await send('/api/session?phone='+phone,{cookie:page.cookie,body:{model:'seeduplex'}})).status,200);
   const reservation=calls.at(-1);assert(reservation.gateway.publicVoice);assert.match(reservation.sessionKey,/^voice:guest:/);assert.equal(reservation.replyTarget,undefined);
   const catalog=await reservation.gateway.request('tools.catalog');const names=catalog.groups.flatMap(g=>g.tools.map(t=>t.id));
   assert(names.includes('web_search'));assert(names.includes('memory_search'));
   assert(names.every(n=>['web_search','memory_search','web_fetch'].includes(n)));
   await assert.rejects(reservation.gateway.request('tools.invoke',{name:'exec',args:{}}),/unavailable/);
   await assert.rejects(reservation.gateway.request('chat.history',{}),/unavailable/);
  }
  for(const entry of fixed){
   const access=await send('/api/access?phone='+entry.id,{body:{access:entry.accessToken}});assert.equal(access.status,200);
   const status=await send('/api/status?phone='+entry.id,{cookie:access.cookie});assert.equal(status.status,200);assert.equal(JSON.parse(status.text).accessContext.entryKind,'fixed');
   assert.equal((await send('/api/session?phone='+entry.id,{cookie:access.cookie,body:{model:'seeduplex'}})).status,200);assert.equal(calls.at(-1).sessionKey,entry.sessionKey);
   const [device]=parseDeviceEntries([{id:'probe-device',phoneEntry:entry.id,token:'probe-device-token'.repeat(3),model:'seeduplex'}],fixed);assert.equal(device.sessionKey,entry.sessionKey);assert.equal(device.accountId,entry.accountId);
  }
  assert.notEqual(calls[0].sessionKey,calls[1].sessionKey);
  console.log(JSON.stringify({schema:'voice-unified-access-integration-v1',realGatewayMethods:methods,existingConversations:2,publicRoutes:2,fixedReservations:2,provider:'fixture',paidCalls:0,channelMessages:0,sharedWrites:0}));
 }finally{await bridge?.dispose();client?.stop();await rm(dir,{recursive:true,force:true});}
});
