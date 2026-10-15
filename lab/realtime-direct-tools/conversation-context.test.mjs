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

test('new calls do not import old delegation envelopes or backend task replies',()=>{
 const value=voiceConversationContext([
  {role:'user',content:'天意本人在语音电话里交给 V 的任务。\n完整目标：给旧伙伴介绍V'},
  {role:'assistant',__openclaw:{runId:'voice-old-call-task'},content:[{type:'text',text:'旧报告和旧任务。'}]},
  {role:'assistant',provenance:{kind:'realtime_voice'},content:[{type:'text',text:'这是已经说过的一句对话。'}]},
  {role:'user',content:'我喜欢勇士队'},
 ]);
 assert.equal(value,'V：这是已经说过的一句对话。\n\n人：我喜欢勇士队');
});
