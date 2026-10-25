#!/usr/bin/env node
// Explicit deployment helper. Copies only versioned helper/Skill assets, no credentials.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,realpathSync} from 'node:fs';import {createHash} from 'node:crypto';import {resolve,dirname} from 'node:path';
const source=resolve(process.argv[2]),target=resolve(process.argv[3]),raw=readFileSync(source+'/backend-device-bundle.json'),manifest=JSON.parse(raw),hash=x=>createHash('sha256').update(x).digest('hex');
if(manifest.schema!=='v-voice-backend-device-bundle-v1')throw Error('Unknown backend bundle');
for(const file of manifest.files){const path=resolve(source,file.path);if(!path.startsWith(source+'/')||!realpathSync(path).startsWith(realpathSync(source)+'/')||hash(readFileSync(path))!==file.sha256)throw Error('Source asset mismatch');}
mkdirSync(target,{recursive:false,mode:0o700});
for(const file of manifest.files){const dest=resolve(target,file.path);mkdirSync(dirname(dest),{recursive:true,mode:0o700});copyFileSync(resolve(source,file.path),dest);}
writeFileSync(target+'/backend-device-bundle.json',raw,{mode:0o600,flag:'wx'});
console.log(JSON.stringify({root:target,sha256:hash(raw),sourceCommit:manifest.sourceCommit,files:manifest.files.length,networkVerified:false}));
