#!/usr/bin/env node
// Actual shared HTTP service + fake Gateway reservation. Only local synthetic
// WebRTC peers supply SDP/audio; no provider, credentials or paid model calls.
import {createServer, request} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';

let sessions=0, closes=0, lastOffer=null, answerReply=null, lastSessionRequest=null;
const bridge=createLiveH5Server({basePath:'/voice', avatarEvaluate:async()=>({picture:'reaction-0'}),
  gateway:{ready:true,request:async(method)=>{
    if(method==='talk.client.create') { sessions++; lastOffer=null; return {voiceSessionId:randomUUID(),model:'gpt-live-1-codex',transport:'webrtc',offerUrl:'/plugins/openai/realtime/calls',clientSecret:'local-fixture-only'}; }
    if(method==='talk.client.close'){closes++;lastOffer=null;answerReply?.('');answerReply=null;}
    return {ok:true};
  }},
  offer:async(_reservation,sdp)=>{lastOffer=sdp;return new Promise(resolve=>{answerReply=resolve;});},
});
await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));
const upstream=`http://127.0.0.1:${bridge.server.address().port}`;
const page=await fetch(upstream+'/voice/');
const cookie=page.headers.get('set-cookie').split(';',1)[0];await page.text();
const server=createServer(async(req,res)=>{
  if(req.url.startsWith('/fixture/')){
    const chunks=[];for await(const b of req)chunks.push(b);
    const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    if(req.url==='/fixture/answer'&&answerReply){answerReply(body.sdp);answerReply=null;}
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({cookie,sessions,closes,lastOffer,lastSessionRequest}));return;
  }
  // Observe native requests without replacing any service response fields.
  const chunks=[];for await(const b of req)chunks.push(b);
  const bytes=Buffer.concat(chunks);
  if(req.url==='/voice/api/session')lastSessionRequest=JSON.parse(bytes);
  // Native production requests use the origin's default port. Present that
  // same authority to the service while the loopback listener uses a test port.
  const proxy=request(upstream+req.url,{method:req.method,headers:{...req.headers,host:'127.0.0.1'}},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res);
  });
  proxy.on('error',()=>{res.writeHead(502);res.end();});
  req.on('aborted',()=>proxy.destroy());res.on('close',()=>proxy.destroy());proxy.end(bytes);
});
const port=Number(process.env.VVOICE_GPT_FIXTURE_PORT??29857);
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
console.log(`Shared GPT protocol fixture http://127.0.0.1:${port}`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  answerReply?.('');server.closeAllConnections();server.close();void bridge.dispose().finally(()=>process.exit(0));
});
