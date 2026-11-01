// GPT Live control: same synthetic caller audio as probe.mjs, over the real Gateway
// reservation and WebRTC, driven by a headless browser. Uses an isolated test session.
// node gpt-live-probe.mjs <scene> <run> <stimuli> <out> <playwright-path>
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {connectGatewayClient} from '../../../lib/gateway-client.mjs';
import {SCENES} from './stimuli.mjs';
const [scene,run,stimuli,out,pw]=process.argv.slice(2);
const {chromium}=createRequire(import.meta.url)(pw);
const config=JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
const token=String(config.gateway.auth.token).replace(/\$\{([^}]+)\}/gu,(_,k)=>process.env[k]??'');
const gateway=await connectGatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token,scopes:['operator.read','operator.write','operator.admin'],caps:[],onEvent(){}});
const sessionKey=`agent:makaron:voice-liveness-probe-${scene}-${run}`;
const reservation=await gateway.request('talk.client.create',{sessionKey,provider:'v-voice-gpt-live',model:'gpt-live-1-codex',voice:'sol',mode:'realtime',transport:'webrtc',brain:'agent-consult',capabilities:['voice-transcript']},{timeoutMs:45000});
const clauses=[];const {clauses:texts,gaps}=SCENES[scene];
for(let i=0;i<texts.length;i++)clauses.push({b64:(await readFile(`${stimuli}/${scene}-${i}.pcm`)).toString('base64'),text:texts[i],gapAfter:gaps[i]??0});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream']});
const page=await browser.newPage();
await page.exposeFunction('__offer',async sdp=>{const r=await fetch(`http://127.0.0.1:${config.gateway.port}${reservation.offerUrl}`,{method:'POST',headers:{authorization:`Bearer ${reservation.clientSecret}`,'content-type':'application/sdp'},body:sdp,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('sdp '+r.status);return r.text();});
const result=await page.evaluate(async({clauses,tailMs})=>{
  const ctx=new AudioContext({sampleRate:48000});await ctx.resume();
  const dest=ctx.createMediaStreamDestination(),pc=new RTCPeerConnection();
  pc.addTrack(dest.stream.getAudioTracks()[0],dest.stream);
  const log=[],spans=[];let t0=0;const t=()=>t0?Math.round(performance.now()-t0):-1;
  const started=new Promise(res=>{
    const ch=pc.createDataChannel('oai-events');
    ch.onmessage=m=>{let e;try{e=JSON.parse(m.data);}catch{return;}if(e.type==='session.started')res();
      const text=e.text??e.transcript??e.delta??e.turn?.transcript??e.payload?.text;
      log.push({t:t(),type:'event',event:e.type,...(typeof text==='string'?{text:text.slice(0,200)}:{}),...(e.turn?.role?{role:e.turn.role}:{})});};
  });
  pc.ontrack=ev=>{
    const el=new Audio();el.srcObject=ev.streams[0];el.volume=0.01;el.play().catch(()=>{});
    const src=ctx.createMediaStreamSource(ev.streams[0]),proc=ctx.createScriptProcessor(1024,1,1);
    let on=false,quiet=0,start=0;
    proc.onaudioprocess=a=>{const d=a.inputBuffer.getChannelData(0);let s=0;for(const v of d)s+=v*v;const rms=Math.sqrt(s/d.length);
      if(rms>0.004){if(!on){on=true;start=t();}quiet=0;}
      else if(on&&++quiet>14){on=false;log.push({t:start,type:'voiced',ms:t()-start-Math.round(quiet*21.3)});}};
    src.connect(proc);proc.connect(ctx.destination);
  };
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  const answer=await window.__offer(offer.sdp);await pc.setRemoteDescription({type:'answer',sdp:answer});
  await Promise.race([started,new Promise((_,j)=>setTimeout(()=>j(Error('no session.started')),20000))]);
  await new Promise(r=>setTimeout(r,1500));t0=performance.now();
  await new Promise(r=>setTimeout(r,1000));
  for(const c of clauses){
    const bytes=Uint8Array.from(atob(c.b64),x=>x.charCodeAt(0)),pcm=new Int16Array(bytes.buffer),buf=ctx.createBuffer(1,pcm.length,16000),d=buf.getChannelData(0);
    for(let i=0;i<pcm.length;i++)d[i]=pcm[i]/32768;
    const s=ctx.createBufferSource();s.buffer=buf;s.connect(dest);const start=t();
    await new Promise(res=>{s.onended=res;s.start();});
    spans.push({start,end:t(),text:c.text});
    if(c.gapAfter)await new Promise(r=>setTimeout(r,c.gapAfter));
  }
  await new Promise(r=>setTimeout(r,tailMs));
  pc.close();return {log,spans,total:t()};
},{clauses,tailMs:12000});
await browser.close();
await gateway.request('talk.client.close',{sessionKey,voiceSessionId:reservation.voiceSessionId}).catch(()=>{});
await mkdir(out,{recursive:true});
await writeFile(`${out}/gptlive-${scene}-${run}.json`,JSON.stringify({model:'gpt-live',scene,run,...result}));
const end=result.spans.at(-1).end;
console.log(JSON.stringify({scene,run,callerEnd:end,voiced:result.log.filter(e=>e.type==='voiced').map(({t,ms})=>({t,ms,during:t<end})),events:[...new Set(result.log.filter(e=>e.type==='event').map(e=>e.event))]}));
gateway.stop();process.exit(0);
