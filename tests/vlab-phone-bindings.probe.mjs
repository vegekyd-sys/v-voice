import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {GatewayClient} from '../lib/gateway-client.mjs';
import {provisionPhone,verifyPhoneSession} from '../lib/phone-provisioning.mjs';
import {updatePhoneFile,readPhoneFile} from '../lib/private-phone-file.mjs';

// Explicit Candidate probe only: never loaded by npm test or a production server.
// All real Gateway requests are read-only. Reservation/relay behavior is covered
// by conversation-server.test.mjs using these same keys and labeled fixtures.
test('Candidate resolves real VLab DM/group and keeps their existing histories separate',async()=>{
 const targets=JSON.parse(process.env.VOICE_TEST_TARGETS_JSON??'null');
 assert.equal(targets?.length,2,'Select exactly two known test conversations');
 assert.notEqual(targets[0].sessionKey,targets[1].sessionKey);
 assert.deepEqual(new Set(targets.map(t=>t.kind)),new Set(['dm','group']));
 const config=JSON.parse(await readFile(process.env.VLAB_SHARED_CONFIG_PATH,'utf8'));
 const token=config.gateway.auth.token.replace(/\$\{([^}]+)\}/gu,(_,key)=>process.env[key]??'');
 assert(token,'Gateway credential is unavailable');
 const start=performance.now(),observations=[],requests=[];
 let client;
 try{
  await new Promise((accept,reject)=>{client=new GatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token,
   scopes:['operator.read'],caps:[],onHelloOk:accept,onConnectError:reject});client.start();});
  const gateway={request:(method,args,options)=>{
   assert(['sessions.describe','chat.history'].includes(method),'The real probe permits read-only RPC only');
   requests.push(method);return client.request(method,args,options);
  }};
  const file=join(process.env.VLAB_CANDIDATE_DATA,'phone-entries.json');
  for(const target of targets){
   const at=performance.now();let record;
   await updatePhoneFile(file,async records=>{
    record=await provisionPhone({gateway,records,...target});return [...records,record];
   });
   await verifyPhoneSession(gateway,record);
   const history=await gateway.request('chat.history',{sessionKey:record.sessionKey,limit:6},{timeoutMs:15000});
   assert.equal(history.sessionKey,record.sessionKey,'History must belong to the selected phone');
   assert(history.sessionId&&Array.isArray(history.messages),'Existing history must be retrievable');
   observations.push({id:record.id,kind:record.kind,sessionKey:record.sessionKey,historySessionId:history.sessionId,
    messageCount:history.messages.length,historySha256:createHash('sha256').update(JSON.stringify(history.messages)).digest('hex'),
    durationMs:Math.round(performance.now()-at)});
  }
  assert.equal((await readPhoneFile(file)).length,2);
  assert.notEqual(observations[0].historySessionId,observations[1].historySessionId,'Two phones must not use one history owner');
  const result={schema:'voice-phone-source-probe-v1',at:new Date().toISOString(),candidateId:process.env.VLAB_CANDIDATE_ID,
   realGatewayRpc:requests,paidCalls:0,voiceCalls:0,channelMessagesSent:0,sharedWrites:0,
   reservationsAndRelay:'separate HTTP/WebSocket fixtures, not live media',phones:observations,durationMs:Math.round(performance.now()-start)};
  await writeFile(join(process.env.VLAB_CANDIDATE_DATA,'phone-source-proof.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(result));
 }finally{client?.stop();}
});
