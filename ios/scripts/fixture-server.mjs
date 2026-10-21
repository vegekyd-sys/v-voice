#!/usr/bin/env node
// Local protocol fixture only. No providers, tool execution, personal data or costs.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocketServer} from 'ws';
const port=Number(process.env.VVOICE_FIXTURE_PORT??29837);
let active=null,client=null,sequence=0,sessions=0,inputBytes=0,zeroBytes=0,playbackDrained=0,playbackStarts=0,greetings=0,heartbeats=0,earlyAudio=false,slowSession=false;
let limitNextSession=false,slowClose=false,closeRequests=0;
const emit=v=>{if(client?.readyState===1)client.send(JSON.stringify({voiceSessionId:active,...v}));};
const audio=(ms=240)=>{
 const pcm=Buffer.alloc(ms*48);
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/24000)*1800),i*2);
 emit({type:'audio',sequence:++sequence,audio:pcm.toString('base64'),sampleRate:24000});emit({type:'audio.done'});
};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const body=await new Promise(resolve=>{const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}'));}catch{resolve({});}});});
 const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/fixture/state')return send(200,{active,sessions,inputBytes,zeroBytes,playbackDrained,playbackStarts,greetings,heartbeats,closeRequests});
 if(path==='/fixture/command'){
   if(body.command==='slow-session')slowSession=true;
   if(body.command==='limit-next-session')limitNextSession=true;
   if(body.command==='slow-close')slowClose=true;
   if(body.command==='malformed-audio')emit({type:'audio',sequence:++sequence,audio:Buffer.from([1]).toString('base64'),sampleRate:24000});
   if(body.command==='early-audio')earlyAudio=true;
   if(body.command==='audio')audio(body.ms??240);
   if(body.command==='clear'){emit({type:'audio.clear'});}
   if(body.command==='provider-reconnecting')emit({type:'provider.reconnecting'});
   if(body.command==='provider-recovered')emit({type:'provider.recovered'});
   if(body.command==='result')emit({type:'backend.result',callId:'fixture-result',text:'## 本地测试结果\n完整内容已送达。'});
   if(body.command==='think')emit({type:'transcript',role:'user',text:'本地测试',final:true});
   if(body.command==='end'){audio();emit({type:'end.after-playback',callId:'fixture-end'});}
   if(body.command==='drop')client?.terminate();
   if(body.command==='reset'){client?.close();client=null;active=null;sessions=0;inputBytes=0;zeroBytes=0;greetings=0;heartbeats=0;earlyAudio=false;playbackStarts=0;limitNextSession=false;slowClose=false;closeRequests=0;}
   return send(200,{ok:true});
 }
 if(req.headers.cookie!=='v_voice_access=fixture-cookie')return send(401,{error:'Fixture cookie required'});
 if(path==='/voice/api/status')return send(200,{ready:true,preview:false,models:[{id:'seeduplex',available:true},{id:'grok',available:true}],activeCall:Boolean(active)});
 if(path==='/voice/api/session'){
   if(limitNextSession){limitNextSession=false;return send(429,{error:'通话开始得太频繁，请稍后再试'});}
   if(active)return send(409,{error:'Existing owner'});
   active=randomUUID();sequence=0;sessions++;
   const reservation={voiceSessionId:active,transport:'gateway-relay',provider:'seeduplex',relayTicket:'fixture-ticket'};
   if(slowSession){slowSession=false;setTimeout(()=>send(200,reservation),300);return;}
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
