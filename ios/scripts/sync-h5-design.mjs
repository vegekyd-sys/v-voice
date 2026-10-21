#!/usr/bin/env node
// Deterministic copies of the existing H5 design; no model calls or downloads.
import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {VOICE_UPDATES} from '../../lab/gpt-live-h5/changelog.mjs';
import {AVATAR_CATALOG,avatarContinuationPlan} from '../../lab/gpt-live-h5/avatar-catalog.mjs';
import {AVATAR_SEQUENCES,HOME_AVATAR_FILE} from '../../lab/gpt-live-h5/avatar-state.mjs';
const root=resolve(import.meta.dirname,'../..'),web=resolve(root,'lab/gpt-live-h5'),native=resolve(root,'ios/VVoice/Resources');
const gallery=AVATAR_CATALOG.map(p=>({id:p.id,label:p.label,asset:p.id==='idle'?'VHome':'VAvatar_'+p.id.replaceAll('-','_'),continuations:avatarContinuationPlan(p.id)}));
const names=Object.fromEntries(gallery.map(p=>{const original=AVATAR_CATALOG.find(x=>x.id===p.id);return [p.asset,p.id==='idle'?HOME_AVATAR_FILE:AVATAR_SEQUENCES[original.scene][original.frame]]}));
const sourceFiles=[...new Set(Object.values(names))].map(x=>'assets/'+x).concat(['styles.css','changelog.mjs','markdown.mjs','vendor/marked-18.0.5.mjs','avatar.mjs','avatar-reactions.mjs','avatar-catalog.mjs','avatar-state.mjs','avatar-approved-reactions.mjs']);
const sources={};for(const file of sourceFiles)sources[file]=createHash('sha256').update(await readFile(resolve(web,file))).digest('hex');
const manifest=JSON.stringify({sources},null,2)+'\n';
if(process.argv.includes('--check')){
 const actual=await readFile(resolve(native,'Reader/H5DesignSource.json'),'utf8');
 if(actual!==manifest)throw Error('H5 design sources changed; run node ios/scripts/sync-h5-design.mjs');
 if(!(await readFile(resolve(native,'Reader/H5Reader.css'))).equals(await readFile(resolve(web,'styles.css'))))throw Error('Reader CSS differs from H5');
 if(await readFile(resolve(native,'Reader/H5AvatarCatalog.json'),'utf8')!==JSON.stringify(gallery,null,2)+'\n')throw Error('Avatar catalog differs from H5');
 if(await readFile(resolve(native,'Reader/H5Updates.json'),'utf8')!==JSON.stringify(VOICE_UPDATES,null,2)+'\n')throw Error('Update notes differ from H5');
 console.log('H5 design source parity verified.');process.exit(0);
}
for(const [name,file] of Object.entries(names)){
 const dir=resolve(native,'Assets.xcassets',`${name}.imageset`);await mkdir(dir,{recursive:true});
 execFileSync('sips',['-s','format','png',resolve(web,'assets',file),'--out',resolve(dir,'portrait.png')],{stdio:'ignore'});
 await writeFile(resolve(dir,'Contents.json'),JSON.stringify({images:[{filename:'portrait.png',idiom:'universal'}],info:{author:'xcode',version:1}},null,2)+'\n');
}
await mkdir(resolve(native,'Reader'),{recursive:true});
await writeFile(resolve(native,'Reader/H5Reader.css'),await readFile(resolve(web,'styles.css')));
const bundle=await build({stdin:{contents:"export {renderMarkdown} from './markdown.mjs'; export {marked} from './vendor/marked-18.0.5.mjs';",resolveDir:web,sourcefile:'native-markdown.mjs'},bundle:true,format:'iife',globalName:'VVoiceMarkdown',target:'safari16',minify:true,write:false,legalComments:'eof'});
await writeFile(resolve(native,'Reader/H5Markdown.js'),bundle.outputFiles[0].contents);
await writeFile(resolve(native,'Reader/H5DesignSource.json'),manifest);
await writeFile(resolve(native,'Reader/H5Updates.json'),JSON.stringify(VOICE_UPDATES,null,2)+'\n');
await writeFile(resolve(native,'Reader/H5AvatarCatalog.json'),JSON.stringify(gallery,null,2)+'\n');
await writeFile(resolve(native,'Reader/marked-LICENSE'),await readFile(resolve(web,'vendor/marked-LICENSE')));
console.log(`Synced all ${gallery.length} original H5 portraits, reader CSS and safe Markdown renderer.`);
