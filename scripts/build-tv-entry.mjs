#!/usr/bin/env node
// TV entry removes the network waterfall, retaining the separately loaded
// startup owner. Keep identifiers used by generated AudioWorklet source.
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
export const TV_ENTRY_BUNDLE=resolve(root,'lab/gpt-live-h5/tv-entry.bundle.mjs');
export const TV_STARTUP_BUNDLE=resolve(root,'lab/gpt-live-h5/tv-startup.bundle.mjs');
export async function buildTvEntry(){
 const result=await build({entryPoints:[resolve(root,'lab/gpt-live-h5/app.js')],bundle:true,format:'esm',platform:'browser',target:['chrome100'],plugins:[{name:'browser-route-alias',setup(b){b.onResolve({filter:/^\.\/entry-startup\.mjs$/},()=>({path:'./tv-startup.bundle.mjs',external:true}));b.onResolve({filter:/^\.\/speaker-routing\.mjs$/},()=>({path:resolve(root,'lab/speaker-native/client.mjs')}));b.onResolve({filter:/^\.\/relay-audio\.mjs$/},()=>({path:resolve(root,'lab/gpt-live-h5/relay-audio.mjs')}));}}],minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,legalComments:'eof',charset:'utf8',write:false,logLevel:'silent',absWorkingDir:root});
 return result.outputFiles[0].contents;
}
export async function buildTvStartup(){
 const result=await build({entryPoints:[resolve(root,'lab/gpt-live-h5/entry-startup.mjs')],bundle:true,format:'esm',platform:'browser',target:['chrome100'],minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,legalComments:'eof',charset:'utf8',write:false,logLevel:'silent',absWorkingDir:root});return result.outputFiles[0].contents;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const [entry,startup]=await Promise.all([buildTvEntry(),buildTvStartup()]);await writeFile(TV_ENTRY_BUNDLE,entry);await writeFile(TV_STARTUP_BUNDLE,startup);console.log('TV entry/startup bytes:',entry.length,startup.length);}
