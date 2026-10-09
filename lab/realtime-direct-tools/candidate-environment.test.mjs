import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {isolateCandidateAgentRuntime,candidateLarkEnvironment} from './candidate-environment.mjs';
test('an inherited shared SDK is replaced by the private runtime before Worker spawn',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-sdk-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const sdk=path.join(root,'openclaw/dist/plugin-sdk/agent-runtime.js');fs.mkdirSync(path.dirname(sdk),{recursive:true});fs.writeFileSync(sdk,'private sdk');
 const env={VLAB_OPENCLAW_AGENT_RUNTIME:'/shared/runtime/agent-runtime.js',SELECTED_MODEL:'unchanged'};const proof=isolateCandidateAgentRuntime(env,root);assert.equal(proof.inherited,'/shared/runtime/agent-runtime.js');assert.equal(env.VLAB_OPENCLAW_AGENT_RUNTIME,fs.realpathSync(sdk));assert.equal(env.SELECTED_MODEL,'unchanged');assert.equal(proof.sha256.length,64);
 fs.unlinkSync(sdk);fs.symlinkSync(import.meta.filename,sdk);assert.throws(()=>isolateCandidateAgentRuntime({},root),/escaped/);
});
test('Lark identity uses only an explicit private paired config and data copy',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-lark-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const config=path.join(root,'config'),data=path.join(root,'data');for(const p of [config,data])fs.mkdirSync(p,{mode:0o700});
 assert.throws(()=>candidateLarkEnvironment({DIRECT_LARK_CLI_CONFIG_DIR:config,DIRECT_LARK_CLI_DATA_DIR:data}),/base containing/);
 const workspace=path.join(config,'openclaw');fs.mkdirSync(workspace,{mode:0o700});fs.writeFileSync(path.join(workspace,'config.json'),'{"apps":[]}',{mode:0o600});
 assert.throws(()=>candidateLarkEnvironment({DIRECT_LARK_CLI_CONFIG_DIR:workspace,DIRECT_LARK_CLI_DATA_DIR:data}),/base containing/);
 assert.deepEqual(candidateLarkEnvironment({}),{});assert.throws(()=>candidateLarkEnvironment({DIRECT_LARK_CLI_CONFIG_DIR:config}),/paired/);assert.deepEqual(candidateLarkEnvironment({DIRECT_LARK_CLI_CONFIG_DIR:config,DIRECT_LARK_CLI_DATA_DIR:data}),{LARKSUITE_CLI_CONFIG_DIR:config,LARKSUITE_CLI_DATA_DIR:data});fs.chmodSync(data,0o755);assert.throws(()=>candidateLarkEnvironment({DIRECT_LARK_CLI_CONFIG_DIR:config,DIRECT_LARK_CLI_DATA_DIR:data}),/private/);
});
