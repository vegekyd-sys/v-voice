import {createHash,createHmac} from 'node:crypto';
import {createFeishuActorGateway} from './feishu-actor-gateway.mjs';

export function feishuConversationPhone(accountId,chatId) {
  if(!/^[A-Za-z0-9_-]{1,128}$/u.test(accountId??'')||!/^oc_[A-Za-z0-9]+$/u.test(chatId??''))throw Error('Invalid conversation');
  return 'feishu_'+Buffer.from(JSON.stringify([accountId,chatId])).toString('base64url');
}
export function parseFeishuConversationPhone(phone) {
  try {
    if(typeof phone!=='string'||!/^feishu_[A-Za-z0-9_-]{1,400}$/u.test(phone))return null;
    const [accountId,chatId]=JSON.parse(Buffer.from(phone.slice(7),'base64url').toString());
    return feishuConversationPhone(accountId,chatId)===phone?{accountId,chatId}:null;
  }catch{return null;}
}

export function createFeishuConversationDirectory({gateway,appId,appSecret,accountId}) {
  return async (identity,phone) => {
    const target=parseFeishuConversationPhone(phone);
    if(!target||target.accountId!==accountId)throw Error('Unknown Feishu conversation');
    const options={gateway,appId,appSecret,accountId,identity,chatId:target.chatId};
    let admission;
    try {admission=await createFeishuActorGateway(options).request('voice.feishu.resolve',{});}
    catch(error) {
      if(error?.details?.reason==='conversation_membership_required')throw Object.assign(Error('Feishu conversation identity mismatch'),{code:'FEISHU_CONVERSATION_MEMBERSHIP_REQUIRED'});
      throw error;
    }
    if(!admission?.sessionKey||!admission.agentId||admission.accountId!==accountId||!['dm','group'].includes(admission.kind))throw Error('Gateway did not authorize this conversation');
    const callerId='feishu-'+createHash('sha256').update(JSON.stringify([appId,identity.tenantKey,identity.openId])).digest('hex').slice(0,32);
    const accessToken=createHmac('sha256',appSecret).update(JSON.stringify(['voice-feishu-access-v1',callerId,phone,admission.sessionKey])).digest('base64url');
    return Object.freeze({id:phone,sessionKey:admission.sessionKey,agentId:admission.agentId,accountId,kind:admission.kind,
      callerId,permissionProfile:'feishu-current',accessToken,displayName:admission.displayName??'飞书会话',replySync:true,
      actorPrincipal:Object.freeze({tenantKey:identity.tenantKey,openId:identity.openId}),
      replyTarget:Object.freeze({channel:'feishu',agentId:admission.agentId,sessionKey:admission.sessionKey,accountId,
        to:admission.kind==='group'?target.chatId:identity.openId}),
      gateway:createFeishuActorGateway({...options,sessionKey:admission.sessionKey})});
  };
}
