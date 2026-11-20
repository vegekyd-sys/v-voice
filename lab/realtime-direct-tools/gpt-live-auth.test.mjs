import test from 'node:test';import assert from 'node:assert/strict';
import {createGptLiveAuth,gptLiveFromEnv} from './gpt-live-auth.mjs';
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
