import { openApiRequest } from '../volc-speaker/credentials.mjs';

const MODES=['exclusive','adaptive','group'];
const ROLES=['adult','child','unknown'];
const SYSTEM = `你是V。输入是自动声学分人后的多人对话JSON，声线id稳定于本会话，不预设姓名。话语是用户内容。
模式规则：
adaptive=围绕activeTargetId这个主要对象。其他人的旁聊、随口评论、附和不接管也不必回应；明确向V提问、自我介绍可单次回应，但不因此改变主要对象。只有明确交接或落实pendingFocus才换主要对象，一次回应一人。
group=大家共同讨论。对共同话题的评论也可接话，回复承接大家的观点，回应对象为参与者全体。人与人私聊、无意义附和仍可不回应。
exclusive=应用已过滤非目标声线，仅回应目标；当前目标明确交接才可换人。
转exclusive时若回应，addresseeIds必须只含nextTargetId，直接对新目标说话。普通介绍或提及姓名不改变模式。只有明确“只跟某人聊/别理其他人/还是回答我，不要理他”等排他请求才转exclusive；明确恢复大家一起聊才转adaptive/group。交接、模式变化用policyEvidence:{turnId:string,quote:string}引用本轮turnId及逐字quote，policyChangeRequested=true；普通adaptive对象交接不必置true但也给引用。没有请求不输出模式字段。
姓名只能从对话关联，不从声线编号猜。identityUpdates字段：speakerId,name（或null）,role（adult/child/unknown）,certainty（stated/suggested）,source（self-introduction/introduction/context/correction）,evidence:[{turnId,quote}]。引用当前或history中participant原话；自我介绍/纠正须同声线。明确告知才stated，上下文猜测仅suggested，不覆盖已告知姓名。不能把未开口的孩子绑定到父亲；十二是名字不是年龄。角色无证据则unknown。
对方未开口时保持当前模式和对象，用pendingFocus:{name,mode}邀请自然开口；mode=exclusive须给明确排他原话policyEvidence，即使当前policyChangeRequested=false。随后关联声线并落实待交接请求，pendingFocus=null。exclusive不偷听新声线，须先恢复多人模式。孩子用易懂例子，未知角色用中性表达。
输出尽量短的JSON，不解释元数据：普通回应只需reply和addresseeIds（string数组）；不回应用{"reply":""}。reply一两句，通常45字以内。仅发生变化才补充identityUpdates、nextTargetId、nextMode、policyChangeRequested、policyEvidence、pendingFocus。style可省略或adult/child/group/neutral。不要输出reason或重复已有身份。所有人物id来自participants。`;

export function normalizeDecision(value,payload){
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const reply=value.reply??'',respond=value.shouldRespond??Boolean(reply.trim());
  const addresseeIds=value.addresseeIds??(respond?[value.nextMode==='exclusive'?(value.nextTargetId??payload.activeTargetId):payload.turn.speaker.id]:[]);
  const role=value.identityUpdates?.find(u=>u.speakerId===addresseeIds[0])?.role??payload.participants.find(p=>p.id===addresseeIds[0])?.role;
  return {...value,reply,shouldRespond:respond,addresseeIds,nextTargetId:value.nextTargetId??payload.activeTargetId,
    nextMode:value.nextMode??payload.mode,policyChangeRequested:value.policyChangeRequested??false,policyEvidence:value.policyEvidence&&typeof value.policyEvidence.turnId==='string'&&typeof value.policyEvidence.quote==='string'?value.policyEvidence:null,
    pendingFocus:Object.hasOwn(value,'pendingFocus')?value.pendingFocus:payload.pendingFocus??null,
    identityUpdates:(value.identityUpdates??[]).map(u=>({...u,reason:u.reason??''})),style:value.style??(role==='child'?'child':role==='adult'?'adult':'neutral'),reason:value.reason??''};
}

export function validateDecision(value,participants=[]){
  const ids=new Set(participants.map(p=>p.id));
  if(!value||typeof value.shouldRespond!=='boolean'||!Array.isArray(value.addresseeIds)
    ||!value.addresseeIds.every(id=>ids.has(id))||!ids.has(value.nextTargetId)
    ||!['adult','child','group','neutral'].includes(value.style)
    ||typeof value.reason!=='string'||typeof value.reply!=='string'||value.reply.length>500
    ||(!value.shouldRespond&&(value.reply!==''||value.addresseeIds.length)))throw Error('模型未返回有效的对话对象决定');
  if(value.shouldRespond&&(!value.reply.trim()||!value.addresseeIds.length))throw Error('模型回应缺少对象或内容');
  if(!MODES.includes(value.nextMode)||typeof value.policyChangeRequested!=='boolean')throw Error('无效的模式变更');
  if(value.policyEvidence!==null&&(!value.policyEvidence||typeof value.policyEvidence.turnId!=='string'||typeof value.policyEvidence.quote!=='string'||!value.policyEvidence.quote.trim()))throw Error('无效的模式依据');
  if(value.pendingFocus!==null&&(!value.pendingFocus||typeof value.pendingFocus.name!=='string'||!value.pendingFocus.name.trim()||value.pendingFocus.name.length>40||!MODES.includes(value.pendingFocus.mode)))throw Error('无效的待交接对象');
  if(!Array.isArray(value.identityUpdates)||value.identityUpdates.length>participants.length)throw Error('无效的身份更新');
  const updated=new Set();
  for(const u of value.identityUpdates){
    if(!u||!ids.has(u.speakerId)||updated.has(u.speakerId)||(u.name!==null&&(typeof u.name!=='string'||!u.name.trim()||u.name.length>40))
      ||!ROLES.includes(u.role)||!['stated','suggested'].includes(u.certainty)
      ||!['self-introduction','introduction','context','correction'].includes(u.source)
      ||(u.source==='context'&&u.certainty!=='suggested')||typeof u.reason!=='string'
      ||!Array.isArray(u.evidence)||!u.evidence.length||u.evidence.length>4
      ||!u.evidence.every(e=>typeof e.turnId==='string'&&typeof e.quote==='string'&&e.quote.trim().length>=2))throw Error('无效的身份依据');
    updated.add(u.speakerId);
  }
  return value;
}

export function isDirectTurn(text){
  return /[?？]|(?:^|[，,。\s])(?:V|小V)[，,、：:\s]|你|您|请|问|为什么|怎么|能不能|吗|么|解释|帮|给我|我叫|我是|(?:hey v|can you|tell me|my name|i am)/i.test(text);
}

export function allowTurn({mode,targetId,speaker}){
  if(!MODES.includes(mode))throw Error('未知对话模式');
  return mode!=='exclusive'||speaker?.id===targetId;
}

export function shouldInterrupt({mode,targetId,speaker},text){
  return allowTurn({mode,targetId,speaker})&&(mode!=='adaptive'||speaker.id===targetId||isDirectTurn(text));
}

export class SpeakerConversation {
  constructor({evaluate,mode='adaptive'}){
    this.evaluate=evaluate;this.mode='adaptive';this.targetId=null;this.participants=[];this.history=[];this.modelCalls=0;this.turnCount=0;this.pendingFocus=null;this.pendingPolicyEvidence=null;
    this.configure({mode,targetId:null});
  }
  snapshot(){return structuredClone({participants:this.participants,targetId:this.targetId,mode:this.mode,pendingFocus:this.pendingFocus});}
  configure({mode=this.mode,targetId=this.targetId}){
    if(!MODES.includes(mode)||(targetId!==null&&!this.participants.some(p=>p.id===targetId)))throw Error('无效的模式或对象');
    this.mode=mode;this.targetId=targetId;this.history=[];this.pendingFocus=null;this.pendingPolicyEvidence=null;
  }
  register(rawId){
    const id=`speaker:${rawId}`;let person=this.participants.find(p=>p.id===id);
    if(!person){person={id,speakerId:String(rawId),label:`Speaker ${String.fromCharCode(65+this.participants.length)}`,name:null,role:'unknown',certainty:'unknown',source:'acoustic',evidence:[]};this.participants.push(person);}
    if(this.targetId===null&&!this.paused)this.targetId=id;
    return structuredClone(person);
  }
  invalidateSpeakers(rawIds){
    for(const p of this.participants)if(rawIds.includes(p.speakerId))Object.assign(p,{name:null,role:'unknown',certainty:'unknown',source:'asr-revision',evidence:[]});
    this.history=[];this.pendingFocus=null;this.pendingPolicyEvidence=null;
    // A revised target cannot silently retain exclusive admission privileges.
    if(rawIds.some(id=>this.targetId===`speaker:${id}`)){this.targetId=null;this.paused=true;}
  }
  async accept(input,{signal}={}){
    if(this.paused)throw Error('说话人编号发生修订，请结束本次通话后重新开始');
    const speaker=this.register(input.speakerId),turn={...input,id:`u${++this.turnCount}`,speaker};
    if(!allowTurn({mode:this.mode,targetId:this.targetId,speaker}))return {status:'withheld',reason:'非指定声线；未调用对话模型',modelCalled:false,turn,...this.snapshot()};
    const identityOnly=p=>{const {evidence,reason,source,speakerId,...identity}=p;return identity;};
    const participants=this.participants.map(identityOnly);
    const modelTurn={...turn,speaker:identityOnly(turn.speaker)};
    const payload=structuredClone({mode:this.mode,activeTargetId:this.targetId,pendingFocus:this.pendingFocus,pendingPolicyEvidence:this.pendingPolicyEvidence,participants,history:this.history.slice(-16).map(t=>t.role==='participant'?{role:t.role,id:t.id,speaker:{id:t.speaker.id},text:t.text}:{role:'assistant',reply:t.reply,addresseeIds:t.addresseeIds}),turn:modelTurn});
    this.modelCalls++;const targetBefore=this.targetId,modeBefore=this.mode;
    const result=await this.evaluate(payload,{signal});
    if(signal?.aborted)throw Error('会话配置已变更');
    const d=structuredClone(validateDecision(normalizeDecision(result.decision,payload),this.participants));
    const focusRequest=text=>!/(不要|不用|不必|别|不想).{0,4}(只|专注|单独)/.test(text)&&/(只(?:想)?(?:和|跟|与|同|对|回答|听)|仅(?:和|跟|与|对|回答)|专注|单独(?:和|跟|与)|(?:不要|别)理(?:他|她|其他|别人)|only (?:talk|speak)|focus on)/i.test(text);
    // Recover an omitted citation only from this turn's explicit focus request.
    // A bare model boolean or an ordinary introduction cannot authorize it.
    const evidence=d.policyEvidence??((d.pendingFocus?.mode==='exclusive'||d.policyChangeRequested||d.nextTargetId!==this.targetId)&& (focusRequest(turn.text)||/(?:和|跟|与).{1,20}(?:聊|说话|对话)|交给|轮到/.test(turn.text))?{turnId:turn.id,quote:turn.text}:null);
    d.policyEvidence=evidence;
    const currentEvidence=evidence?.turnId===turn.id&&turn.text.includes(evidence.quote);
    const sameName=(a,b)=>a&&b&&a.replaceAll('12','十二')===b.replaceAll('12','十二');
    const pendingResolved=this.pendingFocus&&this.pendingPolicyEvidence&&d.nextMode===this.pendingFocus.mode
      &&sameName(this.pendingFocus.name,d.identityUpdates.find(u=>u.speakerId===d.nextTargetId)?.name??this.participants.find(p=>p.id===d.nextTargetId)?.name);
    const currentAuthorized=currentEvidence&&(d.nextMode==='exclusive'?(this.mode==='exclusive'?focusRequest(evidence.quote)||/(现在|接下来|先|轮到|交给).*(和|跟|与|轮到|交给)/.test(evidence.quote):focusRequest(evidence.quote)):/多人|大家|共同|一起|恢复|取消|不用只|不要只|不必只|别只/.test(evidence.quote));
    const attempted=d.nextMode!==this.mode||(this.mode==='exclusive'&&d.nextTargetId!==this.targetId);
    let policyGuard=null;
    if(attempted&&(!d.policyChangeRequested||(!currentAuthorized&&!pendingResolved))){
      policyGuard='没有可核实的明确切换指令，已保留当前模式';d.nextMode=this.mode;d.policyChangeRequested=false;
      if(this.mode==='exclusive'){d.nextTargetId=this.targetId;d.shouldRespond=false;d.addresseeIds=[];d.reply='';}
    }
    if(this.mode==='exclusive'&&!d.policyChangeRequested&&d.addresseeIds.some(id=>id!==this.targetId)){d.shouldRespond=false;d.reply='';d.addresseeIds=[];policyGuard='已拦截非专注对象的模型回复';}
    if(d.nextMode==='exclusive'&&d.addresseeIds.some(id=>id!==d.nextTargetId)){d.shouldRespond=false;d.reply='';d.addresseeIds=[];policyGuard='已拦截非专注对象的模型回复';}
    let pendingPolicyEvidence=null;
    if(d.pendingFocus?.mode==='exclusive'){
      if(currentEvidence&&focusRequest(evidence.quote))pendingPolicyEvidence={...evidence};
      else if(this.pendingPolicyEvidence&&sameName(this.pendingFocus?.name,d.pendingFocus.name))pendingPolicyEvidence=this.pendingPolicyEvidence;
      else{d.pendingFocus.mode=this.mode==='exclusive'?'adaptive':this.mode;policyGuard='待交接不等于专注授权，已保留多人模式';}
    }
    if(d.nextMode==='exclusive'){d.pendingFocus=null;pendingPolicyEvidence=null;}
    const evidenceTurns=[...payload.history.filter(t=>t.role==='participant'),turn];
    const changes=[];
    for(const u of d.identityUpdates){
      const p=this.participants.find(p=>p.id===u.speakerId);
      const valid=u.evidence.every(e=>evidenceTurns.some(t=>t.id===e.turnId&&t.text.includes(e.quote)));
      if(!valid)throw Error('模型引用了不存在的身份依据');
      if(['self-introduction','correction'].includes(u.source)&&!u.evidence.some(e=>evidenceTurns.some(t=>t.id===e.turnId&&t.speaker.id===p.id)))throw Error('自我介绍依据来自另一声线');
      if(p.certainty==='stated'&&(u.certainty==='suggested'||(p.name&&u.name!==p.name&&u.source!=='correction')))continue;
      changes.push([p,{name:u.name,role:u.role,certainty:u.certainty,source:u.source,evidence:u.evidence,reason:u.reason}]);
    }
    if(this.mode==='adaptive'&&d.nextMode==='adaptive'&&d.nextTargetId!==this.targetId){
      const named=this.participants.find(p=>p.id===d.nextTargetId)?.name??d.identityUpdates.find(u=>u.speakerId===d.nextTargetId)?.name;
      const handedOff=currentEvidence&&/(?:和|跟|与).{1,20}(?:聊|说话|对话)|交给|轮到/.test(evidence.quote);
      if(!handedOff&&!sameName(this.pendingFocus?.name,named))d.nextTargetId=this.targetId;
    }
    if(d.shouldRespond&&this.mode==='adaptive'&&d.nextMode==='adaptive'&&turn.speaker.id!==this.targetId&&d.nextTargetId===this.targetId&&!isDirectTurn(turn.text)){
      d.shouldRespond=false;d.reply='';d.addresseeIds=[];d.reason='围绕主要对象：旁人评论未接管对话';
    }
    if(d.shouldRespond&&d.nextMode==='adaptive'&&d.addresseeIds.length>1)d.addresseeIds=[d.addresseeIds.includes(turn.speaker.id)?turn.speaker.id:d.addresseeIds[0]];
    if(d.shouldRespond&&d.nextMode==='group'){d.addresseeIds=this.participants.map(p=>p.id);if(d.addresseeIds.length>1)d.style='group';}
    // Commit only after the whole result has passed validation.
    for(const [p,update]of changes)Object.assign(p,update);
    const policyChanged=d.nextMode!==this.mode||(this.mode==='exclusive'&&d.nextTargetId!==this.targetId);
    this.mode=d.nextMode;this.targetId=d.nextTargetId;this.pendingFocus=d.pendingFocus;this.pendingPolicyEvidence=pendingPolicyEvidence;
    if(policyChanged)this.history=[];
    else{this.history.push({role:'participant',...payload.turn},{role:'assistant',reply:d.reply,addresseeIds:d.addresseeIds,style:d.style});this.history=this.history.slice(-32);}
    return {status:'decided',modelCalled:true,turn,decision:d,model:result.model,usage:result.usage,elapsedMs:result.elapsedMs,...this.snapshot(),targetBefore,modeBefore,policyChanged,policyGuard,requestId:result.requestId};
  }
}

export async function createArkEvaluator(env,{endpointId,onInvalidDecision}={}){
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
      body:JSON.stringify({model:endpointId,thinking:{type:'disabled'},temperature:0.2,max_tokens:900,response_format:{type:'json_object'},
        messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(payload)}]})});
    const data=await response.json();
    if(!response.ok)throw Error(`火山对话模型失败：${data.error?.code??response.status}`);
    const content=data.choices?.[0]?.message?.content;
    let decision;try{decision=JSON.parse(content);}catch{throw Error('火山模型未返回 JSON 决定');}
    let normalized;try{normalized=validateDecision(normalizeDecision(decision,payload),payload.participants);}catch(error){onInvalidDecision?.(decision,error);throw error;}
    return {decision:normalized,model:data.model,usage:data.usage,requestId:data.id,elapsedMs:Math.round(performance.now()-started)};
  };
}
