import {mkdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** Text and whitelisted connection diagnostics. No PCM, protocol or credentials. */
export function createVoiceTranscriptLog({directory,now=Date.now,onError=()=>{},maxPending=256}={}) {
  if(!directory||!path.isAbsolute(directory))throw Error('An absolute private transcript directory is required');
  const captureId=randomUUID(),owners=new Map(),closedOwners=new Map();
  let tail=Promise.resolve(),sequence=0,pending=0,dropped=0,failed=0,closed=false;
  const notify=error=>{failed++;try{onError({code:error.code??'transcript_write_failed'});}catch{}};
  const write=async line=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(line.at));
    const handle=await open(path.join(directory,`${day}.jsonl`),constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try {
      const stat=await handle.stat();
      if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('Transcript file must be private');
      await handle.writeFile(JSON.stringify(line)+'\n');
    } finally {await handle.close();}
  };
  const enqueue=value=>{
    if(pending>=maxPending){dropped++;return false;}
    const row={schema:'voice-text-audit-v1',captureId,sequence:++sequence,at:now(),...value};
    pending++;
    tail=tail.then(async()=>{
      if(dropped){const count=dropped;dropped=0;await write({schema:row.schema,captureId,at:row.at,type:'record.gap',dropped:count});}
      await write(row);
    }).catch(notify).finally(()=>{pending--;});
    return true;
  };
  const audit=event=>{
    if(closed||!event||typeof event.voiceSessionId!=='string')return false;
    const id=event.voiceSessionId;
    if(event.type==='call.created'){
      if(!['seeduplex','grok','openai'].includes(event.provider)||typeof event.sessionKey!=='string'||typeof event.model!=='string')return false;
      owners.set(id,{voiceSessionId:id,sessionKey:event.sessionKey,provider:event.provider,model:event.model,modelSource:'voice_reservation'});
      return enqueue({...owners.get(id),type:'call.created'});
    }
    const owner=owners.get(id)??(/^(?:task\.delivery-|backend\.)/.test(event.type)?closedOwners.get(id):null);if(!owner)return false;
    if(event.type==='call.connection-stage'){
      if(!['catalog-requested','catalog-ready','context-requested','context-ready','provider-connecting','provider-ready'].includes(event.stage))return false;
      return enqueue({...owner,type:event.type,stage:event.stage});
    }
    if(event.type==='call.provider-status'){
      if(!['upstream-error','reconnecting','recovered','input-paused','input-resumed'].includes(event.stage))return false;
      const safe={stage:event.stage};
      if(['configuration','input-timeout','upstream-transient','upstream-rejected','network','setup-timeout'].includes(event.category))safe.category=event.category;
      if(typeof event.upstreamCode==='string'&&/^\d{3,8}$/.test(event.upstreamCode))safe.upstreamCode=event.upstreamCode;
      for(const key of ['sessionAgeMs','attempt'])if(Number.isSafeInteger(event[key])&&event[key]>=0)safe[key]=event[key];
      return enqueue({...owner,type:event.type,...safe});
    }
    // Causal metadata only: never persist tool arguments, results, PCM or raw
    // provider frames. A received utterance without a reply must be diagnosable.
    if(['tool.call','tool.delivered','backend.start-requested','backend.started','backend.completed','backend.control','backend.cancel-observed','backend.cancel-unconfirmed','response.done','provider.event','audio.clear'].includes(event.type)){
      if(event.type==='provider.event'&&!['conversation.item.input_audio_transcription.started','response.created','response.output_audio.started'].includes(event.providerEventType))return false;
      if(event.type==='tool.call'&&(typeof event.name!=='string'||typeof event.callId!=='string'))return false;
      const safe={};
      for(const key of ['callId','runId','taskId','responseId','providerEventType','name','mode','status'])if(typeof event[key]==='string')safe[key]=event[key].slice(0,160);
      if(event.type==='backend.started'&&typeof event.ack?.taskId==='string')safe.taskId=event.ack.taskId;
      if(event.type==='backend.started'&&typeof event.ack?.runId==='string')safe.runId=event.ack.runId;
      if(event.type==='tool.delivered')safe.status=event.result?.error?'error':event.result?.cancelled?'cancelled':'ok';
      for(const key of ['ok','queued','applied'])if(typeof event[key]==='boolean')safe[key]=event[key];
      return enqueue({...owner,type:event.type,...safe});
    }
    if(event.type==='client.playback-stats'){
      const stats={};
      for(const key of ['inputBytes','outputBytes','queuedOutputBytes','clears','underflows','maxReceiveGapMs'])if(Number.isFinite(event.stats?.[key])&&event.stats[key]>=0)stats[key]=event.stats[key];
      return enqueue({...owner,type:event.type,stats});
    }
    if(event.type==='transcript'){
      if(!['user','assistant'].includes(event.role)||typeof event.text!=='string'||!event.text.trim()||typeof event.final!=='boolean')return false;
      // A delta remains a delta; interrupted speech need not produce final.
      return enqueue({...owner,type:'transcript',role:event.role,text:event.text,final:event.final,
        ...(typeof event.source==='string'?{source:event.source}:{}),
        ...(typeof event.callId==='string'?{callId:event.callId}:{})});
    }
    if(['task.delivery-confirmed','task.delivery-failed'].includes(event.type)){
      const receipt=event.receipt??{};
      return enqueue({...owner,type:event.type,...(typeof event.runId==='string'?{runId:event.runId}:{}),
        ...(typeof event.kind==='string'?{kind:event.kind}:{}),
        ...(typeof receipt.messageId==='string'?{messageId:receipt.messageId}:{}),
        ...(typeof event.error==='string'?{error:event.error.slice(0,300)}:{})});
    }
    if(event.type==='device.call'){
      // Speaker lifecycle diagnostics: counters and stage names only, no audio.
      if(!['start','ready','input-speech','closed'].includes(event.stage))return false;
      const safe={stage:event.stage};
      for(const key of ['deviceId','reason'])if(typeof event[key]==='string'&&/^[a-z0-9_-]{1,64}$/u.test(event[key]))safe[key]=event[key];
      for(const key of ['latencyMs','durationMs','inputBytes','outputBytes','userTurns','gatedInputBytes','maxInputGapMs'])if(Number.isSafeInteger(event[key])&&event[key]>=0)safe[key]=event[key];
      return enqueue({...owner,type:event.type,...safe});
    }
    if(event.type==='call.closed'){
      closedOwners.set(id,owner);if(closedOwners.size>256)closedOwners.delete(closedOwners.keys().next().value);
      owners.delete(id);return enqueue({...owner,type:'call.closed'});
    }
    return false;
  };
  const drain=async()=>{
    await tail;
    if(dropped){const count=dropped;dropped=0;try{await write({schema:'voice-text-audit-v1',captureId,at:now(),type:'record.gap',dropped:count});}catch(error){dropped+=count;notify(error);}}
    return {pending,dropped,failed};
  };
  return {audit,flush:drain,
    close:async()=>{closed=true;return drain();},
    snapshot:()=>({pending,dropped,failed,owners:owners.size})};
}
