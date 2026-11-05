import {createHmac} from 'node:crypto';
const canonical = value => JSON.stringify(value === undefined ? null : value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k => [k,JSON.parse(canonical(value[k]))])) : value);

// Called with server-owned OAuth identity. Neither identity nor the app secret
// can be read or overridden by a model, browser request, or tool arguments.
export function createFeishuActorGateway({gateway,appId,appSecret,accountId,identity,chatId,sessionKey,now=Date.now}) {
  if (!gateway || !appSecret || !/^ou_[A-Za-z0-9]+$/u.test(identity?.openId ?? '') ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(identity?.tenantKey ?? '') || !/^oc_[A-Za-z0-9]+$/u.test(chatId ?? '')) throw Error('Invalid verified Feishu caller');
  const actor=Object.freeze({appId,accountId,tenantKey:identity.tenantKey,openId:identity.openId,
    ...(identity.userId?{userId:identity.userId}:{}),chatId});
  return {get ready(){return gateway.ready;},supportsMethod:method=>gateway.supportsMethod?.(method)===true,async request(method,input={},options){
    if (input.voiceActor !== undefined) throw Error('Voice identity cannot be supplied by a caller');
    const params={...input};
    if (method !== 'voice.feishu.resolve' && !['sessions.resolve','sessions.describe'].includes(method) && sessionKey) {
      if (params.sessionKey !== undefined && params.sessionKey !== sessionKey) throw Error('Voice conversation cannot change');
      params.sessionKey=sessionKey;
    }
    const proof={version:1,actor,method,params:canonical(params),issuedAt:now()};
    const voiceActor={...proof,signature:createHmac('sha256',appSecret).update(canonical(proof)).digest('base64url')};
    return gateway.request(method,{...params,voiceActor},options);
  }};
}
