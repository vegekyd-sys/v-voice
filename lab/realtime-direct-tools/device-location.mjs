import {randomUUID} from 'node:crypto';

export const LOCATION_TOOL={type:'function',name:'get_current_location',description:'仅当当前用户明确要求使用手机当前位置（例如从这里打车、查询附近）时，向当前通话的 iPhone 请求一次定位。不得用于其他人或静默追踪。返回时间、精度及 WGS84 坐标；approximate=true 只适合附近搜索，不能当作已确认上车点。打车必须先核实地图坐标系、实际上车点和目的地，再报价并等用户明确确认；本工具不下单、不授予工具身份、不写长期记忆。失败/拒绝/过期必须如实解释，不用历史位置补全。',parameters:{type:'object',properties:{},required:[],additionalProperties:false}};

// Per authenticated relay socket, one outstanding request. No database, durable cache,
// caller-supplied sessionKey, or cross-call lookup exists in this broker.
export function createDeviceLocation({voiceSessionId,send,now=Date.now,timeoutMS=25_000}) {
  let pending=null,closed=false,last=null;
  const finish=result=>{const p=pending;if(!p)return;pending=null;clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);p.resolve(result);};
  return {
    request(signal) {
      last=null;
      if(closed||signal?.aborted)return Promise.resolve({ok:false,reason:'cancelled'});
      if(pending)return Promise.resolve({ok:false,reason:'busy'});
      return new Promise(resolve=>{
        const requestId=randomUUID(),abort=()=>finish({ok:false,reason:'cancelled'});
        pending={requestId,expiresAt:now()+timeoutMS,resolve,signal,abort,timer:setTimeout(()=>finish({ok:false,reason:'timeout'}),timeoutMS)};
        signal?.addEventListener('abort',abort,{once:true});
        try{send({type:'device.location.request',version:1,voiceSessionId,requestId,expiresAt:now()+timeoutMS});}catch{finish({ok:false,reason:'unavailable'});}
      });
    },
    receive(e) {
      if(!pending||closed||e?.type!=='device.location.result'||e.version!==1||e.voiceSessionId!==voiceSessionId||e.requestId!==pending.requestId)return false;
      if(now()>pending.expiresAt){finish({ok:false,reason:'timeout'});return true;}
      if(e.ok!==true){
        const reason=['denied','restricted','services_disabled','needs_foreground','timeout','unavailable','cancelled','stale','no_live_activity'].includes(e.reason)?e.reason:'unavailable';
        finish({ok:false,reason});return true;
      }
      const {latitude,longitude,horizontalAccuracyM,capturedAt,accuracyAuthorization,coordinateSystem}=e;
      if(![latitude,longitude,horizontalAccuracyM,capturedAt].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||horizontalAccuracyM<0||horizontalAccuracyM>100_000||coordinateSystem!=='WGS84'||!['full','reduced'].includes(accuracyAuthorization)){
        finish({ok:false,reason:'invalid_location'});return true;
      }
      const ageMS=now()-capturedAt;
      if(ageMS>30_000||ageMS< -5000){finish({ok:false,reason:'stale'});return true;}
      last={latitude,longitude,horizontalAccuracyM,capturedAt,expiresAt:capturedAt+30_000,coordinateSystem,accuracyAuthorization,approximate:accuracyAuthorization==='reduced'||horizontalAccuracyM>100};
      finish({ok:true,location:{...last},scope:'current_call',pickupConfirmed:false});
      return true;
    },
    context(){
      if(closed||!last||now()>last.expiresAt)throw Error('当前位置缺失或已过期，请重新请求手机定位');
      return '\n当前通话手机刚刚提供的位置（设备报告，仅供本次任务，不默认存入长期记忆；不是已确认的上车点，不能直接下单；WGS84 不可直接冒充其他地图坐标系）：\n'+JSON.stringify(last);
    },
    close(){closed=true;last=null;finish({ok:false,reason:'cancelled'});},
  };
}
