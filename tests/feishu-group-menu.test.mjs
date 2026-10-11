import test from 'node:test';import assert from 'node:assert/strict';
import {phoneMenuUrl,addGroupPhoneMenu} from '../lib/feishu-group-menu.mjs';
const url=phoneMenuUrl('https://voice.example.com','/voice','phone-room-a');
const old={chat_menu_top_level_id:'old',chat_menu_item:{name:'已有菜单',action_type:'NONE'},children:[]};
function fixture(failAfterWrite=false){
 const items=[old],calls=[];
 const api=async(method,path,body)=>{calls.push({method,path,body});if(method==='POST'){items.push({...body.menu_tree.chat_menu_top_levels[0],chat_menu_top_level_id:'new'});if(failAfterWrite)throw Error('Network disconnected after commit');}return {menu_tree:{chat_menu_top_levels:structuredClone(items)}};};
 return {items,calls,api};
}
test('add group phone menu preserves existing entries and idempotently reads back its exact URL',async()=>{
 const f=fixture();const first=await addGroupPhoneMenu({api:f.api,chatId:'oc_test',url});
 assert.equal(first.verified,true);assert.equal(first.existingMenusPreserved,true);assert.equal(f.items[0],old);
 assert.equal((await addGroupPhoneMenu({api:f.api,chatId:'oc_test',url})).created,false);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('unknown write outcome is recovered through a read without resending',async()=>{
 const f=fixture(true);assert.equal((await addGroupPhoneMenu({api:f.api,chatId:'oc_test',url})).recoveredUnknownWrite,true);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('conflicting menus, full menus, secret links and unverified writes fail closed',async()=>{
 for(const link of [url+'#access=secret',url+'&sessionKey=private',url.replace('https:','http:'),url.replace('/feishu','/')])await assert.rejects(addGroupPhoneMenu({api:fixture().api,chatId:'oc_test',url:link}));
 const f=fixture();f.items.push({chat_menu_item:{name:'📞 打给 V',redirect_link:{common_url:'https://other.example/'}}});
 await assert.rejects(addGroupPhoneMenu({api:f.api,chatId:'oc_test',url}));assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 const g=fixture();g.items.push({chat_menu_item:{name:'two'}},{chat_menu_item:{name:'three'}});
 await assert.rejects(addGroupPhoneMenu({api:g.api,chatId:'oc_test',url}));
 await assert.rejects(addGroupPhoneMenu({api:async()=>({menu_tree:{chat_menu_top_levels:[]}}),chatId:'oc_test',url}));
});
