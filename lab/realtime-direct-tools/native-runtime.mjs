import {randomUUID} from 'node:crypto';
import {speakerDisplay, TRANSIENT_MS, THINKING_MS} from '../gpt-live-h5/call-view.mjs';

// Product policy belongs to the service, including calls whose WK page is asleep.
// No tool execution, identity, URLs, JavaScript or credentials cross this contract.
export const NATIVE_RUNTIME_VERSION = 1;
export const NATIVE_RUNTIME_OPERATIONS = Object.freeze([
  'audio.append','audio.clear','audio.complete','playback.hold','playback.release',
  'conversation.row','conversation.speakers','conversation.mode','surface.notice',
  'surface.phase','task.upsert','task.remove','document.present','call.endWhenDrained',
  'call.cancelEnd','connection.wait','connection.ready','avatar.expression',
]);
export const DEFAULT_NATIVE_RUNTIME_POLICY = Object.freeze({
  version:1,
  timing:{thinkingMS:THINKING_MS, providerRecoveryMS:35000, endDrainMS:750},
  copy:{connected:'已接通，可以直接开口', reconnected:'已重新接通，请继续说',
    recovering:'语音模型正在恢复，请稍候再说', recovered:'语音已恢复，可以继续说'},
  pause:{rms:0.035, noiseMultiplier:3, zcrMin:0.004, zcrMax:0.32,
    onsetMS:140, quietMS:400, holdMS:1800, maxHoldMS:12000,
    nativeHoldMS:15000, generationGraceMS:600, doneGraceMS:250},
  bargeIn:{rms:0.025, frames:4},
});
const text=(value,limit=8000)=>typeof value==='string'?Array.from(value).slice(0,limit).join(''):'';
const speakerID=id=>String(id).startsWith('speaker:')?String(id):'speaker:'+id;
const plain=(value,limit)=>text(String(value).replace(/https?:\/\/\S+/gu,'链接').replace(/[#*_`\[\]<>]/gu,'').replace(/\s+/gu,' ').trim(),limit);
const hasMedia=value=>/!\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s<>]+\.(?:mp4|webm|mov|png|jpe?g|webp|gif|avif)(?:[?#][^\s<>]*)?/iu.test(value);
export function documentPresentation(id,body,serverOwned=true){
  const value=text(body,60000), lines=value.split('\n').map(s=>s.trim());
  return {id:text(id,160),text:value,serverOwned,
    title:plain(lines.find(s=>s.startsWith('#'))??'完整方案',32),
    preview:plain(lines.find(s=>s&&!/^(#|\||```)/u.test(s))??'完整内容已送达',90),
    autoOpen:value.length>450||/^#{1,3}\s/mu.test(value)||hasMedia(value)};
}

/** Session-local projection. New provider events and product rules are added here,
 * once, without teaching the binary another model/speaker/tool vocabulary. */
export function createNativeRuntime({voiceSessionId,duplex=false,assisted=false,speakerRouted=false,policy=DEFAULT_NATIVE_RUNTIME_POLICY}={}){
  let revision=0, listenOnly=false, lastSpeakerId=null;
  const rows=[], people=[], documents=new Map();
  const descriptor={...structuredClone(policy), playback:{replaceResponse:duplex, localPause:assisted}};
  const trim=()=>{while(rows.length>80||rows.reduce((n,row)=>n+row.text.length,0)>64000)rows.shift();};
  const row=(role,key)=>{
    let r=key?rows.find(r=>r.key===key):rows.findLast(r=>r.role===role&&!r.complete&&!r.speakerId);
    if(!r){r={id:randomUUID(),key,role,text:'',complete:false};rows.push(r);}return r;
  };
  const label=id=>{const p=people.find(p=>p.id===id);return p?.name?`${p.certainty==='suggested'?'可能是 ':''}${p.name} · ${p.label}`:p?.label??'说话人';};
  const notice=value=>{const n=speakerDisplay(value);return n===undefined?[]:[{op:'surface.notice',text:n?.text??'',kind:n?.kind??'notice',action:n?.action??'',actionLabel:n?.actionLabel??'',ttlMS:n?.transient?TRANSIENT_MS:0}];};
  return {
    descriptor,
    project(value){
      const effects=[], push=(op,rest={})=>effects.push({op,...rest});
      switch(value.type){
      case 'audio':
        push('audio.append',{audio:value.audio,sampleRate:value.sampleRate,sequence:value.sequence,responseId:value.responseId,localBargeIn:!duplex&&value.source==='injected-speech'});break;
      case 'audio.clear':push('audio.clear',{retiredResponseId:value.retiredResponseId});break;
      case 'audio.done':push('audio.complete',{responseId:value.responseId});break;
      case 'input.speech.started':if(assisted)push('playback.hold');break;
      case 'input.speech.stopped':if(assisted)push('playback.hold',{complete:true,recognized:value.recognized!==false});break;
      case 'input.speech.ignored':if(assisted)push('playback.release',{responseId:value.preservedResponseId});break;
      case 'speaker.utterance':case 'speaker.decision':{
        const t=value.turn;
        if(!t||!text(t.text).trim()||t.speakerId===undefined||!Number.isFinite(t.startMs)||!Number.isFinite(t.endMs)||t.startMs<0||t.endMs<t.startMs)break;
        for(const p of (value.participants??[]).slice(0,32)){
          if(!p?.id)continue;const id=speakerID(p.id),i=people.findIndex(p=>p.id===id),person={id:text(id,160),label:text(p.label??'说话人',80),name:p.name?text(p.name,80):null,certainty:p.certainty};
          if(i>=0)people[i]=person;else if(people.length<32)people.push(person);
        }
        const id=speakerID(t.speakerId);
        if(!people.some(p=>p.id===id)&&people.length<32)people.push({id,label:'Speaker '+String.fromCharCode(65+people.length)});
        const r=row('user',`speaker:${t.startMs}:${t.endMs}`);
        Object.assign(r,{text:text(t.text),complete:true,speakerId:id,speakerLabel:label(id),speakerTone:Math.max(0,people.findIndex(p=>p.id===id))%5});
        if(value.type==='speaker.decision')r.listenOnly=value.shouldRespond===false;
        push('conversation.speakers',{people:people.map(p=>({...p,displayLabel:label(p.id)}))});
        // A renamed participant updates their historical rows without reordering them.
        for(const item of rows.filter(r=>r.speakerId)){item.speakerLabel=label(item.speakerId);push('conversation.row',{row:{...item}});}
        if(rows.findLast(r=>r.role==='user')===r){
          lastSpeakerId=id;listenOnly=r.listenOnly===true;
          push('conversation.mode',{lastSpeakerId,listenOnly});
          if(value.type==='speaker.decision')push('surface.phase',{phase:listenOnly?'listening':value.shouldRespond?'thinking':'listening'});
        }
        break;
      }
      case 'transcript':{
        if(!['user','assistant'].includes(value.role)||!text(value.text)||speakerRouted&&value.role==='user')break;
        const r=row(value.role);r.text=value.role==='assistant'&&!value.final?text(r.text+value.text):text(value.text);r.complete=value.final===true;
        push('conversation.row',{row:{...r}});
        if(r.role==='user'&&r.complete)push('surface.phase',{phase:'thinking'});
        if(r.role==='assistant'&&r.complete&&(hasMedia(r.text)||r.text.length>1100||r.text.length>450&&/^#{1,3}\s/mu.test(r.text))){
          r.documentId='reply-'+r.id;push('conversation.row',{row:{...r}});push('document.present',{document:documentPresentation(r.documentId,r.text,false)});
        }
        break;
      }
      case 'tool.call':case 'tool.progress':
        push('task.upsert',{id:text(value.callId,160),activity:text(value.activity??'background',80),stage:value.stage?plain(value.stage,28):value.type==='tool.call'?({web:'查资料中',memory:'查记忆中',calendar:'查日程中'}[value.activity]??'后台处理中'):null,step:value.step});
        push('surface.phase',{phase:'thinking'});break;
      case 'tool.result':case 'tool.error':push('task.remove',{id:text(value.callId,160),outcome:value.type==='tool.error'?'error':'success'});break;
      case 'backend.result':{
        if(!value.callId||!text(value.text)||value.error||value.cancelled)break;
        const d=documentPresentation(value.callId,value.text),previous=documents.get(d.id);
        if(previous===d.text)break;documents.set(d.id,d.text);if(documents.size>16)documents.delete(documents.keys().next().value);
        const r=row('assistant','document:'+d.id);Object.assign(r,{text:'',complete:true,documentId:d.id});
        push('conversation.row',{row:{...r}});push('document.present',{document:d});break;
      }
      case 'end.after-playback':push('call.endWhenDrained',{id:text(value.callId,160)});break;
      case 'end.cancelled':push('call.cancelEnd');break;
      case 'provider.reconnecting':push('connection.wait',{text:descriptor.copy.recovering});break;
      case 'provider.recovered':push('connection.ready',{text:descriptor.copy.recovered});break;
      case 'avatar.expression':push('avatar.expression',{expression:text(value.expression,80)});break;
      default:effects.push(...notice(value));
      }
      trim();
      return {type:'native.runtime',version:1,voiceSessionId,revision:++revision,effects};
    },
  };
}
