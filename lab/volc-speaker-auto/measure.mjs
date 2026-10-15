import {readFile,writeFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
const label=process.argv[2]??'after',origin=process.env.VOLC_SPEAKER_ORIGIN??'http://127.0.0.1:26319';
const ws=new WebSocket(origin.replace('http','ws')+'/stream',{origin}),events=[],sent=[];let ready=false,started;
ws.on('message',raw=>{const e=JSON.parse(raw);if(e.type==='ready')ready=true;events.push({...e,at:performance.now()});});
await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.send(JSON.stringify({type:'start',mode:'adaptive'}));
while(!ready){if(events.some(e=>e.type==='error'))throw Error('server error');await new Promise(r=>setTimeout(r,50));}
const pcm=await readFile('artifacts/volc-speaker/auto/turn-taking.pcm');started=performance.now();
for(let i=0;i<pcm.length;i+=6400){const chunk=pcm.subarray(i,i+6400);ws.send(chunk);sent.push({start:i/32,end:(i+chunk.length)/32,at:performance.now()});await new Promise(r=>setTimeout(r,200));}ws.send(JSON.stringify({type:'finish'}));
const deadline=Date.now()+60000,lastStart=JSON.parse(await readFile('artifacts/volc-speaker/auto/ground-truth.json','utf8')).at(-1).startMs;
while(Date.now()<deadline&&!events.some(e=>(e.type==='speech'||e.type==='speech-end')&&e.forTurn?.startMs>=lastStart))await new Promise(r=>setTimeout(r,100));
const utterances=events.filter(e=>e.type==='utterance');const rows=utterances.map(e=>{
 const t=e.turn,anchor=sent.find(s=>s.start<=t.endMs&&s.end>=t.endMs),endAt=anchor?anchor.at-(anchor.end-t.endMs):started+t.endMs;
 const decision=events.find(d=>d.type==='decision'&&d.turn.startMs===t.startMs),speech=events.find(d=>(d.type==='speech'||d.type==='speech-start')&&d.forTurn?.startMs===t.startMs);
 return {speakerId:t.speakerId,startMs:t.startMs,asrMs:Math.round(e.at-endAt),modelMs:decision?.elapsedMs,decisionAfterEndMs:decision?Math.round(decision.at-endAt):null,speechAfterEndMs:speech?Math.round(speech.at-endAt):null,status:decision?.status,mode:decision?.mode,usage:decision?.usage,timings:decision?.timings};});
const errors=events.filter(e=>e.type==='error').map(e=>e.message);
const receipt={syntheticOnly:true,label,rows,errors,events:events.map(({audio,...e})=>({...e,...audio?{audioBytes:Buffer.from(audio,'base64').length}:{}}))};
await writeFile(`artifacts/volc-speaker/auto/latency-${label}.json`,JSON.stringify(receipt,null,2),{mode:0o600});
console.log(JSON.stringify({label,rows,errors}));ws.send(JSON.stringify({type:'stop'}));ws.close();
