#!/usr/bin/env node
// Local-only acceptance: production H5/service/provider adapter, simulated upstream.
// No provider socket, real tools, recording, personal context or paid request.
import {EventEmitter} from 'node:events';
import {WebSocketServer} from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {DEFAULT_NATIVE_RUNTIME_POLICY} from '../../lab/realtime-direct-tools/native-runtime.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
const port=Number(process.env.VVOICE_SHARED_FIXTURE_PORT??29847);
let fastDials=0,statusRequests=0,httpSessionRequests=0;
let peer,inputFrames=0,outputPackets=0,lookupCalls=0,sessionRequests=[],playbackBusy=false,clears=0;
const emit=value=>{if(!peer||peer.readyState!==1)throw Error('Fixture relay is not connected');peer.emit('message',Buffer.from(JSON.stringify(value)),false);};
const tone=(seconds,hz)=>{const n=Math.round(24000*seconds),b=Buffer.alloc(n*4);for(let i=0;i<n;i++)b.writeFloatLE(.15*Math.sin(i*2*Math.PI*hz/24000),i*4);return b.toString('base64');};
const oldTone=tone(5,440),newTone=tone(.35,880),farewell=tone(.15,660);
const start=id=>emit({type:'response.output_audio.started',response_id:id,tts_type:'default'});
const audio=(id,delta)=>{outputPackets++;emit({type:'response.output_audio.delta',response_id:id,delta});};
const done=id=>emit({type:'response.output_audio.done',response_id:id});
class Upstream extends EventEmitter{
 constructor(){super();this.readyState=1;peer=this;setImmediate(()=>this.emit('open'));}
 send(raw){const value=JSON.parse(raw);if(value.type==='session.create')queueMicrotask(()=>emit({type:'session.created',session:{id:'local-duplex'}}));if(value.type==='input_audio_buffer.append')inputFrames++;}
 close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
}
const gateway=Object.assign(new EventEmitter(),{ready:true,async request(method,args){
 if(method==='tools.catalog')return {groups:[{tools:[{id:'web_search'},{id:'memory_search'}]}]};
 if(method==='tools.invoke'){lookupCalls++;return {ok:true,output:{answer:'local fixture result'}};}
 return {ok:true};
}});
const routing={snapshot:()=>({}),reserve:()=>null,has:()=>false,lazyNative:()=>false,assistant(){},close(){},dispose(){}};
const runtimePolicy=structuredClone(DEFAULT_NATIVE_RUNTIME_POLICY);
const directVoice=createDirectVoiceService({nativeRuntimePolicy:runtimePolicy,gateway,wsModule:{WebSocket:Upstream,WebSocketServer},apiKeys:{seeduplex:'local-fixture-only'},speakerRouting:routing,nativePlaybackPolicy:'assisted',loadContext:async()=>'',audit:e=>{if(e.type==='client.playback-state')playbackBusy=e.speaking;if(e.type==='audio.clear')clears++;}});
const reserve=directVoice.reserve;directVoice.reserve=async args=>{sessionRequests.push({model:args.model,inputPolicy:args.inputPolicy,nativeRuntimeVersion:args.nativeRuntimeVersion});return reserve(args);};
const bridge=createLiveH5Server({gateway,directVoice,speakerRouting:routing,phoneInputPolicy:'native',basePath:'/voice',defaultModel:'seeduplex',avatarEvaluate:async()=>({picture:'listen-5',continuations:[]})});
// The native debug binding omits a nonstandard Origin port. Normalize only
// this loopback fixture; the production origin checks remain unchanged.
const normalize=req=>{if(req.headers.host===`127.0.0.1:${port}`&&req.headers.origin==='http://127.0.0.1')req.headers.origin=`http://127.0.0.1:${port}`;};
bridge.server.prependListener('upgrade',req=>{normalize(req);if(req.url.startsWith('/voice/api/dial?'))fastDials++;});
const handler=bridge.server.listeners('request')[0];bridge.server.removeAllListeners('request');
bridge.server.on('request',async(req,res)=>{
 if(!req.url.startsWith('/fixture/')){normalize(req);if(req.url.startsWith('/voice/api/status'))statusRequests++;if(req.url.startsWith('/voice/api/session'))httpSessionRequests++;return handler(req,res);}
 const send=(code,value)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/fixture/state')return send(200,{fastDials,statusRequests,httpSessionRequests,connected:peer?.readyState===1,inputFrames,outputPackets,lookupCalls,sessionRequests,playbackBusy,clears});
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
