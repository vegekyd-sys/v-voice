#!/usr/bin/env node
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {AVATAR_FILES} from '../lab/gpt-live-h5/avatar-state.mjs';
const root=resolve(import.meta.dirname,'..');
const run=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
if(run('status','--porcelain'))throw Error('Commit and test the exact source before packaging');
const commit=run('rev-parse','HEAD');
const baseline=JSON.parse(await readFile(join(root,'docs/migration-baseline.json'),'utf8'));
const names=[...new Set([...baseline.files.map(f=>f.path),...['v-voice-icon.svg','v-voice-icon-32.png','v-voice-apple-touch.png'].map(n=>'lab/gpt-live-h5/assets/'+n),...AVATAR_FILES.map(n=>'lab/gpt-live-h5/assets/'+n),'plugins/v-voice-gpt-live/package.json','plugins/v-voice-gpt-live/index.mjs','plugins/v-voice-gpt-live/provider.mjs','plugins/v-voice-gpt-live/delivery.mjs','plugins/v-voice-gpt-live/openclaw.plugin.json','lib/voice-task-control.mjs','plugins/v-voice-gpt-live/task-control.mjs','lib/gateway-client.mjs','lib/conversation-entries.mjs','lab/gpt-live-h5/call-control.mjs','lab/speaker-native/client.mjs','lab/gpt-live-h5/capability-policy.mjs','lab/gpt-live-h5/instructions.mjs','lab/gpt-live-h5/media-references.mjs','lab/gpt-live-h5/content-view.mjs','lab/gpt-live-h5/entry-startup.mjs','lab/gpt-live-h5/changelog.mjs','lab/gpt-live-h5/product-controls.mjs','lab/gpt-live-h5/screen-wake-lock.mjs','lab/gpt-live-h5/avatar-approved-reactions.mjs','lab/realtime-direct-tools/conversation-context.mjs','lab/realtime-direct-tools/lark-readonly.mjs','lab/realtime-direct-tools/task-delivery.mjs','lab/gpt-live-h5/listening.mjs','lab/gpt-live-h5/comparison.html','lab/gpt-live-h5/comparison.mjs','lab/gpt-live-h5/comparison.css','package.json','package-lock.json'])];
names.push('plugins/v-voice-gpt-live/tasks.mjs');
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
