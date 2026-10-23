// Idempotent per-conversation installation. Existing tabs are never replaced.
export async function addPhoneTab({api,chatId,url,name='📞 打给 V'}) {
  if(!/^oc_[a-zA-Z0-9]+$/u.test(chatId??''))throw Error('Invalid Feishu conversation');
  const link=new URL(url);
  if(link.protocol!=='https:'||link.hash||link.username||link.password||!link.pathname.endsWith('/feishu')||[...link.searchParams.keys()].some(k=>k!=='phone'))throw Error('Only a public phone login URL can be published');
  const path=`/open-apis/im/v1/chats/${chatId}/chat_tabs`;
  const read=async()=>{const result=await api('GET',path+'/list_tabs');if(!Array.isArray(result?.chat_tabs))throw Error('Conversation tabs were not confirmed');return result.chat_tabs;};
  const matches=t=>t.tab_name===name&&t.tab_type==='url'&&t.tab_content?.url===url&&t.tab_config?.is_built_in===false;
  const before=await read(),existing=before.filter(matches);
  if(existing.length===1)return {created:false,verified:true,tabId:existing[0].tab_id};
  if(existing.length||before.some(t=>t.tab_name===name))throw Error('Phone tab name belongs to another configuration');
  let writeFailed=false;
  try{await api('POST',path,{chat_tabs:[{tab_name:name,tab_type:'url',tab_content:{url},tab_config:{is_built_in:false}}]});}catch{writeFailed=true;}
  const after=await read(),added=after.filter(matches);
  if(added.length!==1||!before.every(old=>after.some(t=>JSON.stringify(t)===JSON.stringify(old))))throw Error('Tab write outcome is not verified; do not retry blindly');
  return {created:true,verified:true,tabId:added[0].tab_id,existingTabsPreserved:true,recoveredUnknownWrite:writeFailed};
}
