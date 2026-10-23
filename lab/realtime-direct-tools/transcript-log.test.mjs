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

test('connection profiling persists only known stages for the reserved call owner',async t=>{
  const f=await fixture(t);f.created();
  assert.equal(f.log.audit({type:'call.connection-stage',voiceSessionId:'foreign',stage:'provider-ready'}),false);
  assert.equal(f.log.audit({type:'call.connection-stage',voiceSessionId:'v1',stage:'arbitrary SECRET'}),false);
  for(const stage of ['catalog-requested','catalog-ready','context-requested','context-ready','provider-connecting','provider-ready']){
    f.tick(10);assert.equal(f.log.audit({type:'call.connection-stage',voiceSessionId:'v1',stage,token:'SECRET',text:'SECRET'}),true);
  }
  await f.log.close();const rows=await f.rows();
  assert.equal(rows.filter(r=>r.type==='call.connection-stage').length,6);
  assert(!JSON.stringify(rows).includes('SECRET'));
  assert(rows.every(r=>r.sessionKey==='personal'));
});

test('post-hangup delivery receipt survives without accepting late transcript or protocol',async t=>{
 const f=await fixture(t);f.created();f.log.audit({type:'call.closed',voiceSessionId:'v1'});
 assert(f.log.audit({type:'task.delivery-confirmed',voiceSessionId:'v1',runId:'owned-run',kind:'final',receipt:{messageId:'om-real',token:'SECRET'},audio:'SECRET'}));
 assert.equal(f.log.audit({type:'transcript',voiceSessionId:'v1',role:'assistant',text:'late',final:true}),false);
 await f.log.close();const rows=await f.rows();assert.equal(rows.at(-1).messageId,'om-real');assert.equal(rows.at(-1).runId,'owned-run');assert(!JSON.stringify(rows).includes('SECRET'));
});

test('causal diagnostics distinguish ASR, tool wait, backend completion and output without retaining payloads',async t=>{
 const f=await fixture(t);f.created();
 for(const row of [
  {type:'provider.event',providerEventType:'conversation.item.input_audio_transcription.started',responseId:'turn'},
  {type:'tool.call',callId:'tool',name:'web_search',args:{query:'SECRET'}},
  {type:'tool.delivered',callId:'tool',result:{text:'SECRET'}},
  {type:'backend.started',callId:'job',ack:{taskId:'owned-task',runId:'owned-run',token:'SECRET'}},
  {type:'response.done',status:'completed',responseId:'response'},
 ])assert(f.log.audit({...row,voiceSessionId:'v1',audio:'SECRET',text:'SECRET'}));
 assert.equal(f.log.audit({type:'provider.event',voiceSessionId:'v1',providerEventType:'response.output_audio.delta',audio:'SECRET'}),false);
 assert(f.log.audit({type:'client.playback-stats',voiceSessionId:'v1',stats:{inputBytes:48000,outputBytes:96000,contextState:'interrupted',inputFrames:50,contextTimeMs:1000,trackMuted:false,pageHidden:false,raw:'SECRET',audio:'SECRET'}}));
 f.log.audit({type:'call.closed',voiceSessionId:'v1'});
 assert(f.log.audit({type:'backend.completed',voiceSessionId:'v1',runId:'owned-run',result:'SECRET'}));
 await f.log.close();const rows=await f.rows();assert(!JSON.stringify(rows).includes('SECRET'));
 assert.deepEqual(rows.find(r=>r.type==='client.playback-stats').stats,{inputBytes:48000,outputBytes:96000,inputFrames:50,contextTimeMs:1000,trackMuted:false,pageHidden:false,contextState:'interrupted'});
 assert.equal(rows.find(r=>r.type==='backend.started').taskId,'owned-task');assert.equal(rows.at(-1).type,'backend.completed');
});
test('a barge-in records which speaker sent it, without any frame payload',async t=>{
  const f=await fixture(t);f.created();
  assert(f.log.audit({type:'client.barge-in',voiceSessionId:'v1',deviceId:'stackchan',confirmed:true,audio:'SECRET'}));
  assert(f.log.audit({type:'client.barge-in',voiceSessionId:'v1',deviceId:'Bad Id!'}));
  await f.log.close();const rows=(await f.rows()).filter(r=>r.type==='client.barge-in');
  assert.deepEqual(rows.map(r=>[r.deviceId,r.confirmed]),[['stackchan',true],[undefined,undefined]]);
  assert(!JSON.stringify(rows).includes('SECRET'));
});
test('upstream cancels and their refusals are kept as event types only',async t=>{
  const f=await fixture(t);f.created();
  for(const providerEventType of ['client.response.cancel','client.response.cancel.rejected','response.canceled','error'])f.log.audit({type:'provider.event',voiceSessionId:'v1',providerEventType,message:'SECRET'});
  await f.log.close();const rows=(await f.rows()).filter(r=>r.type==='provider.event');
  assert.deepEqual(rows.map(r=>r.providerEventType),['client.response.cancel','client.response.cancel.rejected','response.canceled']);
  assert(!JSON.stringify(rows).includes('SECRET'));
});

test('where a background result went is recorded without its content',async t=>{
  const f=await fixture(t);f.created();
  for(const type of ['backend.read-retry','backend.result-held','backend.result-context','backend.result-notice','backend.result-spoken-late','backend.result-answered','backend.result-superseded','backend.result-unspoken'])
    assert.notEqual(f.log.audit({type,voiceSessionId:'v1',callId:'task',error:'SECRET',result:'SECRET'}),false);
  await f.log.close();const rows=await f.rows();
  assert.deepEqual(rows.filter(r=>r.type.startsWith('backend.')).map(r=>r.type),['backend.read-retry','backend.result-held','backend.result-context','backend.result-notice','backend.result-spoken-late','backend.result-answered','backend.result-superseded','backend.result-unspoken']);
  assert(!JSON.stringify(rows).includes('SECRET'));
});

test('ending diagnostics retain only fixed lifecycle stages',async t=>{
 const f=await fixture(t);f.created();
 for(const stage of ['farewell-requested','farewell-unavailable'])assert(f.log.audit({type:'call.ending',voiceSessionId:'v1',stage,text:'SECRET',apiKey:'SECRET'}));
 assert.equal(f.log.audit({type:'call.ending',voiceSessionId:'v1',stage:'SECRET'}),false);
 await f.log.close();const rows=await f.rows();assert.equal(rows.filter(r=>r.type==='call.ending').length,2);assert(!JSON.stringify(rows).includes('SECRET'));
});

test('search timing keeps bounded scalar metadata without results or arbitrary debug fields',async t=>{
 const f=await fixture(t);f.created();
 assert(f.log.audit({type:'tool.search-metrics',voiceSessionId:'v1',callId:'search',name:'memory_search',gatewayMs:2100,searchMs:1975,originalBytes:729,deliveredBytes:269,compacted:true,hits:0,toolMs:-1,managerMs:'SECRET',query:'SECRET',result:{secret:'SECRET'},debug:{text:'SECRET'}}));
 assert.equal(f.log.audit({type:'tool.search-metrics',voiceSessionId:'v1',callId:'wrong',name:'exec'}),false);
 await f.log.close();const rows=await f.rows(),row=rows.at(-1);
 assert.equal(row.searchMs,1975);assert.equal(row.hits,0);assert.equal(row.compacted,true);
 assert.equal(row.toolMs,undefined);assert.equal(row.managerMs,undefined);assert(!JSON.stringify(rows).includes('SECRET'));
});


test('post-call summary failure diagnostics survive call closure without persisting provider secrets',async t=>{
 const f=await fixture(t);f.created();f.log.audit({type:'call.closed',voiceSessionId:'v1'});
 assert.equal(f.log.audit({type:'call.report-error',voiceSessionId:'v1',reportId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',stage:'summary',error:'summary-timeout',providerResponse:'SECRET'}),true);
 f.log.audit({type:'call.report-error',voiceSessionId:'v1',reportId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',stage:'status-start',error:'call-status-target-unconfirmed'});
 f.log.audit({type:'call.report-error',voiceSessionId:'v1',reportId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',stage:'summary',error:'Bearer SECRET'});
 await f.log.close();const rows=await f.rows();assert.equal(rows.at(-3).error,'summary-timeout');assert.equal(rows.at(-2).error,'call-status-target-unconfirmed');assert.equal(rows.at(-1).error,'call-report-operation-failed');assert(!JSON.stringify(rows).includes('SECRET'));
});
