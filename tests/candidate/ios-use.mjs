// Private VLab only. Real OpenClaw backend; transport fixture does not claim an iPhone write.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {installIOSUse} from '../../scripts/install-ios-use.mjs';
import {createDeviceRequests} from '../../lib/device-requests.mjs';
import {iosUseOperations} from '../../lab/realtime-direct-tools/ios-use.mjs';
const runtime=process.env.VLAB_CANDIDATE_RUNTIME,state=process.env.OPENCLAW_STATE_DIR;
assert(runtime&&state,'Private Candidate required');
const cfg=JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH));
const workspace=cfg.agents.entries.makaron.workspace;
assert(workspace.startsWith(process.env.VLAB_CANDIDATE_DATA));
// Isolated model/tool test; never start channels, cron or a shared Gateway.
cfg.channels={};cfg.cron={enabled:false};cfg.plugins={enabled:false,load:{paths:[]},entries:{},allow:[]};
cfg.agents.defaults.heartbeat={every:'0m'};
fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify(cfg),{mode:0o600});
const install=await installIOSUse(workspace);
const cli=path.join(runtime,'openclaw','dist','index.js');
const env={...process.env};
if(!env.DEEPSEEK_API_KEY){
 const secretFile=path.join(path.dirname(process.env.VLAB_SHARED_STATE_DIR),'secrets.env');
 const match=fs.readFileSync(secretFile,'utf8').match(/^\s*(?:export\s+)?DEEPSEEK_API_KEY=(.*)$/m);
 if(match)env.DEEPSEEK_API_KEY=match[1].replace(/^["']|["']$/g,'');
}
const originalAuth=path.join(process.env.VLAB_SHARED_STATE_DIR,'agents/makaron/agent/auth-profiles.json');
if(fs.existsSync(originalAuth))fs.copyFileSync(originalAuth,path.join(state,'agents/makaron/agent/auth-profiles.json'));
function run(args){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[cli,...args],{env,stdio:['ignore','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const timer=setTimeout(()=>child.kill('SIGTERM'),240000);
 child.on('exit',code=>{clearTimeout(timer);if(code!==0)return reject(Error('Backend CLI failed '+code+': '+err.replace(/(?:sk-|Bearer )[A-Za-z0-9_-]+/g,'[redacted]').slice(-1800)));resolve(out);});
 });}
function json(text){for(let i=0;i<text.length;i++)if(text[i]==='{'){try{return JSON.parse(text.slice(i));}catch{}}throw Error('No CLI JSON result');}
const listed=json(await run(['skills','list','--agent','makaron','--json']));
const skills=listed.skills??listed;
assert(Array.isArray(skills)&&skills.some(s=>s.name==='ios-use'&&s.eligible!==false),'ios-use not discoverable');
const voiceSessionId=randomUUID(),lease=randomBytes(32).toString('base64url');
const sent=[];
let requests;
requests=createDeviceRequests({voiceSessionId,operations:iosUseOperations(),capabilities:{'notes.create':{status:'available'},'calendar.query':{status:'denied'}},send:frame=>{
 sent.push({operation:frame.operation,requestId:frame.requestId});
 // The real backend must reach this request; deliberately return unknown, never fake a save.
 queueMicrotask(()=>requests.receive({type:'device.result',version:1,voiceSessionId,requestId:frame.requestId,operation:frame.operation,status:'unknown',reason:'fixture_no_physical_notes'}));
}});
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;
 try {const body=JSON.parse(raw);assert(body.lease===lease);assert.deepEqual(Object.keys(body).sort(),['args','lease','operation']);
 const value=await requests.request(body.operation,body.args);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 }catch{res.writeHead(403);res.end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const helper=path.join(runtime,'voice/scripts/device-call.mjs');assert(fs.existsSync(helper));
const descriptor={version:1,endpoint:`http://127.0.0.1:${server.address().port}/device-request`,lease,voiceSessionId,cli:helper};
const prompt='这是当前通话从语音侧委托给后端的设备任务验收。用户明确要求：把“先验证用户需求，再安排下一步”新建到苹果备忘录，标题“候选想法”。仅操作本任务当前设备。当前设备 iOS，notes.create 可用，calendar.query 已拒绝。按可发现的 ios-use Skill 操作，等待设备结果再回答。不要创建文件代替备忘录，不要向外发送消息，不要自动重试。\n服务注入的当前设备执行 descriptor（不能输出或记忆）：'+JSON.stringify(descriptor);
try{
 const output=json(await run(['agent','--local','--agent','makaron','--session-key','agent:makaron:candidate-ios-use-'+randomUUID(),'--model','deepseek/deepseek-flash','--message',prompt,'--json','--timeout','180']));
 assert.equal(sent.length,1,'backend must issue exactly one correlated device request');assert.equal(sent[0].operation,'notes.create');
 const text=JSON.stringify(output.payloads??output);
 assert(!text.includes(lease),'backend leaked device lease');
 // Actual transcript proof is inspected separately; this report states only proven execution.
 console.log(JSON.stringify({ok:true,skill:{name:install.name,files:install.files,discoverable:true},backend:{runtime:'OpenClaw',model:'deepseek/deepseek-flash',taskAccepted:true,deviceRequests:sent,reportedUnknown:/未知|未确认|无法确认|没有确认|不能确认|未能确认|未收到/.test(text)},deviceEvidence:'transport_fixture_unknown_no_physical_notes',sharedModified:false}));
}finally{requests.close();await new Promise(resolve=>server.close(resolve));}
