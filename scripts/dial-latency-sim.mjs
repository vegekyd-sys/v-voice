// Dial latency model. Runs the real entry server and direct-voice service
// against a Gateway, a provider and a network that answer with the delays
// measured in production, and compares the dial with and without the
// same-dial overlap. No model, account or audio is involved: it shows how the
// stages compose, not what a real phone will measure.
//
//   node scripts/dial-latency-sim.mjs [--runs 5] [--resolve 1100] [--catalog 700]
//        [--context 700] [--upstream 250] [--session 150] [--rtt 200] [--mic 400] [--synth 300]
import {EventEmitter} from 'node:events';
import {request} from 'node:http';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket,{WebSocketServer} from 'ws';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../lab/realtime-direct-tools/session.mjs';
import {feishuConversationPhone} from '../lib/feishu-conversation-directory.mjs';

const args=Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(p=>p.trim().split(/\s+/u)));
const ms=Object.fromEntries(Object.entries({runs:5,resolve:1100,catalog:700,context:700,upstream:250,session:150,rtt:200,mic:400,synth:300}).map(([k,v])=>[k,Number(args[k]??v)]));
const config={appId:'cli_fixture',appSecret:'fixture-app-secret',accountId:'lab'};
const phone=feishuConversationPhone('lab','oc_groupA'),origin='https://voice.example';

async function environment({overlap}) {
  const marks=new Map();
  const mark=name=>{if(!marks.has(name))marks.set(name,performance.now());};
  // The provider: a transport that takes time to open, a session that takes
  // time to start, and a greeting that takes time to synthesize.
  class Upstream extends EventEmitter {
    constructor(){super();this.readyState=0;setTimeout(()=>{if(this.readyState)return;this.readyState=1;this.emit('open');},ms.upstream);}
    send(raw){const value=JSON.parse(raw);
      if(value.type==='session.create')setTimeout(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.created',session:{id:'sim'}})),false),ms.session);
      if(value.type==='speech_text_buffer.commit'){mark('greeting.requested');setTimeout(()=>mark('greeting.audio'),ms.synth);}}
    close(){this.readyState=3;this.emit('close');}terminate(){this.close();}
  }
  const gateway={ready:true,request:async(method,p)=>{
    const a=p?.voiceActor?.actor;
    if(method==='voice.feishu.resolve'){await delay(ms.resolve);return {sessionKey:'agent:makaron:feishu:group:'+a.chatId,agentId:'makaron',accountId:'lab',kind:'group'};}
    if(method==='tools.catalog'){await delay(ms.catalog);return {groups:[{tools:[{id:'web_search'}]}]};}
    return {ok:true};
  }};
  const service=createDirectVoiceService({gateway,loadContext:async()=>{await delay(ms.context);return '';},
    wsModule:{WebSocket:Upstream,WebSocketServer},apiKeys:{seeduplex:'sim'},
    audit:event=>{if(event.type==='call.connection-stage')mark('stage.'+event.stage);}});
  const directVoice=overlap?service:new Proxy(service,{get:(target,key)=>key==='prefetch'?undefined:target[key]});
  const bridge=createLiveH5Server({gateway,directVoice,publicOrigin:origin,basePath:'/voice',accessToken:'sim-legacy-token'.repeat(3),phoneInputPolicy:'native',
    feishuLogin:{...config,conversations:true,allowUnidentified:true,fetchImpl:async url=>Response.json(url.endsWith('/token')?
      {code:0,access_token:'sim-token',token_type:'Bearer'}:{code:0,data:{open_id:'ou_alice',tenant_key:'tenant_fixture'}})}});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));
  const port=bridge.server.address().port;
  const get=(path,cookie='')=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,path,method:'GET',headers:{host:'voice.example',origin,cookie}},res=>resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers:res.headers})));
    req.on('error',reject);req.end();});
  const cookie=res=>res.headers.get('set-cookie').split(';')[0];
  const start=await get('/voice/feishu?phone='+phone+'&oauth=1');
  const finish=await get('/voice/feishu/callback?code=valid&state='+new URL(start.headers.get('location')).searchParams.get('state'),cookie(start));
  const selected=await get(finish.headers.get('location'),cookie(finish));await selected.text();
  const jar=cookie(finish)+'; '+cookie(selected);
  // One call as the page makes it. `early` is the new page: microphone and dial
  // together, greeting requested as soon as the dial socket is owned.
  const call=async({early})=>{
    marks.clear();const t0=performance.now();
    const microphone=delay(ms.mic);
    if(!early)await microphone;
    await delay(ms.rtt*1.5);                       // TCP + TLS + upgrade to the entry
    const ws=new WebSocket(`ws://127.0.0.1:${port}/voice/api/dial?phone=${phone}&model=seeduplex&dialVersion=2&inputPolicy=native`,{headers:{host:'voice.example',origin,cookie:jar}});
    const done=new Promise((resolve,reject)=>{
      ws.on('error',reject);
      ws.on('message',async raw=>{
        const value=JSON.parse(raw);
        await delay(ms.rtt/2);                     // entry to phone
        if(value.type==='reservation'){mark('client.reservation');if(early){await microphone;await delay(ms.rtt/2);ws.send(JSON.stringify({type:'greeting'}));}}
        if(value.type==='ready'){mark('client.ready');await microphone;await delay(ms.rtt/2);ws.send(JSON.stringify({type:'greeting'}));}
        if(value.type==='dial.error'||value.type==='error')reject(Error('dial failed'));
      });
      const poll=setInterval(()=>{if(marks.has('greeting.audio')&&marks.has('client.ready')){clearInterval(poll);resolve();}},5);
    });
    await done;await delay(ms.rtt/2);
    const at=name=>Math.round(marks.get(name)-t0);
    const row={serverReady:at('stage.provider-ready'),clientReady:at('client.ready'),greetingHeard:Math.round(marks.get('greeting.audio')+ms.rtt/2-t0)};
    ws.close();await delay(50);
    return row;
  };
  return {call,close:()=>bridge.dispose()};
}
const median=values=>[...values].sort((a,b)=>a-b)[values.length>>1];
const summarize=rows=>Object.fromEntries(Object.keys(rows[0]).map(key=>[key,median(rows.map(row=>row[key]))]));
const results={};
for(const [name,options] of [['before',{overlap:false,early:false}],['after',{overlap:true,early:true}]]){
  const sim=await environment(options),rows=[];
  for(let run=0;run<ms.runs;run++)rows.push(await sim.call(options));
  await sim.close();results[name]=summarize(rows);
}
console.log(JSON.stringify({assumedMs:ms,medianMsFromTap:results,
  savedMs:Object.fromEntries(Object.keys(results.before).map(key=>[key,results.before[key]-results.after[key]]))},null,2));
process.exit(0);
