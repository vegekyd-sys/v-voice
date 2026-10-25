#!/usr/bin/env node
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';import {existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {AVATAR_FILES} from '../lab/gpt-live-h5/avatar-state.mjs';
const root=resolve(import.meta.dirname,'..');
const run=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
if(run('status','--porcelain'))throw Error('Commit and test the exact source before packaging');
const commit=run('rev-parse','HEAD');
const baseline=JSON.parse(await readFile(join(root,'docs/migration-baseline.json'),'utf8'));
const names=[...new Set([...baseline.files.map(f=>f.path),...['v-voice-icon.svg','v-voice-icon-32.png','v-voice-apple-touch.png'].map(n=>'lab/gpt-live-h5/assets/'+n),...AVATAR_FILES.map(n=>'lab/gpt-live-h5/assets/'+n),'plugins/v-voice-gpt-live/package.json','plugins/v-voice-gpt-live/index.mjs','plugins/v-voice-gpt-live/provider.mjs','plugins/v-voice-gpt-live/delivery.mjs','plugins/v-voice-gpt-live/openclaw.plugin.json','lib/voice-task-control.mjs','plugins/v-voice-gpt-live/task-control.mjs','lib/gateway-client.mjs','lib/conversation-entries.mjs','lab/gpt-live-h5/call-control.mjs','lab/speaker-native/client.mjs','lab/gpt-live-h5/capability-policy.mjs','lab/gpt-live-h5/instructions.mjs','lab/gpt-live-h5/media-references.mjs','lab/gpt-live-h5/content-view.mjs','lab/gpt-live-h5/entry-startup.mjs','lab/gpt-live-h5/changelog.mjs','lab/gpt-live-h5/ui-bundle.mjs','lab/gpt-live-h5/call-view.mjs','lab/gpt-live-h5/screen-wake-lock.mjs','lab/gpt-live-h5/avatar-approved-reactions.mjs','lab/realtime-direct-tools/conversation-context.mjs','lab/realtime-direct-tools/lark-readonly.mjs','lab/realtime-direct-tools/task-delivery.mjs','lab/gpt-live-h5/listening.mjs','lab/gpt-live-h5/comparison.html','lab/gpt-live-h5/comparison.mjs','lab/gpt-live-h5/comparison.css','package.json','package-lock.json'])];
names.push('lib/release-control.mjs','plugins/v-voice-gpt-live/tasks.mjs',
 ...['production.mjs','diagnostics.mjs','stream-service.mjs','service.mjs','online-speaker.mjs','embedding-worker.py','requirements-stream.txt','decision.mjs'].map(n=>'lab/speaker-native/'+n),
 ...['volc-asr.mjs','utterances.mjs'].map(n=>'lab/volc-speaker/'+n),
 'lab/voice-decision-router.mjs');
names.push('lab/realtime-direct-tools/device-endpoint.mjs','lab/realtime-direct-tools/device-playout.mjs','lab/realtime-direct-tools/device-volume.mjs','lab/realtime-direct-tools/near-field-gate.mjs');
// Generated progress clips ship once scripts/generate-notice-clips.mjs has made them.
if(existsSync(join(root,'lab/realtime-direct-tools/assets/tool-progress-provenance.json')))names.push(...['tool-progress-provenance.json','tool-progress-1.pcm','tool-progress-2.pcm','tool-progress-3.pcm'].map(n=>'lab/realtime-direct-tools/assets/'+n));
names.push('lab/realtime-direct-tools/device-location.mjs','lab/realtime-direct-tools/lookup-recovery.mjs','lab/realtime-direct-tools/native-runtime.mjs','lab/realtime-direct-tools/task-progress.mjs','lab/realtime-direct-tools/search-result.mjs');
names.push('lab/realtime-direct-tools/native-interrupt.mjs','lab/realtime-direct-tools/native-duplex-policy.mjs');
names.push('lab/gpt-live-h5/ios-shell-release.json');
names.push('lab/realtime-direct-tools/xiaozhi-wire.mjs','lab/realtime-direct-tools/device-vision.mjs','lab/robot/robot-catalog.mjs','lab/robot/robot-reactions.mjs');
names.push('lib/call-summary.mjs','lib/ios-bindings.mjs','lib/conversation-calls.mjs','lib/conversation-replies.mjs','lib/phone-provisioning.mjs','lib/private-phone-file.mjs','lib/feishu-phone-login.mjs','lib/feishu-group-menu.mjs','lib/feishu-phone-tab.mjs','scripts/feishu-menu.mjs','scripts/phone.mjs');
names.push('lab/gpt-live-h5/caller-context.mjs','lib/feishu-caller-identity.mjs','lab/gpt-live-h5/feishu-client-login.mjs','lib/feishu-actor-gateway.mjs','lib/feishu-conversation-directory.mjs');
names.push('lib/terminal-context.mjs','lib/device-requests.mjs','lab/gpt-live-h5/device-location.mjs','scripts/device-call.mjs','skills/device-use/SKILL.md');
names.push('lab/robot/robot-device.mjs','lab/robot/robot-tools.mjs','lab/robot/robot-semantics.mjs',
 'skills/robot-use/SKILL.md',...['vision','motion','reaction'].map(n=>'skills/robot-use/references/'+n+'.md'));
const target=resolve(process.argv[2]??join(root,'artifacts',commit));
await mkdir(dirname(target),{recursive:true});
await mkdir(target,{recursive:false});
const files=[];
for(const name of [...new Set(names)].sort()){
 const bytes=await readFile(join(root,name)),dest=join(target,name);await mkdir(dirname(dest),{recursive:true});await copyFile(join(root,name),dest);
 files.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
const shell=JSON.parse(await readFile(join(root,'lab/gpt-live-h5/ios-shell-release.json'),'utf8'));
const ios=JSON.parse(await readFile(join(root,'docs/ios/versions.json'),'utf8'));
const clients={web:{node:'web'},ios:{node:'web',shellRevision:shell.revision,minimumBridge:shell.minimumBridge,maximumBridge:shell.maximumBridge,acceptedBuild:ios.lastAcceptedBuild??ios.currentDeviceCandidate?.lastAcceptedBuild??ios.build,nativeSourceCommit:ios.sourceCommit},robot:{node:'devices',protocol:'xiaozhi-v1',firmwareUpdate:'separate-if-required'},speaker:{node:'devices',protocol:'voice-device-v1',firmwareUpdate:'separate-if-required'}};
const manifest={clients,schema:'v-voice-release-v1',commit,baselineCommit:baseline.sourceCommit,gatewayProtocol:4,gatewayRestartRequired:false,
 entrypoint:'lab/gpt-live-h5/server.mjs',files,filesSha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({artifact:target,commit,files:files.length,bytes:files.reduce((a,f)=>a+f.bytes,0),filesSha256:manifest.filesSha256}));
