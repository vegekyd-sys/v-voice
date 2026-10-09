import {GPT_LIVE_PERSONAL_SESSION_KEY} from '../lab/gpt-live-h5/personal-session.mjs';

// Entry records are private operator configuration, never supplied by the page.
// Phase one reuses Tianyi's already-authorized tool identity. Other callers
// require Gateway actor-scoped tooling before an entry may be enabled.
export function createConversationEntries(records=[],legacyAccessToken='') {
  const entries=new Map();
  for(const record of records){
    if(!/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(record.id??'')||record.id==='tianyi'||entries.has(record.id))throw Error('Invalid or duplicate phone entry ID');
    if(record.agentId!=='makaron'||record.callerId!=='tianyi'||record.permissionProfile!=='personal-tianyi')throw Error('Other caller identities require Gateway actor-scoped authorization');
    if(typeof record.sessionKey!=='string'||!record.sessionKey.startsWith('agent:makaron:feishu:')||!record.accountId||!['group','dm'].includes(record.kind))throw Error('An existing Feishu session and account binding are required');
    if(typeof record.accessToken!=='string'||record.accessToken.length<32||record.accessToken===legacyAccessToken)throw Error('Each phone needs its own private access token');
    if([...entries.values()].some(e=>e.accessToken===record.accessToken))throw Error('Phone access tokens must be distinct');
    entries.set(record.id,Object.freeze({id:record.id,agentId:record.agentId,sessionKey:record.sessionKey,accountId:record.accountId,kind:record.kind,callerId:record.callerId,permissionProfile:record.permissionProfile,accessToken:record.accessToken,disabled:record.disabled===true}));
  }
  const personal=Object.freeze({id:'tianyi',agentId:'makaron',sessionKey:GPT_LIVE_PERSONAL_SESSION_KEY,callerId:'tianyi',permissionProfile:'personal-tianyi',accessToken:legacyAccessToken});
  return {resolve(url){const id=url.searchParams.get('phone');if(!id)return personal;const entry=entries.get(id);return entry&&!entry.disabled?entry:null;},publicEntries(){return [...entries.values()].map(({id,kind,disabled})=>({id,kind,disabled}));}};
}
