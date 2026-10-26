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

test('three sizes preserve the call owner and never dial or end implicitly',()=>{
  const {api,view,calls,window}=fixture('?tv=1&tvShell=1');
  assert.equal(api.snapshot.layout,'medium');view.set({dial:{disabled:false}});
  api.action('dial');view.set({call:'connected'});const original=api.snapshot;
  for(const size of ['compact','medium','full','medium']){
    assert.equal(api.setLayout(size,original),true);
    assert.equal(api.commitLayout(size,original),true);
    assert.equal(api.snapshot.owner,original.owner);assert.equal(api.snapshot.generation,original.generation);
    assert.equal(view.get().tvLayout,size);assert.equal(window.document.documentElement.dataset.tvLayout,size);
  }
  assert.equal(api.setLayout('full',{...original,owner:'old'}),false);
  assert.equal(api.setLayout('anything'),false);
  assert.equal(api.commitLayout('full',{...original,owner:'old'}),false);
  assert.equal(api.back(),'handled');assert.equal(api.snapshot.layout,'compact');assert.equal(api.back(),'exit');
  assert.equal(view.get().call,'connected');assert.deepEqual(calls,['dial']);
});

test('meter uses measured energy, prefers audible output, suppresses mute, clears after a gap and end',()=>{
  const {api,view}=fixture();view.set({call:'connected'});
  api.observeAudio({input:.24,output:.06,at:1000});
  assert.equal(api.getAudio().source,'output');assert.deepEqual(api.getAudio().levels,[35]);
  api.observeAudio({input:.24,output:.06,at:1050});assert.equal(api.getAudio().levels.length,1);
  api.observeAudio({input:.24,output:0,at:1500});assert.equal(api.getAudio().source,'input');
  assert.deepEqual(api.getAudio().levels,[100]);
  view.set({muted:true});assert.equal(api.getAudio().source,'none');
  api.observeAudio({input:1,output:0,at:1600});assert.deepEqual(api.getAudio().levels,[]);
  api.observeAudio({input:NaN,output:Infinity,at:1700});assert.deepEqual(api.getAudio().levels,[]);
  api.observeAudio({input:0,output:.1,at:1800});assert.equal(api.getAudio().source,'output');
  view.set({call:'idle'});assert.equal(api.getAudio().source,'none');
  assert.equal('audio' in api.snapshot,false);
});

test('missing audio samples expire instead of leaving a speaking animation',async()=>{
  const {api,view}=fixture();view.set({call:'connected'});api.observeAudio({input:.1});
  assert.equal(api.getAudio().source,'input');
  await new Promise(resolve=>setTimeout(resolve,480));
  assert.deepEqual(api.getAudio(),{source:'none',levels:[]});
});

test('TV report scroll keys preserve the original horizontal call controls',()=>{
  const {view,window,api}=fixture();view.set({reading:true,call:'connected'});
  const doc=window.document,scroll=[];
  const button=(id,x,y,dock=false)=>({id,tagName:'BUTTON',tabIndex:0,disabled:false,
    getBoundingClientRect:()=>({x,y,width:42,height:42,left:x,right:x+42,top:y,bottom:y+42}),
    closest:s=>s==='#readerDock'&&dock?{}:null,
    focus(){doc.activeElement=this;},scrollIntoView(){}});
  const back=button('readerBack',20,10),save=button('readerDownload',700,10),compose=button('textToggle',350,420,true),mute=button('mute',400,420,true),end=button('stop',450,420,true);
  const controls=[back,save,compose,mute,end];
  doc.querySelector=()=>null;
  doc.getElementById=id=>id==='readerBody'?{clientHeight:400,scrollBy:value=>scroll.push(value.top)}:id==='contentReader'?{querySelectorAll:()=>controls}:controls.find(c=>c.id===id);
  window.innerWidth=900;window.innerHeight=500;
  back.focus();api.navigate('down');assert.deepEqual(scroll,[320]);assert.equal(doc.activeElement,back);
  api.navigate('right');assert.equal(doc.activeElement,save);
  api.navigate('right');assert.equal(doc.activeElement,compose);
  api.navigate('right');assert.equal(doc.activeElement,mute);
  api.navigate('right');assert.equal(doc.activeElement,end);assert.deepEqual(scroll,[320]);
  api.navigate('up');assert.equal(doc.activeElement,back);
  api.navigate('up');assert.deepEqual(scroll,[320,-320]);
});

test('native full window changes viewport scale without changing call owner, then restores island scale',()=>{
  const {api,view,window,calls}=fixture('?tv=1&tvShell=1');
  let content='width=device-width,initial-scale=1';
  window.document.querySelector=selector=>selector==='meta[name="viewport"]'?{getAttribute:()=>content,setAttribute:(key,value)=>{content=value;}}:null;
  view.set({call:'connected'});const owner=api.snapshot;
  api.setLayout('full',owner);assert.equal(api.commitLayout('full',owner,{width:912}),true);
  assert.equal(content,'width=1600,initial-scale=0.57,viewport-fit=cover');
  api.setLayout('medium',owner);api.commitLayout('medium',owner,{width:420});
  assert.equal(content,'width=420,initial-scale=1,viewport-fit=cover');
  assert.equal(api.commitLayout('medium',{...owner,owner:'stale'},{width:500}),false);
  assert.equal(content,'width=420,initial-scale=1,viewport-fit=cover');
  assert.equal(api.snapshot.owner,owner.owner);assert.equal(api.snapshot.generation,owner.generation);assert.deepEqual(calls,[]);
});

test('TV compose right reaches Send instead of a geometrically closer hangup',()=>{
  const {api,window}=fixture();const doc=window.document;
  const input={id:'steerText',focus(){doc.activeElement=this;}},send={id:'steer',focus(){doc.activeElement=this;}};
  doc.getElementById=id=>id==='steer'?send:input;
  input.focus();api.navigate('right');assert.equal(doc.activeElement,send);
  api.navigate('left');assert.equal(doc.activeElement,input);
});
