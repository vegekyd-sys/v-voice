import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadToolStartClips,toolStartClip} from './tool-start-audio.mjs';
test('native notice assets have validated provenance and match the actual selected tool',()=>{
  const clips=loadToolStartClips();assert.equal(clips,loadToolStartClips());
  assert.equal(toolStartClip({name:'memory_search'}).text,'我查一下记忆里的记录。');
  assert.equal(toolStartClip({name:'openclaw_tool',args:{tool:'web_fetch'}}).text,'我上网查一下。');
  assert.equal(toolStartClip({name:'feishu_calendar'}).text,'我查一下相关资料。');
  assert.equal(toolStartClip({name:'look',args:{question:'这是什么'}}),null,'no cached clip says "我看看"; never claim to be looking things up');
  for(const name of ['process','delegate_to_v','cancel_task','end_call'])assert.equal(toolStartClip({name:'openclaw_tool',args:{tool:name}}),null);
});
test('progress clips are optional until generated, and must match their provenance',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {createHash}=await import('node:crypto');
 const {loadToolProgressClips,TOOL_PROGRESS_LINES}=await import('./tool-start-audio.mjs');
 const dir=await mkdtemp(tmpdir()+'/voice-progress-');t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=new URL(`file://${dir}/`);
 assert.deepEqual(loadToolProgressClips(root),[],'no generated clips: no progress line, no crash');
 const clips={};
 for(const [i,text] of TOOL_PROGRESS_LINES.entries()){const pcm=Buffer.alloc(480,i+1);await writeFile(`${dir}/tool-progress-${i+1}.pcm`,pcm);clips[`progress-${i+1}`]={text,bytes:pcm.length,sha256:createHash('sha256').update(pcm).digest('hex')};}
 const manifest={provider:'seeduplex',voice:'xiaohe',sampleRate:24000,format:'pcm16le',clips};
 await writeFile(`${dir}/tool-progress-provenance.json`,JSON.stringify(manifest));
 assert.deepEqual(loadToolProgressClips(root).map(c=>c.text),TOOL_PROGRESS_LINES);
 await writeFile(`${dir}/tool-progress-provenance.json`,JSON.stringify({...manifest,clips:{...clips,'progress-1':{...clips['progress-1'],sha256:'0'.repeat(64)}}}));
 assert.throws(()=>loadToolProgressClips(root),/hash mismatch/);
 assert.deepEqual(loadToolProgressClips(),loadToolProgressClips(),'the shipped assets load once');
});
