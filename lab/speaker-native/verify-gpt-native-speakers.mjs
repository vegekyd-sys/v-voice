// Authorized synthetic-only, direct native API probe. Does not use the product
// Gateway, ASR, Speaker, Decision, microphone, tools, or human call recordings.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {synthesizeReply} from '../volc-speaker/tts.mjs';

const dir=new URL('../../artifacts/speaker-native/gpt-native-speakers/',import.meta.url);
await mkdir(dir,{recursive:true,mode:0o700});
const port=26324,origin='http://127.0.0.1:'+port;
const voices={A:'zh_male_dayi_uranus_bigtts',B:'zh_female_vv_uranus_bigtts'};
const samples=[
  ['intro-A','A','你好，我叫天懿，是十二的爸爸。'],
  ['intro-B','B','你好，我叫十二，是天懿的孩子。'],
  ['identity-A','A','现在是谁在说话？请只说我的名字。不确定就说不确定。'],
  ['identity-B','B','现在是谁在说话？请只说我的名字。不确定就说不确定。'],
  ['topic-A','A','V，月亮为什么有时候是弯弯的？请简短解释。'],
  ['topic-B','B','V，月亮为什么有时候是弯弯的？请简短解释。'],
  ['side-A','A','十二，把抽屉里的杯子递给我。'],
  ['focus-A','A','V，接下来只跟十二聊，其他人说话不用回答。'],
];
if(process.argv.includes('--prepare')){
  const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE);
  const receipts=[];
  for(const [id,voice,text] of samples){
    const target=new URL(id+'.mp3',dir);
    try{await access(target);}catch{
      const r=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY,text,{speaker:voices[voice]});
      await writeFile(target,r.audio,{mode:0o600});receipts.push({id,usage:r.usage});
    }
    execFileSync('ffmpeg',['-v','error','-y','-i',target.pathname,'-ar','24000','-ac','1',new URL(id+'.wav',dir).pathname]);
  }
  await writeFile(new URL('tts-usage.json',dir),JSON.stringify({syntheticOnly:true,receipts},null,2),{mode:0o600});
  console.log('Synthetic native-speaker fixtures ready.');process.exit(0);
}

// Read only the already-authorized candidate access token into memory. Never
// print or persist credentials; never copy a refresh token or refresh production.
const py=`import sqlite3,json
c=sqlite3.connect('file:/var/lib/v-voice-candidates/speaker-native-01a13f2c/state/agents/makaron/agent/openclaw-agent.sqlite?mode=ro',uri=True)
d=json.loads(c.execute("select store_json from auth_profile_store where store_key='primary'").fetchone()[0])
p=next(v for v in d['profiles'].values() if v.get('provider')=='openai' and v.get('type')=='oauth')
print(json.dumps({k:v for k,v in p.items() if k in ['access','accountId','expires']}))`;
const auth=JSON.parse(execFileSync('ssh',['v','sudo python3 -'],{input:py,encoding:'utf8'}));
if(auth.expires<Date.now()+300000)throw Error('Candidate OAuth expired; no refresh attempted');
const instructions=`你是V，用中文自然交谈。有人会在对话中介绍自己，请结合声音与上下文区分不同说话人并记住各自姓名；声音认不准时坦诚说不确定，不要仅因为上一位是谁就把下一位也当成他。不需要注册或校准。回答普通问题时先自然称呼当前回答对象；给成人可用准确术语，给孩子用简单直观的比喻。注意说话人和回答对象可以不同。只在对方对你说话时回应，人对人的旁聊和电视声保持倾听；明确要求只跟某人聊后，只回应那个人，直到解除。每次回答最多两句。
Backchannel policy: 不需要嗯哼等附和声。
Interruption policy: 对方插话时让出话语。
Delegation policy: Backend tools: 无。本次仅做简单聊天，不委派，不调用工具。`;
const cases={
  identity:['intro-A','intro-B','identity-B','identity-A','identity-A','identity-B','identity-A','identity-B'],
  identity_reverse:['intro-B','intro-A','identity-A','identity-B','identity-B','identity-A','identity-B','identity-A'],
  behavior:['intro-A','intro-B','topic-B','topic-A','side-A','focus-A','topic-A','topic-B'],
  behavior_clean:['intro-A','intro-B','topic-B','topic-A','side-A','focus-A','topic-A','topic-B'],
};
let calls=0,active=false;
const readBody=async req=>{const b=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000000)throw Error('Body too large');b.push(chunk);}return Buffer.concat(b);};
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,origin);
    if(req.headers.host!=='127.0.0.1:'+port)return json(res,403,{error:'Loopback only'});
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(page);return;}
    if(req.method==='GET'&&url.pathname==='/manifest')return json(res,200,{cases,samples});
    if(req.method==='GET'&&url.pathname.startsWith('/clip/')){
      const id=url.pathname.slice(6);if(!samples.some(s=>s[0]===id))return json(res,404,{});
      res.writeHead(200,{'content-type':'audio/wav'});res.end(await readFile(new URL(id+'.wav',dir)));return;
    }
    if(req.method!=='POST'||req.headers.origin!==origin)return json(res,403,{});
    const body=await readBody(req);
    if(url.pathname==='/offer'){
      if(active||calls>=3)return json(res,429,{error:'Synthetic test session limit'});
      active=true;calls++;
      const response=await fetch('https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas',{
        method:'POST',headers:{Authorization:'Bearer '+auth.access,'chatgpt-account-id':auth.accountId,'OpenAI-Alpha':'quicksilver=v2','content-type':'application/json','session-id':randomUUID(),'thread-id':randomUUID(),'x-session-id':randomUUID()},
        body:JSON.stringify({sdp:body.toString(),session:{model:'gpt-live-1-codex',instructions,audio:{output:{voice:'sol'}},delegation:{type:'client'}}}),signal:AbortSignal.timeout(45000)});
      if(!response.ok){active=false;console.log('Native create HTTP',response.status);return json(res,502,{error:'Native create HTTP '+response.status});}
      res.writeHead(200,{'content-type':'application/sdp'});res.end(await response.text());return;
    }
    const id=url.searchParams.get('case');if(!Object.hasOwn(cases,id))return json(res,400,{});
    if(url.pathname==='/result'){
      const result=JSON.parse(body);result.provenance={model:'gpt-live-1-codex',voice:'sol',transport:'direct-native-webrtc',syntheticOnly:true,externalSpeakerLabels:false,externalTranscripts:false,decision:false,gateway:false,productionChanged:false,instructions};
      await writeFile(new URL(id+'.json',dir),JSON.stringify(result,null,2),{mode:0o600});active=false;
      console.log(JSON.stringify({case:id,state:result.state,turns:result.turns?.map(t=>({clip:t.clip,reply:t.reply,latencyMs:t.latencyMs})),errors:result.errors}));return json(res,200,{saved:true});
    }
    if(url.pathname==='/pcm'){
      await writeFile(new URL(id+'-output.pcm',dir),body,{mode:0o600});return json(res,200,{savedBytes:body.length});
    }
    return json(res,404,{});
  }catch(e){active=false;console.log('Probe failed:',e.message.replaceAll(auth.access,'[redacted]'));json(res,500,{error:'Probe transport failed'});}
});

const page=String.raw`<!doctype html><meta charset="utf-8"><title>原生 GPT Live 多人能力验证</title>
<style>body{font:15px system-ui;max-width:900px;margin:30px;color:#253735}button{padding:12px;margin:8px}pre{white-space:pre-wrap}audio{width:100%}</style>
<h1>原生 GPT Live 多人能力验证</h1><p>内部合成音频测试：直连模型，无外部分人、文字输入、Decision 或 V 后台。不使用麦克风。</p>
<button data-case="identity">同一句话盲测身份</button><button data-case="identity_reverse">倒序介绍后盲测身份</button><button data-case="behavior">表达、旁聊与专注</button><button data-case="behavior_clean">等待回答完整结束后验证</button><button id="stop">停止</button>
<p id="status">未开始</p><pre id="log"></pre><audio id="play" controls></audio>
<script type="module">
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));let stop=false;
$('#stop').onclick=()=>{stop=true};
for(const button of document.querySelectorAll('[data-case]'))button.onclick=()=>run(button.dataset.case);
async function run(id){
  for(const b of document.querySelectorAll('[data-case]'))b.disabled=true;
  stop=false;const result={case:id,startedAt:new Date().toISOString(),state:'running',events:[],turns:[],errors:[],output:{samples:0,nonSilentSamples:0,peak:0}};
  const record=(type,value={})=>{result.events.push({t:Math.round(performance.now()-base),type,...value});};
  const log=text=>{$('#log').textContent+=text+'\n'};$('#log').textContent='';$('#status').textContent='连接原生模型';
  const base=performance.now(),ctx=new AudioContext({sampleRate:24000}),pc=new RTCPeerConnection(),dest=ctx.createMediaStreamDestination(),pcm=[];let dc,ready=false,current,source,recorder;
  await ctx.resume();const zero=ctx.createConstantSource();zero.offset.value=0;zero.connect(dest);zero.start();pc.addTrack(dest.stream.getAudioTracks()[0],dest.stream);
  pc.ontrack=e=>{
    const stream=e.streams[0]??new MediaStream([e.track]);$('#play').srcObject=stream;$('#play').muted=true;void $('#play').play();
    const input=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(4096,1,1),silent=ctx.createGain();silent.gain.value=0;
    input.connect(processor);processor.connect(silent);silent.connect(ctx.destination);recorder={input,processor,silent};
    processor.onaudioprocess=e=>{const data=e.inputBuffer.getChannelData(0),b=new Int16Array(data.length);let power=0;
      for(let i=0;i<data.length;i++){b[i]=Math.round(Math.max(-1,Math.min(1,data[i]))*32767);power+=data[i]*data[i];result.output.peak=Math.max(result.output.peak,Math.abs(data[i]));if(Math.abs(data[i])>0.003)result.output.nonSilentSamples++;}
      result.output.samples+=data.length;pcm.push(b);
      if(current&&power/data.length>0.00001){if(current.firstAudioMs===undefined)current.firstAudioMs=performance.now()-base;current.lastAudioMs=performance.now()-base;}
    };
  };
  pc.onconnectionstatechange=()=>record('connection',{state:pc.connectionState});
  try{
    const manifest=await(await fetch('/manifest')).json(),buffers=new Map();
    for(const clip of new Set(manifest.cases[id]))buffers.set(clip,await ctx.decodeAudioData(await(await fetch('/clip/'+clip)).arrayBuffer()));
    dc=pc.createDataChannel('oai-events');dc.onmessage=e=>{let v;try{v=JSON.parse(e.data)}catch{return}
      if(v.type==='session.started'){ready=true;record(v.type,{model:v.session?.model});}
      if(v.type==='error'){result.errors.push(v.error??v);record('error',{error:v.error??v});}
      if(v.type==='turn.done'){record(v.type,{turn:v.turn});if(v.turn?.role==='assistant'&&current){current.reply.push(v.turn.transcript);current.lastReplyAtMs=performance.now()-base;log('V: '+v.turn.transcript);}}
      if(v.type==='output_transcript.added'||v.type==='session.output_transcript.delta')record(v.type,{item:v.item,delta:v.delta});
      if(v.type.includes('delegation'))record(v.type,{unexpected:true});
      if(v.type==='session.closed')record(v.type,{usage:v.usage});
    };
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);
    const response=await fetch('/offer',{method:'POST',headers:{'content-type':'application/sdp'},body:offer.sdp});if(!response.ok)throw Error((await response.json()).error);
    await pc.setRemoteDescription({type:'answer',sdp:await response.text()});
    const waitUntil=performance.now()+25000;while(!ready&&performance.now()<waitUntil&&!stop)await sleep(100);if(!ready)throw Error('Native session did not become ready');
    await sleep(1200);
    let index=0;
    for(const clip of manifest.cases[id]){
      if(stop)break;if(performance.now()-base>175000)throw Error('Synthetic call duration limit');
      const buffer=buffers.get(clip),spec=manifest.samples.find(s=>s[0]===clip);
      current={clip,groundTruthVoice:spec[1],text:spec[2],startMs:performance.now()-base,endMs:performance.now()-base+buffer.duration*1000,reply:[]};result.turns.push(current);
      log('输入 '+clip+': '+spec[2]);$('#status').textContent=id+'：'+clip;
      source=ctx.createBufferSource();source.buffer=buffer;source.connect(dest);source.start();
      await sleep(buffer.duration*1000);
      if(id==='behavior_clean'){
        // Separate complete native replies from following input. The initial
        // fixed-gap run is retained; a late turn.done is not the next reply.
        const quiet=clip==='side-A'||index===6,minimum=clip==='side-A'?12000:20000;
        const deadline=performance.now()+(quiet?minimum:25000);
        while(performance.now()<deadline&&!stop){
          if(!quiet&&current.reply.length&&current.lastAudioMs!==undefined&&performance.now()-base-current.lastAudioMs>1200)break;
          await sleep(100);
        }
        current.observedUntilMs=performance.now()-base;
      }else await sleep(9000);
      if(current.firstAudioMs!==undefined)current.latencyMs=Math.round(current.firstAudioMs-current.endMs);
      index++;
    }
    result.state=stop?'stopped':'complete';
  }catch(e){result.state='error';result.errors.push({message:e.message});log('错误：'+e.message);}
  finally{
    if(dc?.readyState==='open'){try{dc.send(JSON.stringify({type:'session.close'}));await sleep(1000);}catch{}}
    source?.stop();pc.close();zero.stop();recorder?.processor.disconnect();await ctx.close();
    const bytes=new Blob(pcm.map(b=>b.buffer),{type:'application/octet-stream'});
    await fetch('/pcm?case='+id,{method:'POST',body:bytes});await fetch('/result?case='+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result)});
    $('#status').textContent='完成：'+result.state+'，输出有效采样 '+result.output.nonSilentSamples;for(const b of document.querySelectorAll('[data-case]'))b.disabled=false;
  }
}
</script>`;
server.listen(port,'127.0.0.1',()=>console.log('Synthetic-only direct native probe:',origin));
