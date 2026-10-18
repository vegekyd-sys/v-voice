import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createSpeakerDiagnostics} from './diagnostics.mjs';
test('diagnostics retain stage timings and decisions without chat, voice, names or secrets',t=>{
 const dir=mkdtempSync(join(tmpdir(),'speaker-audit-'));t.after(()=>rmSync(dir,{recursive:true}));const log=createSpeakerDiagnostics({directory:dir,maxBytes:100000});
 log.audit({type:'speaker.decision',voiceSessionId:'call',shouldRespond:false,timings:{afterEndMs:123},turn:{speakerId:'local0',text:'PRIVATE_CHAT',startMs:0,endMs:1000},participants:[{name:'PRIVATE_NAME'}],audio:'PRIVATE_PCM',args:{token:'SECRET'}});
 const raw=readFileSync(join(dir,'routing.jsonl'),'utf8'),row=JSON.parse(raw);assert.equal(row.turn.textLength,12);assert.equal(row.people,1);assert.equal(row.timings.afterEndMs,123);assert.doesNotMatch(raw,/PRIVATE|SECRET/);assert.equal(statSync(join(dir,'routing.jsonl')).mode&0o077,0);
});
