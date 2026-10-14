// Explicit Candidate probe, excluded from npm test. No orders or payments.
import fs from 'node:fs';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';
import {createHash,randomUUID} from 'node:crypto';
import {GatewayClient} from '../lib/gateway-client.mjs';
import {createDirectVoiceService} from '../lab/realtime-direct-tools/session.mjs';

const unit='openclaw-vlab-production-mirror-v8.service';
const pid=execFileSync('systemctl',['show',unit,'-p','MainPID','--value'],{encoding:'utf8'}).trim();
const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
const config=JSON.parse(fs.readFileSync(env.OPENCLAW_CONFIG_PATH,'utf8'));
assert.equal(config.gateway.port,24993,'Must use VLab, never production');
const sessionKey=process.env.VOICE_TEST_SESSION;
assert.match(sessionKey??'',/^agent:makaron:feishu:group:oc_/,'A human-authorized test destination is required');
let service;const requests=[],events=[],audit=[],peers=[];let gateway;
const ready=Promise.withResolvers();
gateway=new GatewayClient({url:'ws://127.0.0.1:24993',token:String(config.gateway.auth.token).replace(/\$\{([^}]+)\}/g,(_,k)=>env[k]??''),
 onHelloOk:ready.resolve,onConnectError:e=>ready.reject(e),onEvent:e=>{events.push(e);service?.handleEvent(e);}});
gateway.start();await ready.promise;
const rpc={request:async(method,args,options)=>{requests.push({method,runId:args.runId,idempotencyKey:args.idempotencyKey});return gateway.request(method,args,options);}};
class Wire extends EventEmitter {
 constructor(){super();this.readyState=1;this.sent=[];peers.push(this);setImmediate(()=>this.emit('open'));}
 send(raw){const e=JSON.parse(raw);this.sent.push(e);if(e.type==='session.create')queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.created',session:{id:'candidate-protocol'}})),false));}
 close(){this.readyState=3;this.emit('close');}
}
class Server{handleUpgrade(req,socket,head,done){done(socket);}close(){}}
const summaries=[];
try{
 service=createDirectVoiceService({gateway:rpc,wsModule:{WebSocket:Wire,WebSocketServer:Server},apiKeys:{seeduplex:'protocol-injection-not-provider-credential'},audit:e=>audit.push(e)});
 const reservation=await service.reserve({model:'seeduplex',sessionKey});
 const client=new EventEmitter();client.readyState=1;client.sent=[];client.send=raw=>client.sent.push(JSON.parse(raw));client.close=()=>{client.readyState=3;client.emit('close');};
 service.upgrade({},client,Buffer.alloc(0),reservation.voiceSessionId,reservation.relayTicket);
 for(let i=0;i<200&&!client.sent.some(e=>e.type==='ready');i++)await delay(10);
 assert(client.sent.some(e=>e.type==='ready'));
 const upstream=peers[0],push=e=>upstream.emit('message',Buffer.from(JSON.stringify(e)),false);
 const mark='VOICE_CANDIDATE_CONTINUE_'+randomUUID().slice(0,8);
 push({type:'conversation.item.input_audio_transcription.completed',transcript:'这是语音 Candidate 测试。挂电话后把进展和结果发在群里。'});
 push({type:'response.function_call_arguments.done',items:[{call_id:'candidate-long-task',name:'delegate_to_v',arguments:JSON.stringify({question:`这是天意授权的语音 Candidate 测试，不点外卖、不付款、不调浏览器、不生成媒体。请实际用 exec 运行 node -e "setTimeout(()=>console.log('${mark}'),8000)"，若返回 process session 就 poll 到退出。只有进程退出后最终回复：语音 Candidate 测试完成：${mark}，挂断后后台正常继续。不得自己发送飞书，宿主会交付。`})}]});
 let started;for(let i=0;i<300&&!started;i++){started=audit.find(e=>e.type==='backend.started');await delay(20);}
 assert(started,'Real VLab backend was not admitted');
 await service.close(reservation.voiceSessionId);assert.equal(client.readyState,3);
 assert(!requests.some(r=>r.method==='chat.abort'&&r.runId===started.runId),'Ordinary hangup aborted real work');
 const redial=await service.reserve({model:'seeduplex',sessionKey});assert.notEqual(redial.voiceSessionId,reservation.voiceSessionId);await service.close(redial.voiceSessionId);
 const draining=service.dispose({drain:true});
 let delivered;for(let i=0;i<1200&&!delivered;i++){delivered=audit.find(e=>e.type==='task.delivery-confirmed'&&e.kind==='final'&&e.runId===started.runId);await delay(100);}
 assert(delivered,'No real Feishu final receipt');await draining;
 assert(!requests.some(r=>r.method==='chat.abort'&&r.runId===started.runId),'Graceful exit aborted real work');
 assert(!client.sent.some(e=>e.type==='backend.result'),'Old final leaked back into closed call');
 const history=await gateway.request('chat.history',{agentId:'makaron',sessionKey,limit:40});
 const final=[...(history.messages??[])].reverse().find(m=>m.__openclaw?.runId===started.runId&&m.role==='assistant'&&m.content?.some?.(b=>b.type==='text'&&b.text?.includes(mark)));
 assert(final,'Exact real Agent final missing');
 const messages=audit.filter(e=>e.type==='task.delivery-confirmed').map(e=>({kind:e.kind,messageId:e.receipt?.messageId,channel:e.receipt?.channel}));
 summaries.push({scenario:'SeedDuplex host protocol → real VLab Agent exec/process → hangup → real Feishu delivery',voiceSessionId:reservation.voiceSessionId,runId:started.runId,redial:true,gracefulExit:true,oldCallResult:false,messages,realProviderAudio:false});
 // Explicit cancellation remains separate from ordinary hangup.
 service=createDirectVoiceService({gateway:rpc,wsModule:{WebSocket:Wire,WebSocketServer:Server},apiKeys:{seeduplex:'protocol-injection-not-provider-credential'},audit:e=>audit.push(e)});
 const cancelling=await service.reserve({model:'seeduplex',sessionKey});
 const cancelClient=new EventEmitter();cancelClient.readyState=1;cancelClient.sent=[];cancelClient.send=raw=>cancelClient.sent.push(JSON.parse(raw));cancelClient.close=()=>{cancelClient.readyState=3;cancelClient.emit('close');};
 service.upgrade({},cancelClient,Buffer.alloc(0),cancelling.voiceSessionId,cancelling.relayTicket);
 for(let i=0;i<200&&!cancelClient.sent.some(e=>e.type==='ready');i++)await delay(10);
 const cancelWire=peers.at(-1);
 cancelWire.emit('message',Buffer.from(JSON.stringify({type:'response.function_call_arguments.done',items:[{call_id:'candidate-cancel-task',name:'delegate_to_v',arguments:JSON.stringify({question:'这是独立的语音 Candidate 取消测试，只执行 exec：node -e "setTimeout(()=>console.log(123),60000)"，yieldMs 设为1000。然后 process poll 直到退出，最终回复测试已结束。不要操作外卖、支付、浏览器或发送消息。'})}]})),false);
 let cancelStarted;for(let i=0;i<300&&!cancelStarted;i++){cancelStarted=audit.find(e=>e.type==='backend.started'&&e.voiceSessionId===cancelling.voiceSessionId);await delay(20);}
 assert(cancelStarted,'Cancellation test was not admitted');
 for(let i=0;i<300&&!events.some(e=>e.event==='agent'&&e.payload?.runId===cancelStarted.runId&&e.payload.stream==='tool'&&e.payload.data?.name==='exec'&&e.payload.data?.phase==='result');i++)await delay(100);
 const stopped=await service.steer(cancelling.voiceSessionId,{mode:'cancel',text:'明确取消这个 Candidate 测试任务'});
 assert.equal(stopped.cancelled,true,'Exact task/process cancellation was not confirmed');
 assert(requests.some(r=>r.method==='chat.abort'&&r.runId===cancelStarted.runId));
 summaries.push({scenario:'explicit cancellation of admitted real Agent task',runId:cancelStarted.runId,cancelled:stopped.cancelled,processCleanupFailures:stopped.processCleanupFailures,realProviderAudio:false});
 console.log(JSON.stringify({ok:true,environment:'VLab Candidate',sharedGatewayPid:pid,scenarios:summaries,sourceSha256:createHash('sha256').update(fs.readFileSync(new URL('../lab/realtime-direct-tools/session.mjs',import.meta.url))).digest('hex')},null,2));
}catch(error){console.error(JSON.stringify({error:error.message,audit:audit.filter(e=>e.type!=='backend.event').map(e=>({type:e.type,runId:e.runId,kind:e.kind,error:e.error,ack:e.ack,observed:e.observed,receipt:e.receipt,hasResult:Boolean(e.result)})),requests},null,2));throw error;}finally{await service?.dispose();gateway.stop();}
