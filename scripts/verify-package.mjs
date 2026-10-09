#!/usr/bin/env node
import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]??'');const m=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
if(m.schema!=='v-voice-release-v1'||m.gatewayProtocol!==4||m.gatewayRestartRequired!==false)throw Error('Unexpected release contract');
const hash=value=>createHash('sha256').update(value).digest('hex');
if(hash(JSON.stringify(m.files))!==m.filesSha256)throw Error('Manifest mismatch');
for(const f of m.files){if(resolve(root,f.path).indexOf(root+'/')!==0)throw Error('Unsafe artifact path');const bytes=await readFile(resolve(root,f.path));if(hash(bytes)!==f.sha256||bytes.length!==f.bytes)throw Error('Artifact mismatch: '+f.path);}
console.log(JSON.stringify({verified:true,commit:m.commit,files:m.files.length}));
