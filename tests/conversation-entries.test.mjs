import test from 'node:test';import assert from 'node:assert/strict';
import {createConversationEntries} from '../lib/conversation-entries.mjs';
import {createVoiceAccess} from '../lab/gpt-live-h5/access.mjs';
const entry={id:'phone-room-a',agentId:'makaron',sessionKey:'agent:makaron:feishu:group:oc_room_a',accountId:'existing-account',kind:'group',callerId:'tianyi',permissionProfile:'personal-tianyi',accessToken:'a'.repeat(40)};
test('session is fixed by private entry mapping, not request identity',()=>{
 const registry=createConversationEntries([entry]);assert.equal(registry.resolve(new URL('https://v/voice/?phone=phone-room-a&sessionKey=other')).sessionKey,entry.sessionKey);
 assert.equal(registry.resolve(new URL('https://v/?phone=unknown')),null);
 assert.match(registry.resolve(new URL('https://v/voice/')).sessionKey,/oc_adda79/);
 assert.equal(registry.publicEntries()[0].accessToken,undefined);
});
test('other-account callers cannot inherit personal tool privileges',()=>{
 assert.throws(()=>createConversationEntries([{...entry,callerId:'someone-else'}]),/actor-scoped/);
 assert.throws(()=>createConversationEntries([{...entry,accessToken:'short'}]),/private access token/);
 assert.throws(()=>createConversationEntries([entry,{...entry,id:'phone-room-b'}]),/distinct/);
});
test('an entry cookie cannot authorize a different phone',()=>{
 const a=createVoiceAccess(entry.accessToken,'/voice',Date.now,{entry:entry.id});
 const b=createVoiceAccess('b'.repeat(40),'/voice',Date.now,{entry:'phone-room-b'});let value;
 a.issue({setHeader:(key,v)=>value=v});const req={headers:{cookie:value.split(';')[0]}};
 assert(a.read(req));assert.equal(b.read(req),null);
});

test('native DM binding is private operator configuration and cannot be overridden by a URL',()=>{
 const dm={...entry,kind:'dm',sessionKey:'agent:makaron:feishu:direct:ou_alice',nativeChatId:'oc_verified'};
 const registry=createConversationEntries([dm]);
 assert.equal(registry.resolve(new URL('https://v/?phone='+entry.id+'&nativeChatId=oc_other')).nativeChatId,'oc_verified');
 assert.equal(registry.publicEntries()[0].nativeChatId,undefined);
 for(const nativeChatId of ['ou_alice','',123])assert.throws(()=>createConversationEntries([{...dm,nativeChatId}]),/native chat binding/);
 assert.throws(()=>createConversationEntries([{...entry,nativeChatId:'oc_other'}]),/native chat binding/);
});
