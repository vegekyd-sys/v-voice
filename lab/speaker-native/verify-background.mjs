import {request as httpRequest} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';import {WebSocket} from 'ws';import {setTimeout as delay} from 'node:timers/promises';import {pcm16to24} from './service.mjs';
const origin=(process.env.VOICE_VERIFY_ORIGIN??'http://127.0.0.1:26325').replace(/\/$/,''),root=new URL('../../artifacts/speaker-native/',import.meta.url),label=process.argv[2]??'background';if(!/^[-a-z0-9]+$/i.test(label))throw Error('Bad label');
const wire=(process.env.VOICE_VERIFY_CONNECT_ORIGIN??origin).replace(/\/$/,''),host=new URL(origin).host;
const requestWire=(url,options={})=>{
 if(wire===origin)return fetch(url,options);
 if(new URL(url).hostname!=='127.0.0.1'||new URL(url).protocol!=='http:')throw Error('Private verification wire must be loopback');
 return new Promise((resolve,reject)=>{const req=httpRequest(url,options,res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,headers:{get:key=>{const v=res.headers[key.toLowerCase()];return Array.isArray(v)?v[0]:v;}},text:async()=>text,json:async()=>JSON.parse(text)});});});req.on('error',reject);req.end(options.body);});
};
const zeroEpoch=Date.now(),zero=performance.now(),at=()=>Math.round(performance.now()-zero),events=[],audio=[],checks={},turns=[];let cookie,ws,reservation,pump,heartbeat,pending,ended=false,failure;
const post=async(route,body)=>{const r=await requestWire(wire+'/api/'+route,{method:'POST',headers:{host,origin:new URL(origin).origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error??'HTTP '+r.status);return result;};
const wait=async(predicate,ms=30000)=>{const end=performance.now()+ms;while(performance.now()<end){if(failure)throw Error(failure);if(predicate())return;await delay(50);}throw Error('Deadline exceeded');};
const speak=async(id)=>{const pcm=pcm16to24(await readFile(new URL(id+'.pcm',root))),row={id,start:at(),duringPending:events.some(e=>e.type==='tool.call'&&e.name==='delegate_to_v')&&!ended};turns.push(row);await new Promise(resolve=>{pending={pcm,offset:0,resolve};});row.end=at();return row;};
const answer=async(row,regex)=>{await wait(()=>events.some(e=>e.at>=row.end&&e.type==='transcript'&&e.role==='assistant'&&e.final&&regex.test(e.text??'')),25000);row.replyAt=events.find(e=>e.at>=row.end&&e.type==='transcript'&&e.role==='assistant'&&e.final&&regex.test(e.text??'')).at;row.latencyMs=row.replyAt-row.end;row.answered=true;await wait(()=>events.some(e=>e.type==='audio'&&!e.callId&&e.at>=row.end),15000);row.audioAt=events.find(e=>e.type==='audio'&&!e.callId&&e.at>=row.end).at;await delay(1200);};
try{
 const page=await requestWire(wire+'/',{headers:{host}});await page.text();cookie=page.headers.get('set-cookie')?.split(';')[0]??'';
 if(process.env.VOICE_VERIFY_COOKIE_FILE)cookie=(await readFile(process.env.VOICE_VERIFY_COOKIE_FILE,'utf8').catch(()=>''))?.trim()||cookie;
 if(process.env.VOICE_VERIFY_ACCESS_FILE&&!cookie){const access=(await readFile(process.env.VOICE_VERIFY_ACCESS_FILE,'utf8')).trim();const r=await requestWire(wire+'/api/access',{method:'POST',headers:{host,origin:new URL(origin).origin,'content-type':'application/json'},body:JSON.stringify({access})});if(!r.ok)throw Error('Admission failed');cookie=r.headers.get('set-cookie')?.split(';')[0]??'';}
 reservation=await post('session',{model:'seeduplex',inputPolicy:'speaker'});heartbeat=setInterval(()=>void post('heartbeat',{voiceSessionId:reservation.voiceSessionId}).catch(e=>failure??=e.message),15000);
 ws=new WebSocket(wire.replace(/^http/,'ws')+'/api/relay?'+new URLSearchParams({voiceSessionId:reservation.voiceSessionId,ticket:reservation.relayTicket}),{headers:{cookie,host,origin:new URL(origin).origin}});
 ws.on('message',raw=>{const e=JSON.parse(raw);if(e.type==='audio'){const b=Buffer.from(e.audio,'base64');audio.push(b);events.push({type:'audio',at:at(),callId:e.callId,bytes:b.length});return;}events.push({...e,at:at()});if(e.type==='speaker.decision'||e.type==='tool.call')console.log(JSON.stringify({stage:e.type,at:at(),to:e.addresseeIds,tool:e.name}));if(e.type==='error')failure=e.message;if(e.type==='tool.result'&&e.name==='delegate_to_v')ended=true;});ws.on('error',e=>failure=e.message);
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});await wait(()=>events.some(e=>e.type==='ready'));
 pump=setInterval(()=>{if(ws.readyState!==1)return;if(pending){const p=pending;ws.send(p.pcm.subarray(p.offset,p.offset+960));p.offset+=960;if(p.offset>=p.pcm.length){pending=null;p.resolve();}}else ws.send(Buffer.alloc(960));},20);
 await speak('bg-warm-a');await wait(()=>events.filter(e=>e.type==='speaker.decision').length>=1);await delay(3500);
 await speak('bg-warm-b');await wait(()=>events.filter(e=>e.type==='speaker.decision').length>=2);await delay(3500);
 checks.twoSpeakers=events.filter(e=>e.type==='speaker.decision').at(-1)?.participants?.length===2;
 await speak('bg-request');await wait(()=>events.some(e=>e.type==='tool.call'&&e.name==='delegate_to_v'),35000);checks.nativeDelegation=true;
 const one=await speak('bg-switch-one');await answer(one,/七|(?<!\d)7(?!\d)/);checks.chatDuringTask=one.duringPending&&one.answered;
 const two=await speak('bg-switch-two');await answer(two,/十一|(?<!\d)11(?!\d)/);checks.secondChat=two.answered;
 await wait(()=>ended,120000);checks.taskTerminal=true;checks.taskProducedResult=events.some(e=>e.type==='backend.result'&&e.text?.trim());
 const three=await speak('bg-switch-three');await answer(three,/十七|(?<!\d)17(?!\d)/);checks.chatAfterTask=three.answered;
 for(const [row,id] of [[one,'speaker:local1'],[two,'speaker:local0'],[three,'speaker:local1']]){const d=events.filter(e=>e.type==='speaker.decision'&&e.at>=row.start&&e.at<=row.replyAt).at(-1);row.correctSpeaker=d?.turn?.speakerId===id;row.correctAudience=d?.addresseeIds?.length===1&&d.addresseeIds[0]===id;}checks.correctPeople=[one,two,three].every(r=>r.correctSpeaker&&r.correctAudience);
 checks.stableRoster=events.filter(e=>e.type==='speaker.decision').at(-1)?.participants?.length===2;
 checks.noRoutingErrors=!events.some(e=>e.type==='speaker.error');checks.actualAudio=turns.filter(t=>t.answered).every(t=>events.some(e=>e.type==='audio'&&!e.callId&&e.at>=t.end&&e.at<=t.replyAt+2000));
}catch(error){failure??=error.message;}finally{
 clearInterval(pump);clearInterval(heartbeat);ws?.close();if(reservation)await post('close',{voiceSessionId:reservation.voiceSessionId}).catch(()=>{});
 if(process.env.VOICE_VERIFY_DIAGNOSTICS_FILE&&reservation){try{const rows=(await readFile(process.env.VOICE_VERIFY_DIAGNOSTICS_FILE,'utf8')).trim().split('\n').map(x=>JSON.parse(x)).filter(x=>x.voiceSessionId===reservation.voiceSessionId);const started=rows.find(x=>x.type==='backend.started'),completed=rows.find(x=>x.type==='backend.completed');checks.realBackendCompleted=Boolean(completed);checks.noImplicitCancel=!rows.some(x=>x.type==='backend.cancel-requested');const first=turns.find(x=>x.id==='bg-switch-one');checks.speechOverlappedRealWork=Boolean(started&&completed&&first&&zeroEpoch+first.start<completed.at&&zeroEpoch+first.end>started.at);}catch{checks.auditAvailable=false;}}
 const result={syntheticOnly:true,origin,voiceSessionId:reservation?.voiceSessionId,checks,passed:!failure&&Object.values(checks).every(Boolean),failure,turns,events,durationMs:at(),audioBytes:audio.reduce((n,b)=>n+b.length,0)};
 await writeFile(new URL('background-'+label+'.json',root),JSON.stringify(result,null,2),{mode:0o600});if(audio.length)await writeFile(new URL('background-'+label+'.pcm',root),Buffer.concat(audio),{mode:0o600});console.log(JSON.stringify({...result,events:undefined}));if(!result.passed)process.exitCode=1;
}
