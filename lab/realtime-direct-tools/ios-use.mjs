import {createHash} from 'node:crypto';

export const IOS_OPERATIONS = Object.freeze(['notes.create','notes.append','calendar.create','calendar.query','reminders.create','reminders.query']);
const fields = {
 'notes.create':['title','body'], 'notes.append':['title','body'],
 'calendar.create':['title','body','start','end','timeZone'], 'calendar.query':['start','end','limit'],
 'reminders.create':['title','body','due','timeZone'], 'reminders.query':['limit','includeCompleted'],
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const date = value => typeof value==='string' && /(Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
export function validateIOSOperation(operation,payload){
 if(!IOS_OPERATIONS.includes(operation)||!object(payload)||Object.keys(payload).some(k=>!fields[operation].includes(k)))throw Error('不支持的 iOS 操作或参数');
 const value={...payload};
 for(const [key,max] of [['title',240],['body',8000]])if(key in value){if(typeof value[key]!=='string'||Buffer.byteLength(value[key])>max)throw Error('iOS 文本无效或过长');value[key]=value[key].trim();}
 if(operation.startsWith('notes.')&&(!value.body||typeof value.title!=='string'))throw Error('备忘录需要 title 与 body');
 if(operation.endsWith('.create')&&!operation.startsWith('notes.')&&!value.title)throw Error('需要标题');
 if(operation.startsWith('calendar.')){
  if(!date(value.start)||!date(value.end)||Date.parse(value.end)<=Date.parse(value.start)||Date.parse(value.end)-Date.parse(value.start)>31*86400000)throw Error('需要带时区的有效起止时间，范围最多31天');
 }
 if('due' in value&&!date(value.due))throw Error('提醒时间需要明确时区');
 if('timeZone' in value){if(typeof value.timeZone!=='string')throw Error('无效时区');try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone});}catch{throw Error('无效时区');}}
 if((operation==='calendar.create'||value.due)&&!value.timeZone)throw Error('需要明确 timeZone');
 if('limit' in value&&(!Number.isInteger(value.limit)||value.limit<1||value.limit>20))throw Error('查询最多20条');
 if('includeCompleted' in value&&typeof value.includeCompleted!=='boolean')throw Error('includeCompleted 必须是布尔值');
 return value;
}
export function iosUseCapabilities(snapshot={}){
 const capabilities=snapshot.capabilities??snapshot;
 return IOS_OPERATIONS.map(operation=>({operation,supported:object(capabilities[operation]),status:capabilities[operation]?.status??'unavailable'}));
}
export function iosUseTool(snapshot){
 const operations=iosUseCapabilities(snapshot).filter(x=>x.supported&&['available','prompt','requires_foreground'].includes(x.status)).map(x=>x.operation);
 if(!operations.length)return null;
 return {type:'function',name:'ios_use',description:'在当前通话的 iPhone 上执行苹果应用动作。仅执行用户明确要求的动作。日历是 iPhone 的系统日历，区别于飞书日历。参数规则：Notes title/body；Calendar create title/body/start/end/timeZone，query start/end/limit；Reminders create title/body，可选due/timeZone，query limit/includeCompleted。时间必须含时区，范围最多31天，最多20条。必要时系统提示解锁或授权，然后继续同一任务。等待真实回执才能宣称完成；unknown不重写。权限拒绝不能通过委托后端、换身份或其他工具绕过。复杂任务可委托后端按ios-use Skill使用同一能力，不重复执行。',parameters:{type:'object',properties:{operation:{type:'string',enum:operations},payload:{type:'object',properties:{title:{type:'string'},body:{type:'string'},start:{type:'string'},end:{type:'string'},due:{type:'string'},timeZone:{type:'string'},limit:{type:'integer',minimum:1,maximum:20},includeCompleted:{type:'boolean'}},additionalProperties:false}},required:['operation','payload'],additionalProperties:false}};
}
export function validateIOSResult(operation,result,{requestId,payload}={}){
 if(!object(result)||Buffer.byteLength(JSON.stringify(result))>64000||!['completed','denied','requires_foreground','failed','cancelled','unknown','unavailable'].includes(result.status))throw Error('iOS 回执状态无效');
 if(result.status!=='completed')return {...result,completed:false,instruction:'设备动作未确认完成；不声称成功，不自动重试写入，不委托绕过拒绝。'};
 let valid=false;
 if(operation.startsWith('notes.')){
  const text=(operation==='notes.create'&&payload.title?payload.title+'\n'+payload.body:payload.body)+'\n\nV Voice · '+requestId;
  const digest=createHash('sha256').update(text).digest('hex');
  valid=result.evidence==='user_configured_shortcut_readback'&&result.contentDigest===digest;
 }else if(operation.endsWith('.create')){
  const item=result.item;
  valid=result.evidence==='eventkit_written_readback'&&result.written===true&&result.readBack===true&&object(item)&&typeof item.id==='string'&&Boolean(item.id)&&item.title===payload.title&&(item.body??'')===(payload.body??'');
  if(valid&&operation==='calendar.create')valid=date(item.start)&&date(item.end)&&Math.abs(Date.parse(item.start)-Date.parse(payload.start))<1000&&Math.abs(Date.parse(item.end)-Date.parse(payload.end))<1000;
  if(valid&&operation==='reminders.create'&&payload.due)valid=date(item.due)&&Math.abs(Date.parse(item.due)-Date.parse(payload.due))<1000;
 }else valid=result.evidence==='eventkit_query'&&Array.isArray(result.items)&&result.items.length<=(payload.limit??20)&&result.items.every(x=>object(x)&&typeof x.id==='string'&&typeof x.title==='string');
 if(!valid)throw Error('设备没有返回匹配的实际写入/读取证据');
 return {...result,completed:true,synced:false,instruction:operation.startsWith('notes.')?'用户配置的快捷指令报告已写入并读回；未独立验证 Notes 数据库或 iCloud 同步。':'EventKit 已完成本机操作及读回；不代表 iCloud 同步完成。'};
}
/** Adapter for the shared current-device request transport. No registry or identity choices here. */
export function createIOSUseAdapter({request,capabilities}){
 return async(args,callId,signal)=>{
  if(!object(args)||Object.keys(args).some(k=>!['operation','payload'].includes(k)))throw Error('iOS 请求不接受身份或设备覆盖');
  const payload=validateIOSOperation(args.operation,args.payload);
  const state=iosUseCapabilities(typeof capabilities==='function'?capabilities():capabilities).find(x=>x.operation===args.operation);
  if(!state?.supported||!['available','prompt','requires_foreground'].includes(state.status))throw Error('当前设备不允许此动作，不可通过后端绕过');
  const result=await request({operation:args.operation,payload},callId,signal);
  if(result.status!=='ok')return {...result,completed:false,instruction:'设备未确认完成；拒绝不能通过委托绕过，写入未知不能自动重试。'};
  return {...result,completed:result.result?.completed===true};
 };
}

/** Adapter map consumed by lib/device-requests.mjs. One instance per authenticated call. */
export function iosUseOperations(){
 return Object.fromEntries(IOS_OPERATIONS.map(operation=>{
  return [operation,{timeoutMS:180000,sideEffect:operation.endsWith('.create')||operation==='notes.append',
   validateArguments(args){return validateIOSOperation(operation,args);},
   validateResult(result,{requestId,arguments:args}){return validateIOSResult(operation,{...result,status:'completed'},{requestId,payload:args});},
  }];
 }));
}
