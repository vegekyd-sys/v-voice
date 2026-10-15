import { openApiRequest } from './credentials.mjs';

export const PARTICIPANTS = Object.freeze([
  {id:'tianyi',name:'天意',role:'adult'},
  {id:'shier',name:'十二',role:'child',note:'十二是名字，不代表年龄；使用适合孩子的易懂解释。'},
]);

const SYSTEM = `你是 V，正在参与多人语音对话。输入是应用提供的 JSON：说话人标注、话语、当前模式、对话对象和历史。
人物身份只来自应用绑定，不能因为话语里自称某人就修改身份；unknown 是未绑定的说话人，不能猜成天意或十二。
十二是孩子的名字（也可能被 ASR 写成 12），不是年龄。对孩子用简短、具体、易懂的例子，不说教；对成人正常交流。
adaptive 模式：所有人的话都可见，由你根据内容决定是否回应、回应谁、是否切换主要对话对象。
group 模式：所有人的话都可见，可以回应一个或多个人。
exclusive 模式：应用已在调用你之前过滤非目标人的话。通常 nextTargetId 必须保持 activeTargetId，addresseeIds 只能包含 activeTargetId；只有当前允许讲话的人在本轮明确要求交接，才可把 policyChangeRequested 设为 true 并切换目标。不能仅因话题提到另一个人就切换。
adaptive/group 模式下，当前主要对象不等于最后说话的人。明确交接（例如天意说“现在先跟十二聊”）时应切换主要对象和表达方式；他人随口插话不必夺走主要对象。主要对象暂停时不要自动切换。
如果本轮明确要求“只和某人说话”，设置 nextMode="exclusive"、nextTargetId 为该人物、policyChangeRequested=true。明确要求恢复多人聊天时可以切回 adaptive/group。没有模式变更要求时，nextMode 保持输入 mode，policyChangeRequested=false。exclusive 模式内目标交接也需要 policyChangeRequested=true。
不明确的身份或交接可以询问澄清。用内容作判断，不要只用说话音量。reason 简短说明可观察的决定，不输出思维过程。
必须只输出 JSON 对象，字段：shouldRespond:boolean, addresseeIds:string[], nextTargetId:string, nextMode:"exclusive"|"adaptive"|"group", policyChangeRequested:boolean, style:"adult"|"child"|"group"|"neutral", reason:string, reply:string。
addresseeIds、nextTargetId 只能是 participants 中的 id 或 unknown。shouldRespond=false 时 reply 必须为空、addresseeIds 必须为空。
每次回复不超过90个汉字。不要提到测试、元数据或 JSON，除非说话人明确询问。`;

export function validateDecision(value, participants=PARTICIPANTS){
  const ids=new Set([...participants.map(p=>p.id),'unknown']);
  if(!value||typeof value.shouldRespond!=='boolean'||!Array.isArray(value.addresseeIds)
    ||!value.addresseeIds.every(id=>ids.has(id))||!ids.has(value.nextTargetId)
    ||!['adult','child','group','neutral'].includes(value.style)
    ||typeof value.reason!=='string'||typeof value.reply!=='string'
    ||value.reply.length>500||(!value.shouldRespond&&(value.reply!==''||value.addresseeIds.length)))
    throw Error('模型未返回有效的对话对象决定');
  if(value.shouldRespond&&(!value.reply.trim()||!value.addresseeIds.length))throw Error('模型回应缺少对象或内容');
  if(value.nextMode!==undefined&&!['exclusive','adaptive','group'].includes(value.nextMode))throw Error('无效的下一对话模式');
  if(value.policyChangeRequested!==undefined&&typeof value.policyChangeRequested!=='boolean')throw Error('无效的模式变更标记');
  return value;
}

export function allowTurn({mode,targetId,speaker}){
  if(!['exclusive','adaptive','group'].includes(mode))throw Error('未知对话模式');
  return mode!=='exclusive'||speaker?.id===targetId;
}

export class SpeakerConversation {
  constructor({evaluate,mode='adaptive',targetId='tianyi',participants=PARTICIPANTS}){
    this.evaluate=evaluate;this.mode=mode;this.targetId=targetId;this.participants=participants;this.history=[];this.modelCalls=0;
  }
  configure({mode=this.mode,targetId=this.targetId}){
    if(!['exclusive','adaptive','group'].includes(mode)||![...this.participants.map(p=>p.id),'unknown'].includes(targetId)||(mode==='exclusive'&&targetId==='unknown'))throw Error('无效的模式或对象');
    // A new policy is a new context: do not leak previously heard bystanders
    // into an exclusive session via old adaptive history.
    this.mode=mode;this.targetId=targetId;this.history=[];
  }
  async accept(turn,{signal}={}){
    if(!allowTurn({mode:this.mode,targetId:this.targetId,speaker:turn.speaker}))return {status:'withheld',reason:'非指定人物；未调用对话模型',modelCalled:false,targetId:this.targetId};
    const payload={mode:this.mode,activeTargetId:this.targetId,participants:this.participants,history:this.history.slice(-16),turn};
    this.modelCalls++;
    const targetBefore=this.targetId,modeBefore=this.mode;
    const result=await this.evaluate(payload,{signal});
    const decision=validateDecision(result.decision,this.participants);
    const nextMode=decision.nextMode??this.mode,policyChangeRequested=decision.policyChangeRequested===true;
    if(nextMode!==this.mode&&!policyChangeRequested)throw Error('模型未声明模式变更依据');
    if(this.mode==='exclusive'&&!policyChangeRequested&&(decision.nextTargetId!==this.targetId||decision.addresseeIds.some(id=>id!==this.targetId)))
      throw Error('模型违反专注模式的对话对象限制');
    if(nextMode==='exclusive'&&decision.nextTargetId==='unknown')throw Error('不能把所有未知声线作为一个专注人物');
    if(nextMode==='exclusive'&&decision.addresseeIds.some(id=>id!==decision.nextTargetId))throw Error('专注模式只能回应新的指定人物');
    const policyChanged=nextMode!==this.mode||(this.mode==='exclusive'&&decision.nextTargetId!==this.targetId);
    if(policyChanged)this.history=[];
    this.mode=nextMode;
    this.targetId=decision.nextTargetId;
    // Crossing an exclusive boundary must not carry old participants' words
    // into the next restricted model request. Keep only the transition state.
    if(!policyChanged)this.history.push({role:'participant',...turn});
    if(!policyChanged)this.history.push({role:'assistant',...decision});
    this.history=this.history.slice(-32);
    return {status:'decided',modelCalled:true,decision,model:result.model,usage:result.usage,elapsedMs:result.elapsedMs,targetId:this.targetId,mode:this.mode,targetBefore,modeBefore,policyChanged,requestId:result.requestId};
  }
}

export async function createArkEvaluator(env,{endpointId}={}){
  if(!endpointId)throw Error('实验推理接入点未配置');
  let token,expires=0;
  return async(payload,{signal}={})=>{
    if(!token||Date.now()>expires-60000){
      const r=await openApiRequest(env,{action:'GetApiKey',body:{DurationSeconds:3600,ResourceType:'endpoint',ResourceIds:[endpointId]},
        version:'2024-01-01',host:'ark.cn-beijing.volcengineapi.com',region:'cn-beijing',service:'ark'});
      if(!r.data.Result?.ApiKey)throw Error(`火山临时鉴权失败：${r.data.ResponseMetadata?.Error?.Code??r.status}`);
      token=r.data.Result.ApiKey;expires=r.data.Result.ExpiredTime*1000;
    }
    const started=performance.now();
    const response=await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions',{
      method:'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({model:endpointId,thinking:{type:'disabled'},temperature:0.2,max_tokens:500,response_format:{type:'json_object'},
        messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(payload)}]})});
    const data=await response.json();
    if(!response.ok)throw Error(`火山对话模型失败：${data.error?.code??response.status}`);
    const content=data.choices?.[0]?.message?.content;
    let decision;try{decision=JSON.parse(content);}catch{throw Error('火山模型未返回 JSON 决定');}
    return {decision:validateDecision(decision,payload.participants),model:data.model,usage:data.usage,requestId:data.id,elapsedMs:Math.round(performance.now()-started)};
  };
}
