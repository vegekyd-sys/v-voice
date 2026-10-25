import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,copyFile,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash,randomBytes} from 'node:crypto';import {createServer} from 'node:http';import {exec} from 'node:child_process';import {promisify} from 'node:util';
import {backendDeviceBundleFromEnv,backendDeviceDescriptor,probeBackendDeviceBundle} from './backend-device-bundle.mjs';
const run=promisify(exec),hash=x=>createHash('sha256').update(x).digest('hex');
test('a backend descriptor requires explicit trusted bundle mapping',()=>{
 assert.equal(backendDeviceBundleFromEnv({}),null);assert.equal(backendDeviceBundleFromEnv({VOICE_BACKEND_DEVICE_BUNDLE_ROOT:'/mapped'}),null);
 assert.equal(backendDeviceDescriptor({endpoint:'https://voice.invalid/internal/device-request'},null),null);
 const b=backendDeviceBundleFromEnv({VOICE_BACKEND_DEVICE_BUNDLE_ROOT:'/actual/backend/root',VOICE_BACKEND_DEVICE_MANIFEST_SHA256:'a'.repeat(64)});
 assert.equal(backendDeviceDescriptor({endpoint:'https://voice.invalid/internal/device-request',lease:'l',voiceSessionId:'call'},b).cli,'/actual/backend/root/scripts/device-call.mjs');
});
test('real helper validates bundle hashes and authenticated call network before publication',async t=>{
 const root=await mkdtemp(join(tmpdir(),'voice-backend-bundle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const files=[];for(const path of ['scripts/device-call.mjs','skills/device-use/SKILL.md']){const bytes=await readFile(new URL('../'+path,import.meta.url));await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),bytes);files.push({path,sha256:hash(bytes),bytes:bytes.length});}
 const raw=JSON.stringify({schema:'v-voice-backend-device-bundle-v1',sourceCommit:'a'.repeat(40),files});await writeFile(root+'/backend-device-bundle.json',raw);
 const lease=randomBytes(32).toString('base64url');let current=true,requests=0;
 const server=createServer(async(req,res)=>{let input='';for await(const c of req)input+=c;const data=JSON.parse(input);requests++;if(!current||data.lease!==lease){res.writeHead(403);res.end('{}');return;}assert.equal(data.operation,'device.probe');res.end(JSON.stringify({status:'ok',voiceSessionId:'call',result:{challenge:data.args.challenge}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const descriptor=backendDeviceDescriptor({endpoint:`http://127.0.0.1:${server.address().port}/internal/device-request`,lease,voiceSessionId:'call'},{root,sha256:hash(raw),node:process.execPath});
 const gateway={request:async(method,params)=>{assert.equal(method,'tools.invoke');assert.equal(params.name,'exec');assert.equal(params.agentId,'bound-agent');assert.equal(params.sessionKey,'bound-session');try{const result=await run(params.args.command);return {ok:true,output:{content:[{text:result.stdout}]}};}catch{return {ok:false};}}};
 const probe=()=>probeBackendDeviceBundle({gateway,agentId:'bound-agent',sessionKey:'bound-session',descriptor});
 assert.equal(await probe(),true);assert.equal(requests,1);
 await writeFile(root+'/skills/device-use/SKILL.md','changed');assert.equal(await probe(),false);assert.equal(requests,1);
 await copyFile(new URL('../skills/device-use/SKILL.md',import.meta.url),root+'/skills/device-use/SKILL.md');current=false;assert.equal(await probe(),false);assert.equal(requests,2);
});
