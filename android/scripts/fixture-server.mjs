#!/usr/bin/env node
// Real H5 + Public authorization + relay adapter; synthetic upstream, no model billing.
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
const port=Number(process.env.VVOICE_ANDROID_FIXTURE_PORT??29849),origin=`http://127.0.0.1:${port}`;
const state=await mkdtemp(join(tmpdir(),'vvoice-android-fixture-'));
const legacyAccess=randomBytes(32).toString('base64url');
let peer,inputFrames=0,outputPackets=0,sessionRequests=0,closed=0,playbackStats={},played=false;
const emit=value=>peer?.readyState===1&&peer.emit('message',Buffer.from(JSON.stringify(value)),false);
class Upstream extends EventEmitter {
 constructor(){super();this.readyState=1;peer=this;setImmediate(()=>this.emit('open'));}
 send(raw){const value=JSON.parse(raw);if(value.type==='session.create')queueMicrotask(()=>emit({type:'session.created',session:{id:'android-fixture'}}));if(value.type==='input_audio_buffer.append')inputFrames++;}
 close(){if(this.readyState===3)return;this.readyState=3;closed++;this.emit('close');}
}
const gateway=Object.assign(new EventEmitter(),{ready:true,async request(){return {ok:true};}});
const routing={snapshot:()=>({}),reserve:()=>null,has:()=>false,lazyNative:()=>false,assistant(){},close(){},dispose(){}};
const directVoice=createDirectVoiceService({gateway,wsModule:{WebSocket:Upstream,WebSocketServer},apiKeys:{seeduplex:'fixture-only'},speakerRouting:routing,loadContext:async()=>'',
 audit:event=>{if(event.type==='client.playback-stats')playbackStats=event.stats;if(event.type==='client.playback-state'&&event.speaking)played=true;}});
const reserve=directVoice.reserve;directVoice.reserve=async args=>{sessionRequests++;return reserve(args);};
const bridge=createLiveH5Server({gateway,directVoice,speakerRouting:routing,basePath:'/voice',publicOrigin:'https://android-fixture.invalid',
 accessToken:legacyAccess,defaultModel:'seeduplex',phoneInputPolicy:'native',iosPublicEntry:true,
 iosBindingsFile:join(state,'grants.json'),feishuLogin:{conversations:true,allowUnidentified:true,accountId:'fixture',appId:'cli_fixture',appSecret:randomBytes(32).toString('base64url'),actors:[]},
 avatarEvaluate:async()=>({picture:'listen-5',continuations:[]})});
const handler=bridge.server.listeners('request')[0];bridge.server.removeAllListeners('request');
// This loopback-only fixture stands in for the HTTPS reverse proxy. Production
// still validates HTTPS origins; the Android release has no cleartext exception.
const normalize=req=>{if(req.headers.host===`127.0.0.1:${port}`){req.headers.host='android-fixture.invalid';if(req.headers.origin===origin)req.headers.origin='https://android-fixture.invalid';}};
bridge.server.prependListener('upgrade',normalize);
bridge.server.on('request',async(req,res)=>{
 const send=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/fixture/state')return send({connected:peer?.readyState===1,inputFrames,outputPackets,sessionRequests,closed,playbackStats,played});
 if(req.url==='/fixture/binding'){
  const headers={'content-type':'application/json',origin};
  const access=await fetch(origin+'/voice/api/access',{method:'POST',headers,body:JSON.stringify({access:legacyAccess})});
  if(!access.ok){res.writeHead(500).end('Fixture authorization failed');return;}
  headers.cookie=access.headers.get('set-cookie').split(';')[0];
  const grant=await fetch(origin+'/voice/api/ios-binding',{method:'POST',headers,body:'{}'});
  if(!grant.ok){res.writeHead(500).end('Fixture handoff failed');return;}
  const value=await grant.json();return send({bindingUrl:value.bindingUrl.replace('https://android-fixture.invalid',origin)});
 }
 if(req.url==='/fixture/tone'&&req.method==='POST'){
  const pcm=Buffer.alloc(24000*4);for(let i=0;i<24000;i++)pcm.writeFloatLE(.15*Math.sin(i*2*Math.PI*440/24000),i*4);
  emit({type:'response.output_text.done',response_id:'tone',text:'安卓本地验证：共用网页字幕、头像和播放。'});
  emit({type:'response.output_audio.started',response_id:'tone'});emit({type:'response.output_audio.delta',response_id:'tone',delta:pcm.toString('base64')});outputPackets++;
  emit({type:'response.output_audio.done',response_id:'tone'});return send({ok:true});
 }
 normalize(req);return handler(req,res);
});
bridge.server.listen(port,'127.0.0.1',()=>console.log(`Android fixture ${origin}/voice/ (no model calls)`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await bridge.dispose();await rm(state,{recursive:true,force:true});process.exit(0);});
