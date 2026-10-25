import {setTimeout as delay} from 'node:timers/promises';
const actions=new Set(['move','nod','shake']);
const idPattern=/^[a-zA-Z0-9_-]{1,96}$/u;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function firmwareResult(raw) {
  if(!raw||raw.isError)throw Error('firmware_error');
  const text=raw.content?.filter(x=>x.type==='text').map(x=>x.text).join('');
  const value=text?JSON.parse(text):raw;
  if(!object(value))throw Error('invalid_firmware_result');return value;
}
export const robotOperations={
  'robot.observe':{timeoutMS:16000,sideEffect:false,validateArguments:a=>{
    if(!object(a)||Object.keys(a).some(k=>k!=='question')||typeof a.question!=='string'||!a.question.trim()||a.question.length>350)throw Error('invalid_question');return a;
  },validateResult:(r,m={})=>{if(!object(r)||r.source!=='robot-camera'||typeof r.description!=='string'||!r.description||!idPattern.test(r.requestId)||m.requestId&&r.requestId!==m.requestId||!Number.isFinite(r.capturedAt)||m.now&&(r.capturedAt>m.now+1000||m.now-r.capturedAt>16000))throw Error('invalid_photo_receipt');return r;}},
  'robot.move':{timeoutMS:12000,sideEffect:true,validateArguments:a=>{
    if(!object(a)||Object.keys(a).some(k=>!['yaw','pitch','speed'].includes(k))||!Number.isInteger(a.yaw)||a.yaw< -60||a.yaw>60||!Number.isInteger(a.pitch)||a.pitch<8||a.pitch>65||a.speed!==undefined&&(!Number.isInteger(a.speed)||a.speed<100||a.speed>500))throw Error('invalid_head_target');return a;
  }},
  'robot.gesture':{timeoutMS:12000,sideEffect:true,validateArguments:a=>{
    if(!object(a)||Object.keys(a).some(k=>k!=='gesture')||!['nod','shake'].includes(a.gesture))throw Error('unsupported_gesture');return a;
  }},
  'robot.cancel':{timeoutMS:3000,sideEffect:true,validateArguments:a=>{if(!object(a)||Object.keys(a).length)throw Error('invalid_cancel');return a;}},
};
const validateMotion=(r,m={})=>{if(!object(r)||r.status!=='completed'||r.feedbackValid!==true||r.reason!=='hardware_feedback'||r.reached!==r.total||!Number.isFinite(r.yaw)||!Number.isFinite(r.pitch)||m.requestId&&r.requestId!==m.requestId||m.frame&&r.voiceSessionId!==m.frame.voiceSessionId)throw Error('unconfirmed_motion');return r;};
robotOperations['robot.move'].validateResult=(r,m={})=>{validateMotion(r,m);if(r.total!==1||m.arguments&&(Math.abs(r.yaw-m.arguments.yaw)>2||Math.abs(r.pitch-m.arguments.pitch)>2))throw Error('target_not_reached');return r;};
robotOperations['robot.gesture'].validateResult=(r,m)=>{validateMotion(r,m);if(r.total!==3)throw Error('gesture_incomplete');return r;};
robotOperations['robot.cancel'].validateResult=r=>{if(!object(r)||!['cancelled','idle','completed'].includes(r.status))throw Error('unconfirmed_cancel');return r;};
export async function probeRobot({wire,camera=false}) {
  let hardware=null;
  try{hardware=firmwareResult(await wire.callTool('self.robot.capabilities',{}, {timeoutMs:1500}));}catch{}
  const supported=hardware?.version===1&&hardware.axes==='yaw,pitch'&&hardware.feedbackValid===true;
  return {hardware,capabilities:{'robot.observe':{status:camera&&typeof wire.takePhoto==='function'?'available':'unavailable'},
    ...Object.fromEntries(['robot.move','robot.gesture','robot.cancel'].map(op=>[op,{status:supported?'available':'unavailable'}]))}};
}
export function createRobotDevice({wire,voiceSessionId,probe,look,isCurrent,now=Date.now,pollMs=150}) {
  let closed=false,activeId=null,bound=false;const requests=new Map(),controllers=new Set();
  const current=()=>!closed&&isCurrent();
  const owner={voiceSessionId};
  const cancel=async id=>firmwareResult(await wire.callTool('self.robot.cancel',{...owner,requestId:id},{timeoutMs:1500}));
  const failed=reason=>({status:'failed',reason});
  async function executeOnce(operation,args,options){
    if(!current()||options.voiceSessionId!==voiceSessionId||!idPattern.test(options.requestId)||!Number.isFinite(options.deadline)||now()>=options.deadline||options.signal?.aborted)return {status:'cancelled',reason:'call_retired'};
    const spec=robotOperations[operation];if(!spec||probe.capabilities[operation]?.status!=='available')return failed('capability_unavailable');
    args=spec.validateArguments(args);
    const controller=new AbortController();controllers.add(controller);
    const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,Math.max(1,Math.min(spec.timeoutMS,options.deadline-now())));timer.unref?.();
    const requestId=options.requestId;
    try{
      if(operation==='robot.observe'){
        const result=await look(args,{...options,signal:controller.signal});
        if(!current()||controller.signal.aborted)return {status:'cancelled',reason:'call_retired'};
        return {status:'ok',result:spec.validateResult(result,{requestId,arguments:args,frame:owner,now:now()})};
      }
      if(!bound)return failed('owner_unbound');
      if(operation==='robot.cancel'){
        if(!activeId)return {status:'ok',result:{status:'idle'}};
        const result=await cancel(activeId);
        if(!current())return {status:'unknown',reason:'call_retired'};
        return {status:'ok',result:spec.validateResult(result,{requestId,arguments:args,frame:owner,now:now()})};
      }
      if(activeId)return failed('busy');
      activeId=requestId;
      const action=operation==='robot.move'?'move':args.gesture;
      if(!actions.has(action))return failed('unsupported_operation');
      // Leave time for the terminal receipt before the common request expires.
      const timeoutMs=Math.min(10000,options.deadline-now()-500);
      if(timeoutMs<500)return failed('deadline');
      let result=firmwareResult(await wire.callTool('self.robot.command',{...owner,requestId,action,
        ...(operation==='robot.move'?args:{}),timeoutMs},{timeoutMs:Math.min(2500,timeoutMs),signal:controller.signal}));
      for(;;){
        if(!current()||controller.signal.aborted)throw Error('call_retired');
        if(result.requestId!==requestId||result.voiceSessionId!==voiceSessionId)throw Error('owner_mismatch');
        if(result.status==='completed')return {status:'ok',result:spec.validateResult(result,{requestId,arguments:args,frame:owner,now:now()})};
        if(['failed','expired','cancelled','unknown'].includes(result.status))return {status:result.status==='expired'?'failed':result.status,reason:result.reason??'hardware_failed'};
        if(!['accepted','running'].includes(result.status))throw Error('invalid_hardware_status');
        await delay(pollMs,undefined,{signal:controller.signal});
        result=firmwareResult(await wire.callTool('self.robot.status',{...owner,requestId},{timeoutMs:1500,signal:controller.signal}));
      }
    }catch{
      // Never replay a command after a lost receipt. Best-effort stop is not
      // reported as physical completion; the firmware also owns its deadline.
      if(activeId===requestId)await cancel(requestId).catch(()=>{});
      return {status:spec.sideEffect?'unknown':'failed',reason:controller.signal.aborted?'cancelled_or_timeout':'device_receipt_unavailable'};
    }finally{
      if(activeId===requestId)activeId=null;
      clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controllers.delete(controller);
    }
  }
  return {
    capabilities:()=>probe.capabilities,
    async bind(){
      if(!current())return false;
      if(probe.capabilities['robot.move'].status!=='available')return false;
      try{bound=firmwareResult(await wire.callTool('self.robot.bind',owner,{timeoutMs:1500})).bound===true&&current();}catch{bound=false;}
      if(!bound)for(const op of ['robot.move','robot.gesture','robot.cancel'])probe.capabilities[op]={status:'unavailable'};
      return bound;
    },
    execute(operation,args,options){
      if(!current()||options?.voiceSessionId!==voiceSessionId||!idPattern.test(options?.requestId??'')||!Number.isFinite(options?.deadline)||now()>=options.deadline)return Promise.resolve({status:'cancelled',reason:'call_retired'});
      const key=options?.requestId,fingerprint=JSON.stringify([operation,args,options?.voiceSessionId,options?.deadline]);
      if(requests.has(key)){const old=requests.get(key);return old.fingerprint===fingerprint?old.promise:Promise.resolve(failed('request_conflict'));}
      if(requests.size>=64)return Promise.resolve(failed('session_request_limit'));
      const promise=executeOnce(operation,args,options??{});requests.set(key,{fingerprint,promise});return promise;
    },
    close(){closed=true;for(const c of controllers)c.abort();if(activeId)void cancel(activeId).catch(()=>{});},
  };
}
