import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function bootstrap(testCase,overrides={}){
 const env={...process.env,DIRECT_VOICE_AUTOMATED:'1',V_REALTIME_DIRECT_TOOLS:'1',DIRECT_VOICE_CASES:testCase,...overrides};
 for(const key of ['VLAB_CANDIDATE_RUNTIME','OPENCLAW_STATE_DIR','OPENCLAW_CONFIG_PATH'])delete env[key];
 return spawnSync(process.execPath,['lab/gpt-live-h5-candidate.mjs'],{env,encoding:'utf8'});
}
test('unknown observer is rejected before disposable runtime startup',()=>{
 const result=bootstrap('not-a-real-case');assert.equal(result.status,1);
 assert.match(result.stderr,/Unknown direct voice observer case/);
 assert.doesNotMatch(result.stderr,/Disposable candidate environment required/);
});
test('controls-only observer passes case validation before runtime startup',()=>{
 for(const name of ['controls','calendar-playback','routing-controls']){const result=bootstrap(name);assert.equal(result.status,1);
 assert.match(result.stderr,/Disposable candidate environment required/);
 assert.doesNotMatch(result.stderr,/Unknown direct voice observer case/);}
});

test('per-model cases reject unknown model or scenario before Gateway startup',()=>{
 for(const selected of [{seeduplex:'bad-case'},{unknown:'controls'}]){const r=bootstrap('hybrid',{DIRECT_VOICE_CASE_BY_MODEL:JSON.stringify(selected)});assert.match(r.stderr,/Unknown per-model voice observer case/);assert.doesNotMatch(r.stderr,/Disposable candidate environment required/);}
 const r=bootstrap('hybrid',{DIRECT_VOICE_CASE_BY_MODEL:JSON.stringify({seeduplex:'controls',grok:'hybrid'})});assert.match(r.stderr,/Disposable candidate environment required/);
});
