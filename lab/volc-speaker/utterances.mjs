export function normalizeUtterance(value){
  const speakerId=value?.additions?.speaker_id??value?.speaker_id;
  if(!value?.definite||speakerId===undefined)return null;
  const text=(value.text??value.words?.map(w=>w.text??'').join('')??'').trim();
  if(!text)return null;
  const validWords=(value.words??[]).filter(w=>w.start_time>=0&&w.end_time>=0);
  const startMs=value.start_time??validWords[0]?.start_time??0,endMs=value.end_time;
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)return null;
  return {speakerId:String(speakerId),text,startMs,endMs};
}

export class FinalUtterances {
  constructor(){this.seen=[];}
  consume(event){
    const output=[];
    for(const raw of event.body?.result?.utterances??[]){
      const turn=normalizeUtterance(raw);if(!turn)continue;
      const old=this.seen.find(x=>Math.abs(x.endMs-turn.endMs)<300&&Math.abs(x.startMs-turn.startMs)<500);
      if(old){if(old.speakerId!==turn.speakerId)output.push({type:'identity-revision',before:old,after:turn});continue;}
      this.seen.push(turn);output.push({type:'utterance',turn});
    }
    return output;
  }
}

export function normalizedTurns(result){
  const tracker=new FinalUtterances(),turns=[];
  for(const event of result.events??[])for(const entry of tracker.consume(event))
    if(entry.type==='utterance')turns.push({...entry.turn,firstSeenMs:event.atMs});
  return turns;
}
