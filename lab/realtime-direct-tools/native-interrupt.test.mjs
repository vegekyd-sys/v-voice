import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeInterruptAsr,explicitSpeechStop} from './native-interrupt.mjs';

for(const text of ['V，先停。','喂，等一下。','先停一下，不要讲故事了。','等等，我还没说完。','听我说，换个问题。'])test('explicit playback control: '+text,()=>assert(explicitSpeechStop(text)));
for(const text of ['嗯。','对。','我想让你帮我想一个','欢迎收看本期节目。','小明，等一下。','我刚说的“先停”是个例子。','停','等一下，先停。','等一下，先停！你把这份文件放下，先别走。'])test('no early playback control: '+text,()=>assert.equal(explicitSpeechStop(text),false));
test('a final standalone stop is a control; an incomplete first character is not',()=>{assert(explicitSpeechStop('停。',true));assert(!explicitSpeechStop('停',false));});
function fixture(options={}){
 const peers=[],status=[],hits=[];let speaking=true;
 const detector=new NativeInterruptAsr({apiKey:'fixture-key',settleMs:0,isSpeaking:()=>speaking,onInterrupt:()=>hits.push(true),onStatus:x=>status.push(x),
  createAsr:config=>{const peer={config,frames:[],async connect(){},append(x){this.frames.push(x);},close(){this.closed=true;}};peers.push(peer);return peer;},...options});
 return {detector,peers,status,hits,setSpeaking:x=>speaking=x,result:(text,start=0,definite=false)=>detector.result({body:{result:{utterances:[{text,start_time:start,definite}]}}})};
}
test('streaming explicit stop fires once per utterance while acknowledgments and quoted controls cannot cancel',async t=>{
 const f=fixture();t.after(()=>f.detector.close());await f.detector.connect();
 f.result('等一',0);assert.equal(f.hits.length,0);f.result('等一下',0);assert.equal(f.hits.length,0);f.result('等一下，先停',0,true);assert.equal(f.hits.length,1);
 f.result('嗯。',1000,true);f.result('我刚才说的先停是个例子',2000,true);assert.equal(f.hits.length,1);
 f.result('V，先停一下',3000);assert.equal(f.hits.length,2);
 assert.equal(f.peers[0].config.speakerInfo,false);assert.equal(f.peers[0].config.nonstream,false);
});
test('idle controls cannot be replayed from ASR history to cancel a later answer',async t=>{
 const f=fixture();t.after(()=>f.detector.close());await f.detector.connect();f.setSpeaking(false);f.result('先停',0,true);f.setSpeaking(true);f.result('先停',0,true);assert.equal(f.hits.length,0);
 f.result('V，等一下',1000);assert.equal(f.hits.length,1);
});
test('the independent 16k control stream never modifies the caller PCM and closes with its call',async()=>{
 const f=fixture();await f.detector.connect();const pcm=Buffer.alloc(960,3),copy=Buffer.from(pcm);f.detector.append(pcm);
 assert.deepEqual(pcm,copy);assert.equal(f.peers[0].frames[0].length,640);f.detector.close();assert.equal(f.peers[0].closed,true);
 f.result('等一下',5000,true);f.detector.append(pcm);assert.equal(f.hits.length,0);assert.equal(f.peers[0].frames.length,1);
});
test('a secondary send failure recovers without throwing away the primary call',async t=>{
 const f=fixture();t.after(()=>f.detector.close());await f.detector.connect();f.peers[0].append=()=>{throw Error('private vendor detail');};
 assert.doesNotThrow(()=>f.detector.append(Buffer.alloc(960)));assert.equal(f.detector.ready,false);assert.deepEqual(f.status,['ready','reconnecting']);assert.equal(f.detector.closed,false);
});

test('ASR start-time revision cannot cancel twice and stale controls cannot cancel a newer answer',async t=>{
 let response='old';const f=fixture({getResponseId:()=>response});t.after(()=>f.detector.close());await f.detector.connect();
 f.detector.append(Buffer.alloc(960));f.result('V，等一下',0);assert.equal(f.hits.length,1);
 f.result('V，等一下，先停',120,true);assert.equal(f.hits.length,1);
 for(let i=0;i<60;i++)f.detector.append(Buffer.alloc(960));
 response='new';f.result('先停',1000,true);assert.equal(f.hits.length,1,'the audio belonged to old, not the new response');
});

 test('a standalone final stop waits for continuation; TV object dialogue revokes it before playback is cancelled',async t=>{
  const f=fixture({settleMs:25});t.after(()=>f.detector.close());await f.detector.connect();
  f.result('等一下，先停。',0,true);assert.equal(f.hits.length,0);
  f.result('等一下，先停。你把这份文件放下，先别走。',0,true);
  await new Promise(r=>setTimeout(r,40));assert.equal(f.hits.length,0);
  f.result('先停一下。',2000,true);await new Promise(r=>setTimeout(r,40));assert.equal(f.hits.length,1);
 });
 test('a settled stop cannot target the replacement answer or survive call closure',async()=>{
  let response='old';const f=fixture({settleMs:25,getResponseId:()=>response});await f.detector.connect();f.detector.append(Buffer.alloc(960));
  f.result('等一下。',0,true);response='new';await new Promise(r=>setTimeout(r,40));assert.equal(f.hits.length,0);
  for(let i=0;i<80;i++)f.detector.append(Buffer.alloc(960));f.result('先停。',1500,true);f.detector.close();await new Promise(r=>setTimeout(r,40));assert.equal(f.hits.length,0);
 });
