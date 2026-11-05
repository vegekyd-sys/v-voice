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

export function createFeishuConversationDirectory({gateway,appId,appSecret,accountId,now=()=>performance.now()}) {
  // One live Gateway read may serve simultaneous requests for the same verified
  // subject and conversation. Never retain a settled admission or share bindings.
  const pendingAdmissions=new Map();
  return async (identity,phone) => {
    const target=parseFeishuConversationPhone(phone);
    if(!target||target.accountId!==accountId)throw Error('Unknown Feishu conversation');
    const options={gateway,appId,appSecret,accountId,identity,chatId:target.chatId};
    const actorGateway=createFeishuActorGateway(options);
    const key=JSON.stringify([identity.tenantKey,identity.openId,identity.userId,phone]);
    let admission;
    try {
      let pending=pendingAdmissions.get(key);
      if(!pending||now()-pending.startedAt>=1000){
        pending={startedAt:now(),work:Promise.resolve().then(()=>actorGateway.request('voice.feishu.resolve',{}))};pendingAdmissions.set(key,pending);
        const owned=pending,forget=()=>{if(pendingAdmissions.get(key)===owned)pendingAdmissions.delete(key);};
        pending.work.then(forget,forget);
      }
      admission=await pending.work;
    }
    catch(error) {
      if(error?.details?.reason==='conversation_membership_required')throw Object.assign(Error('Feishu conversation identity mismatch'),{code:'FEISHU_CONVERSATION_MEMBERSHIP_REQUIRED'});
      throw error;
    }
    if(!admission?.sessionKey||!admission.agentId||admission.accountId!==accountId||!['dm','group'].includes(admission.kind))throw Error('Gateway did not authorize this conversation');
    const callerId='feishu-'+createHash('sha256').update(JSON.stringify([appId,identity.tenantKey,identity.openId])).digest('hex').slice(0,32);
    const accessToken=createHmac('sha256',appSecret).update(JSON.stringify(['voice-feishu-access-v1',callerId,phone,admission.sessionKey])).digest('base64url');
    return Object.freeze({id:phone,sessionKey:admission.sessionKey,agentId:admission.agentId,accountId,kind:admission.kind,
      nativeChatId:target.chatId,callerId,permissionProfile:'feishu-current',accessToken,displayName:admission.displayName??'飞书会话',replySync:true,
      actorPrincipal:Object.freeze({appId,tenantKey:identity.tenantKey,openId:identity.openId}),
      callerIdentity:Object.freeze({source:'feishu',...(identity.displayName?{displayName:identity.displayName}:{})}),
      replyTarget:Object.freeze({channel:'feishu',agentId:admission.agentId,sessionKey:admission.sessionKey,accountId,
        to:admission.kind==='group'?target.chatId:identity.openId}),
      gateway:createFeishuActorGateway({...options,sessionKey:admission.sessionKey})});
  };
}

// Anonymous callers get a browser-local conversation, never the original chat.
// The bare binding has no Gateway access. The host may attach the explicitly
// enabled Public allowlist after verifying this visitor or its device grant.
export function createUnidentifiedPhoneDirectory({accountId,access,publicEntry=false}) {
  const gateway=Object.freeze({ready:true,async request(){throw Error('尚未确认账号身份，当前通话没有账号工具权限');}});
  return (req,phone,visitor=access.read(req))=>{
    const target=parseFeishuConversationPhone(phone);
    if(!visitor||!(publicEntry&&phone==='public')&&(!target||target.accountId!==accountId))return null;
    return Object.freeze({id:phone,visitorId:visitor.id,callerId:'guest-'+visitor.id,permissionProfile:'unidentified',
      sessionKey:'voice:guest:'+createHash('sha256').update(phone+':'+visitor.id).digest('hex'),
      kind:phone==='public'?'personal':'dm',displayName:publicEntry?'Public':'和 V 聊聊',replySync:false,gateway});
  };
}
