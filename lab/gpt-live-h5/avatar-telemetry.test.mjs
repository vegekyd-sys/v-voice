import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createAvatarTelemetry,normalizeAvatarEvent} from './avatar-telemetry.mjs';
import {createAvatarTelemetryLog} from './avatar-telemetry-log.mjs';
const id='11111111-1111-4111-8111-111111111111';
const event=(sequence=1)=>({type:'avatar.displayed',sequence,clientAt:1791547000000,elapsedMs:30,picture:'listen-3',anchor:'listen-3',source:'decision',revision:2,visible:true,turns:[{key:'turn-1',role:'user',text:'今天有点难过',complete:true,truncated:false}],secret:'SECRET'});
const owner=(provider='openai')=>({voiceSessionId:provider+'-voice',sessionKey:'personal',provider,model:'reservation-model',avatarSequences:new Map()});
async function disk(t){const root=await mkdtemp(path.join(os.tmpdir(),'avatar-log-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('private disk log records actual display separately from decisions and deduplicates uncertain retries across all providers',async t=>{
 const directory=await disk(t),log=createAvatarTelemetryLog({directory});t.after(()=>log.close());
 for(const provider of ['openai','seeduplex','grok']){const o=owner(provider);await log.write({owner:o,clientCaptureId:id,events:[event(),{...event(2),type:'avatar.decision_applied'}]});await log.write({owner:o,clientCaptureId:id,events:[event(),{...event(2),type:'avatar.decision_applied'}]});}
 const file=(await readdir(directory))[0],raw=await readFile(path.join(directory,file),'utf8'),rows=raw.trim().split('\n').map(JSON.parse);assert.equal(rows.length,6);assert.equal(rows.filter(r=>r.type==='avatar.displayed').length,3);assert(!raw.includes('SECRET'));assert.equal((await stat(path.join(directory,file))).mode&0o777,0o600);assert(rows.every(r=>r.reportedBy==='browser'&&r.turns[0].text==='今天有点难过'));
});
test('write failure leaves retry watermark untouched and never follows a foreign file symlink',async t=>{
 const directory=await disk(t),o=owner(),log=createAvatarTelemetryLog({directory});await log.write({owner:o,clientCaptureId:id,events:[event()]});const filename=(await readdir(directory))[0];await rm(path.join(directory,filename));const target=path.join(directory,'foreign');await writeFile(target,'preserved');await symlink(target,path.join(directory,filename));await assert.rejects(log.write({owner:o,clientCaptureId:id,events:[event(2)]}));assert.equal(o.avatarSequences.get(id),1);assert.equal(await readFile(target,'utf8'),'preserved');await log.close();
});
test('wire validation rejects invented picture paths, hidden displays and malformed clocks; only public text survives',()=>{
 for(const change of [{picture:'../../secret'},{visible:false},{sequence:0},{source:'internal'},{elapsedMs:-1},{turns:[{role:'system',text:'SECRET'}]}])assert.throws(()=>normalizeAvatarEvent({...event(),...change}));assert(!('secret' in normalizeAvatarEvent(event())));
});
test('client associates visible display with current public turns, retries same identities, and closes without awaiting network',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1791547000000});let fail=true;const sent=[];const snapshot={history:[{key:'old',role:'assistant',text:'old'},{key:'user',role:'user',text:'你能陪我吗',complete:true}],current:[{key:'v',role:'assistant',text:'当然，我在',complete:false},{key:'doc',role:'assistant',speaker:'V · 完整方案',text:'not spoken'}]};
 const client=createAvatarTelemetry({id:()=>id,elapsed:()=>50,snapshot:()=>snapshot,send:async batch=>{sent.push(structuredClone(batch));if(fail)throw Error('offline');}});
 client.display({picture:'listen-3',anchor:'listen-3',source:'decision',revision:1});await client.flush();fail=false;await client.flush();assert.deepEqual(sent[0],sent[1]);assert.equal(client.pending,0);const d=sent[1].events.find(e=>e.type==='avatar.displayed');assert.equal(d.turns[1].text,'当然，我在');assert.equal(d.turns[1].complete,false);assert(!JSON.stringify(d).includes('not spoken'));assert.equal(client.close(),undefined);await client.flush();
});
test('bounded browser queue emits a gap instead of blocking speech or pretending full capture',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1791547000000});const sent=[];const client=createAvatarTelemetry({maxQueued:4,id:()=>id,elapsed:()=>0,snapshot:()=>({history:[],current:[]}),send:async b=>sent.push(structuredClone(b))});for(let i=0;i<10;i++)client.display({picture:'listen-3',source:'state'});await client.flush();await client.flush();assert(sent.flatMap(x=>x.events).some(e=>e.type==='avatar.gap'&&e.dropped>0));client.close();await client.flush();
});
test('multibyte dialogue batches stay within keepalive byte budget without dropping events',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1791547000000});const sent=[];const client=createAvatarTelemetry({id:()=>id,elapsed:()=>0,snapshot:()=>({history:[{key:'u',role:'user',text:'问'.repeat(600)},{key:'v',role:'assistant',text:'答'.repeat(600)}]}),send:async b=>sent.push(structuredClone(b))});
 for(let i=0;i<25;i++)client.display({picture:'listen-3',source:'state'});
 client.close();for(let i=0;i<30&&client.pending;i++)await client.flush();
 assert.equal(client.pending,0);assert(sent.every(b=>new TextEncoder().encode(JSON.stringify(b)).byteLength<=20000));assert.equal(sent.flatMap(b=>b.events).filter(e=>e.type==='avatar.displayed').length,25);
});
