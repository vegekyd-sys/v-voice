import {readFile} from 'node:fs/promises';
import {routerCompletionFromEnv,decisionsChooserFromEnv,replyJudgeFromEnv} from './gpt-live-router.mjs';

// The ChatGPT (Codex) login this service may call GPT Live with. The file is
// private and maintained outside this process (never committed, never logged);
// this service only reads the access token and never refreshes it, so it can
// never rotate a refresh token that another program owns.
const expiry=token=>{try{const exp=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).exp;return Number.isFinite(exp)?exp*1000:null;}catch{return null;}};
export function createGptLiveAuth({file,readFileImpl=readFile,now=Date.now,marginMs=60000}){
  if(typeof file!=='string'||!file)throw Error('GPT Live auth file is required');
  return async function resolveAuth(){
    let value;
    try{value=JSON.parse(await readFileImpl(file,'utf8'));}catch{throw Error('GPT Live 登录凭据不可用');}
    // Either this service's own shape or a Codex CLI auth file.
    const token=value?.access??value?.access_token??value?.tokens?.access_token,accountId=value?.accountId??value?.account_id??value?.tokens?.account_id;
    if(typeof token!=='string'||!token||typeof accountId!=='string'||!accountId)throw Error('GPT Live 登录凭据不可用');
    const expires=Number.isFinite(value?.expires)?value.expires:expiry(token);
    if(expires!==null&&expires<now()+marginMs)throw Error('GPT Live 登录已过期');
    return {token,accountId};
  };
}
// The Gateway's own ChatGPT login (the one its GPT Live One uses), asked for over this service's Gateway
// connection: `voice.product.gpt-live-auth` of the v-voice-gpt-live plugin. The Gateway keeps and renews
// it; here it is held in memory only, for ten minutes at most and never to within five minutes of its
// expiry, so a dial does not wait on the Gateway each time and a renewed login is picked up soon.
export function createGatewayGptLiveAuth({request,agentId,now=Date.now,holdMs=600000,marginMs=300000}){
  if(typeof request!=='function')throw Error('GPT Live gateway auth needs a Gateway request');
  let held=null,pending=null;
  const usable=value=>value&&now()-value.at<holdMs&&(value.expires===null||value.expires>now()+marginMs);
  return async function resolveAuth(){
    if(usable(held))return {token:held.token,accountId:held.accountId};
    pending??=(async()=>{
      let value;
      try{value=await request('voice.product.gpt-live-auth',agentId?{agentId}:{},{timeoutMs:10000});}catch{throw Error('GPT Live 登录凭据不可用');}
      const token=value?.access,accountId=value?.accountId,expires=Number.isFinite(value?.expires)?value.expires:expiry(token);
      if(typeof token!=='string'||!token||typeof accountId!=='string'||!accountId)throw Error('GPT Live 登录凭据不可用');
      if(expires!==null&&expires<now()+60000)throw Error('GPT Live 登录已过期');
      held={token,accountId,expires,at:now()};
      return {token,accountId};
    })().finally(()=>{pending=null;});
    return pending;
  };
}
// Off unless named: the model, its media stack and its login are all opt-in. The login is either the
// Gateway's (`VOICE_GPT_LIVE_AUTH=gateway`, needs `gatewayRequest`) or a private file. The Gateway is asked
// for one agent's login by name (`VOICE_GPT_LIVE_AUTH_AGENT`, the service's usual agent otherwise): a host
// with several agents has no default owner for it.
export function gptLiveFromEnv(env=process.env,{fetchImpl,gatewayRequest}={}){
  const viaGateway=env.VOICE_GPT_LIVE_AUTH==='gateway'&&typeof gatewayRequest==='function';
  if(env.VOICE_ENABLE_GPT_LIVE_11!=='1'||!viaGateway&&!env.VOICE_GPT_LIVE_AUTH_FILE)return null;
  const complete=routerCompletionFromEnv(env,{fetchImpl});
  return {
    resolveAuth:viaGateway?createGatewayGptLiveAuth({request:gatewayRequest,agentId:env.VOICE_GPT_LIVE_AUTH_AGENT||'makaron'}):createGptLiveAuth({file:env.VOICE_GPT_LIVE_AUTH_FILE}),
    // Loaded on the first call only; a service that never offers the model never loads a WebRTC stack.
    loadMedia:async()=>{const [werift,opus]=await Promise.all([import('werift'),import('opusscript')]);return {werift,OpusScript:opus.default??opus};},
    complete,
    choose:decisionsChooserFromEnv(env,{fetchImpl}),
    // What was just said, judged (a goodbye with no hang-up, a promise with nothing running): see the router.
    judge:replyJudgeFromEnv(env,{fetchImpl,complete}),
    ...(env.VOICE_GPT_LIVE_SCRIPTED_LESSONS==='1'?{scriptedLessons:true}:{}),
    ...(env.VOICE_GPT_LIVE_MODEL?{model:env.VOICE_GPT_LIVE_MODEL}:{}),
    ...(env.VOICE_GPT_LIVE_VOICE?{voice:env.VOICE_GPT_LIVE_VOICE}:{}),
  };
}
