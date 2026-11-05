import {createHash} from 'node:crypto';
import {PUBLIC_VOICE_INSTRUCTIONS} from '../lab/gpt-live-h5/public-instructions.mjs';

export const PUBLIC_SEARCH_TOOLS=new Set(['web_search','memory_search','web_fetch']);
export const PUBLIC_CALL_TOOLS=new Set([...PUBLIC_SEARCH_TOOLS,'show_content','end_call','delegate_to_v','openclaw_agent_control','cancel_task','current_time']);

// The unchanged task SDK accepts only its legacy Feishu storage-key grammar.
// This is a Voice-owned storage namespace, NOT an authenticated Feishu actor,
// real conversation or delivery destination. Never borrow a user's chat.
export function createPublicVoiceGateway({gateway,sessionKey,isAuthorized=()=>false}) {
  if(!/^voice:guest:[a-f0-9]{64}$/u.test(sessionKey??''))throw Error('Invalid Public conversation');
  const taskSessionKey='agent:makaron:feishu:direct:ou_voicepublic'+createHash('sha256').update(sessionKey).digest('hex');
  const tasks=new Set(),requests=new Set();
  const identity=p=>JSON.stringify([p.voiceSessionId,p.callId]);
  return Object.freeze({publicVoice:true,get ready(){return gateway.ready;},async request(method,input={},options){
    if(input.sessionKey!==undefined&&input.sessionKey!==sessionKey||input.voiceActor!==undefined)throw Error('Public conversation cannot change');
    if(method==='tools.catalog'){
      if(!isAuthorized())throw Error('Public access expired');
      const catalog=await gateway.request(method,{agentId:'makaron',includePlugins:true},options);
      return {...catalog,groups:(catalog.groups??[]).map(g=>({...g,tools:(g.tools??[]).filter(t=>PUBLIC_SEARCH_TOOLS.has(t.id))}))};
    }
    if(method==='tools.invoke'){
      if(!isAuthorized()||!PUBLIC_SEARCH_TOOLS.has(input.name))throw Error('Public tool unavailable');
      return gateway.request(method,{agentId:'makaron',sessionKey:taskSessionKey,name:input.name,args:input.args},options);
    }
    if(method==='voice.product.task.start'){
      if(!isAuthorized())throw Error('Public access expired');
      requests.add(identity(input));
      const result=await gateway.request(method,{...input,sessionKey:taskSessionKey,question:PUBLIC_VOICE_INSTRUCTIONS+'\n'+input.question},options);
      if(result?.taskId)tasks.add(result.taskId);return result;
    }
    if(method==='voice.product.task.lookup'&&requests.has(identity(input))){
      const result=await gateway.request(method,{voiceSessionId:input.voiceSessionId,callId:input.callId},options);
      if(result?.taskId)tasks.add(result.taskId);return result;
    }
    if(['voice.product.task.read','voice.product.task.cancel','voice.product.task.control'].includes(method)&&tasks.has(input.taskId)){
      return gateway.request(method,input,options);
    }
    throw Error('Public tool unavailable');
  }});
}
