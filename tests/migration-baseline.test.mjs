import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const baseline=JSON.parse(readFileSync(new URL('../docs/migration-baseline.json',import.meta.url)));
const adapters=new Set(['lab/gpt-live-h5/server.mjs','lab/gpt-live-h5/access.mjs','lab/gpt-live-h5/app.js','lab/gpt-live-h5/relay-audio.mjs']);
test('audio providers, queue, controls, persona, avatar catalogue and images retain deployed bytes',()=>{
 assert.equal(baseline.files.length,114);
 for(const f of baseline.files){if(adapters.has(f.path))continue;const bytes=readFileSync(new URL('../'+f.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path);}
});
test('startup no longer loads OpenClaw install-directory SDK or dependencies',()=>{
 const code=readFileSync(new URL('../lab/gpt-live-h5/server.mjs',import.meta.url),'utf8');assert.doesNotMatch(code,/dist\/plugin-sdk\/gateway-runtime|node_modules\/ws\/wrapper|pathToFileURL|RUNTIME_ROOT/);
});
