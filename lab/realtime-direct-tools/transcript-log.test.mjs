import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,writeFile,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createVoiceTranscriptLog,errorKind,DEVICE_START_SESSION_ID} from './transcript-log.mjs';

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
 assert(f.log.audit({type:'client.playback-stats',voiceSessionId:'v1',stats:{inputBytes:48000,outputBytes:96000,raw:'SECRET',audio:'SECRET'}}));
 f.log.audit({type:'call.closed',voiceSessionId:'v1'});
 assert(f.log.audit({type:'backend.completed',voiceSessionId:'v1',runId:'owned-run',result:'SECRET'}));
 await f.log.close();const rows=await f.rows();assert(!JSON.stringify(rows).includes('SECRET'));
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
test('tool and connection errors keep only a fixed errorKind, never the message',()=>{
  const cases={
    'not-configured':['Voice 专用飞书 CLI 配置未就绪','Seeduplex 尚未配置语音凭据','lark: app not configured'],
    'permission':['飞书查询未成功：身份、权限或结果无效','OpenClaw 未开放这个工具','Voice 本人飞书身份不可用','403 Forbidden','permission denied'],
    'timeout':['飞书查询超时，请缩小查询范围。','机器人拍照超时','request timed out','ETIMEDOUT'],
    'unavailable':['Gateway unavailable','飞书只读工具无法启动','音箱已断开','Gateway TRANSPORT_ERROR','connect ECONNREFUSED 127.0.0.1','HTTP 503'],
    'other':['无效日程日期','工具结果过大，请分页读取','',undefined,{message:'x'}],
  };
  for(const [kind,messages] of Object.entries(cases))for(const message of messages)assert.equal(errorKind(message),kind,String(message));
});
test('device listen stages, voiced time and start failures are numbers and enums only',async t=>{
  const f=await fixture(t);f.created();
  assert(f.log.audit({type:'device.call',voiceSessionId:'v1',stage:'listen-detect',deviceId:'stackchan',latencyMs:120,text:'SECRET wake word'}));
  assert(f.log.audit({type:'device.call',voiceSessionId:'v1',stage:'listen-start',deviceId:'stackchan',latencyMs:130,mode:'auto'}));
  assert(f.log.audit({type:'device.call',voiceSessionId:'v1',stage:'listen-stop',deviceId:'stackchan',latencyMs:2900,mode:'SECRET'}));
  assert.equal(f.log.audit({type:'device.call',voiceSessionId:'v1',stage:'listen-SECRET',deviceId:'stackchan'}),false);
  assert(f.log.audit({type:'device.call',voiceSessionId:'v1',stage:'closed',deviceId:'stackchan',reason:'idle',durationMs:14000,voicedMs:3120,droppedVoicedMs:480,
    listenDetects:1,listenStarts:1,listenStops:1,mode:'auto',inputBytes:-1,nearField:{secret:'SECRET'}}));
  // Before Voice gave the call an id: no owner, a fixed id, and the error as a kind.
  assert(f.log.audit({type:'device.call',voiceSessionId:DEVICE_START_SESSION_ID,stage:'closed',deviceId:'stackchan',reason:'start-failed',durationMs:40,voicedMs:0,error:'Gateway unavailable SECRET'}));
  assert.equal(f.log.audit({type:'device.call',voiceSessionId:DEVICE_START_SESSION_ID,stage:'listen-detect',deviceId:'stackchan'}),false);
  assert.equal(f.log.audit({type:'transcript',voiceSessionId:DEVICE_START_SESSION_ID,role:'user',text:'SECRET',final:true}),false);
  assert(f.log.audit({type:'device.ota',voiceSessionId:'ota',deviceId:'stackchan',known:true,mac:'SECRET'}));
  await f.log.close();const rows=await f.rows();
  assert(!JSON.stringify(rows).includes('SECRET'));
  const device=rows.filter(r=>r.type==='device.call');
  assert.deepEqual(device.map(r=>[r.stage,r.mode]),[['listen-detect',undefined],['listen-start','auto'],['listen-stop',undefined],['closed','auto'],['closed',undefined]]);
  const closed=device[3];
  assert.deepEqual([closed.voicedMs,closed.droppedVoicedMs,closed.listenDetects,closed.listenStarts,closed.listenStops,closed.inputBytes],[3120,480,1,1,1,undefined]);
  const failed=device[4];
  assert.deepEqual({...failed,captureId:undefined,sequence:undefined,at:undefined,schema:undefined},
    {captureId:undefined,sequence:undefined,at:undefined,schema:undefined,voiceSessionId:DEVICE_START_SESSION_ID,type:'device.call',stage:'closed',deviceId:'stackchan',reason:'start-failed',durationMs:40,voicedMs:0,errorKind:'unavailable'});
  const ota=rows.find(r=>r.type==='device.ota');assert.deepEqual([ota.voiceSessionId,ota.deviceId,ota.known,'mac' in ota],['ota','stackchan',true,false]);
});
test('device tools, robot hosting lines and connection errors are persisted without text or arguments',async t=>{
  const f=await fixture(t);f.created();
  for(const row of [
    {type:'device.look',deviceId:'stackchan',ok:false,latencyMs:15000,error:'机器人拍照超时 SECRET',question:'SECRET'},
    {type:'device.vision',deviceId:'stackchan',ok:true,photoBytes:48213,latencyMs:2100,result:'SECRET'},
    {type:'device.volume',deviceId:'stackchan',volume:80,previous:60,confirmed:true,persisted:false,request:'SECRET'},
    {type:'device.tool-progress',deviceId:'stackchan',index:0,played:true,waitedMs:4012},
    {type:'device.tool-failure-notice',deviceId:'stackchan',tool:'memory_search',spoken:true,line:'SECRET'},
    {type:'device.tool-result-prompt',deviceId:'stackchan',tool:'SECRET tool',spoken:false},
    {type:'device.unheard-turn',deviceId:'stackchan',openMs:5100,spoken:true},
    {type:'call.connection-error',model:'seeduplex',message:'Seeduplex websocket ECONNRESET SECRET'},
    {type:'speaker.end-played',text:'SECRET'},
  ])assert(f.log.audit({...row,voiceSessionId:'v1'}),row.type);
  assert(f.log.audit({type:'tool.delivered',voiceSessionId:'v1',callId:'c1',name:'feishu_calendar',result:{error:'Voice 专用飞书 CLI 配置未就绪 SECRET'}}));
  assert(f.log.audit({type:'tool.delivered',voiceSessionId:'v1',callId:'c2',name:'memory_search',result:{text:'SECRET'}}));
  assert.equal(f.log.audit({type:'device.look',voiceSessionId:'orphan',deviceId:'stackchan',ok:true}),false);
  await f.log.close();const rows=await f.rows();
  assert(!JSON.stringify(rows).includes('SECRET'));
  const by=type=>rows.find(r=>r.type===type);
  assert.deepEqual([by('device.look').ok,by('device.look').latencyMs,by('device.look').errorKind,'error' in by('device.look')],[false,15000,'timeout',false]);
  assert.deepEqual([by('device.vision').photoBytes,by('device.vision').errorKind],[48213,undefined]);
  assert.deepEqual([by('device.volume').volume,by('device.volume').previous,by('device.volume').confirmed,by('device.volume').persisted],[80,60,true,false]);
  assert.deepEqual([by('device.tool-progress').index,by('device.tool-progress').played,by('device.tool-progress').waitedMs],[0,true,4012]);
  assert.deepEqual([by('device.tool-failure-notice').tool,by('device.tool-failure-notice').spoken],['memory_search',true]);
  assert.deepEqual([by('device.tool-result-prompt').tool,by('device.tool-result-prompt').spoken],[undefined,false]);
  assert.deepEqual([by('device.unheard-turn').openMs,by('device.unheard-turn').spoken],[5100,true]);
  assert.deepEqual([by('call.connection-error').errorKind,'message' in by('call.connection-error')],['unavailable',false]);
  assert(by('speaker.end-played'));
  assert.deepEqual(rows.filter(r=>r.type==='tool.delivered').map(r=>[r.name,r.status,r.errorKind]),[['feishu_calendar','error','not-configured'],['memory_search','ok',undefined]]);
});
