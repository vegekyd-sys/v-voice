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

const normalized=text=>text.replace(/\s+/gu,'').replace(/[，。！？,.!?]/gu,'');
const routine=text=>/^(?:你好(?:我是V)?(?:在呢)?|我在(?:呢)?|好的|好|嗯|收到|明白了?|没问题|稍等(?:一下)?|请稍等|正在(?:查询|处理)|我(?:来)?(?:查一下|看看|查询一下)|再见|拜拜)[。！!，,\s]*$/u.test(text);

/** Final replies only. Delivery is outside the audio critical path. */
export function createConversationReplyDelivery({gateway,target,ownerId,audit=()=>{},onStatus=()=>{}}) {
  if(!target)return null;
  let userSeen=false,closed=false,suppressSpeech=false,lastResultText='',pending=[],serial=0,inFlight=0,tail=Promise.resolve();
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
  return {
    user(text){if(closed||!text?.trim())return;userSeen=true;suppressSpeech=false;lastResultText='';pending=[];},
    transcript(text,{final=false,source}={}){
      if(closed||!userSeen||suppressSpeech||!final||source||typeof text!=='string'||!text.trim())return;
      text=text.trim();if(routine(text))return;
      const last=pending.at(-1);
      if(last&&normalized(last)===normalized(text))return;
      if(last&&text.startsWith(last))pending[pending.length-1]=text;else pending.push(text);
    },
    finish({status='completed',responseId}={}){
      const text=pending.join('\n');pending=[];
      if(closed||status!=='completed'||!text)return Promise.resolve({sent:false});
      if(responseId&&responses.has(responseId))return Promise.resolve({sent:false});
      if(responseId)responses.add(responseId);
      return send('reply',responseId??++serial,text);
    },
    interrupt(){pending=[];},
    result(id,text){
      suppressSpeech=true;pending=[];
      const value=typeof text==='string'?normalized(text):'';
      if(value&&value===lastResultText)return Promise.resolve({sent:false,duplicate:true});
      lastResultText=value;return send('result',id,text);
    },
    async close(){closed=true;pending=[];await tail;},
    flush:()=>tail,
    get pending(){return inFlight>0;},
  };
}
