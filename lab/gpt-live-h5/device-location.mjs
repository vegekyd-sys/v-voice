// Browser API adapter only. No account/session/device identity is selected here.
export async function browserDeviceActions(navigator=globalThis.navigator,secure=globalThis.isSecureContext){
 if(!secure||!navigator?.geolocation)return {version:1,capabilities:{'location.current':{status:'unavailable'}}};
 let permission='prompt';try{permission=(await navigator.permissions?.query({name:'geolocation'}))?.state??'prompt';}catch{}
 return {version:1,capabilities:{'location.current':{status:permission==='granted'?'available':permission==='denied'?'denied':'prompt'}}};
}
export function createBrowserDeviceAdapter({voiceSessionId,send,isCurrent,navigator=globalThis.navigator,document=globalThis.document,now=Date.now}){
 const seen=new Set(),retired=new Set(),timers=new Set();let closed=false,permission,revision=0;
 const refresh=()=>{if(!closed&&isCurrent()&&permission)send({type:'device.capabilities',version:1,voiceSessionId,revision:++revision,capabilities:{'location.current':{status:permission.state==='granted'?'available':permission.state==='denied'?'denied':'prompt'}}});};
 void navigator?.permissions?.query({name:'geolocation'}).then(value=>{if(closed)return;permission=value;permission.addEventListener?.('change',refresh);}).catch(()=>{});

 return {close(){closed=true;permission?.removeEventListener?.('change',refresh);for(const timer of timers)clearTimeout(timer);timers.clear();},handle(frame){
  if(frame?.type==='device.cancel'&&frame.voiceSessionId===voiceSessionId){retired.add(frame.requestId);return true;}
  if(frame?.type!=='device.request'||frame.version!==1||frame.voiceSessionId!==voiceSessionId||frame.operation!=='location.current'||typeof frame.requestId!=='string'||seen.has(frame.requestId)||!Number.isFinite(frame.deadline)||frame.deadline<=now()||frame.deadline>now()+30_000||closed||!isCurrent())return false;
  seen.add(frame.requestId);if(seen.size>100)return false;
  let completed=false;
  const finish=(status,result,reason)=>{if(completed||closed||retired.has(frame.requestId)||!isCurrent())return;completed=true;clearTimeout(timer);timers.delete(timer);send({type:'device.result',version:1,voiceSessionId,requestId:frame.requestId,operation:frame.operation,status,...(result?{result}:{}),...(reason?{reason}:{})});};
  const timer=setTimeout(()=>finish('failed',undefined,'timeout'),Math.max(1,frame.deadline-now()));timers.add(timer);
  if(!navigator?.geolocation){finish('failed',undefined,'unavailable');return true;}
  navigator.geolocation.getCurrentPosition(position=>{
   if(now()>frame.deadline){finish('failed',undefined,'timeout');return;}
   finish('ok',{latitude:position.coords.latitude,longitude:position.coords.longitude,horizontalAccuracyM:position.coords.accuracy,capturedAt:position.timestamp,coordinateSystem:'WGS84',source:'web_geolocation',accuracyAuthorization:'full'});
  },error=>finish(error.code===1?'denied':'failed',undefined,error.code===1?'denied':error.code===3?'timeout':'unavailable'),{enableHighAccuracy:true,timeout:Math.max(1,Math.min(20000,frame.deadline-now())),maximumAge:0});
  return true;
 }};
}
