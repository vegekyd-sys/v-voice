import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createDirectVoiceService} from './session.mjs';
import {VOICE_CAPABILITY_POLICY} from '../gpt-live-h5/capability-policy.mjs';

async function fixture(invoke=async()=>({ok:true,output:{answer:'实际结果'}}),model='grok',options={}) {
 const peers=[],audit=[],invocations=[];let sdkTask;
 class WS extends EventEmitter {constructor(url){super();this.url=url;this.readyState=1;this.sent=[];peers.push(this);setImmediate(()=>this.emit('open'));}
  send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.type==='session.update')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.updated'})),false));if(value.type==='session.create')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.created',session:{id:value.session.id??'fixture-dialog'}})),false));}
  close(){this.readyState=3;this.emit('close');}}
 class Server {handleUpgrade(req,socket,head,done){done(socket);}close(){}}
 const gateway={request:async(method,args)=>{
  if(method==='tools.catalog')return {groups:[{tools:['memory_search','web_search','web_fetch','exec','process'].map(id=>({id}))}]};
  invocations.push(args);
  if(method==='voice.product.task.start'){sdkTask={taskId:'sdk-fixture-task',runId:'sdk-fixture-run',runs:['sdk-fixture-run'],status:'running',progress:[]};return {taskId:sdkTask.taskId,runId:sdkTask.runId};}
  if(method==='voice.product.task.read'){await delay(1);return {...sdkTask,progress:[...sdkTask.progress]};}
  if(method==='voice.product.task.cancel'){sdkTask.status='cancelled';return {taskId:sdkTask.taskId,cancelled:true};}
  return invoke(args,method);
 }};
 const service=createDirectVoiceService({gateway,wsModule:{WebSocket:WS,WebSocketServer:Server},apiKeys:{grok:'fixture-key',seeduplex:'fixture-key'},audit:v=>audit.push(v),contentAckTimeoutMs:20,backendPollMs:1,...options});
 const reservation=await service.reserve({model,sessionKey:options.sessionKey??'agent:makaron:explicit:personal-fixture',voice:options.voice});
 const client=new EventEmitter();client.readyState=1;client.sent=[];client.send=raw=>{const value=JSON.parse(raw);client.sent.push(value);if(value.type==='backend.result'&&options.autoContentAck!==false)queueMicrotask(()=>service.contentShown(value.voiceSessionId,value.callId));};client.close=()=>{client.readyState=3;client.emit('close');};
 service.upgrade({},client,Buffer.alloc(0),reservation.voiceSessionId,reservation.relayTicket);
 // Wait for the protocol readiness event, not a machine-dependent 5ms sleep.
 for(let attempt=0;attempt<200&&!client.sent.some(e=>e.type==='ready');attempt++)await delay(5);
 assert(client.sent.some(e=>e.type==='ready'),'Fixture provider did not become ready');
 const upstream=peers[0],event=v=>upstream.emit('message',Buffer.from(JSON.stringify(v)),false);
 const call=(name,args,id='call-1')=>{event({type:'response.created',response:{id:'response-'+id}});event({type:'response.function_call_arguments.done',response_id:'response-'+id,call_id:id,name,arguments:JSON.stringify(args)});event({type:'response.done',response:{id:'response-'+id,status:'completed'}});};
 return {service,reservation,client,upstream,event,call,audit,invocations,peers,completeBackend:text=>{sdkTask.status='ok';sdkTask.text=text;},progressBackend:text=>sdkTask.progress.push({text,kind:'commentary',provenance:{runId:sdkTask.runId,sequence:sdkTask.progress.length+1}})};
}

test('a speaker switch preserves an admitted tool but never sends its old result to the new native persona',async t=>{
 let native,finish;
 const routing={reserve:()=>({policy:'streaming'}),has:()=>true,bind:async(_id,value)=>{native=value;},close(){},audio(){}};
 const f=await fixture(()=>new Promise(r=>{finish=r;}),'seeduplex',{speakerRouting:routing});t.after(()=>f.service.dispose());
 f.event({type:'response.function_call_arguments.done',items:[{call_id:'old-search',name:'web_search',arguments:JSON.stringify({query:'实际查询'})}]});
 for(let i=0;i<100&&!finish;i++)await delay(2);assert(finish);
 await native.prepare('当前只和孩子十二交谈。','child',[]);
 assert.equal(f.peers.length,2);assert.equal(f.upstream.readyState,1);assert.equal(f.client.readyState,1);
 finish({ok:true,output:{text:'原人物的查询结果'}});for(let i=0;i<250&&f.upstream.readyState!==3;i++)await delay(5);
 assert.equal(f.upstream.readyState,3);assert.equal(f.client.readyState,1);
 assert.equal(JSON.stringify(f.peers[1].sent).includes('old-search'),false);
 assert(f.client.sent.some(e=>e.type==='tool.result'&&e.callId==='old-search'));
});

test('a background result after a speaker switch is shown without speaking to the new person',async t=>{
 let native;const routing={reserve:()=>({policy:'streaming'}),has:()=>true,bind:async(_id,value)=>{native=value;},close(){},audio(){}};
 const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:new Promise(()=>{}),'seeduplex',{speakerRouting:routing});t.after(()=>f.service.dispose());
 f.event({type:'response.function_call_arguments.done',items:[{call_id:'old-task',name:'delegate_to_v',arguments:JSON.stringify({question:'完成原人物的任务'})}]});await delay(5);
 const started=f.audit.find(e=>e.type==='backend.started');assert(started);
 await native.prepare('现在只和十二聊天。','child',[]);
 f.completeBackend('原人物任务已完成，结果已核对。');
 for(let i=0;i<100&&!f.client.sent.some(e=>e.type==='backend.result');i++)await delay(10);
 assert(f.client.sent.some(e=>e.type==='backend.result'&&e.text.includes('任务已完成')));
 assert.equal(f.peers[1].sent.filter(e=>e.type==='speech_text_buffer.commit').length,0);
 assert.equal(f.client.readyState,1);assert.equal(f.invocations.some(x=>x.method==='chat.abort'),false);
});

for (const model of ['grok', 'seeduplex']) test(`${model} session initializes with the shared capability policy and real backend adapter`, async t => {
 const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:{status:'ok'},model);
 t.after(()=>f.service.dispose());
 const setup=f.upstream.sent.find(e=>e.type==='session.update'||e.type==='session.create');
 assert(setup, 'provider session must actually be initialized');
 const serialized=JSON.stringify(setup);
 assert(serialized.includes(JSON.stringify(VOICE_CAPABILITY_POLICY).slice(1,-1)));
 assert.equal(serialized.split('V_CAPABILITY_POLICY_V1').length,2);
 assert(serialized.includes('delegate_to_v'));
 assert(serialized.includes('只读工具的限制只约束该工具'));
});

test('SeedDuplex upstream recovery keeps the browser and owned backend alive, then permits end_call',async t=>{
 let cancelled=false;
 const f=await fixture(async(args,method)=>{
   if(method==='chat.send')return {runId:args.idempotencyKey,status:'started'};
   if(method==='chat.abort'){cancelled=true;return {ok:true};}
   await delay(10);return {status:cancelled?'error':'running',aborted:cancelled};
 },'seeduplex');
 t.after(()=>f.service.dispose());
 const native=(socket,id,name,args={})=>socket.emit('message',Buffer.from(JSON.stringify({type:'response.function_call_arguments.done',items:[{call_id:id,name,arguments:JSON.stringify(args)}]})),false);
 native(f.upstream,'delegated','delegate_to_v',{question:'整理报告，用户已授权发送'});await delay(5);
 const started=f.audit.find(e=>e.type==='backend.started');assert(started);
 f.upstream.close();await delay(350);
 assert.equal(f.peers.length,2);assert.equal(f.client.readyState,1);assert(!f.client.sent.some(e=>e.type==='error'));
 assert(f.client.sent.some(e=>e.type==='provider.recovered'));
 const next=f.peers[1];assert.equal(next.sent[0].session.id,'fixture-dialog');
 native(next,'delegated','delegate_to_v',{question:'整理报告，用户已授权发送'});await delay(5);
 assert.equal(f.audit.filter(e=>e.type==='backend.started').length,1);
 assert.equal(cancelled,false);
 f.completeBackend('报告已整理并发送。');await delay(250);
 assert.equal(f.audit.filter(e=>e.type==='tool.delivered'&&e.callId==='delegated').length,1);
 assert.equal(f.client.sent.filter(e=>e.type==='transcript'&&e.source==='V-backend').length,1);
 assert.equal(next.sent.filter(e=>e.type==='speech_text_buffer.commit').length,1);
 native(next,'ending','end_call');await delay(5);
 const pcm=Buffer.alloc(8);pcm.writeFloatLE(.1,0);pcm.writeFloatLE(.2,4);
 next.emit('message',Buffer.from(JSON.stringify({type:'response.output_audio.started',response_id:'bye',tts_type:'default'})),false);
 next.emit('message',Buffer.from(JSON.stringify({type:'response.output_audio.delta',response_id:'bye',delta:pcm.toString('base64')})),false);
 next.emit('message',Buffer.from(JSON.stringify({type:'response.output_audio.done',response_id:'bye'})),false);
 assert(f.client.sent.some(e=>e.type==='end.after-playback'));
 f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.drained',callId:'ending'})),false);await delay(5);
 assert.equal(f.client.readyState,3);assert.equal(f.audit.filter(e=>e.type==='call.closed').length,1);
});
test('Seeduplex audible greeting reaches the browser transcript and audit exactly once',async t=>{
 const f=await fixture(undefined,'seeduplex');t.after(()=>f.service.dispose());
 await delay(0);
 f.client.emit('message',Buffer.from(JSON.stringify({type:'greeting'})),false);
 f.client.emit('message',Buffer.from(JSON.stringify({type:'greeting'})),false);
 assert.equal(f.upstream.sent.filter(e=>e.type==='speech_text_buffer.commit').length,1);
 assert.equal(f.client.sent.filter(e=>e.type==='transcript').length,0);
 f.event({type:'response.output_audio.started',response_id:'hello',tts_type:'chat_tts_text'});
 const pcm=Buffer.alloc(8);pcm.writeFloatLE(.1,0);pcm.writeFloatLE(.2,4);
 f.event({type:'response.output_audio.delta',response_id:'hello',delta:pcm.toString('base64')});
 f.event({type:'response.output_audio.delta',response_id:'hello',delta:pcm.toString('base64')});
 const text=f.client.sent.filter(e=>e.type==='transcript');
 assert.equal(text.length,1);assert.equal(text[0].text,'天意，你好，我是 V，在呢。');
 assert.equal(text[0].role,'assistant');assert.equal(text[0].final,true);assert.equal(text[0].source,'greeting');
 assert.equal(f.client.sent.filter(e=>e.type==='audio').length,2);
 assert.equal(f.audit.filter(e=>e.type==='transcript'&&e.source==='greeting').length,1);
});

test('native direct call executes real Gateway tool, retains personal session and never delegates to a model',async()=>{
 const f=await fixture();f.call('memory_search',{query:'家庭'});await delay(5);
 assert.equal(f.invocations[0].name,'memory_search');assert.equal(f.invocations[0].sessionKey,'agent:makaron:explicit:personal-fixture');
 assert.equal(f.audit.filter(x=>x.type==='tool.delivered').length,1);
 assert.equal(f.upstream.sent.filter(x=>x.item?.type==='function_call_output').length,1);await f.service.dispose();
});
test('ordinary steering preserves pending work; explicit cancellation retires its late facts',async()=>{
 let finish;const f=await fixture(()=>new Promise(resolve=>finish=resolve));f.call('web_search',{query:'天气'});await delay(2);
 await f.service.steer(f.reservation.voiceSessionId,{mode:'append',text:'我再补充一下'});
 assert.equal(f.audit.filter(x=>x.type==='tool.delivered').length,0);
 await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消刚才的任务'});
 finish({ok:true,output:{privateOldFact:'不得续传'}});await delay(5);
 const delivered=f.audit.find(x=>x.type==='tool.delivered');assert.equal(delivered.result.cancelled,true);assert.equal(JSON.stringify(delivered).includes('privateOldFact'),false);await f.service.dispose();
});
test('end requires native semantic tool, actual farewell audio and matching drained acknowledgement',async()=>{
 const f=await fixture();f.client.emit('message',Buffer.from(JSON.stringify({type:'text',text:'讨论挂断功能'})),false);await delay(2);
 assert.equal(f.client.sent.some(x=>x.type==='end.accepted'),false);
 f.call('end_call',{});await delay(5);assert.equal(f.client.sent.some(x=>x.type==='end.after-playback'),false);
 f.event({type:'response.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});f.event({type:'response.done',response:{id:'farewell',status:'completed'}});
 assert.equal(f.client.sent.some(x=>x.type==='end.after-playback'),true);
 f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.drained',callId:'foreign'})),false);assert.equal(f.client.readyState,1);
 f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.drained',callId:'call-1'})),false);await delay(5);assert.equal(f.client.readyState,3);await f.service.dispose();
});
test('cancel kills and polls only process IDs actually created by this call',async()=>{
 const f=await fixture(async args=>args.name==='exec'?{ok:true,output:{details:{status:'running',sessionId:'owned-1'}}}:{ok:true,output:{details:{status:'completed'}}});
 f.call('openclaw_tool',{tool:'exec',arguments:JSON.stringify({command:'sleep 30'})});await delay(5);
 await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消'});
 assert.deepEqual(f.invocations.filter(x=>x.name==='process').map(x=>x.args),[{action:'kill',sessionId:'owned-1'},{action:'poll',sessionId:'owned-1',timeout:2000}]);
 f.call('openclaw_tool',{tool:'process',arguments:JSON.stringify({action:'kill',sessionId:'foreign'})},'foreign');await delay(5);
 assert.equal(f.invocations.some(x=>x.args.sessionId==='foreign'),false);await f.service.dispose();
});
test('hybrid tool keeps one backend run alive during chat; progress and final wait for actual playback idle',async()=>{
 const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:new Promise(()=>{}));
 f.call('delegate_to_v',{question:'比较多种方案，完成所有步骤'});await delay(5);
 const started=f.audit.find(x=>x.type==='backend.started');assert(started);
 const backend=e=>{if(e.payload?.state==='final')f.completeBackend(e.payload.message.content[0].text);else if(e.payload?.stream==='item')f.progressBackend(e.payload.data.progressText);};
 f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.state',speaking:true})),false);
 backend({event:'agent',payload:{stream:'tool',data:{phase:'result',name:'memory_search'}}});
 backend({event:'agent',payload:{stream:'item',data:{kind:'preamble',phase:'end',progressText:'第一步查到了实际记录，正在核对网页。'}}});
 await delay(250);assert.equal(f.upstream.sent.some(x=>x.item?.type==='force_message'),false);
 await f.service.steer(f.reservation.voiceSessionId,{mode:'append',text:'顺便和我聊聊天'});
 assert.equal(f.invocations.filter(x=>x.question?.includes('完整目标')).length,1);
 f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.state',speaking:false})),false);
 await delay(250);
 const progress=f.upstream.sent.find(x=>x.item?.type==='force_message');assert.equal(progress.item.content[0].text,'第一步查到了实际记录，正在核对网页。');assert.equal(progress.item.interruptible,true);
 backend({payload:{state:'final',message:{content:[{type:'text',text:'所有步骤完成，结论如下'}]}}});await delay(5);
 assert.equal(f.upstream.sent.filter(x=>x.item?.type==='force_message').length,1);
 f.event({type:'response.done',response:{id:'progress-speech',status:'completed'}});await delay(250);
 assert.equal(f.upstream.sent.filter(x=>x.item?.type==='force_message').at(-1).item.content[0].text,'所有步骤完成，结论如下');
 assert.equal(f.client.sent.filter(x=>x.type==='tool.result').length,1);await f.service.dispose();
});
test('hybrid explicit cancellation aborts only its own backend run and never feeds late final',async()=>{
 let cancelled=false;const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
 f.call('delegate_to_v',{question:'做一个较长任务'});await delay(5);const started=f.audit.find(x=>x.type==='backend.started');
 await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消这个任务'});
 f.service.handleEvent({event:'chat',payload:{runId:started.runId,state:'final',message:{text:'不要播报的旧结果'}}});await delay(5);
 const result=f.audit.find(x=>x.type==='tool.delivered');assert.equal(result.result.cancelled,true);assert(!JSON.stringify(result).includes('不要播报'));
 assert(f.invocations.some(x=>x.taskId==='sdk-fixture-task'));assert(!f.client.sent.some(x=>x.type==='backend.result'));await f.service.dispose();
});

test('unconfirmed process termination retains call ownership and prevents redial until cleanup retry',async()=>{
 let terminal=false;const f=await fixture(async args=>args.name==='exec'?{ok:true,output:{details:{status:'running',sessionId:'owned-retry'}}}:{ok:true,output:{details:{status:terminal?'killed':'running'}}});
 f.call('openclaw_tool',{tool:'exec',arguments:JSON.stringify({command:'sleep 60'})});await delay(5);
 const cancelled=await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消'});assert.equal(cancelled.ok,false);
 await assert.rejects(f.service.close(f.reservation.voiceSessionId),/退出尚未确认/);
 await assert.rejects(f.service.reserve({model:'grok',sessionKey:'personal'}),/正在确认退出/);
 terminal=true;await delay(5);await f.service.close(f.reservation.voiceSessionId);
 assert.equal(f.audit.filter(x=>x.type==='call.closed').length,1);await f.service.dispose();
});

test('backend cancellation uses its SDK task owner; never sends backend IDs to Gateway process',async()=>{
 let cancelled=false,started;
 const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:method==='vlab.workers.voice.cancelProcesses'?(cancelled=true,{runId:args.runId,sessionKey:args.sessionKey,confirmed:true,pendingExecs:0,processes:[{sessionId:'worker-owned',result:{details:{status:'failed',exitSignal:'SIGTERM'}}}]}):method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
 f.call('delegate_to_v',{question:'后台执行长命令'});await delay(5);started=f.audit.find(x=>x.type==='backend.started');
 f.service.handleEvent({event:'agent',payload:{runId:started.runId,sessionKey:started.sessionKey,stream:'tool',data:{phase:'result',name:'exec',toolCallId:'exec',result:{details:{status:'running',sessionId:'worker-owned'}}}}});
 const answer=await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消后台'});assert(answer.cancelled);assert(!f.invocations.some(x=>x.name==='process'));assert(f.audit.some(x=>x.type==='backend.cancel-observed'));assert(f.invocations.some(x=>x.taskId==='sdk-fixture-task'));await f.service.dispose();
});

test('invalid or concurrent delegation returns native error without falsely acknowledging a new backend job',async()=>{
 let cancelled=false;const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
 f.call('delegate_to_v',{},'invalid');await delay(5);assert(JSON.parse(f.upstream.sent.find(x=>x.item?.call_id==='invalid').item.output).error);
 f.call('delegate_to_v',{question:'完整任务'},'first');await delay(5);f.call('delegate_to_v',{question:'另一个任务'},'second');await delay(5);
 assert.equal(f.audit.filter(x=>x.type==='backend.start-requested').length,1);const second=JSON.parse(f.upstream.sent.find(x=>x.item?.call_id==='second').item.output);assert(second.error);assert(!second.accepted);await f.service.dispose();
});

test('backend registry miss retains cancellation responsibility and explicit V routing is instructed',async()=>{
 let found=false;const f=await fixture(async args=>args.name==='exec'?{ok:true,output:{details:{status:'running',sessionId:'worker-owned'}}}:{ok:true,output:found?{details:{status:'killed'}}:{details:{status:'failed'},content:[{type:'text',text:'No session found for worker-owned'}]}});
 f.upstream.emit('open');await delay(2);
 const session=f.upstream.sent.find(x=>x.type==='session.update').session;
 assert.match(session.instructions,/后台处理.*必须调用 delegate_to_v/);
 assert(session.instructions.indexOf('任务分工：')<session.instructions.indexOf('可直接执行的原生工具目录：'));
 assert(session.instructions.indexOf('任务分工：')<session.instructions.indexOf('最近个人对话上下文'));
 assert.equal(session.instructions.split('任务分工：').length,2);
 assert.match(session.instructions,/exec\/process 只是执行工具/);
 assert.match(session.tools.find(t=>t.name==='delegate_to_v').description,/后端语言模型/);
 assert.match(session.tools.find(t=>t.name==='exec').description,/不调用后端语言模型/);
 f.call('openclaw_tool',{tool:'exec',arguments:JSON.stringify({command:'sleep 60'})});await delay(5);
 f.call('process',{action:'poll',sessionId:'worker-owned'},'lookup');await delay(5);
 const result=await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消'});assert.equal(result.cancelled,false);
 await assert.rejects(f.service.close(f.reservation.voiceSessionId),/退出尚未确认/);
 await assert.rejects(f.service.reserve({model:'grok',sessionKey:'personal'}),/正在确认退出/);
 found=true;await f.service.close(f.reservation.voiceSessionId);await f.service.dispose();
});
test('native call exposes only coarse task activity to the avatar, not tool arguments',async()=>{
 const f=await fixture();
 f.call('openclaw_tool',{tool:'web_search',arguments:JSON.stringify({query:'private-query-for-avatar-test'})},'visual-web');await delay(5);
 const visible=f.client.sent.find(e=>e.type==='tool.call'&&e.callId==='visual-web');
 assert.equal(visible.activity,'web');
 assert.equal(JSON.stringify(f.client.sent).includes('private-query-for-avatar-test'),false);
 assert.equal(f.invocations[0].args.query,'private-query-for-avatar-test');
 await f.service.dispose();
});

test('relay audio gets call-owned monotonically increasing sequence and a real response end boundary',async()=>{
 const f=await fixture();const delta=Buffer.alloc(960).toString('base64');for(let i=0;i<2;i++)f.event({type:'response.output_audio.delta',delta});f.event({type:'response.done',response:{id:'speech',status:'completed'}});
 assert.deepEqual(f.client.sent.filter(e=>e.type==='audio').map(e=>e.sequence),[1,2]);assert.equal(f.client.sent.filter(e=>e.type==='audio.done').length,1);await f.service.dispose();
});

test('Xiaohe cached native notice uses the same sequenced FIFO and leaves the pending function untouched',async()=>{
 const f=await fixture(undefined,'seeduplex');
 f.event({type:'response.function_call_arguments.done',items:[{call_id:'memory-first',name:'memory_search',arguments:JSON.stringify({query:'十二'})}]});await delay(10);
 const pcm=f.client.sent.filter(e=>e.type==='audio');assert.equal(pcm.length,1);assert.equal(pcm[0].sequence,1);assert.equal(pcm[0].source,'cached-native-tool-start');assert.equal(Buffer.from(pcm[0].audio,'base64').length,94822);
 assert.equal(f.audit.filter(e=>e.type==='tool.delivered').length,1);assert(f.upstream.sent.some(e=>e.items?.[0]?.call_id==='memory-first'));assert(!f.upstream.sent.some(e=>e.type==='speech_text_buffer.commit'));
 // Only actual provider reply PCM can satisfy first-query answer evidence.
 const floats=Buffer.alloc(8);floats.writeFloatLE(.25);floats.writeFloatLE(-.25,4);f.event({type:'response.output_audio.delta',delta:floats.toString('base64')});
 assert.equal(f.client.sent.filter(e=>e.type==='audio').at(-1).sequence,2);assert.equal(f.client.sent.filter(e=>e.type==='audio').at(-1).source,undefined);await f.service.dispose();
});

test('owned long backend result publishes full document and speaks brief notice with exactly one backend run',async()=>{
 const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:new Promise(()=>{}));
 f.call('delegate_to_v',{question:'比较多种方案'});await delay(5);const started=f.audit.find(x=>x.type==='backend.started'),text='## 完整结果\n'+'原始事实与限制。'.repeat(100);
 const event={event:'chat',payload:{runId:started.runId,sessionKey:started.sessionKey,state:'final',message:{content:[{type:'text',text}]}}};f.completeBackend(text);f.service.handleEvent(event);await delay(250);
 const docs=f.client.sent.filter(x=>x.type==='backend.result');assert.equal(docs.length,1);assert.equal(docs[0].text,text);assert.equal(docs[0].callId,'call-1');assert.equal(docs[0].voiceSessionId,f.reservation.voiceSessionId);
 const speech=f.upstream.sent.filter(x=>x.item?.type==='force_message');assert.equal(speech.length,1);assert(speech[0].item.content[0].text.includes('屏幕'));assert(speech[0].item.content[0].text.includes('原始事实'));assert(speech[0].item.content[0].text.length<200);
 assert.equal(f.invocations.filter(x=>x.question?.includes('完整目标')).length,1);await f.service.dispose();
});

test('direct tools emit actual activity; contextual picture decisions belong only to the shared H5 path',async()=>{
 let expressionDone;
 const f=await fixture(undefined,'grok',{avatarEvaluate:()=>new Promise(resolve=>{expressionDone=resolve;})});
 f.call('memory_search',{query:'private query'});await delay(10);
 assert.equal(f.invocations[0].name,'memory_search');
 assert.equal(f.audit.filter(x=>x.type==='tool.delivered').length,1);
 assert.equal(expressionDone,undefined);
 assert.equal(f.client.sent.filter(x=>x.type==='avatar.expression').length,0);
 assert.equal(f.upstream.sent.filter(x=>x.item?.type==='function_call_output').length,1);
 await f.service.dispose();
});

for (const model of ['grok','seeduplex']) test(`${model} public transcript callback reaches private text persistence with exact reservation identity`,async t=>{
 const {mkdtemp,readFile,readdir,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createVoiceTranscriptLog}=await import('./transcript-log.mjs');
 const directory=await mkdtemp(join(tmpdir(),'voice-protocol-text-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const log=createVoiceTranscriptLog({directory});
 const f=await fixture(undefined,model,{audit:log.audit});
 f.event({type:'conversation.item.input_audio_transcription.completed',transcript:'用户真实回调文本'});
 f.event(model==='grok'?{type:'response.output_audio_transcript.delta',delta:'回答片段'}:{type:'response.output_text.delta',delta:'回答片段'});
 f.event(model==='grok'?{type:'response.output_audio_transcript.done',transcript:'完整回答'}:{type:'response.output_text.done',text:'完整回答'});
 await f.service.dispose();assert.equal((await log.close()).failed,0);
 const rows=(await Promise.all((await readdir(directory)).map(async file=>(await readFile(join(directory,file),'utf8')).trim().split('\n').map(JSON.parse)))).flat();
 assert.deepEqual(rows.filter(r=>r.type==='transcript').map(r=>[r.role,r.text,r.final]),[['user','用户真实回调文本',true],['assistant','回答片段',false],['assistant','完整回答',true]]);
 assert(rows.every(r=>r.voiceSessionId===f.reservation.voiceSessionId&&r.provider===model&&r.sessionKey==='agent:makaron:explicit:personal-fixture'));
 assert.equal(rows.at(-1).type,'call.closed');
 assert(!JSON.stringify(rows).includes('fixture-key'));assert(!JSON.stringify(rows).includes(f.reservation.relayTicket));
});


test('short image and video completions publish one UI result and one spoken caption',async()=>{
 for (const url of ['https://cdn.test/car.webp','https://cdn.test/car.mp4']) {
  const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:new Promise(()=>{}));
  f.call('delegate_to_v',{question:'生成赛车媒体'});await delay(5);const started=f.audit.find(x=>x.type==='backend.started');
  const text=`小赛车在积木赛道上。\n[赛车](${url})`;
  f.completeBackend(text);await delay(250);
  assert.equal(f.client.sent.filter(x=>x.type==='backend.result').length,1);
  assert.equal(f.client.sent.find(x=>x.type==='backend.result').text,text);
  const speech=f.upstream.sent.filter(x=>x.item?.type==='force_message');assert.equal(speech.length,1);assert(!speech[0].item.content[0].text.includes('https:'));assert(speech[0].item.content[0].text.includes('小赛车'));
  await f.service.dispose();
 }
});
test('busy delegation is explicitly not started and cannot silently queue another media job',async()=>{
 let cancelled=false;const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
 f.call('delegate_to_v',{question:'调研'},'first');await delay(5);
 f.call('delegate_to_v',{question:'作图'},'second');await delay(5);
 const result=f.audit.find(x=>x.type==='tool.delivered'&&x.callId==='second').result;
 assert(result.error.includes('新任务未启动'));assert(result.error.includes('未加入队列'));
 assert.equal(f.audit.filter(x=>x.type==='backend.started').length,1);await f.service.dispose();
});

for(const model of ['grok','seeduplex'])test(`${model} calendar and other Feishu reads execute locally, with no Gateway exec`,async t=>{
 const reads=[];const f=await fixture(async()=>{throw Error('no Gateway tools expected');},model,{calendar:async(args,id,signal)=>{reads.push({args,id,signal});return {details:{status:'completed',exitCode:0,source:'voice-local-lark'},content:[{type:'text',text:'{"ok":true,"data":{"events":[]}}'}]};},larkRead:async(args,id,signal)=>{reads.push({args,id,signal});return {content:[{type:'text',text:'{"ok":true}'}]};}});t.after(()=>f.service.dispose());
 if(model==='seeduplex')f.event({type:'response.function_call_arguments.done',items:[{call_id:'calendar',name:'feishu_calendar',arguments:'{}'}]});else f.call('feishu_calendar',{},'calendar');await delay(10);
 if(model==='seeduplex')f.event({type:'response.function_call_arguments.done',items:[{call_id:'contact',name:'lark_read',arguments:JSON.stringify({argv:['contact','+search-user','--query','同事']})}]});else f.call('lark_read',{argv:['contact','+search-user','--query','同事']},'contact');await delay(10);
 assert.equal(reads.length,2);assert(reads.every(r=>r.signal instanceof AbortSignal));assert.equal(f.invocations.length,0);assert.equal(f.audit.filter(e=>e.type==='tool.local-result').length,2);assert.equal(f.audit.filter(e=>e.type==='tool.delivered').length,2);
});
test('local read survives ordinary interruption; hangup aborts and waits for real child cleanup',async()=>{
 let signal,cleanupDone=false;const f=await fixture(undefined,'grok',{calendar:(args,id,s)=>{signal=s;return new Promise((resolve,reject)=>s.addEventListener('abort',()=>setTimeout(()=>{cleanupDone=true;reject(Object.assign(Error('cancelled'),{name:'AbortError'}));},30),{once:true}));}});
 f.call('feishu_calendar',{},'local');await delay(5);
 f.event({type:'input_audio_buffer.speech_started'});assert.equal(signal.aborted,false);
 await f.service.steer(f.reservation.voiceSessionId,{mode:'append',text:'顺便问一下'});assert.equal(signal.aborted,false);
 const close=f.service.close(f.reservation.voiceSessionId);assert.equal(cleanupDone,false);await close;assert.equal(signal.aborted,true);assert.equal(cleanupDone,true);assert.equal(f.audit.filter(e=>e.type==='call.closed').length,1);assert.equal(f.invocations.length,0);await f.service.dispose();
});

test('show_content publishes exact Markdown locally and confirms actual UI receipt',async()=>{
 const f=await fixture();const markdown='# 完整资料\n\n![图](https://cdn.test/a.webp)\n\n真实结果';
 f.call('show_content',{markdown});await delay(30);
 const doc=f.client.sent.find(x=>x.type==='backend.result');assert.equal(doc.text,markdown);
 assert.equal(f.audit.find(x=>x.type==='tool.delivered').result.shown,true);
 assert(!f.invocations.some(x=>x.name==='show_content'));
 assert.equal(f.service.presentation(f.reservation.voiceSessionId).documents[0].text,markdown);
 assert.equal(f.service.contentShown('foreign-owner',doc.callId),false);
 await f.service.dispose();
});
test('missing UI receipt is submitted, not a false display success; a snapshot recovers the document',async()=>{
 const f=await fixture(undefined,'grok',{autoContentAck:false});f.call('show_content',{markdown:'# 真实报告\n结果未确认上屏'});await delay(30);
 const result=f.audit.find(x=>x.type==='tool.delivered').result;assert.equal(result.published,true);assert.equal(result.shown,false);
 const snap=f.service.presentation(f.reservation.voiceSessionId);assert.equal(snap.documents.length,1);
 assert.equal(f.service.presentation(f.reservation.voiceSessionId,snap.revision).documents.length,0);
 assert.equal(f.service.contentShown(f.reservation.voiceSessionId,'unknown-report'),false);await f.service.dispose();
});

test('displaying existing content does not pretend to query new sources',async()=>{
 const f=await fixture(undefined,'seeduplex');f.event({type:'response.function_call_arguments.done',items:[{call_id:'show-first',name:'show_content',arguments:JSON.stringify({markdown:'# 已有结果\n甲方案7元'})}]});await delay(30);
 assert(f.client.sent.some(x=>x.type==='backend.result'));assert.equal(f.audit.find(x=>x.type==='tool.delivered').result.shown,true);
 assert(!f.client.sent.some(x=>x.source==='cached-native-tool-start'));assert(!f.audit.some(x=>x.type==='transcript'&&x.source==='tool-start'));await f.service.dispose();
});

test('ordinary hangup detaches its real backend, redial is possible, late final only goes to Feishu',async()=>{
 let cancelled=false;const sends=[];
 const f=await fixture(async(args,method)=>{
  if(method==='chat.send')return {runId:args.idempotencyKey,status:'started'};
  if(method==='send'){sends.push(args);return {messageId:'om-'+sends.length};}
  if(method==='chat.abort'){cancelled=true;return {ok:true};}
  return cancelled?{status:'error',aborted:true}:new Promise(()=>{});
 });
 f.call('delegate_to_v',{question:'处理一个任务'});await delay(10);const started=f.audit.find(e=>e.type==='backend.started');
 f.event({type:'conversation.item.input_audio_transcription.completed',transcript:'我挂电话了，之后把进展都发在群里面'});
 // Fixture uses a non-Feishu session; the task must still survive without sending anywhere.
 await f.service.close(f.reservation.voiceSessionId);assert.equal(cancelled,false);assert.equal(f.client.readyState,3);
 const next=await f.service.reserve({model:'grok',sessionKey:'agent:makaron:explicit:personal-fixture'});assert(next.voiceSessionId!==f.reservation.voiceSessionId);
 f.completeBackend('真实任务完成');await delay(10);
 assert.equal(cancelled,false);assert.equal(sends.length,0);assert(!f.client.sent.some(e=>e.type==='backend.result'));await f.service.dispose();
});

test('backend cancellation uses its Worker registry; never sends backend IDs to Gateway process',async()=>{
 let cancelled=false,started;
 const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:method==='vlab.workers.voice.cancelProcesses'?(cancelled=true,{runId:args.runId,sessionKey:args.sessionKey,confirmed:true,pendingExecs:0,processes:[{sessionId:'worker-owned',result:{details:{status:'failed',exitSignal:'SIGTERM'}}}]}):method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
 f.call('delegate_to_v',{question:'后台执行长命令'});await delay(5);started=f.audit.find(x=>x.type==='backend.started');
 f.service.handleEvent({event:'agent',payload:{runId:started.runId,sessionKey:started.sessionKey,stream:'tool',data:{phase:'result',name:'exec',toolCallId:'exec',result:{details:{status:'running',sessionId:'worker-owned'}}}}});
 const answer=await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消后台'});assert(answer.cancelled);assert(!f.invocations.some(x=>x.name==='process'));assert(f.audit.some(x=>x.type==='backend.cancel-observed'));await f.service.dispose();
});

test('candidate delivery experiment is Grok-only and propagates catalog to real session config',async t=>{
 const options={grokSpeed:1.06,grokExpressiveTags:true};
 const grok=await fixture(undefined,'grok',options);t.after(()=>grok.service.dispose());
 assert.equal(grok.service.models().find(m=>m.id==='grok').speed,1.06);
 assert.equal(grok.upstream.sent[0].session.audio.output.speed,1.06);assert(grok.upstream.sent[0].session.instructions.includes('[chuckle]'));
 const seed=await fixture(undefined,'seeduplex',options);t.after(()=>seed.service.dispose());
 assert.equal(seed.upstream.sent[0].session.audio.output.speed,0);assert(!seed.upstream.sent[0].session.instructions.includes('Grok speech delivery experiment'));
});

test('SeedDuplex steers and appends to the exact existing backend without a second delegation',async t=>{
 const controls=[],starts=[];
 const f=await fixture(async(args,method)=>{
  if(method==='chat.send'){starts.push(args);return {runId:args.idempotencyKey,status:'started'};}
  if(method==='voice.product.task.control'){controls.push(args);return {taskId:args.taskId,ok:true,queued:true};}
  await delay(10);return {status:'running'};
 },'seeduplex');t.after(()=>f.service.dispose());
 const native=(id,name,args)=>f.event({type:'response.function_call_arguments.done',items:[{call_id:id,name,arguments:JSON.stringify(args)}]});
 native('original','delegate_to_v',{question:'整理一份原始报告'});
 for(let i=0;i<100&&!f.audit.some(e=>e.type==='backend.started');i++)await delay(5);
 const started=f.audit.find(e=>e.type==='backend.started');assert(started);
 native('correction','openclaw_agent_control',{mode:'steer',text:'只保留新版要求'});
 native('addition','openclaw_agent_control',{mode:'followup',text:'最后追加一个总结'});
 for(let i=0;i<100&&controls.length<2;i++)await delay(5);
 assert.equal(controls.length,2);assert.equal(f.invocations.filter(x=>x.question?.includes('完整目标')).length,1);
 assert(controls.every(e=>e.taskId===started.ack.taskId));
 assert.deepEqual(controls.map(e=>e.mode),['steer','followup']);
 const receipt=await f.service.steer(f.reservation.voiceSessionId,{mode:'steer',text:'文字输入也改原任务'});
 assert.equal(receipt.queued,true);assert.equal(receipt.applied,false);assert.equal(f.invocations.filter(x=>x.question?.includes('完整目标')).length,1);
 f.completeBackend('新版要求和总结已完成。');
 await delay(250);assert(f.audit.some(e=>e.type==='backend.completed'&&e.runId===started.runId));
});


test('speaker routing failure closes the call without falling back to raw native audio',async t=>{
 let present=true,routed=0;
 const routing={reserve:()=>({policy:'speaker'}),has:()=>present,bind:async()=>{},close:()=>{present=false;},audio:()=>{routed++;}};
 const f=await fixture(undefined,'grok',{speakerRouting:routing});t.after(()=>f.service.dispose());
 const before=f.upstream.sent.filter(e=>e.type==='input_audio_buffer.append').length;
 f.client.emit('message',Buffer.alloc(960),true);assert.equal(routed,1);
 present=false;f.client.emit('message',Buffer.alloc(960),true);await delay(5);
 assert.equal(f.upstream.sent.filter(e=>e.type==='input_audio_buffer.append').length,before);
 assert(f.client.sent.some(e=>e.type==='error'&&e.message.includes('识别已中断')));
 assert.equal(f.client.readyState,3);
});
test('a fatal speaker channel error promptly closes the browser transport without cancelling admitted background work',async t=>{
 let listener,cancelled=false;const routing={reserve:()=>({policy:'streaming'}),has:()=>true,bind:async(_id,_native,emit)=>{listener=emit;},close(){},audio(){}};
 const f=await fixture(async(args,method)=>{if(method==='chat.send')return {runId:args.idempotencyKey,status:'started'};if(method==='chat.abort'){cancelled=true;return {ok:true};}await delay(10);return {status:cancelled?'error':'running',aborted:cancelled};},'seeduplex',{speakerRouting:routing});t.after(()=>f.service.dispose());
 f.event({type:'response.function_call_arguments.done',items:[{call_id:'ongoing',name:'delegate_to_v',arguments:JSON.stringify({question:'整理原任务'})}]});for(let i=0;i<100&&!f.audit.some(e=>e.type==='backend.started');i++)await delay(5);assert(f.audit.some(e=>e.type==='backend.started'));
 listener({type:'error',reason:'asr-disconnected',message:'识人语音通道暂时断开，请重新拨号。'});for(let i=0;i<100&&f.client.readyState!==3;i++)await delay(5);assert.equal(f.client.readyState,3);assert.equal(cancelled,false);assert.equal(f.service.backgroundTaskCount(),1);
});
test('speaker farewell requires actual audio, completed response and matching playback drain',async t=>{
 let native;const routing={reserve:()=>({policy:'streaming'}),has:()=>true,bind:async(_id,value)=>{native=value;},close(){},audio(){}};
 const f=await fixture(undefined,'seeduplex',{speakerRouting:routing});t.after(()=>f.service.dispose());
 native.end({turnId:'sp1'});const id='speaker-end-sp1';assert(f.client.sent.some(e=>e.type==='end.accepted'&&e.callId===id));assert(f.upstream.sent.some(e=>e.type==='speech_text_buffer.commit'&&e.text.includes('拜拜')));
 const drained=()=>f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.drained',callId:id})),false);
 drained();assert.equal(f.client.readyState,1);f.event({type:'response.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});drained();assert.equal(f.client.readyState,1);
 f.event({type:'response.done',response:{id:'bye',status:'completed'}});assert(f.client.sent.some(e=>e.type==='end.after-playback'));drained();await delay(5);assert.equal(f.client.readyState,3);assert(f.audit.some(e=>e.type==='speaker.end-played'));
});
test('new speech revokes a speaker farewell so stale playback acknowledgements cannot close the call',async t=>{
 let native;const routing={reserve:()=>({policy:'streaming'}),has:()=>true,bind:async(_id,value)=>{native=value;},close(){},audio(){}};
 const f=await fixture(undefined,'seeduplex',{speakerRouting:routing});t.after(()=>f.service.dispose());native.end({turnId:'sp1'});native.cancelEnd();f.event({type:'response.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});f.event({type:'response.done',response:{id:'bye',status:'completed'}});f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.drained',callId:'speaker-end-sp1'})),false);await delay(5);assert.equal(f.client.readyState,1);assert(f.client.sent.some(e=>e.type==='end.cancelled'));
});

test('host-owned speaker ending removes native end_call advertising while other direct modes retain it',async t=>{
 const routing={reserve:()=>({policy:'streaming'}),has:()=>true,controlsEnding:()=>true,bind:async()=>{},close(){},audio(){}};const controlled=await fixture(undefined,'seeduplex',{speakerRouting:routing});t.after(()=>controlled.service.dispose());assert.equal(controlled.client.sent.find(e=>e.type==='ready').tools.includes('end_call'),false);assert.match(JSON.stringify(controlled.upstream.sent),/通话控制由主机负责/);
 const original=await fixture(undefined,'seeduplex');t.after(()=>original.service.dispose());assert(original.client.sent.find(e=>e.type==='ready').tools.includes('end_call'));
});
for(const model of ['grok','seeduplex']) test(`${model} delegates the actual finalized caller turn, independently of paraphrase and later chat`,async t=>{
 const f=await fixture(undefined,model);t.after(()=>f.service.dispose());
 const original='独立编号乙：新建子任务，等十秒重新查时间，不能沿用之前的结果。';
 f.event({type:'conversation.item.input_audio_transcription.completed',transcript:original});
 if(model==='seeduplex')f.event({type:'response.function_call_arguments.done',items:[{call_id:'fresh',name:'delegate_to_v',arguments:JSON.stringify({question:'查询时间'})}]});
 else f.call('delegate_to_v',{question:'查询时间'},'fresh');
 f.event({type:'conversation.item.input_audio_transcription.completed',transcript:'你继续做，我随便聊两句'});
 await delay(10);
 const prompt=f.invocations.find(x=>x.question)?.question;assert(prompt);
 assert(prompt.includes(JSON.stringify(original)));
 assert(!prompt.includes('你继续做，我随便聊两句'));
 assert(prompt.includes(f.reservation.voiceSessionId));
 assert(prompt.includes('不能复述旧任务的完成报告'));
 f.completeBackend('本次子任务已返回新查询的实际结果');await delay(250);
});

test('typed supplement becomes the original turn for a new delegation',async t=>{
 const f=await fixture();t.after(()=>f.service.dispose());
 await f.service.steer(f.reservation.voiceSessionId,{mode:'append',text:'独立编号丙，创建新任务'});
 f.call('delegate_to_v',{question:'创建任务'});await delay(10);
 assert(f.invocations.find(x=>x.question)?.question.includes(JSON.stringify('独立编号丙，创建新任务')));
 f.completeBackend('完成');await delay(250);
});

test('Seed hangup retains release ownership until the actual final delivery receipt arrives',async t=>{
 let finalSend,finalStarted=false;
 const receipt=new Promise(resolve=>finalSend=resolve);
 const f=await fixture(async(args,method)=>{
   if(method==='send'){
     if(args.message==='原后台最终结果'){finalStarted=true;return receipt;}
     return {messageId:'accepted-message'};
   }
   return {ok:true};
 },'seeduplex',{sessionKey:'agent:makaron:feishu:group:oc_test'});
 t.after(()=>f.service.dispose());
 f.event({type:'conversation.item.input_audio_transcription.completed',text:'做好后把结果发到群里'});
 f.event({type:'response.function_call_arguments.done',items:[{call_id:'job',name:'delegate_to_v',arguments:JSON.stringify({question:'原任务'})}]});
 for(let n=0;n<100&&!f.audit.some(e=>e.type==='backend.started');n++)await delay(2);
 assert.equal(f.service.backgroundTaskCount(),1);await f.service.close(f.reservation.voiceSessionId);
 assert.equal(f.service.backgroundTaskCount(),1);f.completeBackend('原后台最终结果');
 for(let n=0;n<100&&!finalStarted;n++)await delay(2);
 assert(finalStarted);assert.equal(f.service.backgroundTaskCount(),1,'An unconfirmed send is still pending work');
 finalSend({messageId:'actual-final-message'});
 for(let n=0;n<100&&f.service.backgroundTaskCount();n++)await delay(2);
 assert.equal(f.service.backgroundTaskCount(),0);assert(f.audit.some(e=>e.type==='task.delivery-confirmed'&&e.kind==='final'));
});

test('speaker delegation freezes admitted ASR, ignoring earlier speculative native transcription',async t=>{
 let admitted;const routing={reserve:()=>({policy:'streaming'}),has:()=>true,bind:async(_id,_native,listener)=>{admitted=listener;},close(){},audio(){}};
 const f=await fixture(undefined,'seeduplex',{speakerRouting:routing});t.after(()=>f.service.dispose());
 f.event({type:'conversation.item.input_audio_transcription.completed',transcript:'未准入的旧句'});
 admitted({type:'speaker.admitted',turn:{text:'通过准入的完整后台目标'}});
 f.event({type:'conversation.item.input_audio_transcription.completed',transcript:'原生ASR滞后的旧声音'});
 f.event({type:'response.function_call_arguments.done',items:[{call_id:'admitted-job',name:'delegate_to_v',arguments:JSON.stringify({question:'简短转述'})}]});await delay(10);
 const question=f.invocations.find(x=>x.question)?.question;assert(question?.includes('通过准入的完整后台目标'));assert(!question.includes('原生ASR滞后的旧声音'));
 f.completeBackend('完成');await delay(30);
});
test('server records ingress and upstream pacing even when no client statistics arrive',async t=>{
 const f=await fixture(async()=>({ok:true}),'seeduplex');t.after(()=>f.service.dispose());
 for(let i=0;i<10;i++)f.client.emit('message',Buffer.alloc(960),true);
 for(let i=0;i<50&&!f.audit.some(e=>e.type==='call.input-timing');i++)await delay(50);
 const row=f.audit.find(e=>e.type==='call.input-timing');assert(row);assert.equal(row.serverInputBytes,9600);assert.equal(row.serverInputFrames,10);assert(row.providerInputFramesSent>0);assert.equal(row.providerPendingAudioMs,0);assert(row.serverInputIdleMs>1000);
 assert.equal(f.audit.some(e=>e.type==='client.playback-stats'),false);
});
