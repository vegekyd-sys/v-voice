import {randomUUID} from 'node:crypto';
const progress=new Set(['running','requires_foreground','waiting_user']);
const terminal=new Set(['ok','denied','failed','cancelled','unknown']);
/** One call's adapter map, not a service-wide registry or permission directory. */
export function createDeviceRequests({voiceSessionId,send,operations,capabilities={},now=Date.now,onState=()=>{}}){
 const pending=new Map(),blocked=new Set();let closed=false;
 const state=operation=>closed?'unavailable':blocked.has(operation)?'denied':capabilities[operation]?.status??'unavailable';
 const done=(p,status,result,reason)=>{if(!pending.delete(p.requestId))return;clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);p.resolve({version:1,requestId:p.requestId,voiceSessionId,operation:p.operation,status,...(result!==undefined?{result}:{}),...(reason?{reason}:{})});};
 return {
  state,
  request(operation,args={},options={}){
   const adapter=operations[operation],status=state(operation);
   if(closed||options.signal?.aborted)return Promise.resolve({status:'cancelled',reason:'call_retired'});
   if(!adapter||!['available','prompt','requires_foreground'].includes(status))return Promise.resolve({status:status==='denied'?'denied':'failed',reason:'capability_'+status});
   if(pending.size>=4||[...pending.values()].some(p=>p.operation===operation))return Promise.resolve({status:'failed',reason:'busy'});
   const argumentsValue=adapter.validateArguments(args);
   return new Promise(resolve=>{
    const requestId=randomUUID(),deadline=now()+adapter.timeoutMS;
    const p={operation,requestId,deadline,resolve,signal:options.signal,adapter};
    const retire=reason=>done(p,adapter.sideEffect?'unknown':'cancelled',undefined,reason);
    p.abort=()=>retire('cancelled');p.timer=setTimeout(()=>retire('timeout'),adapter.timeoutMS);p.timer.unref?.();pending.set(requestId,p);
    p.signal?.addEventListener('abort',p.abort,{once:true});
    try{send({type:'device.request',version:1,requestId,voiceSessionId,operation,deadline,arguments:argumentsValue});}catch{retire('disconnected');}
   });
  },
  receive(frame){
   const p=pending.get(frame?.requestId);
   if(!p||closed||frame.type!=='device.result'||frame.version!==1||frame.voiceSessionId!==voiceSessionId||frame.operation!==p.operation||now()>=p.deadline)return false;
   if(progress.has(frame.status)){onState({requestId:p.requestId,operation:p.operation,status:frame.status});return true;}
   if(!terminal.has(frame.status))return false;
   if(frame.status==='denied')blocked.add(p.operation);
   let result;
   if(frame.status==='ok'){try{result=p.adapter.validateResult(frame.result,{now:now(),requestId:p.requestId});}catch{done(p,p.adapter.sideEffect?'unknown':'failed',undefined,'invalid_result');return true;}}
   done(p,frame.status,result,typeof frame.reason==='string'?frame.reason.slice(0,80):undefined);return true;
  },
  close(){closed=true;for(const p of [...pending.values()])done(p,p.adapter.sideEffect?'unknown':'cancelled',undefined,'call_retired');},
 };
}
