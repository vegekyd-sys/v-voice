import test from 'node:test';import assert from 'node:assert/strict';
import {createVoiceGptAuth} from './auth.mjs';
const jwt=exp=>`h.${Buffer.from(JSON.stringify({exp})).toString('base64url')}.s`;
const host=(token,identity={accountId:'acct-fixture'})=>{const asked=[];return {asked,resolveToken:async request=>{asked.push(request);return token;},resolveIdentity:()=>identity,resolveAgentDir:(cfg,id)=>`/agents/${id}/agent`,resolveDefaultAgentId:()=>'main'};};

test('the login is read by the host\'s own call: provider openai, OAuth profiles only, the named agent\'s store',async()=>{
  const h=host(jwt(2000000000)),read=createVoiceGptAuth(h),cfg={fixture:true};
  assert.deepEqual(await read({cfg,agentId:'helper'}),{access:jwt(2000000000),accountId:'acct-fixture',expires:2000000000000});
  assert.deepEqual(h.asked[0],{provider:'openai',cfg,agentDir:'/agents/helper/agent',profileTypes:['oauth'],includeExternalCliAuth:false});
  // No agent named, or a name that is not one: the host's default agent.
  await read({cfg});await read({cfg,agentId:'../etc'});
  assert.deepEqual(h.asked.slice(1).map(request=>request.agentDir),['/agents/main/agent','/agents/main/agent']);
});

test('no login, a login without an account, or a host without the calls: an error, never a partial answer',async()=>{
  await assert.rejects(createVoiceGptAuth(host(undefined))({}),/login unavailable/u);
  await assert.rejects(createVoiceGptAuth(host(jwt(2000000000),{}))({}),/no account/u);
  assert.throws(()=>createVoiceGptAuth({resolveToken:async()=>'x'}),/contract unavailable/u);
  // A token that is not a JWT is passed on without an expiry: the service then asks again each time.
  assert.deepEqual(await createVoiceGptAuth(host('opaque-token'))({}),{access:'opaque-token',accountId:'acct-fixture'});
});
