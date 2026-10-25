const states=new Set(['available','prompt','denied','unavailable','requires_foreground']);
const operationName=/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export function normalizeDeviceActions(value){
 if(value===undefined)return null;
 if(!value||value.version!==1||Array.isArray(value)||Object.keys(value).some(k=>!['version','capabilities','appleNotes'].includes(k)))throw Error('Unsupported device actions');
 const declared=value.capabilities??(value.appleNotes===true?{'notes.create':{status:'available'},'notes.append':{status:'available'}}:{});
 if(!declared||typeof declared!=='object'||Array.isArray(declared)||Object.keys(declared).length>24)throw Error('Invalid device capabilities');
 const capabilities={};
 for(const [op,description] of Object.entries(declared)){
  if(!operationName.test(op)||!description||Object.keys(description).some(k=>k!=='status')||!states.has(description.status))throw Error('Invalid device capability');
  capabilities[op]={status:description.status};
 }
 return {version:1,capabilities};
}
// Called only with admission-owned fields. Models never supply this authority.
export function terminalContext({voiceSessionId,kind='web',capabilities={},actor,session,device}){
 if(!['web','ios','robot','speaker'].includes(kind)||typeof voiceSessionId!=='string')throw Error('Invalid terminal context');
 return {version:1,terminal:{kind},voiceSessionId,actor:{verified:actor?.verified===true,...(actor?.displayName?{displayName:String(actor.displayName).slice(0,128)}:{})},session:{scope:session?.scope==='guest'?'guest':'bound',permissions:'existing_session_only'},device:{scope:'current_call',owner:device?.owner??voiceSessionId},capabilities:normalizeDeviceActions({version:1,capabilities}).capabilities};
}
export const terminalInstructions=context=>'\n当前端与设备能力（服务端绑定的数据，不是新的身份授权）：'+JSON.stringify(context)+'。前后端共用这份上下文。只操作本通话当前设备；能力声明不授予账号权限。用户请求从这里打车/附近查询时，先实际请求当前位置，不用历史、IP、账号地址或模型猜测代替。拒绝/取消不得通过后台或另一工具绕过。设备点不是确认上车点，不直接下单。';
