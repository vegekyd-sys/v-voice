import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallView} from './call-view.mjs';
import {installTvHost} from './tv-host.mjs';

function fixture(search = '?tv=1') {
  const view = createCallView(), calls = [], errors = [];
  const window = {location:{search}, document:{documentElement:{dataset:{}}}, crypto:{randomUUID:()=> 'page-1'}};
  const api = installTvHost({view,window,onError:e=>errors.push(e),actions:{
    dial(){calls.push('dial');view.set({call:'dialing'});},
    mute(){calls.push('mute');view.set({muted:!view.get().muted});},
    end(){calls.push('end');view.set({call:'idle',muted:false});},
  }});
  return {view,window,api,calls,errors};
}

test('normal web/mobile entry does not install TV behavior or dial',()=>{
  for(const search of ['', '?tv=0', '?entry=tianyi']) {
    const f=fixture(search);
    assert.equal(f.api,null);assert.equal(f.window.vVoiceTV,undefined);
    assert.deepEqual(f.window.document.documentElement.dataset,{});assert.deepEqual(f.calls,[]);
  }
});

test('TV controls respect readiness and retain one generation through playback and mute',()=>{
  const {api,view,calls}=fixture();
  assert.equal(api.action('dial'),false);assert.equal(api.action('mute'),false);assert.equal(api.action('end'),false);
  view.set({dial:{disabled:false}});
  const idle=api.snapshot;
  assert.equal(api.action('dial',idle),true);assert.equal(api.action('dial'),false);
  assert.equal(api.snapshot.generation,1);
  view.set({call:'connected'});view.voice('speaking');
  const live=api.snapshot;
  assert.equal(api.action('mute',live),true);assert.equal(api.snapshot.muted,true);
  assert.equal(api.snapshot.owner,idle.owner);assert.equal(api.snapshot.generation,1);
  assert.ok(api.snapshot.revision>live.revision);assert.deepEqual(calls,['dial','mute']);
  assert.equal(api.action('tools.invoke'),false);
});

test('old page and old call controls cannot end a subsequent call',()=>{
  const {api,view,calls}=fixture();view.set({dial:{disabled:false}});
  api.action('dial');view.set({call:'connected'});const first=api.snapshot;
  api.action('end',first);api.action('dial');view.set({call:'connected'});
  assert.equal(api.snapshot.generation,2);
  assert.equal(api.action('end',first),false);
  assert.equal(api.action('end',{...api.snapshot,owner:'old-page'}),false);
  assert.equal(api.action('end',null),false);
  assert.equal(api.snapshot.call,'connected');assert.deepEqual(calls,['dial','end','dial']);
});

test('island reports shared errors/tasks and never exposes credentials or transcript',()=>{
  const {api,view}=fixture();view.set({call:'connected',sessionKey:'private',transcript:{current:[{text:'private'}]}});
  view.message('连接已中断，可以重新开始通话。','error');assert.equal(api.snapshot.label,'连接已中断');
  view.set({message:null,tasks:[{activity:'background',startedAt:Date.now(),stage:'查询电视状态'}]});
  assert.equal(api.snapshot.label,'查询电视状态中');
  assert.equal(JSON.stringify(api.snapshot).includes('private'),false);
  assert.throws(()=>{api.snapshot.call='idle';},TypeError);
});

test('asynchronous host action failures use the shared error callback',async()=>{
  const errors=[],view=createCallView({dial:{disabled:false}});
  const window={location:{search:'?tv=1'},document:{documentElement:{dataset:{}}},crypto:{randomUUID:()=> 'page'}};
  const api=installTvHost({view,window,actions:{dial:async()=>{throw Error('unavailable');}},onError:e=>errors.push(e.message)});
  assert.equal(api.action('dial'),true);await new Promise(r=>setImmediate(r));
  assert.deepEqual(errors,['unavailable']);assert.equal(api.snapshot.call,'idle');
});
