import test from 'node:test';import assert from 'node:assert/strict';
import {createGptLiveAuth,createGatewayGptLiveAuth,gptLiveFromEnv} from './gpt-live-auth.mjs';
const jwt=exp=>`h.${Buffer.from(JSON.stringify({exp})).toString('base64url')}.s`;
const now=()=>1_000_000_000_000;
const login=value=>createGptLiveAuth({file:'/x',now,readFileImpl:async()=>typeof value==='string'?value:JSON.stringify(value)});
test('reads this service\'s own shape and a Codex auth file without ever refreshing',async()=>{
  assert.deepEqual(await login({access:'tok',accountId:'acct',expires:now()+3_600_000})(),{token:'tok',accountId:'acct'});
  const token=jwt(now()/1000+3600);
  assert.deepEqual(await login({tokens:{access_token:token,account_id:'acct',refresh_token:'never-read'}})(),{token,accountId:'acct'});
});
test('an expired, incomplete or unreadable login is refused before any call is placed',async()=>{
  await assert.rejects(login({tokens:{access_token:jwt(now()/1000-10),account_id:'a'}})(),/登录已过期/u);
  await assert.rejects(login({access:'tok',accountId:'acct',expires:now()+30_000})(),/登录已过期/u);
  await assert.rejects(login({access:jwt(now()/1000+3600)})(),/凭据不可用/u);
  await assert.rejects(login('not json')(),/凭据不可用/u);
  await assert.rejects(createGptLiveAuth({file:'/x',now,readFileImpl:async()=>{throw Error('ENOENT');}})(),/凭据不可用/u);
  assert.throws(()=>createGptLiveAuth({file:''}),/auth file/u);
});
test('the model is off unless both the switch and a login file are named',()=>{
  assert.equal(gptLiveFromEnv({}),null);
  assert.equal(gptLiveFromEnv({VOICE_ENABLE_GPT_LIVE_11:'1'}),null);
  assert.equal(gptLiveFromEnv({VOICE_GPT_LIVE_AUTH_FILE:'/x'}),null);
  const config=gptLiveFromEnv({VOICE_ENABLE_GPT_LIVE_11:'1',VOICE_GPT_LIVE_AUTH_FILE:'/x',VOICE_GPT_LIVE_VOICE:'maple'});
  assert.equal(typeof config.resolveAuth,'function');assert.equal(typeof config.loadMedia,'function');
  assert.equal(config.voice,'maple');assert.equal(config.complete,null);assert.equal('model' in config,false);
});

test('the Gateway\'s login is asked for over the service\'s connection, held ten minutes at most and never to within five minutes of its expiry',async()=>{
  let clock=1_000_000,answer={access:'tok-1',accountId:'acct-fixture',expires:clock+3_600_000};const asked=[];
  const resolveAuth=createGatewayGptLiveAuth({request:async(method,params,options)=>{asked.push([method,params,options.timeoutMs]);return answer;},agentId:'helper',now:()=>clock});
  assert.deepEqual(await resolveAuth(),{token:'tok-1',accountId:'acct-fixture'});assert.deepEqual(asked,[['voice.product.gpt-live-auth',{agentId:'helper'},10000]]);
  // Another dial a minute later does not go to the Gateway; two at once after the hold share one request.
  clock+=60_000;await resolveAuth();assert.equal(asked.length,1);
  clock+=600_000;answer={access:'tok-2',accountId:'acct-fixture',expires:clock+3_600_000};
  assert.deepEqual(await Promise.all([resolveAuth(),resolveAuth()]),[{token:'tok-2',accountId:'acct-fixture'},{token:'tok-2',accountId:'acct-fixture'}]);assert.equal(asked.length,2);
  // Within five minutes of its expiry the held login is not reused: the Gateway is asked again (it renews its own),
  // and what it has is used while it is still good for a minute, refused after that.
  clock+=3_600_000-240_000;assert.deepEqual(await resolveAuth(),{token:'tok-2',accountId:'acct-fixture'});assert.equal(asked.length,3);
  clock+=210_000;await assert.rejects(resolveAuth(),/已过期/u);assert.equal(asked.length,4);
  // The Gateway refusing, or answering without a token or an account: unavailable, and asked again next time.
  const failing=createGatewayGptLiveAuth({request:async()=>{throw Error('UNAVAILABLE');}});await assert.rejects(failing(),/凭据不可用/u);
  await assert.rejects(createGatewayGptLiveAuth({request:async()=>({access:'tok'})})(),/凭据不可用/u);
  assert.throws(()=>createGatewayGptLiveAuth({}),/Gateway request/u);
});
test('the model may take its login from the Gateway instead of a file, when the service has a Gateway to ask',async()=>{
  const env={VOICE_ENABLE_GPT_LIVE_11:'1',VOICE_GPT_LIVE_AUTH:'gateway'};
  assert.equal(gptLiveFromEnv(env),null,'nothing to ask: off');
  const asked=[],config=gptLiveFromEnv(env,{gatewayRequest:async(method,params)=>{asked.push([method,params]);return {access:'tok',accountId:'acct-fixture'};}});
  assert.deepEqual(await config.resolveAuth(),{token:'tok',accountId:'acct-fixture'});assert.deepEqual(asked,[['voice.product.gpt-live-auth',{agentId:'makaron'}]]);
  const named=[];await gptLiveFromEnv({...env,VOICE_GPT_LIVE_AUTH_AGENT:'helper'},{gatewayRequest:async(method,params)=>{named.push(params);return {access:'tok',accountId:'acct-fixture'};}}).resolveAuth();assert.deepEqual(named,[{agentId:'helper'}]);
  // Without the setting, a file is still what is read.
  assert.equal(gptLiveFromEnv({VOICE_ENABLE_GPT_LIVE_11:'1'},{gatewayRequest:async()=>({})}),null);
});
