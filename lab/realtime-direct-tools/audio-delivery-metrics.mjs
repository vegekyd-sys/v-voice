// Observe PCM already handed to the relay. These are server delivery times,
// never client receipt/render times. No PCM, text or provider frame is retained.
export function createAudioDeliveryMetrics({report,now=()=>performance.now(),gapMs=500,maxGapEvents=8}) {
  let active=null;
  const snapshot=(phase,at,extra={})=>report({type:'audio.delivery',phase,
    ...(active.responseId?{responseId:active.responseId}:{}),
    packets:active.packets,bytes:active.bytes,audioMs:Math.round(active.bytes/48),
    elapsedMs:Math.max(0,Math.round(at-active.startedAt)),
    maxGapMs:Math.round(active.maxGapMs),gaps:active.gaps,...extra});
  const finish=reason=>{
    if(!active)return;
    snapshot('summary',now(),{reason});active=null;
  };
  return {
    packet(bytes,responseId){
      if(!Number.isSafeInteger(bytes)||bytes<=0||bytes%2)return;
      const id=typeof responseId==='string'?responseId.slice(0,160):null;
      const at=now();
      if(active&&id!==active.responseId)finish('replaced');
      if(!active){
        active={responseId:id,startedAt:at,lastAt:at,packets:1,bytes,maxGapMs:0,gaps:0};
        snapshot('first',at);return;
      }
      const gap=Math.max(0,at-active.lastAt);
      active.packets++;active.bytes+=bytes;active.lastAt=at;
      active.maxGapMs=Math.max(active.maxGapMs,gap);
      if(gap>=gapMs){
        active.gaps++;
        if(active.gaps<=maxGapEvents)snapshot('gap',at,{gapMs:Math.round(gap)});
      }
    },
    finish,
  };
}
