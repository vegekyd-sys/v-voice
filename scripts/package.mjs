#!/usr/bin/env node
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const run=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
if(run('status','--porcelain'))throw Error('Commit and test the exact source before packaging');
const commit=run('rev-parse','HEAD');
const baseline=JSON.parse(await readFile(join(root,'docs/migration-baseline.json'),'utf8'));
const names=[...baseline.files.map(f=>f.path),'lib/gateway-client.mjs','lib/conversation-entries.mjs','lib/phone-provisioning.mjs','lib/private-phone-file.mjs','scripts/phone.mjs','package.json','package-lock.json'];
const target=resolve(process.argv[2]??join(root,'artifacts',commit));
await mkdir(dirname(target),{recursive:true});
await mkdir(target,{recursive:false});
const files=[];
for(const name of names.sort()){
 const bytes=await readFile(join(root,name)),dest=join(target,name);await mkdir(dirname(dest),{recursive:true});await copyFile(join(root,name),dest);
 files.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
const manifest={schema:'v-voice-release-v1',commit,baselineCommit:baseline.sourceCommit,gatewayProtocol:4,gatewayRestartRequired:false,
 entrypoint:'lab/gpt-live-h5/server.mjs',files,filesSha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({artifact:target,commit,files:files.length,bytes:files.reduce((a,f)=>a+f.bytes,0),filesSha256:manifest.filesSha256}));
