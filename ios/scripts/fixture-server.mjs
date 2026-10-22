#!/usr/bin/env node
// Local protocol fixture only. No providers, tool execution, personal data or costs.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {normalizeAvatarEvent} from '../../lab/gpt-live-h5/avatar-telemetry.mjs';
const port=Number(process.env.VVOICE_FIXTURE_PORT??29837);
let active=null,client=null,sequence=0,sessions=0,inputBytes=0,zeroBytes=0,playbackDrained=0,playbackStarts=0,greetings=0,heartbeats=0,earlyAudio=false,slowSession=false;
let slowSessionMS=300;
let speakerMode=false,lastSessionRequest=null;
let limitNextSession=false,slowClose=false,closeRequests=0;
let documents=[],pending=[],acknowledgements=[],supplements=[];
let avatarRequests=[],avatarEvents=[],avatarReply="reaction-0",avatarContinuations=["reaction-1","listen-5"],slowAvatar=false;
const emit=v=>{
 if(v.type==='backend.result'){documents=documents.filter(d=>d.callId!==v.callId);documents.push(v);pending=pending.filter(t=>t.callId!==v.callId);}
 if(['tool.call','tool.progress'].includes(v.type)){const old=pending.find(t=>t.callId===v.callId)??{};pending=pending.filter(t=>t.callId!==v.callId);pending.push({...old,...v});}
 if(['tool.result','tool.error'].includes(v.type))pending=pending.filter(t=>t.callId!==v.callId);
 if(client?.readyState===1)client.send(JSON.stringify({voiceSessionId:active,...v}));
};
const audio=(ms=240)=>{
 const pcm=Buffer.alloc(ms*48);
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/24000)*1800),i*2);
 emit({type:'audio',sequence:++sequence,audio:pcm.toString('base64'),sampleRate:24000});emit({type:'audio.done'});
};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const body=await new Promise(resolve=>{const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}'));}catch{resolve({});}});});
 const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/fixture/state')return send(200,{active,sessions,inputBytes,zeroBytes,playbackDrained,playbackStarts,greetings,heartbeats,closeRequests,acknowledgements,supplements,avatarRequests,avatarEvents,lastSessionRequest});
 if(path==='/fixture/command'){
   if(body.command==='speaker-mode')speakerMode=true;
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
   if(body.command==='audio')audio(body.ms??240);
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
   if(body.command==='think')emit({type:'transcript',role:'user',text:'本地测试',final:true});
   if(body.command==='end'){audio();emit({type:'end.after-playback',callId:'fixture-end'});}
   if(body.command==='drop')client?.terminate();
   if(body.command==='reset'){speakerMode=false;lastSessionRequest=null;client?.close();client=null;active=null;sessions=0;inputBytes=0;zeroBytes=0;greetings=0;heartbeats=0;earlyAudio=false;playbackStarts=0;limitNextSession=false;slowClose=false;closeRequests=0;documents=[];pending=[];acknowledgements=[];supplements=[];avatarRequests=[];avatarEvents=[];avatarReply="reaction-0";avatarContinuations=["reaction-1","listen-5"];slowAvatar=false;}
   return send(200,{ok:true});
 }
 if(req.headers.cookie!=='v_voice_access=fixture-cookie')return send(401,{error:'Fixture cookie required'});
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
 if(path==='/voice/api/presentation')return send(200,{voiceSessionId:active,documents,pending});
 if(path==='/voice/api/content-shown'){
   if(body.voiceSessionId!==active||!documents.some(d=>d.callId===body.callId))return send(409,{error:'Stale document'});
   acknowledgements.push(body.callId);return send(200,{ok:true});
 }
 if(path==='/voice/api/steer'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   supplements.push({text:body.text,mode:body.mode});return send(200,{ok:true,forwardedToVoice:true,queued:false});
 }
 if(path==='/voice/api/status')return send(200,{ready:true,preview:false,comparisonAvailable:true,models:[{id:'gpt-live',label:'GPT Live',available:true},{id:'seeduplex',label:'豆包 SeedDuplex',available:true},{id:'grok',label:'Grok Voice 3.0',available:true,voices:[{id:'iris',label:'Iris'},{id:'eve',label:'Eve'}],speed:1.2,expressiveTags:true}],activeCall:Boolean(active)});
 if(path==='/voice/api/session'){
   lastSessionRequest=body;
   if(limitNextSession){limitNextSession=false;return send(429,{error:'通话开始得太频繁，请稍后再试'});}
   if(active)return send(409,{error:'Existing owner'});
   active=randomUUID();sequence=0;sessions++;documents=[];pending=[];acknowledgements=[];
   const reservation={voiceSessionId:active,transport:'gateway-relay',provider:'seeduplex',relayTicket:'fixture-ticket',...(speakerMode?{speakerRouting:{policy:'speaker'}}:{})};
   if(slowSession){slowSession=false;setTimeout(()=>send(200,reservation),slowSessionMS);return;}
   return send(200,reservation);
 }
 if(path==='/voice/api/close'){
   if(body.voiceSessionId!==active)return send(409,{error:'Stale owner'});
   closeRequests++;
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
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.headers.cookie!=='v_voice_access=fixture-cookie'||url.searchParams.get('voiceSessionId')!==active||url.searchParams.get('ticket')!=='fixture-ticket'){socket.destroy();return;}
 wss.handleUpgrade(req,socket,head,ws=>{
   client=ws;emit({type:'ready'});if(earlyAudio){earlyAudio=false;audio();}
   ws.on('message',(bytes,binary)=>{
     if(binary){inputBytes+=bytes.length;if(bytes.every(b=>b===0))zeroBytes+=bytes.length;return;}
     const v=JSON.parse(bytes.toString());
     if(v.type==='greeting'){greetings++;emit({type:'transcript',role:'assistant',text:'本地音频测试，欢迎。',final:true});audio();}
     if(v.type==='playback.state'&&v.speaking===true)playbackStarts++;
     if(v.type==='playback.drained')playbackDrained++;
   });
 });
});
server.listen(port,'127.0.0.1',()=>console.log(`V Voice local fixture listening on 127.0.0.1:${port}; no model calls`));
