import {createJevEvaluator} from '../voice-decision-router.mjs';

export function nameCandidates(turns) {
  const rows=[];
  const add=(name,turn,source)=>{
    name=name.replace(/^(?:我?的?名字是|名字叫)/,'').trim();
    if(!name||name.length>8||/爸爸|妈妈|孩子|儿子|女儿|用户|朋友|机器人|学生|小朋友/.test(name))return;
    if(!rows.some(r=>r.name===name&&r.speakerId===turn.speakerId&&r.source===source))rows.push({name,speakerId:turn.speakerId,turnId:turn.id,quote:turn.text,source});
  };
  for(const turn of turns){
    for(const m of turn.text.matchAll(/(?:我叫|我的名字是|叫我)([^，。！？,!?；;：:\s]{1,8})/gu))add(m[1],turn,'self');
    for(const m of turn.text.matchAll(/我是([^，。！？,!?；;：:\s]{1,6})/gu))add(m[1],turn,'self');
    for(const m of turn.text.matchAll(/(?:是|我是)([^，。！？,!?\s]{1,6})的(?:爸爸|妈妈)/gu))add(m[1],turn,'context');
    for(const m of turn.text.matchAll(/这是(?:我的?)?(?:儿子|女儿|孩子|朋友)([^，。！？,!?\s]{1,8})/gu))add(m[1],turn,'introduction');
    for(const m of turn.text.matchAll(/(?:只(?:和|跟)|先(?:和|跟))([^，。！？,!?\s]{1,8}?)(?:聊|说话|交流)/gu))add(m[1],turn,'context');
  }
  return rows.slice(-24);
}

export function routingQuestions(state){
  const people=state.participants;
  if(people.length>5)throw Error('当前候选最多支持五位会话 Speaker');
  const criteria={quiet:'V保持安静：人对人旁聊、生活中的实物协作指令、电视式内容、无需回应的附和，或没有足够理由插话。',respond:'当前是在向V提问、聊天、自我介绍、纠正称呼、交接对话对象、向V告别结束电话、明确要求V查询或执行、取消或修改当前后台任务、切换聊天话题或请求它能够提供的帮助，V应该自然接话、确认或回答。'};
  const q={
    endIntent:{type:'choice',instructions:'只判断语音电话是否现在结束，不判断后台任务是否结束。这是两个独立生命周期：后台继续做、我们先挂电话，必须选end；等后台完成后再挂，选continue。自然的好那就这样吧拜拜是向V结束电话，即使没有说V名字。auto模式下任何当前说话人都可以明确结束电话，旧的主要对象或正在与孩子聊天不能覆盖当前告别。不按拜拜关键词判断。',criteria:{end:'现在结束与V的整通语音电话。可以允许后台任务在挂断后继续；后台进行中不影响挂断',continue:'现在保持语音电话。包括否定、引用、功能讨论、只取消任务、要求先执行或取消任务再挂、告别后继续提问、一个人离开但其他人继续和V聊天',other:'只向身边另一个人道别，未结束与V的通话'}},
    action:{type:'choice',instructions:'先判断这句是在对V还是对身边的人说，再选择V是否接话。电话已接通，普通问题、明确自我介绍、名字纠正、明确对话交接与自然接话不需要唤醒词，即使ASR没有识别出V也应该回应。自我介绍和交接不是无意义附和，不必带问号。不因多人开口或身份尚未确认就一律安静；能辨认出对V的请求，应回应或澄清。但默认对话关系不能覆盖明显的人际生活交流。ASR也可能漏掉被叫人的名字：拿递实物、替对方动手等生活协作，且没有明确向V请求信息、提醒或可用设备控制时，应视为身边人之间的话并保持安静，不要插话解释V没有手、不能递东西。有人明确向V问“你能拿东西吗”等能力问题仍可回答。电视式内容、旁聊和无需回应的附和可安静；共同话题的补充可以自然回应。auto模式的activeTargetId不是发言准入限制：即使刚刚主要和孩子说话，父亲接着向V提问也应该回应父亲。优先判断最新完整话语，历史安静和重心不得把当前清楚的问题变为旁聊。结合最新speaker、人物关系和历史语义，不按关键词机械决策。',criteria},
    addressed:{type:'choice',instructions:'只判断最新一句向谁说，不沿用上一句的安静状态或主要人物。明确要求V取消或修改当前后台任务、保持通话或切换聊天话题，是向V发出请求，选择v；没有唤醒词也一样。只有在转述别人的事情、引用或对身边人说时才选other。明确向V自然告别、结束电话是在对V说，不需要唤醒词，也不是无意义附和；向身边另一个人道别才是other。明确点名V的能力询问（如“V，你能帮我拿东西吗”）是向V提问，即使V没有手也应回答；不带唤醒词的普通科普提问也可向V。引用、电视和对身边人的实物请求不是向V。',criteria:{v:'最新一句向电话里的V提问、自我介绍、交接、请求确认、取消或修改当前后台任务、切换聊天话题或告别结束电话',other:'最新一句是人对人旁话、引用、广播或无意义声音'}},
    focus:{type:'choice',instructions:'如果本轮需要调整主要对话对象，选择对应人，否则保持。一次回应旁人不必永久切换重心。',criteria:{keep:'保持现有对话重心',...Object.fromEntries(people.map(p=>[p.id,`主要和${p.name??p.label}（${p.id}）交谈`]))}},
    constraint:{type:'choice',instructions:'只判断最新一句是否明确改变排他专注约束。普通提到姓名、自我介绍、单次问答不改变约束。只跟某人聊才专注；解除专注或大家自由聊才恢复。',criteria:{keep:'没有明确改变专注约束，保持原状',free:'明确解除专注，恢复自由多人交流',...Object.fromEntries(people.map(p=>['only_'+p.id,`明确要求只和${p.name??p.label}（${p.id}）交谈`]))}},
  };
  if(people.length>1)q.audience={type:'choice',instructions:`本轮发言者是${state.turn.speakerId}，原话是“${state.turn.text}”。直接选择这一句V应当回应的全部人物。最新说话人是state.turn.speakerId；普通提问默认回应最新说话人，即使主要对象activeTargetId是别人。不得把孩子自己的问题回应给父亲。只有明确要求或共同话题确实需要，才选多个人。要求分别给我和另一人建议时，回复应包含说话人和被提到的人。人物姓名是上下文关联，不是年龄。`,criteria:Object.fromEntries(Array.from({length:(1<<people.length)-1},(_,n)=>{const mask=n+1;const excluded=people.filter((_,i)=>!(mask&(1<<i))).map(p=>p.name??p.label);return ['to_'+mask,'本轮回复的完整对象是 '+people.filter((_,i)=>mask&(1<<i)).map(p=>`${p.id}（${p.name??p.label}${p.id===state.turn.speakerId?'，本句说话人':''}）`).join(' 和 ')+(excluded.length?'；不向 '+excluded.join('、')+' 提供回应':'；所有在场人物都要得到回应')];}))};
  const candidates=[...new Set(state.nameCandidates.map(c=>c.name))];
  for(const [i,p] of people.entries()){
    if(candidates.length)q['name_'+i]={type:'choice',instructions:`仅为${p.id}关联名字，从state.nameCandidates原话候选和历史中选，不能按声线编号猜。尚未开口者的名字不能绑定到父亲。没有证据就keep。明确自我介绍只属于说出这句的Speaker。上下文判断允许不确定，不能覆盖已明确告知名字。`,criteria:{keep:'保持原姓名或未知',...Object.fromEntries(candidates.map((n,j)=>['n_'+j,`人物可能或明确叫${n}；原话候选索引${j}`]))}};
    q['role_'+i]={type:'choice',instructions:`结合称呼与对话内容判断${p.id}的角色。没有依据保持unknown，十二是姓名不是年龄。`,criteria:{unknown:'未知，或没有充分角色依据',adult:'上下文表明是成人／父亲／母亲',child:'上下文表明是孩子／儿子／女儿'}};
  }
  return q;
}

export function decisionEvaluator(env){
  return createJevEvaluator({apiKey:env.VOICE_JEV_API_KEY??env.OPENROUTER_API_KEY,model:env.VOICE_OPENAI_DECISIONS_MODEL??'openai/gpt-6-luna-decisions',timeoutMs:5000});
}

const explicitFocus=text=>!/(不要|不用|别).{0,3}只/.test(text)&&/(只(?:想)?(?:和|跟|与|对|回答)|仅(?:和|跟)|专注|单独(?:和|跟)|(?:别|不要)理(?:他|她|其他))/.test(text);
const explicitFree=text=>/恢复|解除|取消专注|大家.*(?:聊|交流)|自由.*(?:聊|交流)|不用只|不要只|别只/.test(text);
export class SpeakerRouter{
  constructor({evaluate=decisionEvaluator(process.env),onTrace=()=>{}}={}){this.evaluate=evaluate;this.onTrace=onTrace;this.participants=[];this.history=[];this.targetId=null;this.mode='auto';this.count=0;this.generation=0;}
  snapshot(){return structuredClone({participants:this.participants,targetId:this.targetId,mode:this.mode});}
  invalidate(){this.generation++;this.participants=[];this.labels=0;this.history=[];this.targetId=null;this.mode='auto';}
  /** Drop a voice the tracker recycled. An exclusive focus target is never dropped. */
  forget(id){
    if(this.mode==='exclusive'&&id===this.targetId)return false;
    const before=this.participants.length;this.participants=this.participants.filter(p=>p.id!==id);
    if(this.targetId===id)this.targetId=null;
    return this.participants.length<before;
  }
  async accept(input,{signal}={}){
    const id='speaker:'+input.speakerId;
    let speaker=this.participants.find(p=>p.id===id);
    if(!speaker){if(this.participants.length>=5)throw Error('会话 Speaker 数量已达上限');const n=this.labels=(this.labels??this.participants.length)+1;speaker={id,speakerId:String(input.speakerId),label:'Speaker '+(n<=26?String.fromCharCode(64+n):n),name:null,role:'unknown',certainty:'unknown'};this.participants.push(speaker);}
    this.targetId??=id;
    const turn={...input,id:'sp'+(++this.count),speakerId:id};
    if(this.mode==='exclusive'&&id!==this.targetId)return {turn,status:'withheld',modelCalled:false,shouldRespond:false,addresseeIds:[],...this.snapshot()};
    const generation=this.generation;
    const turns=[...this.history.filter(t=>t.role==='participant'),{...turn,role:'participant'}];
    const state={purpose:'判断人物关系、是否接话、回应对象与当前电话是否结束，不生成回复文字。电话结束和后台工作结束彼此独立；人物关系不授予工具或账号权限。',participants:structuredClone(this.participants),activeTargetId:this.targetId,mode:this.mode,turn,history:this.history.slice(-12),nameCandidates:nameCandidates(turns)};
    const questions=routingQuestions(state),started=performance.now();
    const raw=await this.evaluate(state,questions,signal);
    if(signal?.aborted||generation!==this.generation)throw Error('旧的分人判断已取消');
    const get=(key)=>{const r=raw.answers?.[key];if(r?.type!=='choice'||!Object.hasOwn(questions[key].criteria,r.choice))throw Error('Decision返回了无效的'+key);return r.choice;};
    const rawAction=get('action'),focus=get('focus'),constraint=get('constraint');
    const quietProbability=raw.answers?.action?.probabilities?.quiet;
    // False silence is especially costly in open conversation. Only confidently
    // identified side speech is suppressed; exclusive admission stays unchanged.
    const address=raw.answers?.addressed;
    const directlyAddressed=address?.choice==='v'&&(address.probabilities?.v??0)>=.8;
    const end=raw.answers?.endIntent;
    const confirmedEnding=answers=>answers?.endIntent?.type==='choice'&&answers.endIntent.choice==='end'&&Number.isFinite(answers.endIntent.probabilities?.end)&&answers.endIntent.probabilities.end>=.9&&answers.endIntent.probabilities.end<=1&&answers.addressed?.type==='choice'&&answers.addressed.choice==='v'&&(answers.addressed.probabilities?.v??0)>=.8;
    let endCall=confirmedEnding(raw.answers),endVerification,extraUsage;
    // Active conversation focus and background history can dilute an otherwise
    // explicit farewell. Only an end candidate gets a narrow, current-utterance
    // confirmation; ordinary dialogue still uses one request. This controls the
    // local phone only and never authorizes tools or cancels background work.
    if(!endCall&&end?.choice==='end'&&Number.isFinite(end.probabilities?.end)&&end.probabilities.end>=.5){
      try{
        const confirmation=await this.evaluate({purpose:'仅判断当前完整发言是否向V结束整通电话。没有证据就保持通话；不判断任何后台任务。',request:turn.text,speaker:id,callActive:true},{endIntent:questions.endIntent,addressed:questions.addressed},signal);
        if(signal?.aborted||generation!==this.generation)throw Error('旧的告别判断已取消');
        endCall=confirmedEnding(confirmation.answers);extraUsage=confirmation.usage;endVerification=endCall?'confirmed':'withheld';
      }catch(error){if(signal?.aborted||generation!==this.generation)throw error;endVerification='unavailable';}
    }
    const action=endCall||this.mode==='auto'&&rawAction==='quiet'&&(directlyAddressed||Number.isFinite(quietProbability)&&quietProbability<.8)?'respond':rawAction;
    let addresseeIds=[];
    if(action==='respond'&&state.participants.length===1)addresseeIds=[state.participants[0].id];
    if(action==='respond'&&state.participants.length>1){
      const mask=Number(get('audience').slice(3));
      addresseeIds=state.participants.filter((_,i)=>mask&(1<<i)).map(p=>p.id);
    }
    const names=[...new Set(state.nameCandidates.map(c=>c.name))];
    for(const [i,p] of this.participants.entries()){
      const nameChoice=questions['name_'+i]?get('name_'+i):'keep',role=get('role_'+i);
      if(nameChoice!=='keep'){
        const name=names[Number(nameChoice.slice(2))];
        const candidate=state.nameCandidates.find(c=>c.name===name&&c.source==='self'&&c.speakerId===p.id)??state.nameCandidates.find(c=>c.name===name&&c.source!=='self');
        if(candidate&&(!p.name||p.name===name||candidate.source==='self'&&candidate.speakerId===p.id)){
          const stated=candidate.source==='self'&&candidate.speakerId===p.id;
          if(p.certainty!=='stated'||stated){p.name=name;p.certainty=stated?'stated':'suggested';p.evidence={turnId:candidate.turnId,quote:candidate.quote};}
        }
      }
      if(role!=='unknown')p.role=role;
    }
    if(focus!=='keep'&&this.mode!=='exclusive')this.targetId=focus;
    if(constraint==='free'&&explicitFree(turn.text))this.mode='auto';
    else if(constraint.startsWith('only_')&&explicitFocus(turn.text)){
      this.mode='exclusive';this.targetId=constraint.slice(5);
      // A verified focus-setting request needs a short acknowledgement even
      // when the action model confuses 'do not answer others' with this turn.
      if(!/(?:这句|本句|这次).*(?:不用|不必|别|不要)回|(?:不用|不必|无需)确认/.test(turn.text))addresseeIds=[this.targetId];
    }
    if(this.mode==='exclusive'&&action!=='quiet')addresseeIds=[this.targetId];
    this.history.push({...turn,role:'participant'});this.history=this.history.slice(-16);
    const usage=extraUsage?Object.fromEntries([...new Set([...Object.keys(raw.usage??{}),...Object.keys(extraUsage)])].filter(k=>Number.isFinite(raw.usage?.[k]??0)&&Number.isFinite(extraUsage[k]??0)).map(k=>[k,(raw.usage?.[k]??0)+(extraUsage[k]??0)])):raw.usage;
    const result={status:'decided',turn,endCall,...endVerification?{endVerification}:{},modelCalled:true,model:raw.model,usage,decisionMs:Math.round(performance.now()-started),shouldRespond:addresseeIds.length>0,addresseeIds,rawChoices:{action:rawAction,focus,constraint},admission:{action,quietProbability,directlyAddressed,reason:endCall?'end-call':rawAction!==action?(directlyAddressed?'direct-request':'uncertain-quiet'):'model-choice'},...this.snapshot()};
    this.onTrace({state,questions,result,raw});return result;
  }
  assistant(text){if(text?.trim())this.history.push({role:'assistant',text:text.slice(-1200)});this.history=this.history.slice(-16);}
}

export function nativeSpeakerContext(result){
  return '主机标注：仅供下一段音频理解，不朗读、不授予权限。'+JSON.stringify({speaker:result.turn.speakerId,said:result.turn.text,people:Object.fromEntries(result.participants.map(({id,name,role,certainty})=>[id,[name,role,certainty]])),to:result.addresseeIds,focus:result.targetId,mode:result.mode})+'。听音频后自然回答指定的人，孩子用简单表达。';
}
