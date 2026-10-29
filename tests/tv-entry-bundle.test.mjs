import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildTvEntry,TV_ENTRY_BUNDLE,buildTvStartup,TV_STARTUP_BUNDLE} from '../scripts/build-tv-entry.mjs';
test('TV bundle matches shared sources and preserves the single entry startup owner',async()=>{
 const [built,committed]=await Promise.all([buildTvEntry(),readFile(TV_ENTRY_BUNDLE)]);
 assert.ok(Buffer.from(built).equals(committed),'Run node scripts/build-tv-entry.mjs');
 assert.ok(Buffer.from(await buildTvStartup()).equals(await readFile(TV_STARTUP_BUNDLE)));
 const text=committed.toString();
 assert.match(text,/from[ ]*"\.\/tv-startup\.bundle\.mjs"/);
 assert.match(text,/const PcmPlaybackQueue=/,'Generated speaker worklet binds bundled class expressions');
 assert.match(text,/new URL\("\.\/tv-array-worker.js",import.meta.url\)/,'Worker stays relative to the same served directory');
});


test('bundled speaker worklet renders on its own audio thread without outer bindings',async()=>{
 const {build}=await import('esbuild');
 const {runInNewContext}=await import('node:vm');
 const compiled=await build({entryPoints:['lab/gpt-live-h5/relay-audio.mjs'],bundle:true,format:'esm',platform:'browser',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,write:false});
 const {relayWorkletSource}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
 const processors=new Map();class Processor{constructor(){this.port={postMessage(){}};}}
 runInNewContext(relayWorkletSource(),{AudioWorkletProcessor:Processor,sampleRate:48000,currentTime:0,Int16Array,Float32Array,registerProcessor:(name,C)=>processors.set(name,C)});
 const speaker=new (processors.get('v-direct-speaker'))();
 const pcm=new Int16Array(24000).fill(500);speaker.port.onmessage({data:{type:'audio',buffer:pcm.buffer,epoch:0}});speaker.port.onmessage({data:{type:'done',epoch:0}});
 const out=new Float32Array(128);speaker.process([],[[out]]);assert.ok(out.every(v=>v>0));
});
