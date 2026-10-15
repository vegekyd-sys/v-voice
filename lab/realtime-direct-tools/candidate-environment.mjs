import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// The runner inherits the shared Gateway environment. Worker SDK imports must
// follow the private runtime, including when an inherited absolute SDK wins
// over the config paths that the runner already relocated.
export function isolateCandidateAgentRuntime(env, runtime) {
  const root=fs.realpathSync(runtime);
  const sdk=fs.realpathSync(path.join(root,'openclaw/dist/plugin-sdk/agent-runtime.js'));
  assert(sdk.startsWith(root+'/'),'Candidate SDK escaped its runtime');
  const inherited=env.VLAB_OPENCLAW_AGENT_RUNTIME??null;
  env.VLAB_OPENCLAW_AGENT_RUNTIME=sdk;
  return {inherited,selected:sdk,sha256:createHash('sha256').update(fs.readFileSync(sdk)).digest('hex')};
}

export function candidateLarkEnvironment(env) {
  const config=env.DIRECT_LARK_CLI_CONFIG_DIR,data=env.DIRECT_LARK_CLI_DATA_DIR;
  assert(Boolean(config)===Boolean(data),'Candidate Lark config/data must be paired');
  if(!config)return {};
  for(const dir of [config,data]){
    const stat=fs.lstatSync(dir);
    assert(path.isAbsolute(dir)&&stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'Candidate Lark directories must be private');
  }
  // In an OpenClaw subprocess the CLI selects base/openclaw automatically.
  // A leaf directory can pass a bare CLI check but fail in the actual tool.
  const workspace=path.join(config,'openclaw'),file=path.join(workspace,'config.json');
  assert(fs.existsSync(file),'Candidate Lark config must be the base containing openclaw/config.json');
  for(const target of [workspace,file]){
    const stat=fs.lstatSync(target);
    assert(!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'Candidate Lark bound workspace must be private');
  }
  return {LARKSUITE_CLI_CONFIG_DIR:config,LARKSUITE_CLI_DATA_DIR:data};
}
