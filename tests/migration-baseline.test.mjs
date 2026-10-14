import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const baseline=JSON.parse(readFileSync(new URL('../docs/migration-baseline.json',import.meta.url)));
const updates=JSON.parse(readFileSync(new URL('../docs/deployed-baseline-updates.json',import.meta.url)));
const currentHashes=new Map(updates.files.map(f=>[f.path,f.sha256]));
const adapters=new Set(['lab/gpt-live-h5/avatar-state.mjs','lab/gpt-live-h5/avatar.test.mjs','lab/gpt-live-h5/avatar.mjs','lab/gpt-live-h5/index.html','lab/gpt-live-h5/server.mjs','lab/gpt-live-h5/access.mjs','lab/gpt-live-h5/app.js','lab/gpt-live-h5/styles.css','lab/gpt-live-h5/transcript-presentation.mjs','lab/gpt-live-h5/relay-audio.mjs','lab/realtime-direct-tools/session.mjs','lab/realtime-direct-tools/tools.mjs','lab/realtime-direct-tools/tool-start-audio.mjs','lab/realtime-direct-tools/backend.mjs','lab/realtime-direct-tools/transcript-log.mjs','lab/seeduplex-realtime-provider.mjs','lab/gpt-live-h5/result-presentation.mjs']);
test('unchanged modules outside explicit Voice adapters retain deployed bytes',()=>{
 assert.equal(baseline.files.length,114);
 for(const f of baseline.files){if(adapters.has(f.path))continue;const bytes=readFileSync(new URL('../'+f.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),currentHashes.get(f.path)??f.sha256,f.path);}
});
test('startup no longer loads OpenClaw install-directory SDK or dependencies',()=>{
 const code=readFileSync(new URL('../lab/gpt-live-h5/server.mjs',import.meta.url),'utf8');assert.doesNotMatch(code,/dist\/plugin-sdk\/gateway-runtime|node_modules\/ws\/wrapper|pathToFileURL|RUNTIME_ROOT/);
});
