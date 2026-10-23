import {createHash} from 'node:crypto';

// Resolve from private entry + host configuration, never a browser/tool argument.
export function conversationReplyTarget(binding,feishu={}) {
  if(binding.replySync!==true)return null;
  const match=/^agent:makaron:feishu:(group|direct|dm):((?:oc_|ou_)[A-Za-z0-9_]+)$/u.exec(binding.sessionKey??'');
  if(!match||(binding.kind==='group')!==(match[1]==='group')||(binding.kind==='group'?!match[2].startsWith('oc_'):!match[2].startsWith('ou_')))throw Error('会话回复同步目标无效');
  if(feishu.enabled===false)throw Error('飞书回复同步未配置');
  const accounts=Object.entries(feishu.accounts??{}).filter(([,v])=>v.enabled!==false);
  if(feishu.appId)accounts.push(['default',feishu]);
  const matches=accounts.filter(([id,v])=>id===binding.accountId||v.appId===binding.accountId);
  if(matches.length!==1)throw Error('无法确认此会话对应的飞书机器人账号');
  return Object.freeze({channel:'feishu',agentId:binding.agentId,sessionKey:binding.sessionKey,accountId:matches[0][0],to:match[2]});
}

// Native card JSON is supported by the existing Feishu outbound adapter.
// Keep the question literal; the answer retains its paragraphs, lists and links.
export function conversationReplyCard(question,answer) {
  return {schema:'2.0',config:{width_mode:'default'},header:{title:{tag:'plain_text',content:'语音对话'},template:'purple'},body:{elements:[
    {tag:'markdown',content:'**你问**'},
    {tag:'div',text:{tag:'plain_text',content:question}},
    {tag:'hr'},
    {tag:'markdown',content:'**V 的回答**\n\n'+answer},
  ]}};
}

// Gateway mirrors the delivered card in session history. Recover dialogue for
// the next Voice call instead of teaching the model the card's layout schema.
export function conversationReplyText(value) {
  if(typeof value!=='string'||!value.trim().startsWith('{'))return value;
  try{
    const card=JSON.parse(value),e=card.body?.elements;
    if(card.schema==='2.0'&&['📞 通话结束','通话总结'].includes(card.header?.title?.content)){
      const summary=e?.find(row=>row.tag==='div'&&row.text?.tag==='plain_text')?.text?.content;
      if(typeof summary==='string')return `语音通话总结：${summary}`;
    }
    if(card.schema==='2.0'&&!card.header&&e?.length===1&&typeof e[0].content==='string'&&/^(?:正在通话|V正在电话通话|通话已结束|V电话通话已结束)(?: · [0-9: 分秒]+)?$/u.test(e[0].content.replace(/<[^>]*>/gu,'')))return '语音通话记录';
    if(card.schema!=='2.0'||card.header?.title?.content!=='语音对话'||e?.length!==4||e[0]?.content!=='**你问**'||e[1]?.tag!=='div'||e[1]?.text?.tag!=='plain_text'||typeof e[1].text.content!=='string'||e[2]?.tag!=='hr'||e[3]?.tag!=='markdown'||!e[3]?.content?.startsWith('**V 的回答**\n\n'))return value;
    return `语音提问：${e[1].text.content}\n\nV：${e[3].content.slice('**V 的回答**\n\n'.length)}`;
  }catch{return value;}
}

const normalized=text=>text.replace(/\s+/gu,'').replace(/[，。！？,.!?]/gu,'');
const routine=text=>/^(?:你好(?:我是V)?(?:在呢)?|我在(?:呢)?|好的|好|嗯|收到|明白了?|没问题|稍等(?:一下)?|请稍等|正在(?:查询|处理)|我(?:来)?(?:查一下|看看|查询一下)|再见|拜拜)[。！!，,\s]*$/u.test(text);

/** Final replies only. Delivery is outside the audio critical path. */
export function createConversationReplyDelivery({gateway,target,ownerId,audit=()=>{},onStatus=()=>{},callReport=null}) {
  if(!target)return null;
  let closed=false,currentQuestion=null,anonymous=null,serial=0,inFlight=0,tail=Promise.resolve();
  const turns=new Map(),answers=new Map(),tasks=new Map();
  const outcomes=new Map(),responses=new Set();
  const send=(kind,id,text)=>{
    text=typeof text==='string'?text.trim():'';
    if(!text)return Promise.resolve({sent:false});
    const key=`voice-reply:${ownerId}:${createHash('sha256').update(`${kind}:${id}:${text}`).digest('hex').slice(0,32)}`;
    if(outcomes.has(key))return outcomes.get(key);
    inFlight++;
    const work=tail.then(async()=>{
      const args={...target,message:text,idempotencyKey:key};
      let receipt;
      try{receipt=await gateway.request('send',args,{timeoutMs:20000});}
      catch(error){
        if(!/timeout|timed out|ECONN|socket|network|not connected/iu.test(error.message??''))throw error;
        // An ambiguous response must retain the exact Gateway idempotency key.
        receipt=await gateway.request('send',args,{timeoutMs:20000});
      }
      if(!receipt||receipt.ok===false||['error','failed','partial_failed'].includes(receipt.status)||!receipt.messageId&&!receipt.messageIds?.length&&!receipt.results?.some(r=>r.messageId))throw Error('飞书尚未确认回复送达');
      audit({type:'reply.delivery-confirmed',voiceSessionId:ownerId,kind,id,receipt});onStatus({status:'sent'});
      return {sent:true,receipt};
    }).catch(error=>{
      audit({type:'reply.delivery-failed',voiceSessionId:ownerId,kind,id,error:error.message});
      onStatus({status:'failed',message:'这条主要回复暂未同步到飞书，语音聊天可以继续。'});
      return {sent:false,error:error.message};
    }).finally(()=>{inFlight--;});
    outcomes.set(key,work);tail=work;
    return work;
  };
  const question=(text,id)=>({id:id??`turn-${++serial}`,text:text.trim(),delivered:false,backend:false});
  const answer=(id,create=true)=>{
    if(id){if(!answers.has(id)&&create)answers.set(id,{question:currentQuestion,segments:[]});return answers.get(id);}
    if(!anonymous&&answers.size===1)return answers.values().next().value;
    if(!anonymous&&create)anonymous={question:currentQuestion,segments:[]};return anonymous;
  };
  const message=(q,text)=>{
    const card=JSON.stringify(conversationReplyCard(q.text,text));
    // Leave room for the adapter's escaped question and envelope. Preserve very
    // long results via its existing text path instead of losing them to 30 KB.
    return Buffer.byteLength(card,'utf8')+Buffer.byteLength(q.text,'utf8')<24_000
      ? card : `语音提问：${q.text}\n\n---\n\nV：${text}`;
  };
  const deliver=(kind,id,q,text)=>{
    if(callReport&&!closed)return Promise.resolve({sent:false});
    if(!q?.text||q.delivered||!text?.trim())return Promise.resolve({sent:false});
    // Freeze both halves before queuing: later speech cannot change this pair.
    const paired=message(q,text.trim());q.delivered=true;
    return send(kind,id,paired);
  };
  const delivery = {
    ready(){callReport?.ready();},
    inputStarted(){if(!closed&&(!currentQuestion||currentQuestion.text))currentQuestion=question('');},
    user(text,{final=true,turnId,admitted=true}={}){
      if(closed||!final||!admitted||typeof text!=='string'||!text.trim())return;
      if(routine(text.trim())){currentQuestion=null;return;}
      if(turnId&&turns.has(turnId)){currentQuestion=turns.get(turnId);if(!currentQuestion.delivered)currentQuestion.text=text.trim();return;}
      if(currentQuestion&&!currentQuestion.text){currentQuestion.text=text.trim();if(turnId)currentQuestion.id=turnId;}else currentQuestion=question(text,turnId);
      if(turnId)turns.set(turnId,currentQuestion);
    },
    begin(responseId){if(!closed&&responseId&&!responses.has(responseId))answer(responseId);},
    transcript(text,{final=false,source,responseId}={}){
      if(closed||source||typeof text!=='string'||!text.trim()||responses.has(responseId))return;
      const row=answer(responseId); // Even a delta pins the original question.
      if(!final||!row.question||row.question.backend||routine(text.trim()))return;
      text=text.trim();const last=row.segments.at(-1);
      if(last&&normalized(last)===normalized(text))return;
      if(last&&text.startsWith(last))row.segments[row.segments.length-1]=text;else row.segments.push(text);
    },
    finish({status='completed',responseId}={}){
      const row=answer(responseId,false)??anonymous;
      if(responseId)answers.delete(responseId);if(row===anonymous)anonymous=null;
      if(closed||responses.has(responseId)||!row)return Promise.resolve({sent:false});
      if(responseId)responses.add(responseId);
      if(status!=='completed'||row.question?.backend)return Promise.resolve({sent:false});
      return deliver('reply',responseId??++serial,row.question,row.segments.join('\n'));
    },
    interrupt(responseId){
      if(responseId){answers.delete(responseId);responses.add(responseId);}else{for(const id of answers.keys())responses.add(id);answers.clear();anonymous=null;}
    },
    ignore(responseId){
      const row=answer(responseId,false);if(row?.question===currentQuestion)currentQuestion=null;
      if(responseId){answers.delete(responseId);responses.add(responseId);}else anonymous=null;
    },
    captureTask(id,{from,text}={}){
      if(!id||tasks.has(id))return;
      let q=from?tasks.get(from):null;
      if(!q&&typeof text==='string'&&text.trim())q=currentQuestion&&normalized(currentQuestion.text)===normalized(text)?currentQuestion:question(text);
      q??=currentQuestion;
      if(q){q.backend=true;tasks.set(id,q);}
    },
    result(id,text,{questionId=id}={}){
      return deliver('result',id,tasks.get(questionId),text);
    },
    async close(){closed=true;answers.clear();anonymous=null;await tail;},
    flush:()=>tail,
    get pending(){return inFlight>0;},
  };
  if(callReport)for(const method of ['user','begin','transcript','finish','interrupt','ignore','captureTask','result','close']){
    const original=delivery[method];delivery[method]=(...args)=>{callReport[method]?.(...args);return original(...args);};
  }
  return delivery;
}
