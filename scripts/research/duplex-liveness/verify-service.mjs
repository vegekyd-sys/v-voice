// End-to-end over the real direct voice service with real SeedDuplex and real streaming ASR.
// The caller is synthetic and the Gateway is a fixture: no human, no device, no user session.
// node verify-service.mjs <scene> <run> <stimuli> <out> <echo: off|-20|-6>
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import * as wsModule from 'ws';
import {createDirectVoiceService} from '../../../lab/realtime-direct-tools/session.mjs';
import {NativeInterruptAsr} from '../../../lab/realtime-direct-tools/native-interrupt.mjs';
import {SCENES} from './stimuli.mjs';
const [scene,run,stimuli,out,echo]=process.argv.slice(2);
const gateway={async request(method){if(method==='tools.catalog')return {groups:[{tools:[{id:'web_search',label:'搜索'}]}]};throw Error('fixture has no '+method);}};
const events=[];let t0=0;const t=()=>t0?Date.now()-t0:-1;
const service=createDirectVoiceService({gateway,wsModule,apiKeys:{seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY},nativePlaybackPolicy:'assisted',backchannel:true,
  nativeInterrupt:({inputSampleRate,...callbacks})=>new NativeInterruptAsr({apiKey:process.env.VOLCENGINE_ASR_API_KEY,inputSampleRate,...callbacks}),
  audit:e=>{if(/^backchannel\./.test(e.type))events.push({t:t(),...e});if(e.type==='transcript'&&e.final)events.push({t:t(),type:'transcript',role:e.role,text:e.text});if(e.type==='audio.clear')events.push({t:t(),type:'clear',reason:e.reason});}});
const res=await service.reserve({model:'seeduplex',sessionKey:'voice-liveness-fixture',inputPolicy:'native',inputSampleRate:16000});
const client=new EventEmitter();client.readyState=1;client.close=()=>{};
const gain=echo==='off'?0:10**(Number(echo)/20);let echoBuf=[];
let ready;const readyP=new Promise(r=>{ready=r;});
const outputs=[];
client.send=d=>{const e=JSON.parse(d);
  if(e.type==='ready')ready();
  if(e.type==='audio'){const pcm=Buffer.from(e.audio,'base64');
    outputs.push({t:t(),source:e.source??'model',responseId:e.responseId,ms:Math.round(pcm.length/48)});
    // Residual speaker-to-microphone leak, delayed by the output itself, downsampled 3:2.
    if(gain)for(let i=0;i+6<=pcm.length;i+=6){echoBuf.push(Math.round(pcm.readInt16LE(i)*gain),Math.round(pcm.readInt16LE(i+2)*gain));}
  }
};
service.attach(res.voiceSessionId,res.relayTicket,client);await readyP;
t0=Date.now();let next=Date.now();
const pace=()=>{next+=20;return new Promise(r=>setTimeout(r,Math.max(0,next-Date.now())));};
const push=async pcm=>{const f=Buffer.from(pcm);for(let i=0;i<320&&echoBuf.length;i++)f.writeInt16LE(Math.max(-32768,Math.min(32767,f.readInt16LE(i*2)+echoBuf.shift())),i*2);client.emit('message',f,true);await pace();};
const quiet=async ms=>{for(let i=0;i<ms/20;i++)await push(Buffer.alloc(640));};
const spans=[];
await quiet(1000);
const {clauses,gaps}=SCENES[scene];
for(let c=0;c<clauses.length;c++){const pcm=await readFile(`${stimuli}/${scene}-${c}.pcm`),start=t();for(let o=0;o+640<=pcm.length;o+=640)await push(pcm.subarray(o,o+640));spans.push({start,end:t(),text:clauses[c]});if(c<clauses.length-1)await quiet(gaps[c]);}
await quiet(10000);
await service.close(res.voiceSessionId).catch(()=>{});
await mkdir(out,{recursive:true});
const end=spans.at(-1).end,model=outputs.filter(o=>o.source==='model'),groups=[];
for(const o of model){const g=groups.at(-1);if(g&&g.responseId===o.responseId)g.ms+=o.ms;else groups.push({onset:o.t,responseId:o.responseId,ms:o.ms});}
const summary={scene,run,echo,callerEnd:end,played:events.filter(e=>e.type==='backchannel.played').map(e=>({t:e.t,text:e.text,pauseMs:e.pauseMs,afterClause:spans.findLast(s=>s.end<=e.t)?.text.slice(0,12)})),skipped:events.filter(e=>e.type==='backchannel.skipped').reduce((a,e)=>({...a,[e.reason]:(a[e.reason]??0)+1}),{}),modelDuring:groups.filter(g=>g.onset<end-100).map(g=>({onset:g.onset,ms:g.ms})),firstAfter:(groups.find(g=>g.onset>=end-100)?.onset??NaN)-end,userText:events.filter(e=>e.type==='transcript'&&e.role==='user').map(e=>e.text.slice(0,24)),assistantText:events.filter(e=>e.type==='transcript'&&e.role==='assistant').map(e=>e.text.slice(0,40)),clears:events.filter(e=>e.type==='clear').length};
await writeFile(`${out}/service-${scene}-${echo}-${run}.json`,JSON.stringify({summary,events,outputs,spans}));
console.log(JSON.stringify(summary));process.exit(0);
