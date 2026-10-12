import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,writeFile,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createVoiceTranscriptLog} from './transcript-log.mjs';

async function fixture(t,extra={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'voice-text-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'private');
  let clock=Date.parse('2026-10-09T15:59:59Z');
  const errors=[];
  const log=createVoiceTranscriptLog({directory,now:()=>clock,onError:e=>errors.push(e),...extra});
  const created=(id='v1',provider='seeduplex')=>log.audit({type:'call.created',voiceSessionId:id,sessionKey:'personal',provider,model:provider==='grok'?'grok-voice-agent':'1.2.6.1',relayTicket:'SECRET'});
  const speech=(role,text,final=true,id='v1')=>log.audit({type:'transcript',voiceSessionId:id,role,text,final,secret:'SECRET'});
  const rows=async()=>{const files=(await readdir(directory)).sort();return (await Promise.all(files.map(async f=>(await readFile(path.join(directory,f),'utf8')).trim().split('\n').map(JSON.parse)))).flat();};
  return {root,directory,log,created,speech,rows,errors,tick:n=>clock+=n};
}

test('both models keep exact dialogue, deltas and independent call identities without media or secrets',async t=>{
  const f=await fixture(t);f.created();f.created('v2','grok');
  f.speech('user','你好');f.speech('assistant','很',false);f.speech('assistant','高兴',false);f.speech('assistant','很高兴');f.speech('assistant','hello',true,'v2');
  for(const type of ['audio','provider.protocol','tool.native-result','tool.call'])assert.equal(f.log.audit({type,voiceSessionId:'v1',audio:'SECRET',result:'SECRET'}),false);
  await f.log.close();const rows=await f.rows();
  assert.deepEqual(rows.filter(r=>r.type==='transcript').map(r=>[r.provider,r.role,r.text,r.final]),[['seeduplex','user','你好',true],['seeduplex','assistant','很',false],['seeduplex','assistant','高兴',false],['seeduplex','assistant','很高兴',true],['grok','assistant','hello',true]]);
  assert(!JSON.stringify(rows).includes('SECRET'));
  assert.equal((await stat(f.directory)).mode&0o777,0o700);
  assert.equal((await stat(path.join(f.directory,'2026-10-09.jsonl'))).mode&0o777,0o600);
});
test('Shanghai day rollover, process restart and close preserve append-only identities',async t=>{
  const f=await fixture(t);f.created();f.speech('user','before');f.tick(2000);f.speech('assistant','after');f.log.audit({type:'call.closed',voiceSessionId:'v1'});
  assert.equal(f.speech('assistant','late'),false);await f.log.close();
  assert.deepEqual((await readdir(f.directory)).sort(),['2026-10-09.jsonl','2026-10-10.jsonl']);
  const next=createVoiceTranscriptLog({directory:f.directory,now:()=>Date.parse('2026-10-10T00:00:00Z')});next.audit({type:'call.created',voiceSessionId:'v3',provider:'grok',model:'grok-voice-agent',sessionKey:'personal'});await next.close();
  const rows=await f.rows();assert.equal(rows.length,5);assert.equal(new Set(rows.map(r=>`${r.captureId}/${r.sequence}`)).size,5);
});
test('orphan/invalid text cannot create data and storage failure never throws into voice callbacks',async t=>{
  const f=await fixture(t);assert.equal(f.speech('user','orphan'),false);f.created();assert.equal(f.speech('tool','SECRET'),false);assert.equal(f.speech('user',' '),false);
  await f.log.close();assert.equal((await f.rows()).length,1);
  const blocked=path.join(f.root,'file-not-directory');await writeFile(blocked,'existing');
  const bad=createVoiceTranscriptLog({directory:blocked,onError:e=>f.errors.push(e)});
  assert.doesNotThrow(()=>bad.audit({type:'call.created',voiceSessionId:'x',provider:'grok',model:'grok-voice-agent',sessionKey:'personal'}));
  assert.equal((await bad.close()).failed,1);assert.equal(await readFile(blocked,'utf8'),'existing');
});
test('bounded background writes expose dropped text as a durable gap instead of stalling playback',async t=>{
  const f=await fixture(t,{maxPending:1});f.created();assert.equal(f.speech('user','dropped'),false);
  const result=await f.log.close();assert.equal(result.pending,0);assert.equal(result.failed,0);
  assert.equal((await f.rows()).find(r=>r.type==='record.gap').dropped,1);
});
test('existing symlink cannot redirect private transcripts into another file',async t=>{
  const f=await fixture(t);f.created();await f.log.close();
  const target=path.join(f.root,'foreign');await writeFile(target,'preserved');
  await rm(path.join(f.directory,'2026-10-09.jsonl'));await symlink(target,path.join(f.directory,'2026-10-09.jsonl'));
  const logger=createVoiceTranscriptLog({directory:f.directory,now:()=>Date.parse('2026-10-09T01:00:00Z')});logger.audit({type:'call.created',voiceSessionId:'x',provider:'grok',model:'grok-voice-agent',sessionKey:'personal'});
  assert.equal((await logger.close()).failed,1);assert.equal(await readFile(target,'utf8'),'preserved');
});

test('provider diagnostics persist only fixed classifications and numeric codes, never raw errors or audio',async t=>{
  const f=await fixture(t);f.created();
  f.log.audit({type:'call.provider-status',voiceSessionId:'v1',stage:'upstream-error',category:'input-timeout',upstreamCode:'55000000',sessionAgeMs:72000,attempt:1,message:'SECRET',audio:'SECRET',event:{apiKey:'SECRET'}});
  f.log.audit({type:'call.provider-status',voiceSessionId:'v1',stage:'reconnecting',category:'SECRET',upstreamCode:'SECRET',attempt:-1});
  await f.log.close();const rows=await f.rows();assert(!JSON.stringify(rows).includes('SECRET'));
  assert.equal(rows[1].upstreamCode,'55000000');assert.equal(rows[1].sessionAgeMs,72000);assert.equal(rows[2].category,undefined);assert.equal(rows[2].attempt,undefined);
});
