#!/usr/bin/env node
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const plain=s=>String(s??'').replace(/[\s\p{P}\p{S}]/gu,'').replace(/小琳|小霖/g,'小林').replace(/小舟/g,'小周');
export function coverage(heard,expected){
 const a=plain(heard),b=plain(expected);if(!a||!b)return 0;if(a.includes(b))return 1;
 const grams=new Set();for(let i=0;i+1<a.length;i++)grams.add(a.slice(i,i+2));let found=0;for(let i=0;i+1<b.length;i++)if(grams.has(b.slice(i,i+2)))found++;
 return found/Math.max(1,b.length-1);
}
export function scoreEngine(pair,engine){
 const events=engine.events,protocol=engine.protocol??[],turns=pair.scenario.turns.map((t,i)=>({...t,start:events.find(e=>e.type==='fixture.input.start'&&e.turnId===t.id)?.at??t.startMs,end:events.find(e=>e.type==='fixture.input.end'&&e.turnId===t.id)?.at??t.endMs,next:events.find(e=>e.type==='fixture.input.start'&&e.turnId===pair.scenario.turns[i+1]?.id)?.at??pair.scenario.turns[i+1]?.startMs??Infinity,replies:[]}));
 const questionTurns=new Map(),questionText=new Map(),responseQuestions=new Map(),association=new Map(),completed=[];
 const qkey=(connection,id)=>connection+':'+id;
 for(const e of protocol){
  if(e.type==='conversation.item.input_audio_transcription.completed'){
   const fragment=plain(e.text).replace(/指说/g,'只说');
   const candidates=turns.filter(t=>t.start<=e.at+150&&e.at-t.start<35000).map(t=>({t,score:coverage(e.text,t.text),partial:fragment.length>=5&&plain(t.text).includes(fragment)&&e.at<=t.end+3500})).filter(c=>c.score>=.45||c.partial).sort((a,b)=>b.score-a.score||b.t.start-a.t.start);
   const k=qkey(e.connection,e.questionId??'asr-'+completed.length);questionText.set(k,e.text);completed.push({...e,key:k});if(candidates[0])questionTurns.set(k,candidates[0].t.id);
  }
  if(e.responseId&&e.questionId){
   const explicit=qkey(e.connection,e.questionId);
   if(questionText.has(explicit)){responseQuestions.set(e.responseId,explicit);association.set(e.responseId,'provider-question-id');}
   else if(e.type==='response.output_text.done'){
    // SeedDuplex currently omits question_id on ASR completed. For that API
    // shape, bind a delivered response only to the latest ASR on the same
    // connection, at most eight seconds earlier. This is ordered attribution,
    // not an identity signal, and unrecognized TV text stays an extra reply.
    const previous=completed.filter(q=>q.connection===e.connection&&q.at<=e.at&&e.at-q.at<=8000).at(-1);
    if(previous){responseQuestions.set(e.responseId,previous.key);association.set(e.responseId,'same-connection-asr-order');}
   }
  }
 }
 const released=new Set(events.filter(e=>e.type==='audio').map(e=>e.responseId)),claimed=new Set(),unbound=[],extra=[],recoveries=[];
 for(const e of events.filter(e=>e.type==='transcript'&&e.role==='assistant'&&e.final)){
  const candidates=protocol.filter(p=>p.type==='response.output_text.done'&&p.text===e.text&&p.at<=e.at+50&&p.responseId&&released.has(p.responseId)&&!claimed.has(p.responseId)).sort((a,b)=>b.at-a.at);
  const response=candidates[0];if(response)claimed.add(response.responseId);
  const question=response?responseQuestions.get(response.responseId):null,id=question?questionTurns.get(question):null;
  const audio=response?events.filter(a=>a.type==='audio'&&a.responseId===response.responseId):[];
  const reply={text:e.text,at:e.at,responseId:response?.responseId,question:questionText.get(question),audioBytes:audio.reduce((n,a)=>n+a.bytes,0),firstAudioAt:audio[0]?.at};
  const recovery=/刚才.*(?:没听清|重说|轮流)|声音重叠/u.test(e.text);if(recovery)recoveries.push(reply);
  if(id){turns.find(t=>t.id===id).replies.push({...reply,association:association.get(response.responseId)});continue;}
  if(recovery)continue;
  if(question&&questionText.has(question)){extra.push(reply);continue;}
  // Keep missing provider ownership visible. Temporal fallback is diagnostic
  // only; it cannot turn an unbound answer into a passing scored trial.
  unbound.push({...reply,windowTurn:turns.find(t=>e.at>=t.start&&e.at<t.next)?.id});
 }
 const enrollment=turns.filter(t=>t.kind.startsWith('intro')).map(t=>{
  const heard=completed.filter(q=>questionTurns.get(q.key)===t.id).map(q=>q.text).join(' '),ack=t.replies.map(r=>r.text).join(' ');
  return {person:t.person,voice:t.voice,expectedName:t.expectedName,nameInAsr:plain(heard).includes(t.expectedName),colorInAsr:plain(heard).includes(t.expectedColor),nameAcknowledged:plain(ack).includes(t.expectedName),colorAcknowledged:plain(ack).includes(t.expectedColor),asr:heard,replies:t.replies};
 });
 const rows=turns.filter(t=>!t.kind.startsWith('intro')).map(t=>{
  const body=t.replies.map(r=>r.text).join(' '),text=plain(body),other=t.expectedName==='小林'?'小周':'小林';
  const answered=t.replies.some(r=>r.audioBytes>0),nameCorrect=text.includes(t.expectedName)&&!text.includes(other),colorCorrect=text.includes(t.expectedColor)&&!text.includes(t.expectedColor==='紫色'?'绿色':'紫色');
  const topicCorrect=t.expectedTopic==='山'?/山|登高|徒步/.test(text):/海|沙滩/.test(text);
  const correct=answered&&(t.kind==='identity'?nameCorrect:t.kind==='preference'?colorCorrect:nameCorrect&&topicCorrect);
  const oppositeName=text.includes(other)&&!text.includes(t.expectedName),oppositeColor=text.includes(t.expectedColor==='紫色'?'绿色':'紫色')&&!text.includes(t.expectedColor),oppositeTopic=t.expectedTopic==='山'?/海|沙滩/.test(text):/山|登高|徒步/.test(text);
  const oppositePersonAnswer=answered&&(t.kind==='identity'?oppositeName:t.kind==='preference'?oppositeColor:oppositeName&&oppositeTopic);
  const first=t.replies.filter(r=>r.firstAudioAt!==undefined).sort((a,b)=>a.firstAudioAt-b.firstAudioAt)[0];
  return {id:t.id,person:t.person,kind:t.kind,voice:t.voice,snrDb:t.measuredSnrDb,expectedName:t.expectedName,expectedColor:t.expectedColor,answered,correct,oppositePersonAnswer,nameCorrect,colorCorrect,topicCorrect,late:t.replies.some(r=>r.at>=t.next),firstDeliveredPcmAfterInputEndMs:first?Math.round(first.firstAudioAt-t.end):null,replies:t.replies};
 });
 const rates={};for(const kind of ['identity','preference','natural']){const r=rows.filter(t=>t.kind===kind);rates[kind]={correct:r.filter(t=>t.correct).length,trials:r.length,missing:r.filter(t=>!t.answered).length};}
 const latencies=rows.filter(r=>r.correct&&r.firstDeliveredPcmAfterInputEndMs!==null).map(r=>r.firstDeliveredPcmAfterInputEndMs).sort((a,b)=>a-b);
 let explicitSpeakerTracking=null;
 if(engine.path==='speaker'){
  const ids=t=>[...new Set(events.filter(e=>e.type==='speaker.identity'&&e.startMs>=t.startMs-400&&e.startMs<=t.endMs+200).map(e=>e.speakerId))];
  const enrolled=Object.fromEntries(turns.filter(t=>t.kind.startsWith('intro')).map(t=>[t.person,ids(t)]));
  const distinct=enrolled.A?.length===1&&enrolled.B?.length===1&&enrolled.A[0]!==enrolled.B[0];
  const checks=turns.filter(t=>!t.kind.startsWith('intro')).map(t=>{const observed=ids(t);return {id:t.id,person:t.person,observed,correct:distinct&&observed.length===1&&observed[0]===enrolled[t.person][0]};});
  explicitSpeakerTracking={enrolled,distinct,correct:checks.filter(t=>t.correct).length,trials:checks.length,missing:checks.filter(t=>!t.observed.length).length,rows:checks};
 }
 const pipelineErrorCounts={};for(const e of events.filter(e=>e.type==='speaker.error')){const k=e.reason??'unspecified';pipelineErrorCounts[k]=(pipelineErrorCounts[k]??0)+1;}
 return {path:engine.path,metrics:rates,correct:rows.filter(t=>t.correct).length,trials:rows.length,late:rows.filter(t=>t.late).length,extraReplies:extra.length,recoveryReplies:recoveries.length,unboundReplies:unbound.length,errors:engine.errors,pipelineErrorCounts,unexpectedGatewayRequests:engine.unexpectedGatewayRequests,
  deliveredPcmLatencyMs:{sampleCount:latencies.length,median:latencies[Math.floor(latencies.length/2)]??null,max:latencies.at(-1)??null},explicitSpeakerTracking,enrollment,rows,extra,recoveries,unbound};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const directory=resolve(process.argv[2]??'');if(!process.argv[2])throw Error('Study directory required');const study=JSON.parse(await readFile(join(directory,'study.json'),'utf8')),cases=[];
 for(const name of (await readdir(join(directory,'comparison'))).filter(n=>n.endsWith('.json')).sort()){
  const pair=JSON.parse(await readFile(join(directory,'comparison',name),'utf8'));
  cases.push({id:pair.case,tier:pair.scenario.tier,environment:pair.scenario.environment,complete:pair.complete,identicalInputs:pair.identicalInputs,feed:pair.feed,provenance:pair.provenance,inputSha256:pair.scenario.sha256,snrDb:pair.scenario.turns.map(t=>t.measuredSnrDb),engines:Object.fromEntries(Object.entries(pair.engines).map(([path,engine])=>[path,{...scoreEngine(pair,engine),inputBytes:engine.inputBytes,inputSha256:engine.inputSha256,droppedInputBytes:engine.droppedInputBytes??0}]))});
 }
 const result={schema:'voice-three-tier-comparison-score-v1',model:'1.2.6.1',syntheticOnly:true,physicalMicrophone:false,physicalPlayback:false,calibration:study.calibration,cases};
 await writeFile(join(directory,'scored.json'),JSON.stringify(result,null,2));
 // A shareable evidence file deliberately omits all complete transcripts,
 // audio, private environment and session identifiers.
 const receipts=JSON.parse(await readFile(join(directory,'tts-usage.json'),'utf8'));
 const aggregate={schema:'voice-three-tier-comparison-aggregate-v1',date:'2026-10-22',model:result.model,syntheticOnly:true,physicalMicrophone:false,physicalPlayback:false,voices:study.voices,pairs:study.pairs,calibration:study.calibration,tts:{resource:'seed-tts-2.0',requests:receipts.length,characters:receipts.reduce((n,r)=>n+r.characters,0),reportedTextWords:receipts.reduce((n,r)=>n+Number(r.usage?.text_words??0),0)},
  scoring:{probesPerCase:{identity:4,preference:2,natural:2},namesNormalized:['小琳/小霖 → 小林','小舟 → 小周'],ownership:'provider question id if present on ASR; otherwise latest completed ASR on same connection within 8 seconds',requiresDeliveredAudio:true,temporalFallbackCountsAsPass:false,errorsAndEnrollmentFailuresRetained:true},
  cases:cases.map(c=>({...c,provenance:{studySha256:c.provenance.studySha256,runnerSha256:c.provenance.runnerSha256??null,speakerModuleSha256:c.provenance.speakerModuleSha256,nativeBridgeSha256:c.provenance.nativeBridgeSha256,speakerDecisionModel:c.provenance.speakerDecisionModel,lookahead:c.provenance.lookahead,nativeInterruptionAsr:c.provenance.nativeInterruptionAsr,gateway:c.provenance.gateway},engines:Object.fromEntries(Object.entries(c.engines).map(([path,e])=>[path,{
   metrics:e.metrics,correct:e.correct,trials:e.trials,late:e.late,extraReplies:e.extraReplies,recoveryReplies:e.recoveryReplies,unboundReplies:e.unboundReplies,errorCount:e.errors.length,pipelineErrorCounts:e.pipelineErrorCounts,unexpectedGatewayRequestCount:e.unexpectedGatewayRequests.length,deliveredPcmLatencyMs:e.deliveredPcmLatencyMs,inputBytes:e.inputBytes,inputSha256:e.inputSha256,droppedInputBytes:e.droppedInputBytes,
   enrollment:e.enrollment.map(({person,voice,nameInAsr,colorInAsr,nameAcknowledged,colorAcknowledged})=>({person,voice,nameInAsr,colorInAsr,nameAcknowledged,colorAcknowledged})),explicitSpeakerTracking:e.explicitSpeakerTracking,
   rows:e.rows.map(({id,person,kind,voice,snrDb,answered,correct,oppositePersonAnswer,nameCorrect,colorCorrect,topicCorrect,late,firstDeliveredPcmAfterInputEndMs})=>({id,person,kind,voice,snrDb,answered,correct,oppositePersonAnswer,nameCorrect,colorCorrect,topicCorrect,late,firstDeliveredPcmAfterInputEndMs}))
  }]))}))};
 await writeFile(join(directory,'aggregate.json'),JSON.stringify(aggregate,null,2));
 console.log(JSON.stringify(cases.map(c=>({id:c.id,identicalInputs:c.identicalInputs,engines:Object.fromEntries(Object.entries(c.engines).map(([k,v])=>[k,{correct:v.correct,trials:v.trials,extra:v.extraReplies,unbound:v.unboundReplies,errors:v.errors}]))}))));
}
