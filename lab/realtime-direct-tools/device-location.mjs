export const LOCATION_TOOL={type:'function',name:'get_current_location',description:'仅当当前用户明确要求使用手机当前位置（例如从这里打车、查询附近）时，向当前通话的 iPhone 请求一次定位。不得用于其他人或静默追踪。返回时间、精度及 WGS84 坐标；approximate=true 只适合附近搜索，不能当作已确认上车点。打车必须先核实地图坐标系、实际上车点和目的地，再报价并等用户明确确认；本工具不下单、不授予工具身份、不写长期记忆。失败/拒绝/过期必须如实解释，不用历史位置补全。',parameters:{type:'object',properties:{},required:[],additionalProperties:false}};

import {createDeviceRequests} from '../../lib/device-requests.mjs';
export const locationOperation={timeoutMS:25_000,sideEffect:false,validateArguments(args){if(!args||Object.keys(args).length)throw Error('Location takes no arguments');return {};},validateResult(value,{now}){
 const {latitude,longitude,horizontalAccuracyM,capturedAt,accuracyAuthorization,coordinateSystem,source}=value??{};
 if(![latitude,longitude,horizontalAccuracyM,capturedAt].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||horizontalAccuracyM<0||horizontalAccuracyM>100_000||coordinateSystem!=='WGS84'||!['full','reduced'].includes(accuracyAuthorization)||!['core_location','web_geolocation'].includes(source)||now-capturedAt>30_000||now-capturedAt< -5000)throw Error('Invalid/stale device location');
 return {latitude,longitude,horizontalAccuracyM,capturedAt,expiresAt:capturedAt+30_000,coordinateSystem,source,accuracyAuthorization,approximate:accuracyAuthorization==='reduced'||horizontalAccuracyM>100};
}};
export function createDeviceLocation({voiceSessionId,send,now=Date.now,timeoutMS=25_000,capabilities={'location.current':{status:'prompt'}},requests:sharedRequests}){
 let last=null;
 const requests=sharedRequests??createDeviceRequests({voiceSessionId,send,now,capabilities,operations:{'location.current':{...locationOperation,timeoutMS}}});
 return {requests,
  async request(signal){last=null;const receipt=await requests.request('location.current',{}, {signal});if(receipt.status==='ok'){last=receipt.result;return {ok:true,location:{...last},requestId:receipt.requestId,scope:'current_call',pickupConfirmed:false};}return {ok:false,reason:receipt.reason??receipt.status,status:receipt.status};},
  receive:frame=>requests.receive(frame),
  context(){if(!last||now()>last.expiresAt||requests.state('location.current')==='denied')throw Error('当前位置缺失或已过期，请重新请求手机定位');return '\n当前通话手机刚刚提供的位置（设备报告，仅供本次任务，不默认存入长期记忆；不是已确认的上车点，不能直接下单；WGS84 不可直接冒充其他地图坐标系）：\n'+JSON.stringify(last);},
  close(){last=null;requests.close();},
 };
}
