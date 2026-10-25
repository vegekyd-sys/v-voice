import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
function jsonOutput(text){for(let i=0;i<text.length;i++){if(!['{','['].includes(text[i]))continue;try{return JSON.parse(text.slice(i));}catch{}}throw Error('No JSON output from skill loader');}
test('private Candidate V discovers the installed robot-use entry and its references',async()=>{
 const runtime=process.env.VLAB_CANDIDATE_RUNTIME,data=process.env.VLAB_CANDIDATE_DATA;
 assert(runtime&&data,'private Candidate required');
 const config=JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
 const workspaces=new Set([config.agents?.defaults?.workspace,process.env.OPENCLAW_WORKSPACE_DIR,
  ...Object.values(config.agents?.entries??{}).map(a=>a.workspace),...(config.agents?.list??[]).map(a=>a.workspace)].filter(Boolean));
 for(const workspace of workspaces){assert(resolve(workspace).startsWith(resolve(data)+'/'));await mkdir(join(workspace,'skills'),{recursive:true});await cp(resolve('skills/robot-use'),join(workspace,'skills/robot-use'),{recursive:true});}
 const result=await run(process.execPath,[join(runtime,'openclaw/dist/index.js'),'skills','list','--json'],{timeout:90000,maxBuffer:2*1024*1024});
 const listing=jsonOutput(result.stdout),skills=Array.isArray(listing)?listing:listing.skills;
 assert(Array.isArray(skills));const robot=skills.find(x=>x.name==='robot-use');assert(robot,'robot-use not discovered');
 assert(robot.eligible!==false,JSON.stringify(robot.missing??{}));
 console.log(JSON.stringify({check:'robot_skill_discovery',found:true,eligible:robot.eligible??null,source:robot.source??null,workspaces:workspaces.size,actualModel:false,physicalDevice:false}));
});
