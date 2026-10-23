// A group menu contains only a public login URL, never a bearer or session key.
export function phoneMenuUrl(origin, basePath, phoneId) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || !/^\/[a-zA-Z0-9_-]+$/u.test(basePath)
    || !/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(phoneId ?? '')) throw new Error('Invalid phone menu URL');
  return `${origin}${basePath}/feishu?phone=${encodeURIComponent(phoneId)}`;
}

export async function addGroupPhoneMenu({api, chatId, url, name = '📞 打给 V'}) {
  if (!/^oc_[a-zA-Z0-9]+$/u.test(chatId ?? '')) throw new Error('Invalid Feishu group');
  const link = new URL(url);
  if (link.protocol !== 'https:' || link.hash || link.username || link.password
    || [...link.searchParams.keys()].some(key => key !== 'phone')
    || !link.pathname.endsWith('/feishu')) throw new Error('Only a public phone login URL can be published');
  const path = `/open-apis/im/v1/chats/${chatId}/menu_tree`;
  const read = async () => {
    const data = await api('GET', path);
    if (!Array.isArray(data?.menu_tree?.chat_menu_top_levels)) throw new Error('Group menus were not confirmed');
    return data.menu_tree.chat_menu_top_levels;
  };
  const matches = item => item.chat_menu_item?.name === name && item.chat_menu_item?.action_type === 'REDIRECT_LINK'
    && item.chat_menu_item?.redirect_link?.common_url === url
    && ['ios_url','android_url','pc_url','web_url'].every(key => !item.chat_menu_item.redirect_link[key] || item.chat_menu_item.redirect_link[key] === url);
  const before = await read(), existing = before.filter(matches);
  if (existing.length === 1) return {created:false,verified:true,menuId:existing[0].chat_menu_top_level_id};
  if (existing.length || before.some(item => item.chat_menu_item?.name === name)) throw new Error('Phone menu name already belongs to another configuration');
  if (before.length >= 3) throw new Error('Group has no free first-level menu slot');
  let writeFailed = false;
  try {
    await api('POST', path, {menu_tree:{chat_menu_top_levels:[{chat_menu_item:{
      name,action_type:'REDIRECT_LINK',redirect_link:{common_url:url},},children:[]}]}});
  } catch { writeFailed = true; }
  // An unknown POST outcome is read back; never blindly repeat the mutation.
  const after = await read(), added = after.filter(matches);
  const retained = before.every(old => after.some(item => JSON.stringify(item) === JSON.stringify(old)));
  if (added.length !== 1 || !retained) throw new Error('Group menu write outcome is not verified; preserve evidence and do not retry blindly');
  return {created:true,verified:true,menuId:added[0].chat_menu_top_level_id,existingMenusPreserved:true,recoveredUnknownWrite:writeFailed};
}
