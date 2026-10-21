#!/usr/bin/env node
// Deterministic copies of the existing H5 design; no model calls or downloads.
import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),web=resolve(root,'lab/gpt-live-h5'),native=resolve(root,'ios/VVoice/Resources');
const names={VHome:'v-operator-home-1024.webp',VListen:'v-operator-square-listen-0-512.webp',VMemory:'v-operator-square-memory-0-512.webp',VWeb:'v-operator-square-web-0-512.webp',VCalendar:'v-operator-square-calendar-0-512.webp',VWorking:'v-operator-square-background-0-512.webp',VComplete:'v-operator-square-complete-0-512.webp'};
const sourceFiles=[...Object.values(names).map(x=>'assets/'+x),'styles.css','markdown.mjs','vendor/marked-18.0.5.mjs'];
const sources={};for(const file of sourceFiles)sources[file]=createHash('sha256').update(await readFile(resolve(web,file))).digest('hex');
const manifest=JSON.stringify({sources},null,2)+'\n';
if(process.argv.includes('--check')){
 const actual=await readFile(resolve(native,'Reader/H5DesignSource.json'),'utf8');
 if(actual!==manifest)throw Error('H5 design sources changed; run node ios/scripts/sync-h5-design.mjs');
 if(!(await readFile(resolve(native,'Reader/H5Reader.css'))).equals(await readFile(resolve(web,'styles.css'))))throw Error('Reader CSS differs from H5');
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
await writeFile(resolve(native,'Reader/marked-LICENSE'),await readFile(resolve(web,'vendor/marked-LICENSE')));
console.log('Synced 7 original H5 portraits, reader CSS and safe Markdown renderer.');
