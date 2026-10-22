import test from 'node:test';import assert from 'node:assert/strict';import {createLegacyEntry} from './legacy-entry.mjs';
test('legacy bookmarks redirect to current hosted product without proxying media or accepting old calls',async t=>{
 const server=createLegacyEntry({destination:'https://candidate.example/voice/'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port;
 const r=await fetch(origin+'/?entry=tianyi&fixture=question&sessionKey=untrusted',{redirect:'manual'});assert.equal(r.status,307);assert.equal(r.headers.get('location'),'https://candidate.example/voice/?entry=tianyi&fixture=question');assert.equal((await fetch(origin+'/api/session',{method:'POST'})).status,410);assert.throws(()=>createLegacyEntry({destination:'http://candidate.example/'}));
});
