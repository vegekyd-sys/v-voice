import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {feishuConversationPhone} from './feishu-conversation-directory.mjs';

// Native Feishu ingress owns this file. It locates the verified OAuth actor's
// DM only; the existing conversation resolver still performs live admission.
export function createPrivatePhoneLocator({file,appId,accountId,now=Date.now}) {
  return async actor=>{
    let handle;
    try {
      handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();
      if(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.size>2*1024*1024)throw Error('private_conversation_unavailable');
      const value=JSON.parse(await handle.readFile('utf8'));
      if(value.version!==1||!Array.isArray(value.bindings)||value.bindings.length>8192)throw Error('private_conversation_unavailable');
      const rows=value.bindings.filter(row=>row.appId===appId&&row.openId===actor?.openId&&/^ou_[A-Za-z0-9]+$/u.test(row.openId??'')&&/^oc_[A-Za-z0-9]+$/u.test(row.chatId??'')&&Number.isSafeInteger(row.updatedAt)&&row.updatedAt>now()-30*86400000&&row.updatedAt<=now()+30000);
      if(rows.length!==1)throw Error('private_conversation_unavailable');
      return feishuConversationPhone(accountId,rows[0].chatId);
    } finally {await handle?.close();}
  };
}
