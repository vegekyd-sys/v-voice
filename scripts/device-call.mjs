#!/usr/bin/env node
// Backend Skill helper. Descriptor arrives on stdin, never from a browser.
import {readFileSync,realpathSync} from 'node:fs';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {dirname,resolve} from 'node:path';
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>24000)throw Error('Descriptor too large');}
const descriptor=JSON.parse(raw),{endpoint,lease,voiceSessionId}=descriptor,verify=process.argv[2]==='--verify-bundle';
let operation=process.argv[2],args=JSON.parse(verify?'{}':process.argv[3]??'{}');
if(verify){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),manifest=readFileSync(root+'/backend-device-bundle.json'),expected=process.argv[3];
 if(!/^[a-f0-9]{64}$/.test(expected)||expected!==descriptor.bundleSha256||createHash('sha256').update(manifest).digest('hex')!==expected)throw Error('Backend asset manifest mismatch');
 const parsed=JSON.parse(manifest);if(parsed.schema!=='v-voice-backend-device-bundle-v1'||!parsed.files?.some(f=>f.path==='scripts/device-call.mjs')||!parsed.files.some(f=>f.path==='skills/device-use/SKILL.md'))throw Error('Backend bundle incomplete');
 for(const file of parsed.files){const path=resolve(root,file.path);if(!path.startsWith(root+'/')||!realpathSync(path).startsWith(realpathSync(root)+'/')||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.sha256)throw Error('Backend asset hash mismatch');}
 if(typeof descriptor.probeChallenge!=='string'||descriptor.probeChallenge.length>80)throw Error('Missing current probe challenge');
 operation='device.probe';args={challenge:descriptor.probeChallenge};
}
const url=new URL(endpoint);
if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Invalid device endpoint');
const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lease,operation,args}),redirect:'error',signal:AbortSignal.timeout(verify?15000:185000)});
if(!response.ok)throw Error('Current device execution unavailable: '+response.status);
const result=await response.json();
if(verify){if(result.status!=='ok'||result.voiceSessionId!==voiceSessionId||result.result?.challenge!==args.challenge)throw Error('Current call network probe failed');process.stdout.write('VOICE_DEVICE_BUNDLE_PROBE '+JSON.stringify({verified:true,voiceSessionId,challenge:args.challenge,bundleSha256:descriptor.bundleSha256})+'\n');}
else process.stdout.write(JSON.stringify(result)+'\n');
