import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createDirectVoiceService} from './session.mjs';

async function fixture(invoke=async()=>({ok:true,output:{answer:'实际结果'}}),model='grok',options={}) {
 const peers=[],audit=[],invocations=[];
 class WS extends EventEmitter {constructor(){super();this.readyState=1;this.sent=[];peers.push(this);queueMicrotask(()=>this.emit('open'));}
  send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.type==='session.update')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.updated'})),false));if(value.type==='session.create')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.created'})),false));}
  close(){this.readyState=3;this.emit('close');}}
 class Server {handleUpgrade(req,socket,head,done){done(socket);}close(){}}
 const gateway={request:async(method,args)=>{
  if(method==='tools.catalog')return {groups:[{tools:['memory_search','web_search','web_fetch','exec','process'].map(id=>({id}))}]};
  invocations.push(args);return invoke(args,method);
 }};
 const service=createDirectVoiceService({gateway,wsModule:{WebSocket:WS,WebSocketServer:Server},apiKeys:{grok:'fixture-key',seeduplex:'fixture-key'},audit:v=>audit.push(v),...options});
 const reservation=await service.reserve({model,sessionKey:'agent:makaron:explicit:personal-fixture'});
 const client=new EventEmitter();client.readyState=1;client.sent=[];client.send=raw=>client.sent.push(JSON.parse(raw));client.close=()=>{client.readyState=3;client.emit('close');};
 service.upgrade({},client,Buffer.alloc(0),reservation.voiceSessionId,reservation.relayTicket);await delay(5);
 const upstream=peers[0],event=v=>upstream.emit('message',Buffer.from(JSON.stringify(v)),false);
 const call=(name,args,id='call-1')=>{event({type:'response.created',response:{id:'response-'+id}});event({type:'response.function_call_arguments.done',response_id:'response-'+id,call_id:id,name,arguments:JSON.stringify(args)});event({type:'response.done',response:{id:'response-'+id,status:'completed'}});};
 return {service,reservation,client,upstream,event,call,audit,invocations};
}
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
 const backend=e=>f.service.handleEvent({event:e.event??'chat',payload:{runId:started.runId,sessionKey:started.sessionKey,...e.payload}});
 f.client.emit('message',Buffer.from(JSON.stringify({type:'playback.state',speaking:true})),false);
 backend({event:'agent',payload:{stream:'tool',data:{phase:'result',name:'memory_search'}}});
 backend({event:'agent',payload:{stream:'item',data:{kind:'preamble',phase:'end',progressText:'第一步查到了实际记录，正在核对网页。'}}});
 await delay(250);assert.equal(f.upstream.sent.some(x=>x.item?.type==='force_message'),false);
 await f.service.steer(f.reservation.voiceSessionId,{mode:'steer',text:'顺便和我聊聊天'});
 assert.equal(f.invocations.filter(x=>x.message?.includes('完整目标')).length,1);
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
 assert(f.invocations.some(x=>x.runId===started.runId&&x.sessionKey===started.sessionKey));assert(!f.client.sent.some(x=>x.type==='backend.result'));await f.service.dispose();
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

test('backend cancellation uses its Worker registry; never sends backend IDs to Gateway process',async()=>{
 let cancelled=false,started;
 const f=await fixture(async(args,method)=>method==='chat.send'?{runId:args.idempotencyKey,status:'started'}:method==='vlab.workers.voice.cancelProcesses'?(cancelled=true,{runId:args.runId,sessionKey:args.sessionKey,confirmed:true,pendingExecs:0,processes:[{sessionId:'worker-owned',result:{details:{status:'failed',exitSignal:'SIGTERM'}}}]}):method==='chat.abort'?(cancelled=true,{ok:true}):cancelled?{status:'error',aborted:true}:new Promise(()=>{}));
 f.call('delegate_to_v',{question:'后台执行长命令'});await delay(5);started=f.audit.find(x=>x.type==='backend.started');
 f.service.handleEvent({event:'agent',payload:{runId:started.runId,sessionKey:started.sessionKey,stream:'tool',data:{phase:'result',name:'exec',toolCallId:'exec',result:{details:{status:'running',sessionId:'worker-owned'}}}}});
 const answer=await f.service.steer(f.reservation.voiceSessionId,{mode:'cancel',text:'取消后台'});assert(answer.cancelled);assert(!f.invocations.some(x=>x.name==='process'));assert(f.audit.some(x=>x.type==='backend.process-cancel-observed'));await f.service.dispose();
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
 const event={event:'chat',payload:{runId:started.runId,sessionKey:started.sessionKey,state:'final',message:{content:[{type:'text',text}]}}};f.service.handleEvent(event);f.service.handleEvent(event);await delay(250);
 const docs=f.client.sent.filter(x=>x.type==='backend.result');assert.equal(docs.length,1);assert.equal(docs[0].text,text);assert.equal(docs[0].callId,'call-1');assert.equal(docs[0].voiceSessionId,f.reservation.voiceSessionId);
 const speech=f.upstream.sent.filter(x=>x.item?.type==='force_message');assert.equal(speech.length,1);assert(speech[0].item.content[0].text.includes('屏幕'));assert(speech[0].item.content[0].text.includes('原始事实'));assert(speech[0].item.content[0].text.length<200);
 assert.equal(f.invocations.filter(x=>x.message?.includes('完整目标')).length,1);await f.service.dispose();
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
