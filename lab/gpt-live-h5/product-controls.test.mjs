import test from 'node:test';
import assert from 'node:assert/strict';
import {placeDialControl} from './product-controls.mjs';
function fixture() {
  const home={children:[],append(node){node.parentElement?.children.splice(node.parentElement.children.indexOf(node),1);this.children.push(node);node.parentElement=this;}};
  const pill={children:[],append:home.append};
  const start={parentElement:home,attributes:{},setAttribute(key,value){this.attributes[key]=value;}};home.children.push(start);
  const document={body:{dataset:{callState:'idle',conversation:'empty'}},getElementById:id=>id==='start'?start:pill};
  let mobile=true;
  const window={matchMedia:()=>({matches:mobile})};
  const sync=()=>placeDialControl(document,window,home);
  return {home,pill,start,document,sync,resize:value=>{mobile=value;sync();}};
}
test('H5 hangup with history moves the existing dial control into the pill, without losing its identity',()=>{
 const f=fixture();f.sync();assert.equal(f.start.parentElement,f.home);
 f.document.body.dataset.conversation='started';f.document.body.dataset.callState='connected';f.sync();assert.equal(f.start.parentElement,f.home);
 f.document.body.dataset.callState='idle';f.sync();assert.equal(f.start.parentElement,f.pill);assert.equal(f.home.children.length,0);assert.equal(f.start.attributes['aria-label'],'重新拨号');
 f.sync();assert.equal(f.pill.children.length,1);
});
test('redial and desktop resize return the same button to its original home; empty H5 keeps its large dial button',()=>{
 const f=fixture();f.document.body.dataset.conversation='started';f.sync();
 f.document.body.dataset.callState='dialing';f.sync();assert.equal(f.start.parentElement,f.home);
 f.document.body.dataset.callState='idle';f.sync();f.resize(false);assert.equal(f.start.parentElement,f.home);
 f.resize(true);assert.equal(f.start.parentElement,f.pill);
 f.document.body.dataset.conversation='empty';f.sync();assert.equal(f.start.parentElement,f.home);assert.equal(f.start.attributes['aria-label'],'拨号');
});
