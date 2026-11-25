#!/usr/bin/env node
// Which tool GPT Live's router picks for a delegated sentence, for two versions of the code side by
// side: the real routing model (VOICE_GPT_LIVE_ROUTER_* / VOICE_BOARD_* / DEEPSEEK_API_KEY from the
// environment, never printed), each version's own router prompt, notes and tool declarations, and the
// same invented cases. Nothing is executed: only the choice is recorded. A change to what the router is
// told ships only if it chooses at least as well as the version in production.
//
//   node router-eval.mjs cases.json <baseline root> <candidate root> [repeats] > report.json
//
// Run on V with the Voice service's environment loaded (the key is the service's own).
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [casesFile,baseRoot,candRoot,repeats='3']=process.argv.slice(2);
if(!casesFile||!baseRoot||!candRoot)throw Error('Usage: router-eval.mjs cases.json <baseline root> <candidate root> [repeats]');
const cases=JSON.parse(await readFile(casesFile,'utf8'));
// The tools a phone call on GPT Live is given (session.mjs), without media creation, as the bridge offers them.
const CALL_TOOLS=['openclaw_agent_control','read','process','memory_search','web_search','web_fetch','feishu_calendar','lark_read','current_time','show_content','delegate_to_v','send_task_updates','cancel_task','openclaw_tool','end_call'];
const WHILE_WORKING=new Set(['openclaw_agent_control','cancel_task','process']);

async function load(root){
  const from=path=>import(pathToFileURL(join(resolve(root),path)).href);
  const router=await from('lab/realtime-direct-tools/gpt-live-router.mjs');
  const {TOOLS}=await from('lab/realtime-direct-tools/tools.mjs');
  const session=await from('lab/realtime-direct-tools/session.mjs');
  const complete=router.routerCompletionFromEnv(process.env);
  if(!complete)throw Error('No routing model key in the environment');
  const route=router.createDelegationRouter({complete});
  // A version without shared notes told its router nothing besides its prompt (media notes are left out on both sides).
  const notes=typeof session.routerNotes==='function'?session.routerNotes({}):'';
  return {route,notes,tools:working=>[...TOOLS.filter(tool=>CALL_TOOLS.includes(tool.name)&&(working||!WHILE_WORKING.has(tool.name))),router.GPT_LIVE_SELF_TOOL]};
}
const versions={baseline:await load(baseRoot),candidate:await load(candRoot)};
const rows=[];
for(let round=0;round<Number(repeats);round++)for(const [index,item] of cases.entries())for(const [name,version] of Object.entries(versions)){
  const startedAt=performance.now();
  let choice=null;
  try{choice=await version.route({text:item.said,userText:item.said,tools:version.tools(Boolean(item.running)),notes:version.notes,history:item.history??[],running:Boolean(item.running)});}catch{}
  rows.push({version:name,case:index,round,chose:choice?.name??null,via:choice?.via??null,right:item.expect.includes(choice?.name),ms:Math.round(performance.now()-startedAt)});
}
const median=list=>{const sorted=[...list].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??null;};
const summary=Object.fromEntries(Object.keys(versions).map(name=>{const mine=rows.filter(row=>row.version===name);
  return [name,{right:mine.filter(row=>row.right).length,of:mine.length,fallback:mine.filter(row=>row.via==='fallback').length,medianMs:median(mine.map(row=>row.ms))}];}));
const perCase=cases.map((item,index)=>({said:item.said,expect:item.expect,...Object.fromEntries(Object.keys(versions).map(name=>[name,rows.filter(row=>row.version===name&&row.case===index).map(row=>row.chose)]))}));
process.stdout.write(JSON.stringify({summary,perCase},null,1)+'\n');
