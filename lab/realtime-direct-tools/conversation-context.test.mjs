import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceConversationContext} from './conversation-context.mjs';

test('voice history excludes raw tools, reasoning and command arguments', () => {
  const value = voiceConversationContext([
    {role:'user',content:[{type:'text',text:'把测试日程改到23:40'}]},
    {role:'assistant',content:[{type:'toolCall',arguments:{command:'lark-cli api --data \\invalid'}},{type:'thinking',thinking:'private'},{type:'text',text:'正在修改。'}]},
    {role:'toolResult',content:[{type:'text',text:'{"secret":"private","command":"\\invalid"}'}]},
    {role:'assistant',content:[{type:'text',text:'改好了，23:40到23:50。'}]},
  ]);
  assert.equal(value,'人：把测试日程改到23:40\n\nV：正在修改。\n\nV：改好了，23:40到23:50。');
});

test('keeps text verbatim without JSON quoting and bounds the retained context', () => {
  const text='你好\n这是 "原话"，路径 C:\\work。';
  assert.equal(voiceConversationContext([{role:'user',content:text}]),`人：${text}`);
  assert.equal(voiceConversationContext([{role:'user',content:'1234567890'}],5),'67890');
});

test('mirrored Voice cards carry dialogue without presentation JSON into the next call',async()=>{
 const {conversationReplyCard}=await import('../../lib/conversation-replies.mjs');
 const q='保留 * 原文与 <at id=all>，不要变成格式',a='**结论**\n\n- 第一项\n- 第二项';
 const card=JSON.stringify(conversationReplyCard(q,a));
 assert.equal(voiceConversationContext([{role:'assistant',content:card}]),`V：语音提问：${q}\n\nV：${a}`);
 assert.equal(voiceConversationContext([{role:'user',content:'{"unrelated":true}'}]),'人：{"unrelated":true}');
});
