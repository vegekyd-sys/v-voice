import {mkdirSync,appendFileSync,statSync,renameSync} from 'node:fs';
import {join} from 'node:path';

// Bounded operational records only: no audio, embeddings, transcripts, tool args,
// names, access credentials or provider protocol. Separate from conversation history.
export function createSpeakerDiagnostics({directory,now=Date.now,maxBytes=4*1024*1024}={}){
  if(!directory)return {audit(){},snapshot:()=>({enabled:false})};
  mkdirSync(directory,{recursive:true,mode:0o700});
  const file=join(directory,'routing.jsonl'),audio=new Set();let failed=0;
  return {audit(event){
    if(!event?.voiceSessionId)return;
    const row={at:now(),type:event.type,voiceSessionId:event.voiceSessionId};
    const scalar=['reason','token','speakerId','startMs','afterStartMs','inferenceMs','prepareMs','bufferMs','fallback','avoidedReplayMs','shouldRespond','status','decisionCalls','inputSeconds','stage','role','final','speaking'];
    for(const key of scalar)if(['string','number','boolean'].includes(typeof event[key]))row[key]=event[key];
    if(event.timings)row.timings=event.timings;
    if(event.rawChoices)row.choices=event.rawChoices;
    if(event.participants)row.people=event.participants.length;
    if(event.addresseeIds)row.to=event.addresseeIds;
    if(event.turn)row.turn={id:event.turn.id,speakerId:event.turn.speakerId,startMs:event.turn.startMs,endMs:event.turn.endMs,textLength:event.turn.text?.length};
    if(event.type==='audio'){
      if(audio.has(event.voiceSessionId))return;
      audio.add(event.voiceSessionId);row.type='output.first-audio';
    }else if(event.type==='response.done'||event.type==='client.playback-state')audio.delete(event.voiceSessionId);
    else if(event.type==='call.closed'){audio.delete(event.voiceSessionId);}
    else if(!event.type.startsWith('speaker.')&&!['call.created','call.connection-stage','call.provider-status','transcript','tool.call','tool.delivered','response.done','client.playback-state'].includes(event.type))return;
    try{if((statSync(file,{throwIfNoEntry:false})?.size??0)>maxBytes)renameSync(file,file+'.previous');appendFileSync(file,JSON.stringify(row)+'\n',{mode:0o600});}catch{failed++;}
  },snapshot:()=>({enabled:true,failed})};
}
