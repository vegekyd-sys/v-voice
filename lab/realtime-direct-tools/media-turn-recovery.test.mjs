import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaTurnRecovery} from './media-turn-recovery.mjs';
import {mediaStatusQuestion} from './media-cli-policy.mjs';

test('only an unfulfilled commitment is nudged once; a real call, new turn or interruption supersedes it',()=>{
 let at=0;const sent=[],state={current:true};
 const r=createMediaTurnRecovery({state:()=>state,resume:t=>sent.push(t),now:()=>at,settleMs:10});
 r.user();r.assistant('好，就让小赛车往前开，做5秒短视频。');at=20;state.playing=true;r.tick();assert.equal(sent.length,0);
 state.playing=false;r.tick();r.tick();assert.equal(sent.length,1);assert.match(sent[0],/不增加授权/);
 r.user();r.assistant('好，我来做这张图片。');r.started();at=40;r.tick();assert.equal(sent.length,1);
 r.user();r.assistant('好，我来做视频。');r.user();at=60;r.tick();assert.equal(sent.length,1);
 for(const text of ['可以，要不要出一张图片？','好，视频做好了。','如果需要的话，我可以做视频。','好，我来解释视频的原理。']){
  r.user();r.assistant(text);at+=20;r.tick();
 }assert.equal(sent.length,1);
 r.user();r.assistant('好，我来做视频。');state.ending=true;at+=20;r.tick();assert.equal(sent.length,1);
});
test('progress questions never authorize another media generation, but edits remain distinct',()=>{
 for(const text of ['做好了吗？','做了没啊？','你有在做吗？','开始了吗','视频怎么样了','好了没','做完了吗'])assert.equal(mediaStatusQuestion(text),true,text);
 for(const text of ['把这张图动起来','换成红色，再做一个','可以，开始吧','这张不好，重做吧','做一个写着“做好了吗”的图片'])assert.equal(mediaStatusQuestion(text),false,text);
});
