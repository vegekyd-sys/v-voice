#!/usr/bin/env node
import {createDeviceLocation} from '../../lab/realtime-direct-tools/device-location.mjs';
// Local protocol fixture only. No providers, tool execution, personal data or costs.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hash,releaseRevision} from './h5-release.mjs';
import {WebSocketServer} from 'ws';
import {createNativeRuntime} from '../../lab/realtime-direct-tools/native-runtime.mjs';
import {normalizeAvatarEvent} from '../../lab/gpt-live-h5/avatar-telemetry.mjs';
const port=Number(process.env.VVOICE_FIXTURE_PORT??29837);
let active=null,client=null,sequence=0,sessions=0,inputBytes=0,zeroBytes=0,playbackDrained=0,playbackStarts=0,greetings=0,heartbeats=0,earlyAudio=false,slowSession=false;
let slowSessionMS=300;
let fastMode=false,fastReject=false,fastWrongOwner=false,fastDials=0,statusRequests=0,sessionRequests=0;
let deviceLocation=null,locationResults=[],systemBackgroundReady=false;
let presentationRequests=0;
let nativeMode=false,speakerMode=false,runtimeMode=false,nativeRuntime=null,lastSessionRequest=null;
let shellDelayMS=0;
let lastOffer=null,offerReply=null;const eventClients=new Set();
let limitNextSession=false,slowClose=false,closeRequests=0;
let documents=[],pending=[],acknowledgements=[],supplements=[];
let avatarRequests=[],avatarEvents=[],avatarReply="reaction-0",avatarContinuations=["reaction-1","listen-5"],slowAvatar=false;
let shellVariant='none',shellRequests=[],shellRedirects=0;
let inputFrames=0,inputActiveFrames=0,peakInputRMS=0;
async function shellRelease(variant){
 const release=JSON.parse(await readFile(new URL('../../lab/gpt-live-h5/ios-shell-release.json',import.meta.url),'utf8'));
 for(const file of release.files){
   let bytes=Buffer.from(file.data,'base64');
   if(file.path==='index.html')bytes=Buffer.from(bytes.toString().replace('</head>',`<meta name="fixture-ui-release" content="${variant}"></head>`).replace('</body>',`<div id="fixtureReleaseBadge">本地网页发布 ${variant.toUpperCase()}</div></body>`));
   if(file.path==='styles.css')bytes=Buffer.concat([bytes,Buffer.from(`\nbody{--fixture-ui-release:${variant}}#fixtureReleaseBadge{position:fixed;top:60px;left:20px;z-index:9999;padding:7px 12px;border-radius:12px;background:${variant==='a'?'#e5dcff':'#d5f3e7'};color:#463660;font:13px -apple-system}`)]);
   if(file.path==='native-h5.js'&&variant==='broken')bytes=Buffer.from('throw new Error("local broken release")');
   file.data=bytes.toString('base64');file.sha256=hash(bytes);file.bytes=bytes.length;
 }
 if(variant==='incompatible')release.minimumBridge=2;
 release.revision=releaseRevision(release);
 if(variant==='corrupt')release.files[0].data=Buffer.from('corrupt').toString('base64');
 return release;
}
const emit=v=>{
 if(v.type==='backend.result'){documents=documents.filter(d=>d.callId!==v.callId);documents.push(v);pending=pending.filter(t=>t.callId!==v.callId);}
 if(['tool.call','tool.progress'].includes(v.type)){const old=pending.find(t=>t.callId===v.callId)??{};pending=pending.filter(t=>t.callId!==v.callId);pending.push({...old,...v});}
 if(['tool.result','tool.error'].includes(v.type))pending=pending.filter(t=>t.callId!==v.callId);
 for(const response of eventClients)response.write(`data: ${JSON.stringify({voiceSessionId:active,...v})}\n\n`);
 if(client?.readyState===1)client.send(JSON.stringify(nativeRuntime&&!['ready','error'].includes(v.type)?nativeRuntime.project(v):{voiceSessionId:active,...v}));
};
const audio=(ms=240,responseId)=>{
 const pcm=Buffer.alloc(ms*48);
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/24000)*1800),i*2);
 emit({type:'audio',...(responseId?{responseId}:{}),sequence:++sequence,audio:pcm.toString('base64'),sampleRate:24000});emit({type:'audio.done',...(responseId?{responseId}:{})});
};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const body=await new Promise(resolve=>{const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}'));}catch{resolve({});}});});
 const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/fixture/state')return send(200,{fastDials,statusRequests,sessionRequests,active,sessions,inputBytes,zeroBytes,inputFrames,inputActiveFrames,peakInputRMS,playbackDrained,playbackStarts,greetings,heartbeats,closeRequests,presentationRequests,acknowledgements,supplements,avatarRequests,avatarEvents,lastSessionRequest,shellRequests,shellRedirects,lastOffer,locationResults,systemBackgroundReady});
 if(path==='/fixture/redirect-target'){shellRedirects++;return send(200,{});}
 if(path==='/voice/ios-shell-release.json'){
   shellRequests.push({cookie:!!req.headers.cookie,authorization:!!req.headers.authorization});
   if(shellVariant==='none')return send(404,{});
   if(shellVariant==='redirect'){res.writeHead(302,{location:'/fixture/redirect-target'});res.end();return;}
   const variant=shellVariant,delay=shellDelayMS;shellDelayMS=0;
   const release=await shellRelease(variant);
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   return send(200,release);
 }
 if(path==='/fixture/command'){
   if(body.command==='system-background-ready'){systemBackgroundReady=true;return send(200,{});}
   if(body.command==='location'){
     if(!deviceLocation)return send(409,{error:'No location capability'});
     const result=await deviceLocation.request();locationResults.push(result);
     emit({type:'transcript',role:'assistant',text:result.ok?`本地定位回执：当前通话已收到手机位置，精度 ${Math.round(result.location.horizontalAccuracyM)} 米，坐标系 WGS84。仅测试数据，未连接真实 V 或滴滴。`:`本地定位回执：${result.reason}，没有提供位置。`,final:true});
     return send(200,result);
   }
   if(body.command==='location-frame'){client?.send(JSON.stringify({...body.frame,voiceSessionId:body.frame?.voiceSessionId??active}));return send(200,{});}
   if(body.command==='gpt-answer'&&offerReply){const reply=offerReply;offerReply=null;reply(200,{sdp:body.sdp});}
   if(body.command==='reset'){lastOffer=null;offerReply?.(409,{error:'Reset'});offerReply=null;for(const response of eventClients)response.end();eventClients.clear();}
   if(body.command==='shell-delay')shellDelayMS=Math.max(0,Math.min(2000,Number(body.ms)||0));
   if(body.command==='shell-release')shellVariant=body.variant??'none';
   if(body.command==='reset'){shellDelayMS=0;shellVariant='none';shellRequests=[];shellRedirects=0;inputFrames=0;inputActiveFrames=0;peakInputRMS=0;}
   if(body.command==='fast-mode')fastMode=true;
   if(body.command==='fast-reject')fastReject=true;
   if(body.command==='fast-wrong-owner')fastWrongOwner=true;
   if(body.command==='reset'){fastMode=false;fastReject=false;fastWrongOwner=false;fastDials=0;statusRequests=0;sessionRequests=0;}
   if(body.command==='native-mode')nativeMode=true;
   if(body.command==='speaker-mode')speakerMode=true;
   if(body.command==='runtime-mode')runtimeMode=true;
   if(body.command==='speakers-demo'){
     const a={speakerId:'local0',text:'V，帮我们排一下今天的安排。',startMs:0,endMs:1200},b={speakerId:'local1',text:'我下午三点有空，可以一起讨论。',startMs:1500,endMs:2800};
     const participants=[{id:'speaker:local0',label:'Speaker A',name:'天懿',certainty:'confirmed'},{id:'speaker:local1',label:'Speaker B',name:'小林',certainty:'suggested'}];
     emit({type:'speaker.utterance',turn:a});emit({type:'speaker.decision',turn:a,participants,shouldRespond:true});
     emit({type:'speaker.utterance',turn:b});emit({type:'speaker.decision',turn:b,participants,shouldRespond:false});
   }
   if(body.command==='avatar-slow')slowAvatar=true;
   if(body.command==='avatar-reply'){avatarReply=body.picture;avatarContinuations=body.continuations??[];}
   if(body.command==='event'&&body.event)emit(body.event);
   if(body.command==='slow-session'){slowSession=true;slowSessionMS=Math.max(100,Math.min(15000,Number(body.ms)||300));}
   if(body.command==='limit-next-session')limitNextSession=true;
   if(body.command==='slow-close')slowClose=true;
   if(body.command==='malformed-audio')emit({type:'audio',sequence:++sequence,audio:Buffer.from([1]).toString('base64'),sampleRate:24000});
   if(body.command==='early-audio')earlyAudio=true;
   if(body.command==='audio')audio(body.ms??240,body.responseId);
   if(body.command==='wave-demo'){
     const pcm=Buffer.alloc(6000*48);
     for(let i=0;i<pcm.length/2;i++){
       const t=i/24000, gain=0.02+0.34*Math.pow((1+Math.sin(t*7.8))/2,2)*(0.4+0.6*Math.pow(Math.sin(t*2.1),2));
       pcm.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*t)*32767*gain),i*2);
     }
     emit({type:'audio',sequence:++sequence,audio:pcm.toString('base64'),sampleRate:24000});emit({type:'audio.done'});
   }
   if(body.command==='clear'){emit({type:'audio.clear'});}
   if(body.command==='provider-reconnecting')emit({type:'provider.reconnecting'});
   if(body.command==='provider-recovered')emit({type:'provider.recovered'});
   if(body.command==='demo'){
     emit({type:'transcript',role:'user',text:'帮我整理一下今天的安排。',final:true});
     emit({type:'transcript',role:'assistant',text:'好的，我来看看今天的日程，再帮你安排好优先级。',final:true});
   }
   if(body.command==='report')emit({type:'backend.result',callId:'fixture-plan',text:'# 今天的安排与建议\n\n建议先完成产品评审，再留出一段不被打断的工作时间。\n\n## 时间安排\n\n| 时间 | 事项 | 优先级 |\n| --- | --- | --- |\n| 09:30 | 产品评审 | 高 |\n| 11:00 | 专注工作 | 高 |\n| 15:00 | 团队同步 | 中 |\n\n## 接下来怎么做\n\n1. 把最重要的决定放在上午。\n2. 下午留出 30 分钟处理临时事项。\n3. 收工前回顾今天的进展。\n\n> 这是一份本地界面测试方案，没有连接真实模型或日历。\n\n```text\n先做重要的事，再做紧急的事。\n```'});
   if(body.command==='result')emit({type:'backend.result',callId:'fixture-result',text:'## 本地测试结果\n完整内容已送达。'});
   if(body.command==='report-poll-only')documents.push({type:'backend.result',callId:'fixture-poll-report',text:'# 后台完整报告\n\n这份报告只通过已有 presentation 接口送达，不从音频 WebSocket 推送。'});
   if(body.command==='think')emit({type:'transcript',role:'user',text:'本地测试',final:true});
   if(body.command==='end'){audio();emit({type:'end.after-playback',callId:'fixture-end'});}
   if(body.command==='drop')client?.terminate();
   if(body.command==='reset'){deviceLocation?.close();deviceLocation=null;locationResults=[];systemBackgroundReady=false;nativeMode=false;speakerMode=false;runtimeMode=false;nativeRuntime=null;lastSessionRequest=null;client?.close();client=null;active=null;sessions=0;inputBytes=0;zeroBytes=0;greetings=0;heartbeats=0;earlyAudio=false;playbackStarts=0;limitNextSession=false;slowClose=false;closeRequests=0;documents=[];pending=[];acknowledgements=[];supplements=[];avatarRequests=[];avatarEvents=[];avatarReply="reaction-0";avatarContinuations=["reaction-1","listen-5"];slowAvatar=false;}
   return send(200,{ok:true});
 }
 if(req.headers.cookie!=='v_voice_access=fixture-cookie')return send(401,{error:'Fixture cookie required'});
 if(path==='/voice/api/events'){
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});res.flushHeaders();res.write(': fixture\n\n');
   eventClients.add(res);res.on('close',()=>eventClients.delete(res));return;
 }
 if(path==='/voice/api/offer'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   lastOffer=body.sdp;offerReply=send;return;
 }
 if(path==='/voice/api/ready'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   greetings++;return send(200,{ok:true});
 }
 if(path==='/voice/api/call-control-input')return send(200,{ok:true});
 if(path==='/voice/api/avatar'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   if(!Number.isSafeInteger(body.revision)||body.revision<1||!Array.isArray(body.turns)||body.turns.length>6||body.turns.some(t=>typeof t.text!=='string'||t.text.length>600))return send(400,{error:'Invalid context'});
   avatarRequests.push(body);
   const reply={picture:avatarReply,continuations:avatarContinuations,revision:body.revision};
   if(slowAvatar){slowAvatar=false;setTimeout(()=>send(200,reply),1200);return;}
   return send(200,reply);
 }
 if(path==='/voice/api/avatar-events'){
   try{avatarEvents.push(...body.events.map(normalizeAvatarEvent));return send(200,{ok:true});}catch{return send(400,{error:'Invalid telemetry'});}
 }
 if(path==='/voice/api/comparison')return send(200,{schema:'voice-listening-v1',scenes:[{id:'greeting',title:'打个招呼',context:'本地声音试听',text:'你好'}],variants:[{id:'plain',title:'自然表达',description:'本地合成测试波形'}],clips:[{id:'sample-a',scene:'greeting',engine:'realtime',variant:'plain',requestedScript:'你好',renderedScript:'你好',seconds:0.24,inspection:{valid:true}}]});
 if(path==='/voice/api/comparison/audio/sample-a'){
   const pcm=Buffer.alloc(240*48);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/24000)*1800),i*2);
   const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);res.writeHead(200,{'content-type':'audio/wav'});res.end(Buffer.concat([h,pcm]));return;
 }
 if(path==='/voice/api/presentation'){presentationRequests++;return send(200,{voiceSessionId:active,documents,pending});}
 if(path==='/voice/api/content-shown'){
   if(body.voiceSessionId!==active||!documents.some(d=>d.callId===body.callId))return send(409,{error:'Stale document'});
   acknowledgements.push(body.callId);return send(200,{ok:true});
 }
 if(path==='/voice/api/steer'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   supplements.push({text:body.text,mode:body.mode});return send(200,{ok:true,forwardedToVoice:true,queued:false});
 }
 if(path==='/voice/api/status')statusRequests++;
 if(path==='/voice/api/status')return send(200,{...(fastMode?{nativeDialVersion:1}:{}),...(nativeMode?{phoneInputPolicy:'native'}:{}),ready:true,preview:false,comparisonAvailable:true,models:[{id:'future-relay-model',label:'服务新模型',available:true,nativeTransport:'gateway-relay'},{id:'unsupported-transport',label:'尚未支持的传输',available:true,nativeTransport:'future-transport'},{id:'gpt-live',label:'GPT Live',available:true},{id:'seeduplex',label:'豆包 SeedDuplex',available:true},{id:'grok',label:'Grok Voice 3.0',available:true,voices:[{id:'iris',label:'Iris'},{id:'eve',label:'Eve'}],speed:1.2,expressiveTags:true}],activeCall:Boolean(active)});
 if(path==='/voice/api/session'){
   sessionRequests++;
   lastSessionRequest=body;
   if(limitNextSession){limitNextSession=false;return send(429,{error:'通话开始得太频繁，请稍后再试'});}
   if(active)return send(409,{error:'Existing owner'});
   active=randomUUID();sequence=0;sessions++;documents=[];pending=[];acknowledgements=[];
   const reservation=body.model==='gpt-live'?{voiceSessionId:active,model:'gpt-live-1-codex',transport:'webrtc'}:{voiceSessionId:active,transport:'gateway-relay',provider:'seeduplex',relayTicket:'fixture-ticket',...(nativeMode&&body.inputPolicy==='native'?{nativeDuplex:true,nativePlaybackPolicy:'assisted'}:speakerMode?{speakerRouting:{policy:'speaker'}}:{})};
   nativeRuntime=runtimeMode&&body.nativeRuntimeVersion===1?createNativeRuntime({voiceSessionId:active,duplex:nativeMode,assisted:nativeMode,speakerRouted:speakerMode}):null;
   if(nativeRuntime)reservation.nativeRuntime=nativeRuntime.descriptor;
   if(body.nativeLocationVersion===1&&body.model!=='gpt-live'){reservation.nativeLocationVersion=1;deviceLocation=createDeviceLocation({voiceSessionId:active,send:e=>client?.send(JSON.stringify(e))});}
   if(slowSession){slowSession=false;setTimeout(()=>send(200,reservation),slowSessionMS);return;}
   return send(200,reservation);
 }
 if(path==='/voice/api/close'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   closeRequests++;lastOffer=null;offerReply?.(409,{error:"Closed"});offerReply=null;for(const response of eventClients)response.end();eventClients.clear();
   if(slowClose){
     slowClose=false;const old=active,ws=client;
     setTimeout(()=>{if(active===old)active=null;ws?.close();if(client===ws)client=null;send(200,{ok:true});},250);return;
   }
   active=null;client?.close();client=null;return send(200,{ok:true});
 }
 if(path==='/voice/api/heartbeat'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   heartbeats++;return send(200,{ok:true});
 }
 return send(404,{error:'Unknown route'});
});
function observeClient(ws){
   ws.on('message',(bytes,binary)=>{
     if(binary){
       inputBytes+=bytes.length;inputFrames++;
       if(bytes.every(b=>b===0))zeroBytes+=bytes.length;
       let energy=0;for(let i=0;i+1<bytes.length;i+=2)energy+=(bytes.readInt16LE(i)/32768)**2;
       const rms=bytes.length>=2?Math.sqrt(energy/Math.floor(bytes.length/2)):0;
       if(rms>=0.002)inputActiveFrames++;
       peakInputRMS=Math.max(peakInputRMS,rms);return;
     }
     const v=JSON.parse(bytes.toString());
     if(v.type==='device.location.result')deviceLocation?.receive(v);
     if(v.type==='greeting'){greetings++;emit({type:'transcript',role:'assistant',text:'本地音频测试，欢迎。',final:true});audio();}
     if(v.type==='playback.state'&&v.speaking===true)playbackStarts++;
     if(v.type==='playback.drained')playbackDrained++;
   });
}
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/voice/api/dial'&&fastMode){
   if(fastReject){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
   if(req.headers.cookie!=='v_voice_access=fixture-cookie'||active){socket.destroy();return;}
   fastDials++;lastSessionRequest=Object.fromEntries(url.searchParams);lastSessionRequest.nativeRuntimeVersion=Number(lastSessionRequest.nativeRuntimeVersion);
   wss.handleUpgrade(req,socket,head,ws=>{
     active=randomUUID();const owned=active;sequence=0;sessions++;documents=[];pending=[];acknowledgements=[];client=ws;
     ws.on('close',()=>{if(active===owned){active=null;client=null;}});
     nativeRuntime=runtimeMode?createNativeRuntime({voiceSessionId:active,duplex:nativeMode,assisted:nativeMode,speakerRouted:speakerMode}):null;
     const reservation={type:'reservation',dialVersion:1,voiceSessionId:active,transport:'gateway-relay',model:'1.2.6.1',provider:'seeduplex',...(nativeMode?{nativeDuplex:true,nativePlaybackPolicy:'assisted'}:{}),...(nativeRuntime?{nativeRuntime:nativeRuntime.descriptor}:{})};
     const complete=()=>{
       if(ws.readyState!==1||active!==owned)return;
       ws.send(JSON.stringify(reservation));
       ws.send(JSON.stringify({type:'ready',voiceSessionId:fastWrongOwner?randomUUID():owned}));
       if(earlyAudio){earlyAudio=false;audio();}
     };
     if(slowSession){slowSession=false;setTimeout(complete,slowSessionMS);}else complete();
     observeClient(ws);
   });return;
 }
 if(req.headers.cookie!=='v_voice_access=fixture-cookie'||url.searchParams.get('voiceSessionId')!==active||url.searchParams.get('ticket')!=='fixture-ticket'){socket.destroy();return;}
 wss.handleUpgrade(req,socket,head,ws=>{
   client=ws;emit({type:'ready'});if(earlyAudio){earlyAudio=false;audio();}
   observeClient(ws);
 });
});
server.listen(port,'127.0.0.1',()=>console.log(`V Voice local fixture listening on 127.0.0.1:${port}; no model calls`));
