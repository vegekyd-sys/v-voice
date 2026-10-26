import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../app/src/main/assets/host-bridge.js',import.meta.url),'utf8');
function harness({main=true}={}) {
 const sent=[],clicks=[],listeners={},style=[];const observers=[];
 const body={dataset:{callState:'idle',microphoneMuted:'false'}};
 const elements=new Map(['stop','mute','changelogClose','modelTrigger','readerBack','textToggle'].map(id=>[id,{click:()=>clicks.push(id),getAttribute:()=>null}]));
 const document={body,head:{append:value=>style.push(value)},createElement:()=>({}),
  getElementById:id=>elements.get(id),querySelector:()=>null,dispatchEvent:event=>clicks.push(event.key),addEventListener:(name,fn)=>listeners[name]=fn};
 const host={postMessage:raw=>sent.push(JSON.parse(raw))};
 const window={VVoiceHost:host,addEventListener:(name,fn)=>listeners[name]=fn};
 const track={stopped:0,stop(){this.stopped++;},addEventListener(){}};
 const context={window,top:main?window:{},document,VVoiceHost:host,MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},
  KeyboardEvent:class{constructor(type,options){Object.assign(this,options);}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track]})}}};
 vm.runInNewContext(source,context);
 return {sent,clicks,listeners,track,host,context,elements,body,document,refresh(){observers.forEach(fn=>fn());},change(state,muted=false){body.dataset={callState:state,microphoneMuted:String(muted)};observers.forEach(fn=>fn());}};
}
test('main-frame bridge only exports bounded call state and releases capture at hangup',async()=>{
 const f=harness();assert.deepEqual(f.sent.filter(v=>v.type==='state'),[{type:'state',state:'idle',muted:false}]);
 await f.context.navigator.mediaDevices.getUserMedia({audio:true});f.change('dialing');f.change('connected');f.change('connected',true);f.change('idle');
 assert.equal(f.track.stopped,1);assert.equal(f.sent.filter(v=>v.type==='state').length,5);
 f.change('idle');assert.equal(f.sent.filter(v=>v.type==='state').length,5);
 for(const state of f.sent.filter(v=>v.type==='state'))assert.deepEqual(Object.keys(state),['type','state','muted']);
});
test('notification controls use the shared H5 controls and reject unknown commands',()=>{
 const f=harness();f.host.onmessage({data:'not-json'});f.host.onmessage({data:'{"type":"dial"}'});
 f.host.onmessage({data:'{"type":"hangup"}'});f.host.onmessage({data:'{"type":"mute"}'});
 assert.deepEqual(f.clicks,['stop','mute']);
});
test('subframes never install a host adapter',()=>assert.equal(harness({main:false}).sent.length,0));
test('H5 still owns the controls and lifecycle attributes consumed by Android',async()=>{
 const app=await readFile(new URL('../../lab/gpt-live-h5/app.js',import.meta.url),'utf8');
 const ui=await readFile(new URL('../../lab/gpt-live-h5/ui/call-ui.jsx',import.meta.url),'utf8');
 assert.match(app,/document\.body\.dataset\.callState = state/);assert.match(app,/document\.body\.dataset\.microphoneMuted = String\(muted\)/);
 for(const id of ['stop','mute','start'])assert.ok(ui.includes(`id="${id}"`));
});

test('Android back closes existing H5 surfaces without hanging up or mutating call ownership',()=>{
 const f=harness();f.change('connected');
 f.elements.set('changelogDialog',{open:true});assert.equal(f.context.window.__vVoiceAndroidBack(),true);assert.equal(f.clicks.at(-1),'changelogClose');
 f.elements.delete('changelogDialog');f.elements.set('modelMenu',{});assert.equal(f.context.window.__vVoiceAndroidBack(),true);assert.equal(f.clicks.at(-1),'modelTrigger');
 f.elements.delete('modelMenu');f.body.dataset.reading='true';assert.equal(f.context.window.__vVoiceAndroidBack(),true);assert.equal(f.clicks.at(-1),'readerBack');
 f.body.dataset.reading='false';f.elements.get('textToggle').getAttribute=()=> 'true';assert.equal(f.context.window.__vVoiceAndroidBack(),true);assert.equal(f.clicks.at(-1),'textToggle');
 f.elements.get('textToggle').getAttribute=()=> 'false';assert.equal(f.context.window.__vVoiceAndroidBack(),false);
 assert.equal(f.clicks.includes('stop'),false);assert.equal(f.body.dataset.callState,'connected');
});
test('native settings hides for readers and dialogs, then returns without leaking content',()=>{
 const f=harness();f.body.dataset.reading='true';f.refresh();
 assert.deepEqual(f.sent.at(-1),{type:'presentation',obscured:true});const count=f.sent.length;f.refresh();assert.equal(f.sent.length,count);
 f.body.dataset.reading='false';f.elements.set('changelogDialog',{open:true});f.refresh();assert.equal(f.sent.length,count);
 f.elements.delete('changelogDialog');f.refresh();assert.deepEqual(f.sent.at(-1),{type:'presentation',obscured:false});
});
