import test from 'node:test';
import assert from 'node:assert/strict';
import {backchannelVerdict,createBackchannel,loadBackchannelClips,BACKCHANNEL_DEFAULTS} from './backchannel.mjs';

const clips=[{text:'嗯'},{text:'哦'}];
function harness({blocked=()=>false,options,random=()=>0.9}={}){
  let at=1000;const played=[],events=[];
  const lane=createBackchannel({clips,isBlocked:blocked,play:c=>played.push({text:c.text,at}),audit:e=>events.push(e),options,now:()=>at,random});
  const step=(voiced)=>{const pcm=Buffer.alloc(960);for(let i=0;i<480;i++)pcm.writeInt16LE(voiced?Math.round(8000*Math.sin(i/4)):0,i*2);at+=20;lane.audio(pcm);};
  return {lane,played,events,speak:ms=>{for(let t=0;t<ms;t+=20)step(true);},quiet:ms=>{for(let t=0;t<ms;t+=20)step(false);},advance:ms=>{at+=ms;},get at(){return at;}};
}

test('a question or a request wants an answer, a statement wants a listening sound',()=>{
  assert.equal(backchannelVerdict('我那个工位正好在空调出风口底下'),'listen');
  assert.equal(backchannelVerdict('你说我要不要去找领导'),'question');
  assert.equal(backchannelVerdict('这事儿到底行不行？'),'question');
  assert.equal(backchannelVerdict('帮我订一张票'),'request');
  assert.equal(backchannelVerdict('等一下先别说'),'stop');
  assert.equal(backchannelVerdict(''),'no-text');
});

test('sounds once in a short pause after a long stretch of speech',()=>{
  const h=harness();
  h.speak(3000);h.lane.text('上周我们公司搬到了新楼');h.quiet(400);
  assert.equal(h.played.length,1);
  assert.ok(h.events.some(e=>e.type==='backchannel.played'));
  h.quiet(200);assert.equal(h.played.length,1,'one pause gets one sound');
});

test('never sounds over speech, and not after short speech',()=>{
  const h=harness();
  h.speak(10000);h.lane.text('一直在说');assert.equal(h.played.length,0);
  const short=harness();short.speak(800);short.lane.text('现在几点');short.quiet(400);
  assert.equal(short.played.length,0);
});

test('respects a question, stale text and the cooldown',()=>{
  const question=harness();question.speak(3000);question.lane.text('你说我要不要去');question.quiet(400);assert.equal(question.played.length,0);
  const stale=harness();stale.lane.text('很久以前的字');stale.speak(5000);stale.quiet(400);assert.equal(stale.played.length,0,'audio without recent words is not a caller to acknowledge');
  const h=harness();h.speak(3000);h.lane.text('第一句');h.quiet(400);h.speak(3000);h.lane.text('第二句');h.quiet(400);
  assert.equal(h.played.length,1,'cooldown holds the second');
  h.speak(6000);h.lane.text('第三句');h.quiet(400);assert.equal(h.played.length,2);
});

test('stays out of the way while V is speaking or just spoke',()=>{
  let busy=true;const h=harness({blocked:()=>busy});
  h.speak(3000);h.lane.text('还在说');h.quiet(400);assert.equal(h.played.length,0);
  busy=false;h.speak(1000);h.lane.text('还在说');h.quiet(400);assert.equal(h.played.length,0,'just spoke');
  h.advance(BACKCHANNEL_DEFAULTS.settleAfterVoiceMs);h.speak(3000);h.lane.text('还在说');h.quiet(400);assert.equal(h.played.length,1);
});

test('a finished turn starts counting again',()=>{
  const h=harness();h.speak(1000);h.lane.text('说完了');h.quiet(2000);
  h.speak(1000);h.lane.text('新一轮');h.quiet(400);assert.equal(h.played.length,0);
});

test('shipped clips load with verified provenance',()=>{
  const loaded=loadBackchannelClips();
  assert.ok(loaded.length>=3);
  for(const clip of loaded){assert.equal(clip.source,'backchannel');assert.ok(clip.seconds<1.2,clip.text);}
});
