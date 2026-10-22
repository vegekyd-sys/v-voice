import test from 'node:test';import assert from 'node:assert/strict';
import {addPhoneTab} from '../lib/feishu-phone-tab.mjs';
const url='https://voice.example.com/voice/feishu?phone=phone-room-a';
for(const ambiguous of [false,true])test(`tab install preserves neighbors and is idempotent, ambiguous=${ambiguous}`,async()=>{
 let tabs=[{tab_id:'messages',tab_type:'message'}],writes=0;
 const api=async(method,path,body)=>{if(method==='GET'){assert(path.endsWith('/list_tabs'));return {chat_tabs:structuredClone(tabs)};}writes++;tabs.push({...body.chat_tabs[0],tab_id:'phone'});if(ambiguous)throw Error('timeout');};
 const r=await addPhoneTab({api,chatId:'oc_trial',url});assert.equal(r.verified,true);assert.equal(r.recoveredUnknownWrite,ambiguous);
 assert.equal((await addPhoneTab({api,chatId:'oc_trial',url})).created,false);assert.equal(writes,1);assert.equal(tabs[0].tab_id,'messages');
});
test('no credential links or conflicting tabs are overwritten',async()=>{
 let writes=0;const api=async(method)=>{if(method==='POST')writes++;return {chat_tabs:[{tab_name:'📞 打给 V',tab_type:'url',tab_content:{url:'https://other.example.com'}}]};};
 await assert.rejects(addPhoneTab({api,chatId:'oc_trial',url}));
 await assert.rejects(addPhoneTab({api,chatId:'oc_trial',url:url+'#access=secret'}));assert.equal(writes,0);
});
