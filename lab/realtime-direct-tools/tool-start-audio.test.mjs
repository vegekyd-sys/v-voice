import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadToolStartClips,toolStartClip} from './tool-start-audio.mjs';
test('native notice assets have validated provenance and match the actual selected tool',()=>{
  const clips=loadToolStartClips();assert.equal(clips,loadToolStartClips());
  assert.equal(toolStartClip({name:'memory_search'}).text,'我查一下记忆里的记录。');
  assert.equal(toolStartClip({name:'openclaw_tool',args:{tool:'web_fetch'}}).text,'我上网查一下。');
  assert.equal(toolStartClip({name:'feishu_calendar'}).text,'我查一下相关资料。');
  for(const name of ['process','delegate_to_v','cancel_task','end_call'])assert.equal(toolStartClip({name:'openclaw_tool',args:{tool:name}}),null);
});
