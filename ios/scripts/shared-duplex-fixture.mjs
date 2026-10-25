#!/usr/bin/env node
// Local-only acceptance: production H5/service/provider adapter, simulated upstream.
// No provider socket, real tools, recording, personal context or paid request.
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {WebSocketServer} from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {DEFAULT_NATIVE_RUNTIME_POLICY} from '../../lab/realtime-direct-tools/native-runtime.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
const port=Number(process.env.VVOICE_SHARED_FIXTURE_PORT??29847);
const iosUseFixture=process.env.VVOICE_IOS_USE_FIXTURE==='1',iosResults=[],iosProgress=[],iosFrontendStatuses=[],iosBackendStatuses=[];
let fastDials=0,statusRequests=0,httpSessionRequests=0;
let nativePeer,nativeVoiceID;
class CapturedServer extends WebSocketServer {handleUpgrade(req,socket,head,callback){super.handleUpgrade(req,socket,head,client=>{nativePeer=client;callback(client);});}}
let peer,inputFrames=0,outputPackets=0,lookupCalls=0,sessionRequests=[],playbackBusy=false,clears=0;
const emit=value=>{if(!peer||peer.readyState!==1)throw Error('Fixture relay is not connected');peer.emit('message',Buffer.from(JSON.stringify(value)),false);};
const tone=(seconds,hz)=>{const n=Math.round(24000*seconds),b=Buffer.alloc(n*4);for(let i=0;i<n;i++)b.writeFloatLE(.15*Math.sin(i*2*Math.PI*hz/24000),i*4);return b.toString('base64');};
const oldTone=tone(5,440),newTone=tone(.35,880),farewell=tone(.15,660);
const start=id=>emit({type:'response.output_audio.started',response_id:id,tts_type:'default'});
const audio=(id,delta)=>{outputPackets++;emit({type:'response.output_audio.delta',response_id:id,delta});};
const done=id=>emit({type:'response.output_audio.done',response_id:id});
const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
class Upstream extends EventEmitter{
 constructor(){super();this.readyState=1;peer=this;setImmediate(()=>this.emit('open'));}
 send(raw){const value=JSON.parse(raw);if(iosUseFixture){const match=strings(value).join('\n').match(/"calendar\.query":\{"status":"(\w+)"/u);if(match)iosFrontendStatuses.push(match[1]);}if(iosUseFixture&&value.type==='conversation.item.create'&&JSON.stringify(value).includes('eventkit_'))iosResults.push(value);if(value.type==='session.create')queueMicrotask(()=>emit({type:'session.created',session:{id:'local-duplex'}}));if(value.type==='input_audio_buffer.append')inputFrames++;}
 close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
}
const gateway=Object.assign(new EventEmitter(),{ready:true,async request(method,args){
 if(iosUseFixture&&method==='voice.product.task.start'){const match=args.question.match(/"calendar\.query":\{"status":"(\w+)"/u);if(match)iosBackendStatuses.push(match[1]);return {taskId:'ios-fixture-task',runId:'ios-fixture-run'};}
 if(iosUseFixture&&method==='voice.product.task.read')return {taskId:'ios-fixture-task',status:'ok',text:'已读取当前设备权限，未执行设备动作。'};
 if(method==='tools.catalog')return {groups:[{tools:[{id:'web_search'},{id:'memory_search'}]}]};
 if(method==='tools.invoke'){lookupCalls++;return {ok:true,output:{answer:'local fixture result'}};}
 return {ok:true};
}});
const routing={snapshot:()=>({}),reserve:()=>null,has:()=>false,lazyNative:()=>false,assistant(){},close(){},dispose(){}};
const runtimePolicy=structuredClone(DEFAULT_NATIVE_RUNTIME_POLICY);
const directVoice=createDirectVoiceService({nativeRuntimePolicy:runtimePolicy,gateway,wsModule:{WebSocket:Upstream,WebSocketServer:iosUseFixture?CapturedServer:WebSocketServer},apiKeys:{seeduplex:'local-fixture-only'},speakerRouting:routing,nativePlaybackPolicy:'assisted',loadContext:async()=>'',audit:e=>{if(e.type==='device.ios.progress')iosProgress.push({status:e.status});if(e.type==='client.playback-state')playbackBusy=e.speaking;if(e.type==='audio.clear')clears++;}});
const reserve=directVoice.reserve;directVoice.reserve=async args=>{sessionRequests.push({model:args.model,inputPolicy:args.inputPolicy,nativeRuntimeVersion:args.nativeRuntimeVersion});const value=await reserve({...args,...(iosUseFixture?{terminalKind:'ios'}:{})});nativeVoiceID=value.voiceSessionId;return value;};
const attach=directVoice.attach;directVoice.attach=(id,ticket,client)=>{nativePeer=client;nativeVoiceID=id;return attach(id,ticket,client);};
const bridge=createLiveH5Server({gateway,directVoice,speakerRouting:routing,phoneInputPolicy:'native',basePath:'/voice',defaultModel:'seeduplex',avatarEvaluate:async()=>({picture:'listen-5',continuations:[]})});
// The native debug binding omits a nonstandard Origin port. Normalize only
// this loopback fixture; the production origin checks remain unchanged.
const normalize=req=>{if(req.headers.host===`127.0.0.1:${port}`&&req.headers.origin==='http://127.0.0.1')req.headers.origin=`http://127.0.0.1:${port}`;};
bridge.server.prependListener('upgrade',req=>{normalize(req);if(req.url.startsWith('/voice/api/dial?'))fastDials++;});
const handler=bridge.server.listeners('request')[0];bridge.server.removeAllListeners('request');
bridge.server.on('request',async(req,res)=>{
 if(!req.url.startsWith('/fixture/')){normalize(req);if(req.url.startsWith('/voice/api/status'))statusRequests++;if(req.url.startsWith('/voice/api/session'))httpSessionRequests++;return handler(req,res);}
 const send=(code,value)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/fixture/state')return send(200,{fastDials,statusRequests,httpSessionRequests,connected:peer?.readyState===1,inputFrames,outputPackets,lookupCalls,sessionRequests,playbackBusy,clears,iosResults,iosProgress,iosFrontendStatuses,iosBackendStatuses});
 if(req.url!=='/fixture/command'||req.method!=='POST')return send(404,{});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('Fixture command too large');}
  const {command}=JSON.parse(raw);
  if(command==='policy-v1'){runtimePolicy.copy.connected='候选策略一已接通';runtimePolicy.pause.speechOnsetMS=140;}
  else if(command==='policy-v2'){runtimePolicy.copy.connected='候选策略二已接通';runtimePolicy.pause.speechOnsetMS=220;}
  else if(command==='caption'){emit({type:'response.output_text.done',response_id:'caption',text:'新服务端策略的字幕，无需修改安装包。'});}
  else if(command==='old'){start('old');audio('old',oldTone);done('old');}
  else if(command==='speech-start'){emit({type:'conversation.item.input_audio_transcription.started'});}
  else if(command==='speech-complete'){emit({type:'conversation.item.input_audio_transcription.completed',text:'请换个话题'});}
  else if(command==='speech-failed'){emit({type:'conversation.item.input_audio_transcription.failed'});}
  else if(command==='ignored'){emit({type:'response.output_text.done',response_id:'aside-'+Date.now(),text:'（安静等候，不插话、不回应背景广播）'});}
  else if(iosUseFixture&&command==='device-context'){if(nativePeer?.readyState!==1)throw Error('No current native client');nativePeer.send(JSON.stringify({type:'device.context',version:1,voiceSessionId:nativeVoiceID,terminalContext:{version:1,terminal:{kind:'ios'}}}));}
  else if(iosUseFixture&&['revoke-calendar','grant-calendar'].includes(command)){if(process.env.VVOICE_IOS_FIXTURE_SIMULATOR!=='24B897EC-974A-439B-94E5-FC8D17D10C05')throw Error('Explicit owned simulator required');execFileSync('xcrun',['simctl','privacy',process.env.VVOICE_IOS_FIXTURE_SIMULATOR,command==='revoke-calendar'?'revoke':'grant','calendar','com.versa.vvoice']);}
  else if(iosUseFixture&&command==='backend-context'){emit({type:'response.function_call_arguments.done',items:[{call_id:'ios-backend-'+Date.now(),name:'delegate_to_v',arguments:JSON.stringify({question:'读取此刻设备权限，不执行设备动作。'})}]});}
  else if(iosUseFixture&&command==='calendar-query'){emit({type:'response.function_call_arguments.done',items:[{call_id:'ios-calendar-query',name:'ios_use',arguments:JSON.stringify({operation:'calendar.query',payload:{start:'2031-01-02T10:00:00+08:00',end:'2031-01-02T10:30:00+08:00',limit:1}})}]});}
  else if(iosUseFixture&&command==='calendar'){emit({type:'response.function_call_arguments.done',items:[{call_id:'ios-calendar-fixture',name:'ios_use',arguments:JSON.stringify({operation:'calendar.create',payload:{title:'V Voice transport Candidate',body:'Simulator-only fixture',start:'2031-01-02T10:00:00+08:00',end:'2031-01-02T10:30:00+08:00',timeZone:'Asia/Shanghai'}})}]});}
  else if(command==='lookup'){emit({type:'response.function_call_arguments.done',items:[{call_id:'local-search',name:'web_search',arguments:'{"query":"local fixture only"}'}]});}
  else if(command==='replace'){emit({type:'response.output_text.delta',response_id:'next',delta:'本地新回答'});audio('old',oldTone);emit({type:'response.done'});}
  else if(command==='next'){start('next');audio('next',newTone);audio('old',oldTone);done('old');done('next');}
  else if(command==='farewell'){emit({type:'response.function_call_arguments.done',items:[{call_id:'local-end',name:'end_call',arguments:'{}'}]});setTimeout(()=>{if(peer?.readyState===1){start('farewell');audio('farewell',farewell);done('farewell');}},40);}
  else return send(400,{error:'Unknown fixture command'});
  send(200,{ok:true});
 }catch(error){send(409,{error:error.message});}
});
bridge.server.listen(port,'127.0.0.1',()=>console.log(`Shared duplex local fixture http://127.0.0.1:${port}/voice/; no model calls`));
const close=()=>{void bridge.dispose().finally(()=>process.exit(0));};process.once('SIGINT',close);process.once('SIGTERM',close);
