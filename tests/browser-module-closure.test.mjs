import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';

test('every browser module imported by the real entry is served successfully',async t=>{
 const bridge=createLiveH5Server({preview:true});
 await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));
 t.after(()=>bridge.dispose());
 const origin=`http://127.0.0.1:${bridge.server.address().port}`;
 const pending=[origin+'/app.js'],seen=new Set();
 while(pending.length){
  const url=pending.pop();if(seen.has(url))continue;seen.add(url);
  const response=await fetch(url);assert.equal(response.status,200,url);
  assert.match(response.headers.get('content-type'),/javascript/,url);
  const code=await response.text();
  for(const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\()(['"])(\.[^'"]+)\1/g))pending.push(new URL(m[2],url).href);
 }
 assert.ok(seen.has(origin+'/content-view.mjs'));
 assert.ok(seen.has(origin+'/ui-bundle.mjs'));
 assert.ok(seen.has(origin+'/call-view.mjs'));
});
