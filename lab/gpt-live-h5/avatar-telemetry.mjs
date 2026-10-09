import {avatarPicture} from './avatar-catalog.mjs';
const sources=new Set(['state','decision','continuation','neutral_fallback','asset_fallback','attention','visibility']);
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
export function normalizeAvatarEvent(e) {
 if(!e||!integer(e.sequence,1)||!integer(e.clientAt,1)||!Number.isFinite(e.elapsedMs)||e.elapsedMs<0)throw Error('Invalid avatar event clock');
 const clock={sequence:e.sequence,clientAt:e.clientAt,elapsedMs:e.elapsedMs};
 if(['avatar.capture_started','avatar.capture_closed'].includes(e.type))return {...clock,type:e.type};
 if(e.type==='avatar.gap'){if(!integer(e.dropped,1))throw Error('Invalid avatar gap');return {...clock,type:e.type,dropped:e.dropped};}
 if(!['avatar.displayed','avatar.decision_applied'].includes(e.type)||!avatarPicture(e.picture))throw Error('Invalid avatar picture');
 if(e.type==='avatar.displayed'&&(!sources.has(e.source)||e.visible!==true))throw Error('Invalid avatar display');
 if(e.revision!=null&&!integer(e.revision,1))throw Error('Invalid avatar revision');
 if(!Array.isArray(e.turns)||e.turns.length>2)throw Error('Invalid avatar dialogue');
 const turns=e.turns.map(t=>{
  if(!t||!['user','assistant'].includes(t.role)||typeof t.key!=='string'||t.key.length>160||typeof t.text!=='string'||t.text.length>600||typeof t.complete!=='boolean'||typeof t.truncated!=='boolean')throw Error('Invalid avatar turn');
  return {key:t.key,role:t.role,text:t.text,complete:t.complete,truncated:t.truncated,...(integer(t.at,1)?{at:t.at}:{})};
 });
 return {...clock,type:e.type,picture:e.picture,revision:e.revision??null,turns,
  ...(e.type==='avatar.displayed'?{source:e.source,visible:true,anchor:avatarPicture(e.anchor)?.id??null}:{})};
}
// Network and storage are observational only: never await these on voice paths.
export function createAvatarTelemetry({send,snapshot,now=Date.now,elapsed=()=>performance.now(),id=()=>crypto.randomUUID(),maxQueued=160,retryMs=2000}) {
 const captureId=id(),started=elapsed();let sequence=0,queue=[],dropped=0,busy=false,timer=null,closed=false,retiredAt=Infinity;
 const turns=()=>{
  const s=snapshot(),rows=[...(s?.history??[]),...(s?.current??[])].filter(r=>['user','assistant'].includes(r.role)&&r.speaker!=='V · 完整方案'&&typeof r.text==='string'&&r.text.trim());
  return ['user','assistant'].map(role=>rows.filter(r=>r.role===role).at(-1)).filter(Boolean).map(r=>({key:String(r.key),role:r.role,text:r.text.slice(-600),truncated:r.text.length>600,complete:r.complete??true,...(Number.isSafeInteger(r.at)?{at:r.at}:{})}));
 };
 const clock=()=>({sequence:++sequence,clientAt:now(),elapsedMs:Math.max(0,elapsed()-started)});
 const schedule=delay=>{clearTimeout(timer);timer=setTimeout(()=>void flush(),delay);};
 function record(value){
  if(closed)return;
  if(queue.length>=maxQueued-1){dropped++;return;}
  if(dropped){queue.push({...clock(),type:'avatar.gap',dropped});dropped=0;}
  queue.push({...clock(),...value,turns:turns()});schedule(250);
 }
 async function flush(){
  clearTimeout(timer);if(busy||!queue.length||now()>retiredAt)return;
  // keepalive has a browser byte budget, not a character budget. Leave room
  // for other requests and the call envelope, including multibyte dialogue.
  busy=true;const batch=[];
  for(const e of queue.slice(0,20)){
   if(new TextEncoder().encode(JSON.stringify({captureId,events:[...batch,e]})).byteLength>20000)break;
   batch.push(e);
  }
  try{await send({captureId,events:batch});queue.splice(0,batch.length);}catch{}finally{
   busy=false;
   if(dropped&&queue.length<maxQueued){queue.push({...clock(),type:'avatar.gap',dropped});dropped=0;}
   if(queue.length)schedule(retryMs);
  }
 }
 record({type:'avatar.capture_started'});
 return {display:e=>record({type:'avatar.displayed',...e,visible:true}),decision:e=>record({type:'avatar.decision_applied',picture:e.picture,revision:e.revision??null}),flush,
  close(){if(closed)return;record({type:'avatar.capture_closed'});closed=true;retiredAt=now()+300000;void flush();},get pending(){return queue.length+dropped;}};
}
