import {readFile} from 'node:fs/promises';
import {routerCompletionFromEnv,decisionsChooserFromEnv} from './gpt-live-router.mjs';

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
// Off unless named: the model, its media stack and its login are all opt-in.
export function gptLiveFromEnv(env=process.env,{fetchImpl}={}){
  if(env.VOICE_ENABLE_GPT_LIVE_11!=='1'||!env.VOICE_GPT_LIVE_AUTH_FILE)return null;
  return {
    resolveAuth:createGptLiveAuth({file:env.VOICE_GPT_LIVE_AUTH_FILE}),
    // Loaded on the first call only; a service that never offers the model never loads a WebRTC stack.
    loadMedia:async()=>{const [werift,opus]=await Promise.all([import('werift'),import('opusscript')]);return {werift,OpusScript:opus.default??opus};},
    complete:routerCompletionFromEnv(env,{fetchImpl}),
    choose:decisionsChooserFromEnv(env,{fetchImpl}),
    ...(env.VOICE_GPT_LIVE_SCRIPTED_LESSONS==='1'?{scriptedLessons:true}:{}),
    ...(env.VOICE_GPT_LIVE_MODEL?{model:env.VOICE_GPT_LIVE_MODEL}:{}),
    ...(env.VOICE_GPT_LIVE_VOICE?{voice:env.VOICE_GPT_LIVE_VOICE}:{}),
  };
}
