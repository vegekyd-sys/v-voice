// Presentation only: callers must still pass the server's existing admission.
// Never expose credentials, raw session keys, Feishu actor IDs or tool tokens.
export function voiceAccessContext(binding,{publicEnabled=false,publicTools=false}={}) {
  const guest=binding.permissionProfile==='unidentified';
  const dynamic=binding.permissionProfile==='feishu-current';
  const isPublic=guest&&publicEnabled;
  return Object.freeze({version:1,mode:guest?'public':'connected',entryKind:guest?'public':dynamic?'account':'fixed',
    accountLabel:guest?'独立访客':dynamic?(binding.callerIdentity?.displayName||'飞书账号'):binding.accountLabel||'预配置账号',
    identityLabel:guest?'访客身份':dynamic?'飞书身份已确认':'入口已预配置通话人',
    conversationLabel:guest?(isPublic?'Public':'访客会话'):binding.displayName||'我的 V',
    conversationKind:guest?'personal':binding.kind,
    replySync:!guest&&binding.replySync===true,
    capabilities:guest?(isPublic&&publicTools?['conversation','web_search','memory_search','background_tasks','show_content']:['conversation','show_content']):['conversation','authorized_account_tools','show_content'],
    scopeNote:guest?(isPublic&&publicTools?'可对话、搜索、查询 V 记忆和委派后台任务；未连接个人账号。':'当前服务尚未开放 Public 工具。'):
      dynamic?'使用当前账号获准的会话与工具；发送或修改按你的具体要求执行。':'账号、通话人和会话由此入口预配置；切换浏览器账号不会替换它们。'});
}

// A device may reference an existing fixed phone. Selection is exclusively
// operator configuration; device hello/model frames cannot supply a mapping.
export function resolveFixedDeviceRecord(record,entries=[]) {
  if(record.phoneEntry===undefined)return record;
  if(typeof record.phoneEntry!=='string')throw Error('Invalid fixed device entry');
  const entry=entries.find(e=>e.id===record.phoneEntry&&!e.disabled);
  if(!entry||entry.permissionProfile!=='personal-tianyi')throw Error('Fixed device entry is unavailable');
  for(const key of ['sessionKey','agentId','callerId','accountId','permissionProfile']){
    if(record[key]!==undefined&&record[key]!==entry[key])throw Error('Conflicting fixed device mapping');
  }
  return {...record,...Object.fromEntries(['sessionKey','agentId','callerId','accountId','permissionProfile','kind','displayName','accountLabel'].map(k=>[k,entry[k]]))};
}
