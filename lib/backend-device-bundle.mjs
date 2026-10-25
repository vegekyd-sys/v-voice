import {randomUUID} from 'node:crypto';
const hash=/^[a-f0-9]{64}$/;
export function backendDeviceBundleFromEnv(env=process.env){
 const root=env.VOICE_BACKEND_DEVICE_BUNDLE_ROOT,sha256=env.VOICE_BACKEND_DEVICE_MANIFEST_SHA256,node=env.VOICE_BACKEND_DEVICE_NODE??'node';
 if(!root||!sha256)return null;
 if(!root.startsWith('/')||root.includes('\0')||!hash.test(sha256)||!(node==='node'||node.startsWith('/'))||node.includes('\0'))return null;
 return {root:root.replace(/\/$/,''),sha256,node};
}
export function backendDeviceDescriptor({endpoint,lease,voiceSessionId},bundle){
 if(!bundle||!hash.test(bundle.sha256)||typeof bundle.root!=='string'||!bundle.root.startsWith('/'))return null;
 return {version:1,endpoint,lease,voiceSessionId,cli:bundle.root+'/scripts/device-call.mjs',skill:bundle.root+'/skills/device-use/SKILL.md',node:bundle.node??'node',bundleSha256:bundle.sha256};
}
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
function strings(value){if(typeof value==='string')return [value];if(Array.isArray(value))return value.flatMap(strings);if(value&&typeof value==='object')return Object.values(value).flatMap(strings);return [];}
export async function probeBackendDeviceBundle({gateway,agentId,sessionKey,descriptor}){
 const challenge=randomUUID(),input={...descriptor,probeChallenge:challenge};
 const command=`printf '%s' ${quote(JSON.stringify(input))} | ${quote(descriptor.node)} ${quote(descriptor.cli)} --verify-bundle ${quote(descriptor.bundleSha256)}`;
 const receipt=await gateway.request('tools.invoke',{name:'exec',agentId,sessionKey,args:{command,timeoutSeconds:15}},{timeoutMs:20000});
 if(receipt?.ok!==true)return false;
 for(const text of strings(receipt.output))for(const line of text.split('\n')){
  if(!line.startsWith('VOICE_DEVICE_BUNDLE_PROBE '))continue;
  try{const proof=JSON.parse(line.slice('VOICE_DEVICE_BUNDLE_PROBE '.length));if(proof.verified===true&&proof.challenge===challenge&&proof.voiceSessionId===descriptor.voiceSessionId&&proof.bundleSha256===descriptor.bundleSha256)return true;}catch{}
 }
 return false;
}
