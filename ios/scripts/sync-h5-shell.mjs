#!/usr/bin/env node
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {AVATAR_FILES} from '../../lab/gpt-live-h5/avatar-state.mjs';
const root=resolve(import.meta.dirname,'../..'),h5=resolve(root,'lab/gpt-live-h5'),dest=resolve(root,'ios/VVoice/Resources/H5Shell');
const sources=['index.html','styles.css','ui/call-ui.jsx','ui-bundle.mjs','call-view.mjs','content-view.mjs','markdown.mjs','media-references.mjs','changelog.mjs','avatar.mjs','avatar-reactions.mjs','avatar-telemetry.mjs','avatar-catalog.mjs','avatar-state.mjs','avatar-approved-reactions.mjs','vendor/marked-18.0.5.mjs','comparison.html','comparison.css','comparison.mjs',...new Set(AVATAR_FILES.map(f=>'assets/'+f)),'assets/v-voice-icon.svg','assets/v-voice-icon-32.png','assets/v-voice-apple-touch.png'];
const manifest={sources:{}};for(const name of sources)manifest.sources[name]=createHash('sha256').update(await readFile(resolve(h5,name))).digest('hex');
manifest.sources['ios/H5/native-h5.mjs']=createHash('sha256').update(await readFile(resolve(root,'ios/H5/native-h5.mjs'))).digest('hex');
const bundle=await build({entryPoints:[resolve(root,'ios/H5/native-h5.mjs')],bundle:true,format:'iife',target:'safari16',minify:true,write:false,legalComments:'eof'});
const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' blob:; font-src 'self' data:; frame-src 'none'; base-uri 'self'; form-action 'none'">`;
let html=(await readFile(resolve(h5,'index.html'),'utf8')).replace(/\s*<link rel="modulepreload"[^>]*>/gu,'').replace(/\s*<script[^>]*src="\.\/entry-startup.mjs"[^>]*><\/script>/gu,'').replace('<script type="module" src="./app.js"></script>','<script src="./native-h5.js"></script>').replace('<meta charset="utf-8" />','<meta charset="utf-8" />'+csp);
// Safari supplies a browser top inset. The full-screen WK shell needs the reader to respect the notch itself.
html=html.replace('</head>','<style>.reader-layer{padding-top:max(24px,env(safe-area-inset-top))}@media(max-width:600px){.reader-layer{padding-top:max(8px,env(safe-area-inset-top))}}</style></head>');
// Original page DOM and stylesheet stay intact; only transport and native viewport accommodation differ.
const copies=['styles.css','comparison.css','comparison.mjs',...new Set(AVATAR_FILES.map(f=>'assets/'+f)),'assets/v-voice-icon.svg','assets/v-voice-icon-32.png','assets/v-voice-apple-touch.png'];
const expected=new Map([['index.html',Buffer.from(html)],['native-h5.js',bundle.outputFiles[0].contents],['comparison.html',Buffer.from((await readFile(resolve(h5,'comparison.html'),'utf8')).replace('<meta charset="utf-8">','<meta charset="utf-8">'+csp).replace('<script type="module" src="./comparison.mjs">','<script src="./comparison.mjs">'))]]);
for(const f of copies)expected.set(f,await readFile(resolve(h5,f)));
// Original comparison uses top-level await. Keep its logic intact in a classic-script async wrapper.
expected.set('comparison.mjs',Buffer.from('(async () => {\n'+await readFile(resolve(h5,'comparison.mjs'),'utf8')+'\n})();\n'));
manifest.outputs=Object.fromEntries([...expected].map(([p,b])=>[p,createHash('sha256').update(b).digest('hex')]));
expected.set('source-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
if(process.argv.includes('--check')){for(const [f,bytes]of expected)if(!Buffer.from(bytes).equals(await readFile(resolve(dest,f))))throw Error('H5 shell stale: '+f);console.log('Exact H5 shell sources and generated bundle verified.');}
else {for(const [f,bytes]of expected){await mkdir(resolve(dest,f,'..'),{recursive:true});await writeFile(resolve(dest,f),bytes);}console.log('Bundled original H5 page, styles, UI, reader, all Reaction assets and comparison.');}
