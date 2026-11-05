#!/usr/bin/env node
// Standalone zero-dependency CLI. No service source, credentials or media.
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),target=resolve(process.argv[2]??'artifacts/voice-cli-0.1.0');
await mkdir(target,{recursive:false,mode:0o700});
for(const path of ['bin','lib','skills/voice-cli'])await mkdir(join(target,path),{recursive:true});
for(const path of ['bin/v-voice.mjs','lib/voice-cli-contract.mjs','skills/voice-cli/SKILL.md'])await copyFile(join(root,path),join(target,path));
await copyFile(join(root,'docs/voice-cli.md'),join(target,'README.md'));
await writeFile(join(target,'package.json'),JSON.stringify({name:'@versa/v-voice-cli',version:'0.1.0',private:true,type:'module',engines:{node:'>=22'},bin:{'v-voice':'bin/v-voice.mjs'},files:['bin','lib','skills','README.md']},null,2)+'\n');
console.log(JSON.stringify({schema:'v-voice-cli-package/v1',directory:target,dependencies:0,install:'npm install --prefix PRIVATE_DIRECTORY '+target}));
