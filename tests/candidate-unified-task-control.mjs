// Isolated VLab Candidate: real Agent, public SDK control, exact owner guard.
// No channels, purchases, external messages or shared Gateway writes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const runtime=process.env.VLAB_CANDIDATE_RUNTIME,state=process.env.OPENCLAW_STATE_DIR,configPath=process.env.OPENCLAW_CONFIG_PATH;
assert(runtime?.includes('/candidate-tests/runs/'));const core=path.join(runtime,'openclaw'),voice=path.join(runtime,'voice-task-control');fs.mkdirSync(voice,{mode:0o700});
execFileSync('tar',['-xzf','tmp/voice-unified-source.tgz','--no-same-owner','-C',voice]);
fs.mkdirSync(path.join(voice,'node_modules'),{recursive:true});fs.symlinkSync(path.join(core,'node_modules/ws'),path.join(voice,'node_modules/ws'));
fs.mkdirSync(path.join(voice,'plugins/v-voice-gpt-live/node_modules'),{recursive:true});fs.symlinkSync(core,path.join(voice,'plugins/v-voice-gpt-live/node_modules/openclaw'));
for(const key of ['cache','prefix']){const value=path.join(state,'npm-'+key);fs.mkdirSync(value,{recursive:true,mode:0o700});process.env['npm_config_'+key]=value;process.env['NPM_CONFIG_'+key.toUpperCase()]=value;}
for(const key of ['userconfig','globalconfig']){const value=path.join(state,'npm-'+key+'.conf');fs.writeFileSync(value,'',{mode:0o600});process.env['npm_config_'+key]=value;process.env['NPM_CONFIG_'+key.toUpperCase()]=value;}
const cfg=JSON.parse(fs.readFileSync(configPath));const modelArg=process.argv.indexOf('--model');const testModel=modelArg>=0?process.argv[modelArg+1]:undefined;if(testModel){assert(testModel==='azure-openai/gpt-5.5','Only the declared alternate integration model is allowed');assert([cfg.agents.defaults,cfg.agents.entries.makaron].some(a=>Object.hasOwn(a.models??{},testModel)),'Alternate model must already be registered in trusted Candidate config');for(const a of [cfg.agents.defaults,cfg.agents.entries.makaron,...(cfg.agents.list??[]).filter(a=>a.id==='makaron')])a.model={primary:testModel,fallbacks:[]};console.log(JSON.stringify({backendModelOverride:testModel,scope:'Public SDK integration only; production model selection unchanged'}));}cfg.channels={};cfg.cron={...(cfg.cron??{}),enabled:false};cfg.browser={...(cfg.browser??{}),enabled:false};
cfg.agents.defaults.heartbeat={every:'0m'};cfg.logging={...(cfg.logging??{}),file:path.join(state,'gateway.log')};
// Keep the actual selected parent model; omit unrelated provider/harness catalogs
// so the disposable native test cannot auto-install other sessions' plugins.
const makaron=cfg.agents.entries.makaron,selected=new Set();
const collect=v=>{if(typeof v==='string')selected.add(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')for(const k of ['primary','fallbacks'])collect(v[k]);};
collect(cfg.agents.defaults.model);collect(makaron.model);
cfg.agents.entries={makaron};if(Array.isArray(cfg.agents.list))cfg.agents.list=cfg.agents.list.filter(a=>a.id==='makaron');cfg.bindings=[];
const usedProviders=new Set([...selected].map(s=>s.split('/')[0]));usedProviders.add('openai');
if(cfg.models?.providers)cfg.models.providers=Object.fromEntries(Object.entries(cfg.models.providers).filter(([k])=>usedProviders.has(k)));
for(const a of [cfg.agents.defaults,makaron,...(cfg.agents.list??[])])if(a?.models)a.models=Object.fromEntries(Object.entries(a.models).filter(([k])=>selected.has(k)));
console.log(JSON.stringify({candidateSelectedModels:[...selected],channelsDisabled:true,cronDisabled:true}));
const allowed=new Set(['openai','google','deepseek','memory-core','v-voice-gpt-live','vlab-agent-worker-isolation']);
cfg.plugins.entries=Object.fromEntries(Object.entries(cfg.plugins.entries??{}).filter(([id])=>allowed.has(id)));
cfg.plugins.entries['v-voice-gpt-live']={enabled:true};cfg.plugins.allow=[...allowed];
const providerPaths=(cfg.plugins.load?.paths??[]).filter(p=>{try{const id=JSON.parse(fs.readFileSync(path.join(p,'openclaw.plugin.json'))).id;return allowed.has(id)&&id!=='v-voice-gpt-live';}catch{return false;}});
cfg.plugins.load={paths:[...providerPaths,path.join(voice,'plugins/v-voice-gpt-live')]};
for(const a of [cfg.agents.defaults,...Object.values(cfg.agents.entries??{}),...(cfg.agents.list??[])])if(a)a.heartbeat={every:'0m'};
// Preserve the selected vlab-worker harness, using its own config and state copy.
process.env.VLAB_OPENCLAW_AGENT_RUNTIME=path.join(core,'dist/plugin-sdk/agent-runtime.js');
const worker=cfg.plugins.entries['vlab-agent-worker-isolation']?.config;assert(worker?.workerConfigPath,'Selected Worker harness needs its Candidate configuration');
const rel=path.relative(state,worker.workerConfigPath);assert(!rel.startsWith('..'));
const wc=JSON.parse(fs.readFileSync(path.join(process.env.VLAB_SHARED_STATE_DIR,rel),'utf8').replaceAll(process.env.VLAB_SHARED_STATE_DIR,state).replaceAll('/srv/vlab-production-mirror/labs/instances/db91-parity/runtime',runtime));
wc.channels={};wc.cron={...(wc.cron??{}),enabled:false};wc.browser={...(wc.browser??{}),enabled:false};
if(testModel)for(const a of [wc.agents.defaults,wc.agents.entries.makaron,...(wc.agents.list??[]).filter(a=>a.id==='makaron')])a.model={primary:testModel,fallbacks:[]};
wc.agents.entries={makaron:wc.agents.entries.makaron};if(Array.isArray(wc.agents.list))wc.agents.list=wc.agents.list.filter(a=>a.id==='makaron');wc.bindings=[];
const ws=new Set();const add=v=>{if(typeof v==='string')ws.add(v);else if(Array.isArray(v))v.forEach(add);else if(v&&typeof v==='object')for(const k of ['primary','fallbacks'])add(v[k]);};add(wc.agents.defaults.model);add(wc.agents.entries.makaron.model);
const wp=new Set([...ws].map(s=>s.split('/')[0]));wp.add('openai');if(wc.models?.providers)wc.models.providers=Object.fromEntries(Object.entries(wc.models.providers).filter(([k])=>wp.has(k)));
for(const a of [wc.agents.defaults,wc.agents.entries.makaron,...(wc.agents.list??[])]){a.heartbeat={every:'0m'};if(a.models)a.models=Object.fromEntries(Object.entries(a.models).filter(([k])=>ws.has(k)));if(a!==wc.agents.defaults){a.workspace=makaron.workspace;a.agentDir=makaron.agentDir;}}
wc.agents.defaults.workspace=cfg.agents.defaults.workspace;wc.plugins??={};wc.plugins.entries=Object.fromEntries(Object.entries(wc.plugins.entries??{}).filter(([id])=>allowed.has(id)&&!['vlab-agent-worker-isolation','v-voice-gpt-live'].includes(id)));wc.plugins.allow=[...allowed].filter(id=>!['vlab-agent-worker-isolation','v-voice-gpt-live'].includes(id));
wc.plugins.load={paths:providerPaths.filter(p=>{try{return !['vlab-agent-worker-isolation','v-voice-gpt-live'].includes(JSON.parse(fs.readFileSync(path.join(p,'openclaw.plugin.json'))).id);}catch{return false;}})};
wc.logging={...(wc.logging??{}),file:path.join(state,'worker-gateway.log')};
wc.tools={...(wc.tools??{}),deny:[...new Set([...(wc.tools?.deny??[]),'message','cron'])]};
fs.mkdirSync(path.dirname(worker.workerConfigPath),{recursive:true});fs.writeFileSync(worker.workerConfigPath,JSON.stringify(wc),{mode:0o600});
worker.gatewayConfigPath=configPath;Object.assign(worker,{minWorkers:1,maxWorkers:1,warmSpareWorkers:0});
console.log(JSON.stringify({candidateWorkerModels:[...ws],workerHarnessPreserved:true}));

fs.writeFileSync(configPath,JSON.stringify(cfg),{mode:0o600});
const out=fs.openSync(path.join(state,'gateway-output.log'),'a',0o600),gateway=spawn(process.execPath,[core+'/dist/index.js','gateway','--port',String(cfg.gateway.port)],{env:process.env,stdio:['ignore',out,out]});
const {GatewayClient}=await import(core+'/dist/plugin-sdk/gateway-runtime.js');let client,foreign;const events=[],report={sdkController:'openclaw/plugin-sdk/realtime-voice.controlRealtimeVoiceAgentRun',sharedGatewayTouched:false,results:[]};
async function connect(){for(let i=0;i<90;i++){
 if(gateway.exitCode!==null)throw Error('Candidate Gateway exited: '+gateway.exitCode);
 const ready=Promise.withResolvers();const c=new GatewayClient({url:'ws://127.0.0.1:'+cfg.gateway.port,token:String(cfg.gateway.auth.token).replace(/\$\{([^}]+)\}/g,(_,k)=>process.env[k]??''),deviceIdentity:null,clientName:'cli',mode:'cli',scopes:['operator.read','operator.write'],caps:['voice-direct-tools','tool-events'],onHelloOk:ready.resolve,onConnectError:ready.reject,onEvent:e=>events.push(e)});c.start();
 try{await Promise.race([ready.promise,delay(1000).then(()=>{throw Error('connect timeout');})]);return c;}catch{c.stop();await delay(1000);}
 }throw Error('Candidate Gateway readiness timed out');}
try{
 client=await connect();foreign=await connect();
 const voiceSessionId=randomUUID(),runId='voice-'+voiceSessionId+'-'+randomUUID(),sessionKey='agent:makaron:explicit:voice-control-'+randomUUID();
 const prompt='只做这次隔离测试：先用 exec 执行 sleep 12。工具完成后，最终只回复 CONTROL_OLD。等待时如收到用户的新条件，以最新条件为准。不要外部发送、不要写文件、不要启动子任务。';
 const ack=await client.request('chat.send',{agentId:'makaron',sessionKey,message:prompt,thinking:'off',deliver:false,idempotencyKey:runId},{timeoutMs:30000});assert.equal(ack.runId,runId);
 for(let i=0;i<1200&&!events.some(e=>e.event==='agent'&&e.payload?.runId===runId&&e.payload.stream==='tool');i++){const failure=events.find(e=>e.payload?.runId===runId&&(e.event==='chat'&&e.payload.state==='error'||e.event==='agent'&&e.payload.stream==='lifecycle'&&e.payload.data?.phase==='error'));assert(!failure,'Backend run failed before its tool step');await delay(100);}
 assert(events.some(e=>e.event==='agent'&&e.payload?.runId===runId&&e.payload.stream==='tool'),'Real task never reached its tool step');
 const base={voiceSessionId,runId,sessionKey};
 let rejected=false;try{await foreign.request('voice.product.task-control',{...base,mode:'steer',text:'FORBIDDEN_FOREIGN'},{timeoutMs:15000});}catch{rejected=true;}assert(rejected);
 const status=await client.request('voice.product.task-control',{...base,mode:'status',text:'现在的进度是什么'},{timeoutMs:15000});console.log(JSON.stringify({stage:'status',result:status}));assert.equal(status.ok,true);assert.equal(status.active,true);
 let steer;for(let i=0;i<20;i++){steer=await client.request('voice.product.task-control',{...base,mode:'steer',text:'最新明确修正：最终不要回复 CONTROL_OLD，只回复 CONTROL_NEW。'},{timeoutMs:15000});if(steer.queued||!['runtime_rejected','not_streaming'].includes(steer.reason))break;await delay(500);}console.log(JSON.stringify({stage:'steer',result:steer}));assert.equal(steer.ok,true);assert.equal(steer.queued,true);assert.equal(steer.applied,false);
 const followup=await client.request('voice.product.task-control',{...base,mode:'followup',text:'在原任务按最新条件完成的结果之后追加 FOLLOWUP_OK，只增加这个标记，不覆盖之前的修正。'},{timeoutMs:15000});console.log(JSON.stringify({stage:'followup',result:followup}));assert.equal(followup.ok,true);assert.equal(followup.queued,true);
 let final;
 for(let i=0;i<1200&&!final;i++){final=events.find(e=>e.event==='chat'&&e.payload?.runId===runId&&e.payload.state==='final');if(!final)await delay(100);}
 assert(final,'Original run never returned its final');const m=final.payload.message;const text=typeof m.content==='string'?m.content:(m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
 assert.match(text,/CONTROL_NEW/);assert.match(text,/FOLLOWUP_OK/);assert.doesNotMatch(text,/CONTROL_OLD|FORBIDDEN_FOREIGN/);
 report.results.push({runId,statusActive:status.active,steerAccepted:steer.queued,followupAccepted:followup.queued,final:text,foreignRejected:rejected,originalRunPreserved:true});
 fs.writeFileSync(path.join(state,'unified-control-report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}catch(error){
 const tail=fs.readFileSync(path.join(state,'gateway-output.log'),'utf8').slice(-5500).replace(/(token|api.?key|authorization|secret|password)[=: ]+[^\s]+/giu,'$1=[redacted]').replace(/https?:\/\/\S+/giu,'[endpoint]');console.error(JSON.stringify({candidateError:error.message,observedEvents:events.slice(-15).map(e=>({event:e.event,runId:e.payload?.runId,stream:e.payload?.stream,state:e.payload?.state})),gatewayLog:tail}));throw error;
}finally{
 client?.stop();foreign?.stop();gateway.kill('SIGTERM');for(let i=0;i<100&&gateway.exitCode===null;i++)await delay(100);if(gateway.exitCode===null)gateway.kill('SIGKILL');fs.closeSync(out);
}
