import {request as httpRequest} from 'node:http';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {pcm16to24} from './service.mjs';

// Authorized synthetic verification only; no microphone or human recordings.
export class VerificationCall {
  constructor({cookie='',origin=process.env.VOICE_VERIFY_ORIGIN,wire=process.env.VOICE_VERIFY_CONNECT_ORIGIN??origin}={}) {
    this.origin=origin.replace(/\/$/,'');this.wire=wire.replace(/\/$/,'');this.cookie=cookie;this.events=[];this.audioBytes=0;this.started=Date.now();this.closed=false;this.inputBytes=0;
  }
  async request(route,{method='GET',body}={}) {
    const headers={host:new URL(this.origin).host,origin:new URL(this.origin).origin,cookie:this.cookie,'content-type':'application/json'};
    const url=this.wire+route,options={method,headers,...body?{body:JSON.stringify(body)}:{}};
    let response;
    if(this.wire===this.origin)response=await fetch(url,options);
    else {
      if(new URL(this.wire).hostname!=='127.0.0.1'||new URL(this.wire).protocol!=='http:')throw Error('Private wire must be loopback');
      response=await new Promise((resolve,reject)=>{const req=httpRequest(url,options,res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,headers:{get:key=>{const x=res.headers[key.toLowerCase()];return Array.isArray(x)?x[0]:x;}},text:()=>Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(options.body);});
    }
    const cookie=response.headers.get('set-cookie')?.split(';')[0];if(cookie)this.cookie=cookie;
    const text=await response.text();let value;try{value=JSON.parse(text);}catch{value={text};}
    if(!response.ok)throw Object.assign(Error(value.error??'HTTP '+response.status),{status:response.status});return value;
  }
  async open() {
    for(let attempt=0;;attempt++){try{await this.request('/');break;}catch(error){if(attempt>=30)throw error;await delay(300);}}
    if(!this.cookie){const access=(await readFile(process.env.VOICE_VERIFY_ACCESS_FILE,'utf8')).trim();await this.request('/api/access',{method:'POST',body:{access}});}
    for(let attempt=0;;attempt++){const status=await this.request('/api/status');if(status.ready)break;if(attempt>=60)throw Error('Private backend not ready');await delay(300);}
    this.reservation=await this.request('/api/session',{method:'POST',body:{model:'seeduplex',inputPolicy:'speaker'}});
    const r=this.reservation;this.id=r.voiceSessionId;
    this.ws=new WebSocket(this.wire.replace(/^http/,'ws')+'/api/relay?'+new URLSearchParams({voiceSessionId:r.voiceSessionId,ticket:r.relayTicket}),{headers:{cookie:this.cookie,host:new URL(this.origin).host,origin:new URL(this.origin).origin}});
    this.ws.on('message',raw=>{const e=JSON.parse(raw),at=Date.now();if(e.type==='audio'){const bytes=Buffer.from(e.audio,'base64').length;this.audioBytes+=bytes;this.events.push({type:'audio',at,bytes,callId:e.callId});}else this.events.push({...e,at});if(e.type==='error')this.failure=e.message;});
    this.ws.on('error',e=>this.failure=e.message);this.ws.on('close',()=>this.closed=true);
    await this.wait(()=>this.events.some(e=>e.type==='ready'));
    this.heartbeat=setInterval(()=>void this.request('/api/heartbeat',{method:'POST',body:{voiceSessionId:this.id}}).catch(e=>this.failure=e.message),15000);
    this.pump=setInterval(()=>{if(this.ws.readyState!==1||this.paused)return;let pcm=Buffer.alloc(4800);if(this.pending){const p=this.pending;pcm=p.pcm.subarray(p.offset,p.offset+4800);p.offset+=4800;if(p.offset>=p.pcm.length){this.pending=null;p.resolve();}}this.ws.send(pcm);this.inputBytes+=pcm.length;},100);
    return this;
  }
  async wait(predicate,ms=30000,{allowClosed=false}={}) {const deadline=Date.now()+ms;while(Date.now()<deadline){if(this.failure)throw Error(this.failure);if(predicate())return;if(this.closed&&!allowClosed)throw Error('Call closed prematurely');await delay(50);}throw Error('Verification deadline');}
  async speak(id) {
    const start=Date.now(),pcm=pcm16to24(await readFile(new URL('../../artifacts/speaker-native/'+id+'.pcm',import.meta.url)));
    if(this.pending)throw Error('Concurrent synthetic speech on one channel');
    await new Promise(resolve=>this.pending={pcm,offset:0,resolve});return {id,start,end:Date.now()};
  }
  async decision(turn) {await this.wait(()=>this.events.some(e=>e.type==='speaker.decision'&&e.at>=turn.start));return this.events.find(e=>e.type==='speaker.decision'&&e.at>=turn.start);}
  async answer(turn,pattern) {
    await this.wait(()=>this.events.some(e=>e.type==='transcript'&&e.role==='assistant'&&e.final&&e.at>=turn.end&&pattern.test(e.text??'')),35000);
    await this.wait(()=>this.events.some(e=>e.type==='audio'&&!e.callId&&e.at>=turn.end));
    const audio=this.events.find(e=>e.type==='audio'&&!e.callId&&e.at>=turn.end);await delay(1800);return {latencyMs:audio.at-turn.end};
  }
  async farewell(id='end-bye') {
    const turn=await this.speak(id);await this.wait(()=>this.events.some(e=>e.type==='end.after-playback'&&e.at>=turn.start),35000);
    const end=this.events.find(e=>e.type==='end.after-playback'&&e.at>=turn.start),audio=this.events.filter(e=>e.type==='audio'&&e.at>=turn.start);
    if(!audio.length)throw Error('Farewell had no real audio');
    // API proof is paced PCM drain; browser verification separately proves actual playback.
    await delay(audio.reduce((n,e)=>n+e.bytes,0)/48+800);this.ws.send(JSON.stringify({type:'playback.drained',callId:end.callId}));
    await this.wait(()=>this.closed,5000,{allowClosed:true});return {turn,end,audioBytes:audio.reduce((n,e)=>n+e.bytes,0)};
  }
  report() {return {voiceSessionId:this.id,durationMs:Date.now()-this.started,inputSeconds:this.inputBytes/48000,audioBytes:this.audioBytes,events:this.events,closed:this.closed};}
  async close() {clearInterval(this.pump);clearInterval(this.heartbeat);this.ws?.close();if(this.id)await this.request('/api/close',{method:'POST',body:{voiceSessionId:this.id}}).catch(()=>{});}
}
