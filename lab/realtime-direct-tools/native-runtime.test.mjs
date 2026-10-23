import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeRuntime,DEFAULT_NATIVE_RUNTIME_POLICY,NATIVE_RUNTIME_OPERATIONS,documentPresentation} from './native-runtime.mjs';

test('new host interjections use the same audio primitives without native source vocabulary',()=>{
  const runtime=createNativeRuntime({voiceSessionId:'fixture',duplex:true,assisted:true});
  const pcm=Buffer.alloc(960).toString('base64');
  for(const source of ['injected-speech','tool-start','future-contextual-ack']){
    const f=runtime.project({type:'audio',audio:pcm,sampleRate:24000,sequence:1,source,responseId:'answer'});
    assert.equal(f.type,'native.runtime');assert.equal(f.effects[0].op,'audio.append');assert.equal(f.effects[0].localBargeIn,false);
    assert(!JSON.stringify(f).includes(source));
  }
  assert.deepEqual(runtime.project({type:'audio.clear',retiredResponseId:'answer'}).effects,[{op:'audio.clear',retiredResponseId:'answer'}]);
  assert.deepEqual(runtime.project({type:'input.speech.stopped',recognized:false}).effects,[{op:'playback.hold',complete:true,recognized:false}]);
  assert.deepEqual(runtime.project({type:'input.speech.ignored',preservedResponseId:'answer'}).effects,[{op:'playback.release',responseId:'answer'}]);
});
test('partial/final captions and a late speaker decision keep exact row ownership',()=>{
  const r=createNativeRuntime({voiceSessionId:'fixture',speakerRouted:true});
  const first=r.project({type:'transcript',role:'assistant',text:'第一',final:false}).effects[0].row;
  const final=r.project({type:'transcript',role:'assistant',text:'第一句话',final:true}).effects[0].row;
  assert.equal(final.id,first.id);assert.equal(final.text,'第一句话');
  assert.equal(r.project({type:'transcript',role:'user',text:'duplicate provider ASR',final:true}).effects.length,0);
  const utterance=(speakerId,startMs,type='speaker.utterance')=>({type,turn:{speakerId,startMs,endMs:startMs+100,text:'测试'},participants:[{id:'speaker:1',label:'Speaker A'},{id:'speaker:2',label:'Speaker B'}],shouldRespond:false});
  const a=r.project(utterance(1,0)).effects.find(e=>e.row)?.row;
  r.project(utterance(2,200));
  const late=r.project(utterance(1,0,'speaker.decision'));
  assert.equal(late.effects.find(e=>e.row?.id===a.id).row.listenOnly,true);
  assert(!late.effects.some(e=>e.op==='conversation.mode'||e.op==='surface.phase'));
  const invalid=r.project({...utterance(1,-1),turn:{speakerId:1,startMs:40,endMs:0,text:'invalid'}});
  assert.deepEqual(invalid.effects,[]);
});
test('notice wording, action and task titles come from the web-owned display policy',()=>{
  const r=createNativeRuntime({voiceSessionId:'fixture'});
  assert.deepEqual(r.project({type:'speaker.recovery',reason:'mixed-speakers'}).effects,[{op:'surface.notice',text:'声音重叠，请轮流说',kind:'notice',action:'',actionLabel:'',ttlMS:4000}]);
  const n=r.project({type:'speaker.error',fatal:true,message:'连接断开'}).effects[0];
  assert.equal(n.action,'redial');assert.equal(n.actionLabel,'重拨');
  assert.equal(r.project({type:'speaker.end-revoked'}).effects[0].text,'');
  assert.equal(r.project({type:'tool.call',callId:'search',activity:'web'}).effects[0].stage,'查询网页');
  assert.equal(r.project({type:'tool.progress',callId:'search'}).effects[0].stage,null,'missing progress preserves the current label');
});
test('service policy is snapshotted per call; changes need no binary and cannot mutate an active call',()=>{
  const policy=structuredClone(DEFAULT_NATIVE_RUNTIME_POLICY);
  const a=createNativeRuntime({voiceSessionId:'a',policy});
  policy.copy.connected='新一轮已就绪';policy.pause.onsetMS=220;policy.taskLabels.web='搜索新资料';
  const b=createNativeRuntime({voiceSessionId:'b',policy});
  assert.equal(a.descriptor.pause.onsetMS,140);assert.equal(b.descriptor.pause.onsetMS,220);
  assert.equal(b.descriptor.copy.connected,'新一轮已就绪');
  assert.equal(a.project({type:'tool.call',callId:'a',activity:'web'}).effects[0].stage,'查询网页');
  assert.equal(b.project({type:'tool.call',callId:'b',activity:'web'}).effects[0].stage,'搜索新资料');
  assert.equal(a.project({type:'provider.reconnecting'}).effects[0].text,DEFAULT_NATIVE_RUNTIME_POLICY.copy.recovering);
});
test('document metadata, auto-open, limits and duplicate results stay on the service',()=>{
  const r=createNativeRuntime({voiceSessionId:'fixture'}),body='# 测试报告\n实际结果';
  const f=r.project({type:'backend.result',callId:'report',text:body});
  assert.equal(f.effects[1].document.autoOpen,true);assert.equal(f.effects[0].row.documentId,'report');
  assert.equal(r.project({type:'backend.result',callId:'report',text:body}).effects.length,0);
  assert.equal(r.project({type:'backend.result',callId:'cancelled',text:body,cancelled:true}).effects.length,0);
  const preview=documentPresentation('id','https://private.test/SECRET\n'+'字'.repeat(70000));
  assert(!preview.preview.includes('SECRET'));assert.equal(Array.from(preview.text).length,60000);
  for(let i=0;i<200;i++)r.project({type:'transcript',role:'assistant',text:String(i),final:true});
  const after=r.project({type:'speaker.utterance',turn:{speakerId:1,startMs:0,endMs:20,text:'仍可说话'}});
  assert(after.effects.every(e=>NATIVE_RUNTIME_OPERATIONS.includes(e.op)));
});
