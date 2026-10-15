import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APPROVED_REACTION_ADDITIONS } from './avatar-approved-reactions.mjs';
import { avatarContinuationPlan, avatarPicture } from './avatar-catalog.mjs';
import { AVATAR_SEQUENCES } from './avatar-state.mjs';
import { createAvatarReactionSelector } from './avatar-decision.mjs';
import { createAvatarRenderer } from './avatar.mjs';
import { createLiveH5Server } from './server.mjs';

test('approved reactions are selectable and render shipped frames; rejected table images never enter the gallery',async()=>{
 assert.equal(APPROVED_REACTION_ADDITIONS.length,15);
 assert.ok(!APPROVED_REACTION_ADDITIONS.some(p=>p.candidateId.startsWith('stop-')));
 for(const p of APPROVED_REACTION_ADDITIONS){
  let criteria;
  const selector=createAvatarReactionSelector({evaluate:async(input,q)=>{criteria=q.picture.criteria;return {answers:{picture:{type:'choice',choice:p.id}}};}});
  const selected=await selector.select({owner:p.id,context:{turns:[{role:p.phase==='user_listening'?'user':'assistant',text:'通用对话素材'}]}});
  assert.equal(selected.picture,p.id);assert.ok(criteria[p.id].includes(p.phase));
  assert.ok(avatarContinuationPlan(p.id).length>=2);
  assert.ok(avatarContinuationPlan(p.id).every(id=>avatarPicture(id)));
  const image={src:'old',getAttribute(){return this.src;}};
  let displayed;
  const renderer=createAvatarRenderer({image,load:async file=>{assert.ok(fs.statSync(new URL('./assets/'+file,import.meta.url)).size>0);return file;},onPose:(scene,frame)=>displayed=avatarPicture(`${scene}-${frame}`).id});
  await renderer.show(p.scene,p.frame);assert.equal(displayed,selected.picture);
  assert.equal(image.src,AVATAR_SEQUENCES[p.scene][p.frame]);renderer.dispose();
 }
});

test('browser can load the additions module and both image sizes without opening a voice session',async t=>{
 const bridge=createLiveH5Server({gateway:{request:()=>{throw Error('Must not open a voice session');}},offer:()=>{},preview:true});
 await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));t.after(()=>bridge.dispose());
 const url=`http://127.0.0.1:${bridge.server.address().port}`;
 const page=await fetch(url),cookie=page.headers.get('set-cookie').split(';')[0];await page.text();
 const module=await fetch(url+'/avatar-approved-reactions.mjs',{headers:{cookie}});
 assert.equal(module.status,200);assert.equal(await module.text(),fs.readFileSync(new URL('./avatar-approved-reactions.mjs',import.meta.url),'utf8'));
 for(const p of APPROVED_REACTION_ADDITIONS)for(const size of [256,512]){
  const file=AVATAR_SEQUENCES[p.scene][p.frame].replace('-512.webp',`-${size}.webp`);
  const response=await fetch(url+'/assets/'+file,{headers:{cookie}});assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(new URL('./assets/'+file,import.meta.url)));
 }
});


test('October 15 approvals append stable IDs with listening/speaking boundaries and lightweight assets',()=>{
 const expected=['play-listen-v1','play-reply-v1','correction-listen-v1','rephrase-reply-v1','interest-listen-v1'];
 assert.equal(APPROVED_REACTION_ADDITIONS[0].candidateId,'clarify-01');
 assert.equal(APPROVED_REACTION_ADDITIONS[9].candidateId,'video-reply-v1');
 for(const [i,candidateId] of expected.entries()){
  const p=APPROVED_REACTION_ADDITIONS[10+i];assert.equal(p.candidateId,candidateId);assert.equal(p.id,`reaction-${10+i}`);
  assert.equal(p.tags.phase,p.phase);assert.equal(p.tags.speaker,p.phase==='user_listening'?'user':'V');
  for(const key of ['target','dialogue_act','emotion','gaze','posture','energy','task_domain','task_stage','avoid'])assert.notEqual(p.tags[key],undefined);
  assert.ok(p.tags.avoid.length);assert.equal(p.gaze,'user');
  for(const [size,limit] of [[256,30*1024],[512,80*1024]]){
   const file=AVATAR_SEQUENCES[p.scene][p.frame].replace('-512.webp',`-${size}.webp`);
   assert.ok(fs.statSync(new URL('./assets/'+file,import.meta.url)).size<=limit);
  }
 }
});
