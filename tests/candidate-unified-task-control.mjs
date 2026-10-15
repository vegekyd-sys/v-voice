// Isolated VLab Candidate: real Agent, public SDK control, exact owner guard.
// No channels, purchases, external messages or shared Gateway writes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn,spawnSync,execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const runtime=process.env.VLAB_CANDIDATE_RUNTIME,state=process.env.OPENCLAW_STATE_DIR,configPath=process.env.OPENCLAW_CONFIG_PATH;
assert(process.argv.includes('--model'),'Choose an explicit non-DeepSeek --model for this Candidate test');
assert(runtime?.includes('/candidate-tests/runs/'));const core=path.join(runtime,'openclaw'),voice=path.join(runtime,'voice-task-control');fs.mkdirSync(voice,{mode:0o700});
execFileSync('tar',['-xzf','tmp/voice-unified-source.tgz','--no-same-owner','-C',voice]);
fs.mkdirSync(path.join(voice,'node_modules'),{recursive:true});fs.symlinkSync(path.join(core,'node_modules/ws'),path.join(voice,'node_modules/ws'));
fs.mkdirSync(path.join(voice,'plugins/v-voice-gpt-live/node_modules'),{recursive:true});fs.symlinkSync(core,path.join(voice,'plugins/v-voice-gpt-live/node_modules/openclaw'));
for(const key of ['cache','prefix']){const value=path.join(state,'npm-'+key);fs.mkdirSync(value,{recursive:true,mode:0o700});process.env['npm_config_'+key]=value;process.env['NPM_CONFIG_'+key.toUpperCase()]=value;}
for(const key of ['userconfig','globalconfig']){const value=path.join(state,'npm-'+key+'.conf');fs.writeFileSync(value,'',{mode:0o600});process.env['npm_config_'+key]=value;process.env['NPM_CONFIG_'+key.toUpperCase()]=value;}
const boundedOutput=process.argv.includes('--bounded-output');
const cfg=JSON.parse(fs.readFileSync(configPath));
if(process.argv.includes('--model')&&process.argv[process.argv.indexOf('--model')+1]?.startsWith('openai/')){
 const install=spawnSync(process.execPath,[path.join(core,'dist/index.js'),'plugins','install','@openclaw/codex@2026.9.1','--pin','--force','--accept-capabilities','--acknowledge-install-policy-warning'],{env:process.env,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});
 assert.equal(install.status,0,'Private Codex harness registration failed');Object.assign(cfg,JSON.parse(fs.readFileSync(configPath)));
 const project=root=>fs.readdirSync(path.join(root,'npm/projects')).find(n=>n.startsWith('openclaw-codex-'));
 const src=project(process.env.VLAB_SHARED_STATE_DIR),dst=project(state);assert(src&&dst);
 fs.cpSync(path.join(process.env.VLAB_SHARED_STATE_DIR,'npm/projects',src,'node_modules/@openclaw/codex/dist'),path.join(state,'npm/projects',dst,'node_modules/@openclaw/codex/dist'),{recursive:true});
 cfg.plugins.entries.codex.config??={};cfg.plugins.entries.codex.config.appServer??={};cfg.plugins.entries.codex.config.appServer.homeScope='agent';cfg.plugins.entries.codex.config.codexPlugins={enabled:false};
 console.log(JSON.stringify({alternateHarness:'private Codex registration with shared patched code; no shared writes'}));
}
if(boundedOutput){for(const provider of Object.values(cfg.models?.providers??{}))for(const model of provider.models??[])model.maxTokens=Math.min(model.maxTokens??2048,2048);console.log(JSON.stringify({candidateOutputBudget:2048,functionalControlTest:true}));}const modelArg=process.argv.indexOf('--model');const testModel=modelArg>=0?process.argv[modelArg+1]:undefined;if(testModel){assert(['openai/gpt-6-luna','openrouter/google/gemini-3.5-flash'].includes(testModel),'Only the declared alternate integration model is allowed');assert([cfg.agents.defaults,cfg.agents.entries.makaron].some(a=>Object.hasOwn(a.models??{},testModel)||(testModel.startsWith('openai/')&&Object.hasOwn(a.models??{},'openai/*'))),'Alternate model must already be allowed in trusted Candidate config');for(const a of [cfg.agents.defaults,cfg.agents.entries.makaron,...(cfg.agents.list??[]).filter(a=>a.id==='makaron')])a.model={primary:testModel,fallbacks:[]};console.log(JSON.stringify({backendModelOverride:testModel,scope:'Public SDK integration only; production model selection unchanged'}));}cfg.channels={};cfg.cron={...(cfg.cron??{}),enabled:false};cfg.browser={...(cfg.browser??{}),enabled:false};
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
const allowed=new Set(['codex','openrouter','openai','google','deepseek','memory-core','v-voice-gpt-live','vlab-agent-worker-isolation']);
if(!testModel?.startsWith('openai/'))allowed.delete('codex');
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
if(boundedOutput)for(const provider of Object.values(wc.models?.providers??{}))for(const model of provider.models??[])model.maxTokens=Math.min(model.maxTokens??2048,2048);
wc.channels=structuredClone(cfg.channels);wc.cron={...(wc.cron??{}),enabled:false};wc.browser={...(wc.browser??{}),enabled:false};
if(testModel)for(const a of [wc.agents.defaults,wc.agents.entries.makaron,...(wc.agents.list??[]).filter(a=>a.id==='makaron')])a.model={primary:testModel,fallbacks:[]};
wc.agents.entries={makaron:wc.agents.entries.makaron};if(Array.isArray(wc.agents.list))wc.agents.list=wc.agents.list.filter(a=>a.id==='makaron');wc.bindings=[];
const ws=new Set();const add=v=>{if(typeof v==='string')ws.add(v);else if(Array.isArray(v))v.forEach(add);else if(v&&typeof v==='object')for(const k of ['primary','fallbacks'])add(v[k]);};add(wc.agents.defaults.model);add(wc.agents.entries.makaron.model);
const wp=new Set([...ws].map(s=>s.split('/')[0]));wp.add('openai');if(wc.models?.providers)wc.models.providers=Object.fromEntries(Object.entries(wc.models.providers).filter(([k])=>wp.has(k)));
for(const a of [wc.agents.defaults,wc.agents.entries.makaron,...(wc.agents.list??[])]){a.heartbeat={every:'0m'};if(a.models)a.models=Object.fromEntries(Object.entries(a.models).filter(([k])=>ws.has(k)));if(a!==wc.agents.defaults){a.workspace=makaron.workspace;a.agentDir=makaron.agentDir;}}
wc.agents.defaults.workspace=cfg.agents.defaults.workspace;wc.plugins??={};wc.plugins.entries=Object.fromEntries(Object.entries(wc.plugins.entries??{}).filter(([id])=>allowed.has(id)&&!['vlab-agent-worker-isolation','v-voice-gpt-live'].includes(id)));wc.plugins.allow=[...allowed].filter(id=>!['vlab-agent-worker-isolation','v-voice-gpt-live'].includes(id));
wc.plugins.load={paths:providerPaths.filter(p=>{try{return !['vlab-agent-worker-isolation','v-voice-gpt-live'].includes(JSON.parse(fs.readFileSync(path.join(p,'openclaw.plugin.json'))).id);}catch{return false;}})};
if(testModel&&cfg.plugins.entries.codex)wc.plugins.entries.codex=cfg.plugins.entries.codex;
wc.logging={...(wc.logging??{}),file:path.join(state,'worker-gateway.log')};
wc.tools={...(wc.tools??{}),deny:[...new Set([...(wc.tools?.deny??[]),'message','cron'])]};
fs.mkdirSync(path.dirname(worker.workerConfigPath),{recursive:true});fs.writeFileSync(worker.workerConfigPath,JSON.stringify(wc),{mode:0o600});
worker.gatewayConfigPath=configPath;Object.assign(worker,{minWorkers:1,maxWorkers:1,warmSpareWorkers:0});
console.log(JSON.stringify({candidateWorkerModels:[...ws],workerHarnessPreserved:true}));

fs.writeFileSync(configPath,JSON.stringify(cfg),{mode:0o600});
// Use a temporary, access-only profile staged privately on this host. Never refresh
// production credentials or copy conversation data into this isolated test.
if(testModel){
 const authFile=process.env.VOICE_CANDIDATE_AUTH_FILE;assert(authFile,'Private alternate-model auth profile is required');
 const profile=JSON.parse(fs.readFileSync(authFile));fs.unlinkSync(authFile);
 if(testModel.startsWith('openrouter/')){
  assert(profile.provider==='openrouter'&&profile.token,'Private OpenRouter token required');
  const model={id:'google/gemini-3.5-flash',name:'Gemini 3.5 Flash Candidate',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:262144,maxTokens:2048};
  const provider={baseUrl:'https://openrouter.ai/api/v1',api:'openai-completions',apiKey:profile.token,models:[model]};cfg.models.providers.openrouter=provider;wc.models.providers.openrouter=structuredClone(provider);
  fs.writeFileSync(worker.workerConfigPath,JSON.stringify(wc),{mode:0o600});
 }else{
 assert(profile.provider==='openai'&&profile.type==='oauth'&&profile.access&&profile.expires>Date.now()+600000&&!profile.refresh,'Only an unexpired access-only profile is allowed');
 const {DatabaseSync}=await import('node:sqlite');const authPath=path.join(makaron.agentDir,'openclaw-agent.sqlite');fs.mkdirSync(makaron.agentDir,{recursive:true,mode:0o700});
 const db=new DatabaseSync(authPath),maintenance=fs.readdirSync(path.join(core,'dist')).find(n=>/^openclaw-agent-db-maintenance-.*\.js$/.test(n));
 const {a:ensureAgentSchema}=await import(path.join(core,'dist',maintenance));ensureAgentSchema(db,'makaron',authPath);
 db.prepare('INSERT OR REPLACE INTO auth_profile_store (store_key,store_json,updated_at) VALUES (?,?,?)').run('primary',JSON.stringify({version:1,profiles:{'openai:candidate-access-only':profile}}),Date.now());db.close();fs.chmodSync(authPath,0o600);
 cfg.auth={profiles:{'openai:candidate-access-only':{provider:'openai',mode:'oauth'}}};wc.auth=cfg.auth;
 fs.writeFileSync(worker.workerConfigPath,JSON.stringify(wc),{mode:0o600});
 }
 console.log(JSON.stringify({alternateAuth:'private-test-only',refreshCredentialCopied:false}));
}
// Persist via OpenClaw's supported writer after plugin registration. Direct
// JSON edits can be replaced by the registry's saved configuration generation.
const configRuntime=await import(path.join(core,'dist/plugin-sdk/config-runtime.js'));
await configRuntime.writeConfigFile(cfg);configRuntime.clearConfigCache();
const saved=configRuntime.loadConfig();assert.deepEqual(saved.channels,cfg.channels);assert.equal(saved.agents.defaults.model.primary,cfg.agents.defaults.model.primary);
execFileSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import assert from 'node:assert/strict';const rt=await import(${JSON.stringify(path.join(core,'dist/plugin-sdk/config-runtime.js'))});const c=JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH));await rt.writeConfigFile(c);rt.clearConfigCache();assert.deepEqual(rt.loadConfig().channels,c.channels);`],{env:{...process.env,OPENCLAW_CONFIG_PATH:worker.workerConfigPath},stdio:'pipe',timeout:30000});
console.log(JSON.stringify({privateConfigPersisted:true}));
const out=fs.openSync(path.join(state,'gateway-output.log'),'a',0o600),gateway=spawn(process.execPath,[core+'/dist/index.js','gateway','--port',String(cfg.gateway.port)],{env:process.env,stdio:['ignore',out,out]});
const {GatewayClient}=await import(core+'/dist/plugin-sdk/gateway-runtime.js');let client,foreign;const events=[],report={sdkController:'openclaw/plugin-sdk/realtime-voice.controlRealtimeVoiceAgentRun',sharedGatewayTouched:false,results:[]};
async function connect(){for(let i=0;i<90;i++){
 if(gateway.exitCode!==null)throw Error('Candidate Gateway exited: '+gateway.exitCode);
 const ready=Promise.withResolvers();const c=new GatewayClient({url:'ws://127.0.0.1:'+cfg.gateway.port,token:String(cfg.gateway.auth.token).replace(/\$\{([^}]+)\}/g,(_,k)=>process.env[k]??''),deviceIdentity:null,clientName:'cli',mode:'cli',scopes:['operator.read','operator.write'],caps:['voice-direct-tools','tool-events'],onHelloOk:ready.resolve,onConnectError:ready.reject,onEvent:e=>events.push(e)});c.start();
 try{await Promise.race([ready.promise,delay(1000).then(()=>{throw Error('connect timeout');})]);return c;}catch{c.stop();await delay(1000);}
 }throw Error('Candidate Gateway readiness timed out');}
async function runScenario({name,prompt,steerText,followupText,check}) {
 const started=Date.now(),voiceSessionId=randomUUID(),runId='voice-'+voiceSessionId+'-'+randomUUID(),sessionKey='agent:makaron:explicit:voice-control-'+randomUUID();
 const timeline=[];const mark=(action,details)=>{const row={ms:Date.now()-started,action,...details};timeline.push(row);console.log(JSON.stringify({scenario:name,...row}));};
 if(testModel)await client.request('sessions.patch',{key:sessionKey,model:testModel},{timeoutMs:45000});
 const ack=await client.request('chat.send',{agentId:'makaron',sessionKey,message:prompt,thinking:testModel?.startsWith('openrouter/')?'off':'low',deliver:false,idempotencyKey:runId},{timeoutMs:30000});assert.equal(ack.runId,runId);mark('start',{request:prompt});
 for(let i=0;i<600&&!events.some(e=>e.event==='agent'&&e.payload?.runId===runId&&e.payload.stream==='tool');i++){
  const failure=events.find(e=>e.payload?.runId===runId&&(e.event==='chat'&&['error','aborted','final'].includes(e.payload.state)||e.event==='agent'&&e.payload.stream==='lifecycle'&&e.payload.data?.phase==='error'));if(failure){const safe=JSON.stringify(failure.payload?.message??failure.payload?.data??failure.payload?.error??{}).replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]');throw Error('Backend ended before its requested tool step: '+safe.slice(0,1800));}await delay(100);
 }
 assert(events.some(e=>e.event==='agent'&&e.payload?.runId===runId&&e.payload.stream==='tool'),'Real task never reached its tool step within 60s');mark('tool-start',{});
 const base={voiceSessionId,runId,sessionKey};
 let rejected=false;try{await foreign.request('voice.product.task-control',{...base,mode:'steer',text:'FORBIDDEN_FOREIGN'},{timeoutMs:45000});}catch{rejected=true;}assert(rejected);mark('foreign-rejected',{});
 const status=await client.request('voice.product.task-control',{...base,mode:'status',text:'现在的进度是什么'},{timeoutMs:45000});assert.equal(status.ok,true);assert.equal(status.active,true);mark('status',{active:status.active});
 let steer;for(let i=0;i<20;i++){steer=await client.request('voice.product.task-control',{...base,mode:'steer',text:steerText},{timeoutMs:45000});if(steer.queued||!['runtime_rejected','not_streaming'].includes(steer.reason))break;await delay(500);}assert.equal(steer.ok,true);assert.equal(steer.queued,true);assert.equal(steer.applied,false);mark('steer',{request:steerText,queued:true,applied:false});
 const followup=await client.request('voice.product.task-control',{...base,mode:'followup',text:followupText},{timeoutMs:45000});assert.equal(followup.ok,true);assert.equal(followup.queued,true);assert.equal(followup.applied,false);mark('followup',{request:followupText,queued:true,applied:false});
 let final;
 for(let i=0;i<900&&!final;i++){const failure=events.find(e=>e.event==='chat'&&e.payload?.runId===runId&&['error','aborted'].includes(e.payload.state));assert(!failure,'Original run failed while applying conditions');final=events.find(e=>e.event==='chat'&&e.payload?.runId===runId&&e.payload.state==='final');if(!final)await delay(100);}
 assert(final,'Original run never returned its final within 90s');const m=final.payload.message;const text=typeof m.content==='string'?m.content:(m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
 const proof=await check(text);mark('final',{result:text,...proof});
 await delay(100);let staleRejected=false;try{const r=await client.request('voice.product.task-control',{...base,mode:'steer',text:'STALE_CHANGE'},{timeoutMs:45000});staleRejected=r.ok!==true&&r.queued!==true;}catch{staleRejected=true;}assert(staleRejected,'Finished owner must not accept later conditions');mark('stale-rejected',{});
 const result={name,runId,statusActive:true,steerAccepted:true,followupAccepted:true,foreignRejected:true,staleRejected,originalRunPreserved:true,timeline};report.results.push(result);console.log(JSON.stringify(result));
}
try{
 client=await connect();foreign=await connect();
 const actual=await client.request('config.get',{}, {timeoutMs:45000});const live=actual.config??actual.parsed??actual;
 assert(live.channels&&Object.values(live.channels).every(c=>c.enabled===false),'Private Gateway unexpectedly enabled a channel; refusing to send any task');
 assert.equal(live.plugins.entries['vlab-agent-worker-isolation'].config.maxWorkers,1,'Private Worker config was not retained');
 console.log(JSON.stringify({liveConfigVerified:true,channelsDisabled:true,maxWorkers:1}));
 await runScenario({name:'same-run-markers',prompt:'只做这次隔离测试：先用 exec 执行 sleep 12。工具完成后，最终只回复 CONTROL_OLD。等待时如收到用户的新条件，以最新条件为准。不要外部发送、不要写文件、不要启动子任务。',
  steerText:'最新明确修正：最终不要回复 CONTROL_OLD，只回复 CONTROL_NEW。',followupText:'在原任务按最新条件完成的结果之后追加 FOLLOWUP_OK，只增加这个标记，不覆盖之前的修正。',
  check:async text=>{assert.match(text,/CONTROL_NEW/);assert.match(text,/FOLLOWUP_OK/);assert.doesNotMatch(text,/CONTROL_OLD|FORBIDDEN_FOREIGN/);return {};}});
 const proofFile=path.join(makaron.workspace,'candidate-control-result.json');assert(proofFile.includes('/candidate-tests/runs/'));
 await runScenario({name:'changed-budget-and-added-rain-plan',prompt:`这次只做隔离测试，不要外部发送、不要调用子任务。先用 exec 执行 sleep 12，再用 exec 在 ${proofFile} 写一个 JSON 文件，初始要求是 budget:1000、rainPlan:false。等待时用户可能改变要求，必须使用最新要求写文件。最终简短报告结果。`,
  steerText:'预算改成500元，保持原任务，最终文件的 budget 必须是数字500。',followupText:'原任务完成时再加上雨天备选，把同一个文件的 rainPlan 写成 true，不覆盖刚才改过的预算。',
  check:async text=>{assert(fs.existsSync(proofFile),'The Agent did not execute the requested file write');const artifact=JSON.parse(fs.readFileSync(proofFile));console.log(JSON.stringify({observedArtifact:artifact}));assert.equal(artifact.budget,500);assert.equal(artifact.rainPlan,true);return {artifact};}});
 fs.writeFileSync(path.join(state,'unified-control-report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}catch(error){
 const tail=fs.readFileSync(path.join(state,'gateway-output.log'),'utf8').slice(-5500).replace(/(token|api.?key|authorization|secret|password)[=: ]+[^\s]+/giu,'$1=[redacted]').replace(/https?:\/\/\S+/giu,'[endpoint]');console.error(JSON.stringify({candidateError:error.message,observedEvents:events.slice(-15).map(e=>({event:e.event,runId:e.payload?.runId,stream:e.payload?.stream,state:e.payload?.state})),gatewayLog:tail}));throw error;
}finally{
 client?.stop();foreign?.stop();gateway.kill('SIGTERM');for(let i=0;i<100&&gateway.exitCode===null;i++)await delay(100);if(gateway.exitCode===null)gateway.kill('SIGKILL');fs.closeSync(out);
}

await new Promise(resolve=>process.stdout.write('',resolve));process.exit(0);
