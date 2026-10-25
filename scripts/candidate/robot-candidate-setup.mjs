import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,cp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
export async function prepareRobotBackend({auth=false}={}){
 const runtime=process.env.VLAB_CANDIDATE_RUNTIME,data=process.env.VLAB_CANDIDATE_DATA;
 assert(runtime&&data,'private Candidate required');
 const config=JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
 const agent=config.agents.entries.makaron,workspace=agent.workspace;
 assert(resolve(workspace).startsWith(resolve(data)+'/'));
 await mkdir(join(workspace,'skills'),{recursive:true});
 for(const name of ['robot-use','device-use'])await cp(resolve('skills',name),join(workspace,'skills',name),{recursive:true});
 // Use this runtime's actual local loader. The skills CLI may query the live
 // Gateway profile retained by Candidate; that is not this private workspace.
 const dist=join(runtime,'openclaw/dist');
 const cliSource=await readFile(join(dist,(await readdir(dist)).find(n=>/^skills-cli-.*\.js$/.test(n))),'utf8');
 const statusModule=/const \{ buildWorkspaceSkillStatus \} = await import\("(.+?)"\)/.exec(cliSource)?.[1];assert(statusModule);
 const {buildWorkspaceSkillStatus}=await import(join(dist,statusModule));
 const listing=buildWorkspaceSkillStatus(workspace,{config,agentId:'makaron'});
 assert.equal(resolve(listing.workspaceDir),resolve(workspace));
 const skill=listing.skills.find(s=>s.name==='robot-use');assert(skill,'private robot-use not discovered');assert.equal(skill.eligible,true);
 if(auth){
  // Only provider auth tables, never the shared conversation database.
  const src=new DatabaseSync(join(process.env.VLAB_SHARED_STATE_DIR,'agents/makaron/agent/openclaw-agent.sqlite'),{readOnly:true});
  const dst=new DatabaseSync(join(agent.agentDir,'openclaw-agent.sqlite'));
  for(const table of ['auth_profile_store','auth_profile_state']){
   const row=src.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get('table',table);if(!row)continue;
   if(!dst.prepare('SELECT 1 FROM sqlite_master WHERE type=? AND name=?').get('table',table))dst.exec(row.sql);
   const rows=src.prepare(`SELECT * FROM ${table}`).all();if(!rows.length)continue;
   const keys=Object.keys(rows[0]),insert=dst.prepare(`INSERT OR REPLACE INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
   for(const row of rows)insert.run(...keys.map(k=>row[k]));
  }
  src.close();dst.close();
 }
 // Private run has no delivery destinations. Agent --local does not start a Gateway.
 config.channels={};config.bindings=[];config.cron={enabled:false};
 await writeFile(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify(config)+'\n',{mode:0o600});
 return {runtime,data,config,agent,workspace,cli:join(dist,'index.js'),skill};
}
