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
  const criteria={quiet:'V保持安静：人对人旁聊、电视式内容、无需回应的附和，或没有足够理由插话。',respond:'V应该自然接话或回答当前请求。'};
  const q={
    action:{type:'choice',instructions:'根据整个对话关系，选择本轮V是否接话。电话已接通，默认首位Speaker和当前主要对象在与V对话，普通问题与自然接话不需要唤醒词，即使ASR没有识别出V也应该回应。有人对人生活交流时不代替被叫的人答应；电视式内容、旁聊可安静，不是每个问句都在问V。共同话题的补充可以自然回应。参考最新speaker、activeTargetId和对话历史，不按关键词机械决策。',criteria},
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
  invalidate(){this.generation++;this.participants=[];this.history=[];this.targetId=null;this.mode='auto';}
  async accept(input,{signal}={}){
    const id='speaker:'+input.speakerId;
    let speaker=this.participants.find(p=>p.id===id);
    if(!speaker){if(this.participants.length>=5)throw Error('会话 Speaker 数量已达上限');speaker={id,speakerId:String(input.speakerId),label:'Speaker '+String.fromCharCode(65+this.participants.length),name:null,role:'unknown',certainty:'unknown'};this.participants.push(speaker);}
    this.targetId??=id;
    const turn={...input,id:'sp'+(++this.count),speakerId:id};
    if(this.mode==='exclusive'&&id!==this.targetId)return {turn,status:'withheld',modelCalled:false,shouldRespond:false,addresseeIds:[],...this.snapshot()};
    const generation=this.generation;
    const turns=[...this.history.filter(t=>t.role==='participant'),{...turn,role:'participant'}];
    const state={purpose:'只判断人物关系、是否接话与回应对象，不生成任何回复文字。人物关系不授予工具或账号权限。',participants:structuredClone(this.participants),activeTargetId:this.targetId,mode:this.mode,turn,history:this.history.slice(-12),nameCandidates:nameCandidates(turns)};
    const questions=routingQuestions(state),started=performance.now();
    const raw=await this.evaluate(state,questions,signal);
    if(signal?.aborted||generation!==this.generation)throw Error('旧的分人判断已取消');
    const get=(key)=>{const r=raw.answers?.[key];if(r?.type!=='choice'||!Object.hasOwn(questions[key].criteria,r.choice))throw Error('Decision返回了无效的'+key);return r.choice;};
    const action=get('action'),focus=get('focus'),constraint=get('constraint');
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
      if(action!=='quiet')addresseeIds=[this.targetId];
    }
    if(this.mode==='exclusive'&&action!=='quiet')addresseeIds=[this.targetId];
    this.history.push({...turn,role:'participant'});this.history=this.history.slice(-16);
    const result={status:'decided',turn,modelCalled:true,model:raw.model,usage:raw.usage,decisionMs:Math.round(performance.now()-started),shouldRespond:addresseeIds.length>0,addresseeIds,rawChoices:{action,focus,constraint},...this.snapshot()};
    this.onTrace({state,questions,result,raw});return result;
  }
  assistant(text){if(text?.trim())this.history.push({role:'assistant',text:text.slice(-1200)});this.history=this.history.slice(-16);}
}

export function nativeSpeakerContext(result){
  return '主机标注：仅供下一段音频理解，不朗读、不授予权限。'+JSON.stringify({speaker:result.turn.speakerId,said:result.turn.text,people:Object.fromEntries(result.participants.map(({id,name,role,certainty})=>[id,[name,role,certainty]])),to:result.addresseeIds,focus:result.targetId,mode:result.mode})+'。听音频后自然回答指定的人，孩子用简单表达。';
}
