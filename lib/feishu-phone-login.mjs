import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';

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

// OAuth establishes the caller, never their tool permissions. Phase one keeps
// the existing Tianyi-only policy; each actor has explicit, operator-verified
// phone IDs. User-supplied chat IDs/session keys cannot provision an entry.
export function createFeishuPhoneLogin({appId, appSecret, actors, publicOrigin, basePath,
  entries, fetchImpl = fetch, now = Date.now}) {
  if (!/^cli_[a-zA-Z0-9]+$/u.test(appId ?? '') || typeof appSecret !== 'string' || !appSecret
    || new URL(publicOrigin).protocol !== 'https:' || new URL(publicOrigin).origin !== publicOrigin
    || !/^\/[a-zA-Z0-9_-]+$/u.test(basePath) || !Array.isArray(actors) || !actors.length) {
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
  const states = new Map(), sessions = new Map();
  const callbackUrl = `${publicOrigin}${basePath}/feishu/callback`;
  const loginCookie = 'v_feishu_phone', stateCookie = 'v_feishu_phone_state';
  const sweep = () => {
    for (const [key, value] of states) if (value.expiresAt <= now()) states.delete(key);
    for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key);
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
    protects: binding => protectedPhones.has(binding.id),
    actorPermits(principal,binding) {
      const actor=allowed.get(principal.tenantKey+':'+principal.openId);
      return actor?.callerId===binding.callerId&&actor.phoneIds.includes(binding.id);
    },
    read(req) {
      sweep();
      return sessions.get(cookieValue(req, loginCookie))?.actor ?? null;
    },
    permits(req, binding) { return this.read(req)?.phoneIds.includes(binding.id) === true; },
    select(req, requestedPhone) {
      const actor = this.read(req);
      if (!actor) return null;
      const phoneId = requestedPhone || actor.defaultPhoneId;
      if (!actor.phoneIds.includes(phoneId)) throw new Error('Phone is not available to this caller');
      return entries.resolve(new URL(`${publicOrigin}${basePath}/?phone=${encodeURIComponent(phoneId)}`));
    },
    begin(req, res, requestedPhone, callId) {
      sweep();
      if (requestedPhone && !protectedPhones.has(requestedPhone)) throw new Error('Unknown phone');
      if (states.size >= 512) throw new Error('Too many pending phone logins');
      const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      states.set(state, {browser, verifier, phoneId: requestedPhone, callId:/^[a-f0-9-]{36}$/u.test(callId??'')?callId:null, expiresAt: now() + 300000});
      setCookie(res, stateCookie, browser, 300);
      const authorize = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
      for (const [key, value] of Object.entries({client_id: appId, response_type: 'code',
        redirect_uri: callbackUrl, state, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url')})) authorize.searchParams.set(key, value);
      // No tool, directory, calendar or offline-access scopes are requested.
      return authorize.href;
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
      const actor = allowed.get(info.data?.tenant_key + ':' + info.data?.open_id);
      if (!actor || pending.phoneId && !actor.phoneIds.includes(pending.phoneId)) throw new PhoneLoginError('caller_not_registered', {identityPresent:typeof info.data?.open_id === 'string', tenantPresent:typeof info.data?.tenant_key === 'string'});
      if (sessions.size >= 512) throw new Error('Too many phone login sessions');
      const session = randomBytes(32).toString('base64url');
      sessions.set(session, {actor, expiresAt: now() + 28800000});
      setCookie(res, loginCookie, session, 28800);
      // OAuth tokens, names, phone numbers and email are not persisted or sent
      // to a voice model. No refresh token is requested or retained.
      return `${basePath}/feishu?phone=${encodeURIComponent(pending.phoneId || actor.defaultPhoneId)}${pending.callId?'&call='+pending.callId:''}`;
    },
  };
}
