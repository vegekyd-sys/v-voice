import {createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {parseFeishuConversationPhone} from './feishu-conversation-directory.mjs';

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
  entries, resolveConversation, conversationLogin, fetchImpl = fetch, now = Date.now}) {
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
  const states = new Map(),checks=new Map();
  // Encrypted, authenticated browser identity survives service restarts. It
  // carries no provider tokens or phone permissions: current configuration is
  // checked on every read, so removing an actor/phone takes effect immediately.
  const cookieKey = createHash('sha256').update(JSON.stringify(['voice-browser-login-v1',appId,appSecret,publicOrigin,basePath])).digest();
  const seal = actor => {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cookieKey,iv);
    const payload=Buffer.from(JSON.stringify({actor:actor.tenantKey+':'+actor.openId,
      ...(actor.dynamic?{identity:{tenantKey:actor.tenantKey,openId:actor.openId,...(actor.userId?{userId:actor.userId}:{}),dynamic:true}}:{}),expiresAt:now()+PHONE_LOGIN_TTL_MS}));
    return Buffer.concat([iv,cipher.update(payload),cipher.final(),cipher.getAuthTag()]).toString('base64url');
  };
  const unseal = value => {
    try {
      if(typeof value!=='string'||value.length>2048||! /^[A-Za-z0-9_-]+$/u.test(value))return null;
      const bytes=Buffer.from(value,'base64url');if(bytes.length<29)return null;
      const decipher=createDecipheriv('aes-256-gcm',cookieKey,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));
      const payload=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString());
      return Number.isFinite(payload.expiresAt)&&payload.expiresAt>now()?
        allowed.get(payload.actor)??(resolveConversation&&payload.identity?.dynamic&&id(payload.identity.openId)&&id(payload.identity.tenantKey)?payload.identity:null):null;
    }catch{return null;}
  };
  const callbackUrl = `${publicOrigin}${basePath}/feishu/callback`;
  const loginCookie = 'v_feishu_phone', stateCookie = 'v_feishu_phone_state',checkCookie='v_feishu_phone_check';
  const sweep = () => {
    for (const [key, value] of states) if (value.expiresAt <= now()) states.delete(key);
    for(const [key,value] of checks)if(value.expiresAt<=now())checks.delete(key);
  };
  const setCookie = (res, name, value, age) => res.setHeader('set-cookie',
    `${name}=${value}; Path=${basePath}/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
  const requestJson = async (stage, url, options) => {
    const response = await fetchImpl(url, {...options, redirect: 'error', signal: AbortSignal.timeout(10000)});
    const body = await response.json();
    if (!response.ok || body.code !== 0) throw new PhoneLoginError('provider_rejected', {stage, httpStatus:response.status, providerCode:Number.isInteger(body.code) ? body.code : null});
    return body;
  };
  return {
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
      const phone=url.searchParams.get('phone');
      if(!parseFeishuConversationPhone(phone))return entries.resolve(url);
      const actor=this.read(req);
      if(!actor||!resolveConversation)return null;
      return resolveConversation(actor,phone);
    },
    select(req, requestedPhone) {
      const actor = this.read(req);
      if (!actor) return null;
      if(resolveConversation&&parseFeishuConversationPhone(requestedPhone))return resolveConversation(actor,requestedPhone);
      const phoneId = requestedPhone || actor.defaultPhoneId;
      if (!actor.phoneIds?.includes(phoneId)) throw new Error('Phone is not available to this caller');
      return entries.resolve(new URL(`${publicOrigin}${basePath}/?phone=${encodeURIComponent(phoneId)}`));
    },
    begin(req, res, requestedPhone, callId, {promptConsent=false} = {}) {
      sweep();
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
    async beginConversation(req,res,phone) {
      sweep();
      if(!conversationLogin||!resolveConversation||!parseFeishuConversationPhone(phone)||checks.size>=512)throw new PhoneLoginError('conversation_login_unavailable');
      const old=checks.get(cookieValue(req,checkCookie));
      if(old?.phone===phone)return {code:old.code,expiresAt:old.expiresAt};
      const pending=await conversationLogin.begin(phone);
      if(typeof pending?.ticket!=='string'||! /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/u.test(pending.code??'')||!Number.isFinite(pending.expiresAt)||pending.expiresAt<=now()||pending.expiresAt>now()+310000)throw new PhoneLoginError('conversation_login_unavailable');
      const browser=randomBytes(32).toString('base64url');checks.set(browser,{...pending,phone});
      setCookie(res,checkCookie,browser,300);
      return {code:pending.code,expiresAt:pending.expiresAt};
    },
    async completeConversation(req,res) {
      sweep();const browser=cookieValue(req,checkCookie),pending=checks.get(browser);
      if(!pending||!conversationLogin)throw new PhoneLoginError('conversation_login_expired');
      if(pending.busy)return {status:'pending'};
      pending.busy=true;
      try {
        const result=await conversationLogin.status(pending.ticket);
        if(result?.status==='pending')return {status:'pending'};
        const a=result?.identity;
        if(result?.status!=='verified'||!id(a?.openId)||!id(a?.tenantKey))throw new PhoneLoginError('conversation_login_unavailable');
        const actor={openId:a.openId,tenantKey:a.tenantKey,...(id(a.userId)?{userId:a.userId}:{}),dynamic:true};
        await resolveConversation(actor,pending.phone);
        checks.delete(browser);setCookie(res,loginCookie,seal(actor),PHONE_LOGIN_TTL_MS/1000);
        return {status:'verified',location:`${basePath}/feishu?phone=${encodeURIComponent(pending.phone)}`};
      }catch(error){checks.delete(browser);throw error;}
      finally{pending.busy=false;}
    },
    async complete(req, res, url) {
      sweep();
      const state = url.searchParams.get('state'), pending = states.get(state);
      if (!pending || !equal(cookieValue(req, stateCookie), pending.browser)) throw new PhoneLoginError('invalid_state', {pending:!!pending, browserMatched:!!pending && equal(cookieValue(req, stateCookie), pending.browser)});
      states.delete(state); // single-use, including denial and failed exchanges
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
      let actor = allowed.get(info.data?.tenant_key + ':' + info.data?.open_id);
      if(resolveConversation&&parseFeishuConversationPhone(pending.phoneId)&&id(info.data?.open_id)&&id(info.data?.tenant_key)){
        actor={tenantKey:info.data.tenant_key,openId:info.data.open_id,...(id(info.data.user_id)?{userId:info.data.user_id}:{}),dynamic:true};
        try {await resolveConversation(actor,pending.phoneId);}
        catch(error) {error.recoveryPhone=pending.phoneId;throw error;}
      }else if (!actor || pending.phoneId && !actor.phoneIds.includes(pending.phoneId)) throw new PhoneLoginError('caller_not_registered', {identityPresent:typeof info.data?.open_id === 'string', tenantPresent:typeof info.data?.tenant_key === 'string'});
      setCookie(res, loginCookie, seal(actor), PHONE_LOGIN_TTL_MS/1000);
      // OAuth tokens, names, phone numbers and email are not persisted or sent
      // to a voice model. No refresh token is requested or retained.
      return `${basePath}/feishu?phone=${encodeURIComponent(pending.phoneId || actor.defaultPhoneId)}${pending.callId?'&call='+pending.callId:''}`;
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
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f5f6f8;color:#20242b;font:16px/1.7 system-ui,sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:440px;margin:24px;padding:32px;background:white;border-radius:20px}h1{font-size:23px;line-height:1.4}p{color:#626a76}a{display:inline-block;margin-top:16px;padding:10px 20px;background:#20242b;color:white;border-radius:12px;text-decoration:none}</style><main><h1>${title}</h1><p>${message}</p>${retry?`<a href="${retry}">重新选择飞书身份</a><p><a href="${basePath}/feishu/connect?phone=${encodeURIComponent(phone)}">通过飞书私聊确认</a></p>`:''}</main></html>`;
}

export function feishuPhoneLoginChoices({phone,basePath}) {
  if(!parseFeishuConversationPhone(phone))throw Error('Invalid conversation');
  const p=encodeURIComponent(phone);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>打开 V 电话</title><style>body{font:16px/1.7 system-ui;background:#f5f6f8;color:#20242b;display:grid;min-height:100dvh;place-items:center;margin:0}main{max-width:420px;margin:24px;padding:32px;background:white;border-radius:20px}h1{font-size:24px}a{display:block;padding:12px 18px;margin-top:16px;border:1px solid #ddd;border-radius:12px;text-decoration:none;color:inherit}p{color:#626a76}</style><main><h1>打开 V 电话</h1><p>先确认你的飞书身份。外部联系人可以在本人和 V 的私聊中确认。</p><a href="${basePath}/feishu?phone=${p}&amp;oauth=1">飞书账号授权登录</a><a href="${basePath}/feishu/connect?phone=${p}">外部联系人：通过私聊确认</a></main></html>`;
}

export function feishuConversationLoginPage({phone,basePath,appId}) {
  if(!parseFeishuConversationPhone(phone)||!/^cli_[A-Za-z0-9]+$/u.test(appId??''))throw Error('Invalid conversation');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>在飞书私聊中确认</title><style>body{font:16px/1.7 system-ui;background:#f5f6f8;color:#20242b;display:grid;min-height:100dvh;place-items:center;margin:0}main{max-width:440px;margin:24px;padding:32px;background:white;border-radius:20px}h1{font-size:24px;line-height:1.4}p{color:#626a76}button,a{font:inherit;display:inline-block;padding:10px 18px;border:0;background:#20242b;color:white;border-radius:12px;text-decoration:none;cursor:pointer}code{display:block;font:20px/1.7 monospace;word-break:break-all;padding:16px;background:#f5f6f8;border-radius:12px}a{background:white;color:#20242b;border:1px solid #ddd;margin-top:12px}button:disabled{opacity:.5}</style><main><h1>在飞书私聊中确认</h1><p>用这次外部联系人身份，在你和 V 的私聊里发送下面的验证码。确认后，此浏览器会自动打开原会话的电话。</p><button id="start">生成验证码</button><section id="codeArea" hidden><code id="code"></code><button id="copy">复制验证码</button><br><a href="https://applink.feishu.cn/client/bot/open?appId=${appId}">打开与 V 的私聊</a><p>只发送自己打开的电话页面中的验证码。验证码 5 分钟内有效，仅用于登录当前浏览器。</p></section><p id="status" role="status"></p></main><script>
const start=document.querySelector('#start'),area=document.querySelector('#codeArea'),code=document.querySelector('#code'),status=document.querySelector('#status');let generation=0;
async function poll(current,expiresAt){if(current!==generation)return;if(Date.now()>=expiresAt){status.textContent='验证码已过期，请重新生成。';start.disabled=false;return;}try{const res=await fetch(${JSON.stringify(basePath+'/feishu/connect/status')},{credentials:'same-origin',cache:'no-store'});const result=await res.json();if(!res.ok)throw Error();if(result.status==='verified'){status.textContent='已确认，正在打开电话…';location.assign(result.location);return;}setTimeout(()=>poll(current,expiresAt),2000);}catch{status.textContent='此次确认已失效，请重新生成验证码。';start.disabled=false;}}
start.onclick=async()=>{const current=++generation;start.disabled=true;status.textContent='正在生成…';try{const res=await fetch(${JSON.stringify(basePath+'/feishu/connect')},{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({phone:${JSON.stringify(phone)}})});const result=await res.json();if(!res.ok)throw Error();code.textContent='电话登录 '+result.code;area.hidden=false;status.textContent='等待你从飞书私聊发送验证码…';poll(current,result.expiresAt);}catch{status.textContent='暂时无法生成，请稍后重试。';start.disabled=false;}};
document.querySelector('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent);status.textContent='已复制，请在你和 V 的私聊中发送。';}catch{status.textContent='请手动复制上方验证码。';}};
</script></html>`;
}
