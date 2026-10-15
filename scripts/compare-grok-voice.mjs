#!/usr/bin/env node
// Explicit opt-in real xAI calls; all Gateway/tool results below are synthetic.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {createDirectVoiceService} from '../lab/realtime-direct-tools/session.mjs';

export const CASES=[
 {id:'calendar',input:'查一下我今天的飞书日历，告诉我下一场会议几点开始，叫什么。',tool:'feishu_calendar',facts:[['10:30','十点半','十点三十','10点30'],'版本评审']},
 {id:'memory',input:'查一下我的记忆，我之前定下的语音回复偏好是什么？',tool:'memory_search',facts:['中文','结论']},
 {id:'delegate',input:'交给后台模型比较三个语音方案，按中文效果、工具任务、延迟整理一个完整方案。不需要发送。',tool:'delegate_to_v',facts:['中文','工具']},
 {id:'screen',input:'把刚才的完整结果放到屏幕上，不用重新查。',context:'刚才已经核实的完整结果：## 测试报告\n通过37项，失败2项。建议先修复挂断。',tool:'show_content',argumentFacts:['37','2','挂断']},
 {id:'media',input:'交给后台生成一个十秒的视频：小猫在月球上跳舞，横屏，水彩风格。不要只给我提示词。',tool:'delegate_to_v',argumentFacts:['猫','月球','水彩']},
 {id:'failure',input:'查一下今天最新的语音模型新闻。',tool:'web_search',failure:true},
 {id:'farewell',input:'好了，我们今天就聊到这里，拜拜啦。',tool:'end_call',end:true},
 {id:'quoted-farewell',input:'同事昨天对我说拜拜啦，我觉得挺可爱的。你觉得这个说法怎么样？我们接着聊。',noEnd:true},
];
function wav(pcm){const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(pcm.length+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length,40);return Buffer.concat([b,pcm]);}
export async function runCase({model,scenario,apiKey,audio,outDir,round=1,timeoutMs=18000}){
 const row={model,case:scenario.id,inputMode:audio?'synthetic-audio':'text',round,input:scenario.input,tools:[],transcripts:[],audioBytes:0,modelsReported:[],errors:[],responseStatuses:[]};
 const audit=[],frames=[];let service,client,sentAt,inputEndedAt,firstAudioAt,answerAudioAt,firstToolAt,lastActivity=0,lastDeliveryAt=0,lastAssistantAt=0,lastResponseDoneAt=0,done=false,closed=false;
 const timers=new Set();const started=performance.now();
 const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);};
 const catalog=['memory_search','web_search','web_fetch','exec','process'].map(id=>({id,description:id}));
 const sessionKey='agent:makaron:explicit:grok-comparison-synthetic';
 const gateway={request:async(method,args)=>{
  if(method==='tools.catalog')return {groups:[{tools:catalog}]};
  if(method==='tools.invoke')return scenario.failure?{ok:false,error:{code:'SYNTHETIC_DENIED',message:'测试工具拒绝访问，没有检索结果'}}:{ok:true,output:{answer:'用户明确偏好：中文回复，先讲结论，再讲依据。'}};
  if(method==='chat.send'){
   later(()=>service.handleEvent({event:'chat',payload:{runId:args.idempotencyKey,sessionKey,state:'final',message:{content:[{type:'text',text:'合成后台结果：建议先验收中文表达与工具任务，再比较延迟。完整方案已整理；没有发送，也没有发布。'}]}}}),800);
   return {runId:args.idempotencyKey,status:'started'};
  }
  if(method==='agent.wait'){await delay(500);return {status:'running',yielded:true};}
  if(method==='chat.abort')return {ok:true};
  throw Error(`Unexpected fixture RPC: ${method}`);
 }};
 class ObservedSocket extends WebSocket{constructor(url,opts){super(url,opts);this.on('message',(data,binary)=>{if(binary)return;try{const e=JSON.parse(data);if(['session.created','session.updated'].includes(e.type)&&e.session?.model)row.modelsReported.push(e.session.model);if(e.type==='input_audio_buffer.speech_stopped')row.vadStoppedMs=performance.now()-sentAt;if(e.type==='response.done'){lastResponseDoneAt=performance.now();row.responseStatuses.push(e.response?.status??'completed');}}catch{}});}}
 const onAudit=e=>{audit.push(e);if(e.type==='tool.call'){firstToolAt??=performance.now();row.tools.push({name:e.name,args:e.args});}if(e.type==='tool.delivered'){row.toolDelivered=true;lastDeliveryAt=performance.now();}};
 service=createDirectVoiceService({gateway,wsModule:{WebSocket:ObservedSocket,WebSocketServer},apiKeys:{grok:apiKey},grokModel:model,audit:onAudit,
  loadContext:async()=>scenario.context??'',calendar:async()=>({ok:true,events:[{title:'版本评审',start:'2026-10-15T10:30:00+08:00',end:'2026-10-15T11:00:00+08:00'}]}),contentAckTimeoutMs:500});
 const server=createServer((_,res)=>{res.writeHead(404);res.end();});
 server.on('upgrade',(req,socket,head)=>{const u=new URL(req.url,'http://localhost');service.upgrade(req,socket,head,u.pathname.slice(1),u.searchParams.get('ticket'));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const reservation=await service.reserve({model:'grok',sessionKey});
 client=new WebSocket(`ws://127.0.0.1:${server.address().port}/${reservation.voiceSessionId}?ticket=${reservation.relayTicket}`);
 const send=e=>{if(client.readyState===1)client.send(JSON.stringify(e));};
 client.on('error',e=>row.errors.push(e.message));client.on('close',()=>closed=true);
 client.on('message',data=>{
  lastActivity=performance.now();const e=JSON.parse(data);
  if(e.type==='ready'){
   row.readyMs=performance.now()-started;sentAt=performance.now();
   if(audio)void(async()=>{
    for(let i=0;i<audio.length&&!done;i+=960){if(client.readyState!==1)break;client.send(audio.subarray(i,i+960));await delay(20);}
    inputEndedAt=performance.now();
    for(let i=0;i<50&&!done&&client.readyState===1;i++){client.send(Buffer.alloc(960));await delay(20);}
   })();
   else{inputEndedAt=sentAt;send({type:'text',text:scenario.input});}
  }
  if(e.type==='audio'){firstAudioAt??=performance.now();if(row.toolDelivered)answerAudioAt??=performance.now();const b=Buffer.from(e.audio,'base64');row.audioBytes+=b.length;frames.push(b);}
  if(e.type==='transcript'&&e.final){if(e.role==='assistant')lastAssistantAt=performance.now();row.transcripts.push({role:e.role,text:e.text,atMs:performance.now()-started});}
  if(e.type==='backend.result'){row.screenText=e.text;send({type:'content.shown',callId:e.callId});void service.contentShown(e.voiceSessionId,e.callId);}
  if(e.type==='end.after-playback'){row.endAfterPlayback=true;send({type:'playback.drained',callId:e.callId});}
  if(e.type==='error')row.errors.push(e.message);
 });
 try{
  while(performance.now()-started<timeoutMs){
   if(closed)break;
   const settled=sentAt&&performance.now()-lastActivity>900&&lastAssistantAt>lastDeliveryAt&&lastResponseDoneAt>lastDeliveryAt;
   if(settled&&row.audioBytes&&row.transcripts.some(t=>t.role==='assistant')&&(!scenario.tool||row.toolDelivered))break;
   await delay(80);
  }
  row.timedOut=performance.now()-started>=timeoutMs;
 }finally{
  done=true;for(const t of timers)clearTimeout(t);
  await service.dispose();client.terminate();await new Promise(r=>server.close(r));
 }
 row.elapsedMs=Math.round(performance.now()-started);
 row.firstAudioMs=firstAudioAt&&inputEndedAt?Math.round(firstAudioAt-inputEndedAt):null;
 row.firstToolMs=firstToolAt&&inputEndedAt?Math.round(firstToolAt-inputEndedAt):null;
 row.afterToolAudioMs=answerAudioAt&&inputEndedAt?Math.round(answerAudioAt-inputEndedAt):null;
 row.finalTextMs=lastAssistantAt&&inputEndedAt?Math.round(lastAssistantAt-inputEndedAt):null;
 row.inputDurationMs=inputEndedAt&&sentAt?Math.round(inputEndedAt-sentAt):null;
 const assistant=row.transcripts.filter(t=>t.role==='assistant').map(t=>t.text).join('\n');
 const called=row.tools.find(t=>t.name===scenario.tool);
 row.checks={reportedModel:row.modelsReported.length>0&&row.modelsReported.every(m=>m===model),audio:row.audioBytes>0,noError:!row.errors.length&&!row.timedOut,
  tool:scenario.tool?Boolean(called):true,facts:!scenario.facts||scenario.facts.every(f=>(Array.isArray(f)?f:[f]).some(value=>assistant.includes(value))),
  arguments:!scenario.argumentFacts||scenario.argumentFacts.every(f=>JSON.stringify(called?.args??{}).includes(f)),
  end:!scenario.end||row.endAfterPlayback===true,noFalseHangup:!scenario.noEnd||!row.tools.some(t=>t.name==='end_call'),
  failureHonesty:!scenario.failure||/无法|不能|没|未能|失败|拒绝|错误|暂时/.test(assistant)};
 row.pass=Object.values(row.checks).every(Boolean);
 if(outDir){const stem=`${model}-${scenario.id}-${audio?'audio':'text'}-${round}`;await writeFile(join(outDir,`${stem}.json`),JSON.stringify({...row,audit},null,2));if(frames.length)await writeFile(join(outDir,`${stem}.wav`),wav(Buffer.concat(frames)));}
 return row;
}
async function main(){
 const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
 if(!args.includes('--run'))throw Error('Real API calls require --run and XAI_API_KEY. See docs/grok-voice-3.md.');
 if(!process.env.XAI_API_KEY)throw Error('XAI_API_KEY is required');
 if(!args.includes('--out'))throw Error('--out must point outside the repository (contains synthetic transcripts/audio)');
 const outDir=resolve(option('--out')),root=resolve(import.meta.dirname,'..');
 if(outDir===root||outDir.startsWith(root+'/'))throw Error('Store comparison output outside the repository');
 const rounds=args.includes('--rounds')?Number(option('--rounds')):2;
 if(!Number.isInteger(rounds)||rounds<1||rounds>3)throw Error('rounds must be 1..3');
 await mkdir(outDir,{recursive:true});
 const rows=[];const models=['grok-voice-2.0','grok-voice-3.0'];
 const sourceHashes={};
 for(const path of ['scripts/compare-grok-voice.mjs','lab/realtime-direct-tools/grok-provider.mjs','lab/realtime-direct-tools/session.mjs','lab/realtime-direct-tools/tools.mjs','lab/realtime-direct-tools/backend.mjs'])sourceHashes[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
 await writeFile(join(outDir,'metadata.json'),JSON.stringify({startedAt:new Date().toISOString(),models,rounds,node:process.version,sourceHashes,toolData:'synthetic-only'},null,2));
 for(let round=1;round<=rounds;round++)for(const scenario of CASES)for(const model of round%2?models:[...models].reverse()){
  const row=await runCase({model,scenario,apiKey:process.env.XAI_API_KEY,outDir,round});rows.push(row);console.log(JSON.stringify({model,case:row.case,round,pass:row.pass,firstAudioMs:row.firstAudioMs,tools:row.tools.map(t=>t.name),errors:row.errors}));
  await writeFile(join(outDir,'results.json'),JSON.stringify(rows,null,2));
 }
 if(args.includes('--audio-dir'))for(const id of ['calendar','farewell','quoted-farewell']){
  const scenario=CASES.find(s=>s.id===id),audio=await readFile(join(resolve(option('--audio-dir')),`${id}.pcm`));
  for(const model of [...models].reverse()){
   const row=await runCase({model,scenario,apiKey:process.env.XAI_API_KEY,audio,outDir});rows.push(row);console.log(JSON.stringify({model,case:id,mode:'synthetic-audio',pass:row.pass,firstAudioMs:row.firstAudioMs,errors:row.errors}));
   await writeFile(join(outDir,'results.json'),JSON.stringify(rows,null,2));
  }
 }
}
if(process.argv[1]===new URL(import.meta.url).pathname)await main();
