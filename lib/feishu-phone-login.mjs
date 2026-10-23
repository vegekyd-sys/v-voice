import {createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {parseFeishuConversationPhone,feishuConversationPhone} from './feishu-conversation-directory.mjs';

export async function readFeishuPhoneLoginFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('Feishu phone login file must be private');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}

class PhoneLoginError extends Error {
  constructor(reason, details = {}) {
    super('Feishu phone login was not confirmed');
    this.reason = reason;
    this.details = details;
  }
}
// Keep authorization codes, tokens and user identifiers out of diagnostics.
export function feishuPhoneLoginFailure(error) {
  if(error?.code==='FEISHU_CONVERSATION_MEMBERSHIP_REQUIRED')return {reason:'conversation_membership_required',stage:'conversation'};
  return error instanceof PhoneLoginError
    ? {reason:error.reason, ...error.details}
    : {reason:'unexpected_login_failure'};
}

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
const equal = (a, b) => {
  const x = Buffer.from(a ?? ''), y = Buffer.from(b ?? '');
  return x.length === y.length && timingSafeEqual(x, y);
};
const cookieValue = (req, name) => String(req.headers.cookie ?? '').split(/;\s*/u)
  .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
export const PHONE_LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// OAuth establishes the caller, never their tool permissions. Legacy actors
// keep explicit phone IDs. Dynamic conversations require Gateway admission;
// user-supplied chat IDs/session keys cannot provision or authorize an entry.
export function createFeishuPhoneLogin({appId, appSecret, actors = [], publicOrigin, basePath,
  entries, resolveConversation, accountId, fetchImpl = fetch, now = Date.now}) {
  if (!/^cli_[a-zA-Z0-9]+$/u.test(appId ?? '') || typeof appSecret !== 'string' || !appSecret
    || new URL(publicOrigin).protocol !== 'https:' || new URL(publicOrigin).origin !== publicOrigin
    || !/^\/[a-zA-Z0-9_-]+$/u.test(basePath) || !Array.isArray(actors) || !actors.length && !resolveConversation) {
    throw new Error('Invalid Feishu phone login configuration');
  }
  const allowed = new Map(), protectedPhones = new Set();
  for (const actor of actors) {
    if (!id(actor.openId) || !id(actor.tenantKey) || actor.callerId !== 'tianyi'
      || !Array.isArray(actor.phoneIds) || !actor.phoneIds.length
      || !actor.phoneIds.includes(actor.defaultPhoneId)) throw new Error('Invalid Feishu phone actor');
    const key = actor.tenantKey + ':' + actor.openId;
    if (allowed.has(key)) throw new Error('Duplicate Feishu phone actor');
    for (const phoneId of actor.phoneIds) {
      const binding = entries.resolve(new URL(`${publicOrigin}${basePath}/?phone=${encodeURIComponent(phoneId)}`));
      if (!binding || binding.id !== phoneId || binding.callerId !== actor.callerId) throw new Error('Unknown actor phone');
      protectedPhones.add(phoneId);
    }
    const defaultBinding = entries.resolve(new URL(`${publicOrigin}${basePath}/?phone=${encodeURIComponent(actor.defaultPhoneId)}`));
    if (defaultBinding.kind !== 'dm') throw new Error('Default Feishu phone must be a DM');
    allowed.set(key, Object.freeze({...actor, phoneIds: Object.freeze([...actor.phoneIds])}));
  }
  // Canonicalize only reviewed private group bindings, never browser session keys.
  const canonicalPhone = phone => {
    if(!resolveConversation||parseFeishuConversationPhone(phone))return phone;
    const binding=entries.resolve(new URL(`${publicOrigin}${basePath}/?phone=${encodeURIComponent(phone??'')}`));
    const match=binding?.kind==='group'&&binding.id!=='tianyi'&&binding.accountId===accountId
      ? /^agent:makaron:feishu:group:(oc_[A-Za-z0-9]+)$/u.exec(binding.sessionKey):null;
    return match?feishuConversationPhone(accountId,match[1]):phone;
  };
  const displayName = value => typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,128):'';
  const states = new Map(), handoffs = new Map();
  // Encrypted, authenticated browser identity survives service restarts. It
  // carries no provider tokens or phone permissions: current configuration is
  // checked on every read, so removing an actor/phone takes effect immediately.
  // Retire all pre-removal cookies: OAuth and the removed chat-code flow used
  // the same untagged format, so old cookies cannot safely distinguish issuers.
  const cookieKey = createHash('sha256').update(JSON.stringify(['voice-browser-login-oauth-v2',appId,appSecret,publicOrigin,basePath])).digest();
  const seal = actor => {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cookieKey,iv);
    const payload=Buffer.from(JSON.stringify({actor:actor.tenantKey+':'+actor.openId,...(actor.displayName?{displayName:actor.displayName}:{}),
      ...(actor.dynamic?{identity:{tenantKey:actor.tenantKey,openId:actor.openId,...(actor.userId?{userId:actor.userId}:{}),...(actor.displayName?{displayName:actor.displayName}:{}),dynamic:true}}:{}),expiresAt:now()+PHONE_LOGIN_TTL_MS}));
    return Buffer.concat([iv,cipher.update(payload),cipher.final(),cipher.getAuthTag()]).toString('base64url');
  };
  const unseal = value => {
    try {
      if(typeof value!=='string'||value.length>2048||! /^[A-Za-z0-9_-]+$/u.test(value))return null;
      const bytes=Buffer.from(value,'base64url');if(bytes.length<29)return null;
      const decipher=createDecipheriv('aes-256-gcm',cookieKey,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));
      const payload=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString());
      if(!Number.isFinite(payload.expiresAt)||payload.expiresAt<=now())return null;
      const registered=allowed.get(payload.actor);
      if(resolveConversation&&payload.identity?.dynamic&&id(payload.identity.openId)&&id(payload.identity.tenantKey))return {...registered,...payload.identity};
      return registered?{...registered,...(displayName(payload.displayName)?{displayName:displayName(payload.displayName)}:{})}:null;
    }catch{return null;}
  };
  const callbackUrl = `${publicOrigin}${basePath}/feishu/callback`;
  const loginCookie = 'v_feishu_phone', stateCookie = 'v_feishu_phone_state';
  const sweep = () => {
    for(const [key,value] of handoffs)if(value.expiresAt<=now())handoffs.delete(key);
    for (const [key, value] of states) if (value.expiresAt <= now()) states.delete(key);
  };
  const setCookie = (res, name, value, age) => res.setHeader('set-cookie',
    `${name}=${value}; Path=${basePath}/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
  const requestJson = async (stage, url, options) => {
    const response = await fetchImpl(url, {...options, redirect: 'error', signal: AbortSignal.timeout(10000)});
    const body = await response.json();
    if (!response.ok || body.code !== 0) throw new PhoneLoginError('provider_rejected', {stage, httpStatus:response.status, providerCode:Number.isInteger(body.code) ? body.code : null});
    return body;
  };
  const persistIdentity = async (data,pending,res) => {
    let actor=allowed.get(data?.tenant_key+':'+data?.open_id);
    if(resolveConversation&&parseFeishuConversationPhone(pending.phoneId)&&id(data?.open_id)&&id(data?.tenant_key)) {
      actor={tenantKey:data.tenant_key,openId:data.open_id,...(id(data.user_id)?{userId:data.user_id}:{}),dynamic:true};
      try {await resolveConversation(actor,pending.phoneId);}catch(error){error.recoveryPhone=pending.phoneId;throw error;}
    } else if(!actor||pending.phoneId&&!actor.phoneIds.includes(pending.phoneId))throw new PhoneLoginError('caller_not_registered');
    actor={...actor,...(displayName(data?.name)?{displayName:displayName(data.name)}:{})};
    setCookie(res,loginCookie,seal(actor),PHONE_LOGIN_TTL_MS/1000);
    const handoff=parseFeishuConversationPhone(pending.phoneId)?randomBytes(24).toString('base64url'):null;
    if(handoff)handoffs.set(handoff,{phone:pending.phoneId,actor:actor.tenantKey+':'+actor.openId,expiresAt:now()+30000});
    return `${basePath}/feishu?phone=${encodeURIComponent(pending.phoneId||actor.defaultPhoneId)}${handoff?'&identified='+handoff:''}${pending.callId?'&call='+pending.callId:''}`;
  };
  const consumeClient = (req,state) => {
    sweep();const pending=states.get(state);
    if(!pending?.client||!equal(cookieValue(req,stateCookie),pending.browser))throw new PhoneLoginError('invalid_state');
    states.delete(state);return pending;
  };
  return {
    canonicalPhone,
    consumeHandoff(req,phone,key) {
      sweep();const h=handoffs.get(key),a=unseal(cookieValue(req,loginCookie));
      if(!h||h.phone!==phone||!a||h.actor!==a.tenantKey+':'+a.openId)return false;
      handoffs.delete(key);return true;
    },
    beginClient(req,res,phone) {
      sweep();phone=canonicalPhone(phone);
      if(!resolveConversation||!parseFeishuConversationPhone(phone)||states.size>=512)throw new PhoneLoginError('invalid_state');
      const state=randomBytes(32).toString('base64url'),browser=randomBytes(32).toString('base64url');
      states.set(state,{client:true,phoneId:phone,browser,expiresAt:now()+180000});
      setCookie(res,stateCookie,browser,180);
      return `${basePath}/feishu/callback?client=1&state=${state}`;
    },
    clientPending(req,state) {sweep();const p=states.get(state);return p?.client&&equal(cookieValue(req,stateCookie),p.browser)?{phone:p.phoneId}:null;},
    async completeClient(req,res,{state,code}) {
      const pending=consumeClient(req,state);
      if(!id(code))throw new PhoneLoginError('login_declined');
      const app=await requestJson('app_token','https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret})});
      if(!app.app_access_token)throw new PhoneLoginError('invalid_token_response');
      const token=await requestJson('client_token','https://open.feishu.cn/open-apis/authen/v1/access_token',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${app.app_access_token}`},body:JSON.stringify({grant_type:'authorization_code',code})});
      if(!token.data?.access_token)throw new PhoneLoginError('invalid_token_response');
      const info=await requestJson('user_info','https://open.feishu.cn/open-apis/authen/v1/user_info',{headers:{authorization:`Bearer ${token.data.access_token}`}});
      return await persistIdentity(info.data,pending,res);
    },
    clearIdentity(res) {setCookie(res,loginCookie,'',0);},
    protects: binding => protectedPhones.has(binding.id)||binding.permissionProfile==='feishu-current',
    actorPermits(principal,binding) {
      if(binding.permissionProfile==='feishu-current')return principal?.tenantKey===binding.actorPrincipal.tenantKey&&principal?.openId===binding.actorPrincipal.openId;
      const actor=allowed.get(principal.tenantKey+':'+principal.openId);
      return actor?.callerId===binding.callerId&&actor.phoneIds.includes(binding.id);
    },
    read(req) {
      sweep();
      return unseal(cookieValue(req, loginCookie));
    },
    permits(req, binding) { const actor=this.read(req);return binding.permissionProfile==='feishu-current'?!!actor&&this.actorPermits(actor,binding):actor?.phoneIds?.includes(binding.id) === true; },
    async resolve(req,url) {
      const phone=canonicalPhone(url.searchParams.get('phone'));
      if(!parseFeishuConversationPhone(phone))return entries.resolve(url);
      const actor=this.read(req);
      if(!actor||!resolveConversation)return null;
      return resolveConversation(actor,phone);
    },
    select(req, requestedPhone) {
      requestedPhone=canonicalPhone(requestedPhone);
      const actor = this.read(req);
      if (!actor) return null;
      if(resolveConversation&&parseFeishuConversationPhone(requestedPhone))return resolveConversation(actor,requestedPhone);
      const phoneId = requestedPhone || actor.defaultPhoneId;
      if (!actor.phoneIds?.includes(phoneId)) throw new Error('Phone is not available to this caller');
      return entries.resolve(new URL(`${publicOrigin}${basePath}/?phone=${encodeURIComponent(phoneId)}`));
    },
    begin(req, res, requestedPhone, callId, {promptConsent=false} = {}) {
      sweep();requestedPhone=canonicalPhone(requestedPhone);
      if (requestedPhone && !protectedPhones.has(requestedPhone)&&!(resolveConversation&&parseFeishuConversationPhone(requestedPhone))) throw new Error('Unknown phone');
      if(!requestedPhone&&!actors.length)throw new Error('A Feishu conversation is required');
      if (states.size >= 512) throw new Error('Too many pending phone logins');
      const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      states.set(state, {browser, verifier, phoneId: requestedPhone, callId:/^[a-f0-9-]{36}$/u.test(callId??'')?callId:null, expiresAt: now() + 300000});
      setCookie(res, stateCookie, browser, 300);
      const authorize = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
      for (const [key, value] of Object.entries({client_id: appId, response_type: 'code',
        redirect_uri: callbackUrl, state, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url')})) authorize.searchParams.set(key, value);
      if(promptConsent)authorize.searchParams.set('prompt','consent');
      // No tool, directory, calendar or offline-access scopes are requested.
      return authorize.href;
    },
    async complete(req, res, url) {
      sweep();
      const state = url.searchParams.get('state'), pending = states.get(state);
      if (!pending || pending.client || !equal(cookieValue(req, stateCookie), pending.browser)) throw new PhoneLoginError('invalid_state', {pending:!!pending, browserMatched:!!pending && equal(cookieValue(req, stateCookie), pending.browser)});
      states.delete(state); // single-use, including denial and failed exchanges
      try {
      if (url.searchParams.has('error') || !id(url.searchParams.get('code'))) throw new PhoneLoginError('login_declined');
      // The authorize endpoint currently documents PKCE compatibility with v2.
      // Keep S256 mandatory; never retry a failed code exchange without PKCE.
      const token = await requestJson('token', 'https://open.feishu.cn/open-apis/authen/v2/oauth/token', {method: 'POST',
        headers: {'content-type': 'application/json; charset=utf-8'},
        body: JSON.stringify({grant_type: 'authorization_code', client_id: appId,
          client_secret: appSecret, code: url.searchParams.get('code'), redirect_uri: callbackUrl,
          code_verifier: pending.verifier})});
      if (!token.access_token || token.token_type !== 'Bearer') throw new PhoneLoginError('invalid_token_response');
      const info = await requestJson('user_info', 'https://open.feishu.cn/open-apis/authen/v1/user_info', {
        headers: {authorization: `Bearer ${token.access_token}`}});
      // Only the basic account label is retained; never provider tokens/contact fields.
      return await persistIdentity(info.data,pending,res);
      } catch(error) {error.recoveryPhone=pending.phoneId;throw error;}
    },
  };
}

// Render fixed copy and a validated public route; never reflect provider errors,
// OAuth codes, caller IDs, or session keys into the browser.
export function feishuPhoneLoginErrorPage({reason,phone,basePath}) {
  const mismatch=reason==='conversation_membership_required';
  const title=mismatch?'请切换到这个会话的飞书身份':'暂时无法打开电话';
  const message=mismatch?'当前网页授权的飞书身份不属于这个会话。如果私聊使用外部联系人身份，请在授权页切换到同一个身份，再重新打开电话。':'请从飞书会话重新打开电话入口，或重新授权后重试。';
  const retry=parseFeishuConversationPhone(phone)?`${basePath}/feishu?phone=${encodeURIComponent(phone)}&amp;retry=1`:null;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f5f6f8;color:#20242b;font:16px/1.7 system-ui,sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:440px;margin:24px;padding:32px;background:white;border-radius:20px}h1{font-size:23px;line-height:1.4}p{color:#626a76}a{display:inline-block;margin-top:16px;padding:10px 20px;background:#20242b;color:white;border-radius:12px;text-decoration:none}</style><main><h1>${title}</h1><p>${message}</p>${retry?`<a href="${retry}">重新选择飞书身份</a>`:''}</main></html>`;
}
