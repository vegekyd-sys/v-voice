import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash,releaseRevision} from '../ios/scripts/h5-release.mjs';

test('web release contains one complete compatible H5 snapshot with valid bytes',async()=>{
 const release=JSON.parse(await readFile(new URL('../lab/gpt-live-h5/ios-shell-release.json',import.meta.url),'utf8'));
 assert.equal(release.schema,1);assert.equal(release.minimumBridge,1);assert.equal(release.maximumBridge,1);
 assert.equal(release.revision,releaseRevision(release));
 const paths=new Set();
 for(const f of release.files){
   assert.ok(!paths.has(f.path));paths.add(f.path);
   const bytes=Buffer.from(f.data,'base64');assert.equal(bytes.length,f.bytes);assert.equal(hash(bytes),f.sha256);
 }
 for(const path of ['index.html','native-h5.js','styles.css','comparison.html'])assert.ok(paths.has(path));
 const js=Buffer.from(release.files.find(f=>f.path==='native-h5.js').data,'base64').toString();
 assert.match(js,/bridgeVersion:1/);assert.match(js,/__VVoicePageID/);
});

test('web, bundled fallback and source manifest are all current',async()=>{
 await promisify(execFile)(process.execPath,['ios/scripts/sync-h5-shell.mjs','--check'],{cwd:new URL('../',import.meta.url)});
});
