// Real backend-model acceptance with a simulated firmware peer. No hardware or
// external messages are sent. The ordinary Voice service/lease/helper are real.
import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {dirname,join} from 'node:path';import {writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
import {prepareRobotBackend} from './robot-candidate-setup.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createRobotDevice,robotOperations} from '../../lab/robot/robot-device.mjs';
const pack=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function runAgent(cli,args){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[cli,...args],{env:{...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
 child.on('error',()=>{clearTimeout(timer);reject(Error('candidate_agent_spawn_failed'));});
 child.on('exit',code=>{clearTimeout(timer);if(code!==0){
  writeFileSync(join(process.env.VLAB_CANDIDATE_DATA,'robot-agent-stderr.log'),stderr,{mode:0o600});
  console.log(stderr.split('\n').filter(l=>/error:|Error:|Invalid config|not found|unknown option/.test(l)).map(l=>l.replace(/(?:Bearer |sk-)[A-Za-z0-9_./+-]+/g,'[REDACTED]')).join('\n').slice(-3500));
  // Do not print argv, prompts, leases, auth or complete provider output.
  return reject(Error('candidate_agent_exit_'+code+'_'+(stderr.includes('auth')?'auth':stderr.includes('plugin')?'plugin':'runtime')));
 }
 for(let i=0;i<stdout.length;i++)if(stdout[i]==='{'){try{return resolve(JSON.parse(stdout.slice(i)));}catch{}}
 reject(Error('candidate_agent_invalid_json'));
 });
});}
test('real private V loads robot-use and reaches the common current-call device executor',async t=>{
 const env=await prepareRobotBackend({auth:true});
 let peer,task={taskId:'robot-task',runId:'robot-run',status:'running',progress:[]},agentResult,agentFailure,question;
 let active=true,robot,command;const motorCommands=[],executions=[],audit=[];
 const gateway={request:async(method,args)=>{
  if(method==='tools.catalog')return {groups:[]};
  if(method==='voice.product.task.start'){
   question=args.question;
   void runAgent(env.cli,['agent','--local','--agent','makaron','--session-key','robot-candidate-'+randomUUID(),
    '--model','deepseek/deepseek-v4-flash','--message',question,'--json','--timeout','150']).then(value=>{
      agentResult=value.result??value;task.text=(agentResult.payloads??[]).map(p=>p.text??'').join('\n');task.status=task.text?'ok':'error';
    }).catch(error=>{agentFailure=error.message;task.status='error';task.error=error.message;});
   return {taskId:task.taskId,runId:task.runId};
  }
  if(method==='voice.product.task.read')return task;
  if(method==='voice.product.task.cancel'){task.status='cancelled';return {taskId:task.taskId,cancelled:true};}
  return {ok:true};
 }};
 class Provider extends EventEmitter{constructor(){super();peer=this;this.readyState=1;this.sent=[];setImmediate(()=>this.emit('open'));}
  send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.type==='session.update')queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"session.updated"}'),false));}
  close(){this.readyState=3;this.emit('close');}}
 class WSS{close(){}handleUpgrade(req,socket,head,done){done(socket);}}
 const wire={callTool:async(name,args)=>{
  if(name==='self.robot.bind')return pack({bound:true});
  if(name==='self.robot.command'){motorCommands.push(args);command=args;return pack({...args,status:'running'});}
  if(name==='self.robot.status')return pack({...command,status:'completed',feedbackValid:true,reason:'hardware_feedback',yaw:0,pitch:30,reached:3,total:3});
  if(name==='self.robot.cancel')return pack({...args,status:'cancelled'});
  throw Error('unexpected_firmware_tool');
 }};
 const capabilities={'robot.observe':{status:'unavailable'},'robot.move':{status:'available'},'robot.gesture':{status:'available'},'robot.cancel':{status:'available'}};
 const terminalAdapter={kind:'robot',capabilities:()=>capabilities,execute:async(operation,args,options)=>{
  executions.push({operation,args});
  if(!robot){robot=createRobotDevice({wire,voiceSessionId:options.voiceSessionId,probe:{capabilities},isCurrent:()=>active,pollMs:5});assert(await robot.bind());}
  return robot.execute(operation,args,options);
 }};
 const service=createDirectVoiceService({gateway,wsModule:{WebSocket:Provider,WebSocketServer:WSS},apiKeys:{grok:'simulated-frontend'},deviceOperations:robotOperations,audit:e=>audit.push(e),backendPollMs:25});
 const server=createLiveH5Server({gateway,directVoice:service,phoneInputPolicy:'native',callSummarize:null});
 await new Promise(resolve=>server.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{active=false;robot?.close();await server.dispose();});
 const reservation=await service.reserve({model:'grok',surface:'speaker',inputPolicy:'native',sessionKey:'agent:makaron:explicit:robot-candidate',terminalAdapter,
  backendDeviceURL:`http://127.0.0.1:${server.server.address().port}/internal/device-request`});
 assert(!JSON.stringify(reservation).includes('lease'));
 const client=new EventEmitter();client.readyState=1;client.sent=[];client.send=raw=>client.sent.push(JSON.parse(raw));client.close=()=>{client.readyState=3;client.emit('close');};
 service.attach(reservation.voiceSessionId,reservation.relayTicket,client);
 for(let i=0;i<200&&!client.sent.some(e=>e.type==='ready');i++)await delay(10);
 assert(client.sent.some(e=>e.type==='ready'));
 const event=value=>peer.emit('message',Buffer.from(JSON.stringify(value)),false);
 event({type:'response.created',response:{id:'backend-test'}});
 event({type:'response.function_call_arguments.done',response_id:'backend-test',call_id:'robot-backend',name:'delegate_to_v',arguments:JSON.stringify({question:'请让当前机器人点一次头，然后告诉我实际执行回执。请按当前端能力及对应 Skill 完成。这是候选模拟硬件，不是真机验收。'})});
 event({type:'response.done',response:{id:'backend-test',status:'completed'}});
 for(let i=0;i<1800&&!agentResult&&!agentFailure;i++)await delay(100);
 assert(!agentFailure,agentFailure);assert(agentResult,'backend timeout');
 assert.equal(executions.length,1);assert.equal(executions[0].operation,'robot.gesture');assert.deepEqual(executions[0].args,{gesture:'nod'});assert.equal(motorCommands.length,1);
 const meta=agentResult.meta?.agentMeta??{};
 assert.equal(meta.provider,'deepseek');
 console.log(JSON.stringify({check:'robot_backend_live',model:meta.model,provider:meta.provider,usage:meta.usage??null,
  skillDiscovered:true,deviceOperation:executions[0].operation,commandCount:motorCommands.length,currentCallBound:motorCommands[0].voiceSessionId===reservation.voiceSessionId,
  serviceAndHelperReal:true,frontendProvider:'simulated',firmware:'simulated',physicalDevice:false}));
});
