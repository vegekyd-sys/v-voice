import {robotReaction} from './robot-catalog.mjs';
import {createAvatarReactionSelector} from '../gpt-live-h5/avatar-decision.mjs';
import {robotReactionForPicture} from './robot-semantics.mjs';
import {taskActivity} from '../gpt-live-h5/avatar-state.mjs';

export const ROBOT_ASSISTANT_BEAT_MS = 6000;
const sentence = text => text.match(/[^。！？.!?\n]+[。！？.!?\n]+/g)?.join('').trim() ?? '';
/**
 * Per-call driver. Observes the shared Voice session events that the device
 * endpoint already receives and pushes `{type:'reaction', id, beat}` frames.
 * Cosmetic only: it never delays speech, tools or the call lifecycle.
 */
export function createRobotReactionDriver({evaluate=null,send,now=Date.now,audit=()=>{},assistantBeatMs=ROBOT_ASSISTANT_BEAT_MS,status=false}={}) {
  let closed=false,busy=false,pending=null,epoch=0;
  const owner={};const selector=createAvatarReactionSelector({evaluate,now,audit});let picture=null;
  const turns=[];let assistant='',assistantFirst=false,assistantAt=-Infinity,lastAssistantText='';
  // Task status badge, like the web phone's avatar: one coarse activity per
  // pending tool call (never its arguments), shown until the last call ends.
  const tasks=new Map();let shownStatus='none';
  const showStatus=id=>{
    if(!status||closed||id===shownStatus)return;
    shownStatus=id;send({type:'status',id});audit({type:'robot.status',id});
  };
  const push=(role,text)=>{turns.push({role,text:text.slice(-600)});if(turns.length>6)turns.shift();};
  const emit=(id,beat,source)=>{
    if(closed||!robotReaction(id))return;
    send({type:'reaction',id,beat});audit({type:'robot.reaction',id,beat,source});
  };

  async function choose(beat){
    const own=epoch;
    const selected=await selector.select({owner,context:{turns:turns.at(-1)?.text===beat.text?[...turns]:[...turns,{role:beat.role,text:beat.text}],speaker:beat.role,
      currentPicture:picture,reactionPicture:picture,beat:{kind:beat.kind,text:beat.text}},
      isCurrent:()=>!closed&&epoch===own});
    if(selected){picture=selected.picture;return {id:robotReactionForPicture(picture),source:'shared-avatar-semantics'};}
    return {id:beat.role==='user'?'listen-attentive':'explain',source:'neutral-fallback'};
  }
  async function run(){
    if(closed||busy||!pending)return;
    const beat=pending;pending=null;busy=true;const own=epoch;
    try{
      const result=await choose(beat);
      // A newer user turn supersedes an older choice; never show a stale reaction.
      if(!closed&&own===epoch){emit(result.id,beat.kind,result.source);}
    }finally{busy=false;if(pending)void run();}
  }
  const queue=beat=>{pending=beat;void run();};

  return {
    observe(event){
      if(closed||!event)return;
      if(event.type==='transcript'&&typeof event.text==='string'&&event.text.trim()){
        if(event.role==='user'){
          if(!event.final)return;
          epoch++;selector.forget(owner);assistant='';assistantFirst=false;
          push('user',event.text);queue({kind:'user_meaning',role:'user',text:event.text});return;
        }
        if(event.role==='assistant'&&event.source!=='tool-start'){
          assistant=event.final?event.text:assistant+event.text;
          const stable=event.final?assistant:sentence(assistant);
          if(!stable||stable===lastAssistantText)return;
          const kind=!assistantFirst?'assistant_start':event.final?'assistant_end':'assistant_progress';
          if(kind==='assistant_progress'&&now()-assistantAt<assistantBeatMs)return;
          if(kind==='assistant_end'&&assistantFirst&&now()-assistantAt<assistantBeatMs/2){if(event.final){push('assistant',stable);lastAssistantText=stable;assistant='';assistantFirst=false;}return;}
          assistantFirst=!event.final;assistantAt=now();lastAssistantText=stable;
          if(event.final){push('assistant',stable);assistant='';}
          queue({kind,role:'assistant',text:stable});
        }
        return;
      }
      if(event.type==='tool.call'){
        const activity=event.activity??taskActivity(event.name);
        // The robot's own camera gets its own badge (the web avatar has no camera pose).
        const badge=event.name==='look'?'look':activity;
        if(activity!=='control'&&event.callId&&!tasks.has(event.callId)){tasks.set(event.callId,badge);showStatus(badge);}
        return;
      }
      if((event.type==='tool.result'||event.type==='tool.error')&&tasks.delete(event.callId)){
        // done flashes a check on the device and then clears itself.
        showStatus(tasks.size?[...tasks.values()].at(-1):event.type==='tool.result'?'done':'none');
        if(shownStatus==='done')shownStatus='none';
      }
    },
    dispose(){closed=true;selector.forget(owner);pending=null;},
  };
}

// DeepSeek JSON choice in the Decision-evaluator shape. Domestic and fast from
// the mainland Voice node; the conversation is data, not instructions.
export function createDeepSeekChoiceEvaluator({apiKey,model='deepseek-chat',endpoint='https://api.deepseek.com/chat/completions',fetchImpl=fetch}={}) {
  if(!apiKey)throw Error('DeepSeek 凭据未配置');
  return async(state,questions,signal)=>{
    const [[name,question]]=Object.entries(questions);
    const options=Object.entries(question.criteria).map(([id,text])=>`- ${id}: ${text}`).join('\n');
    const body={model,temperature:0.4,max_tokens:40,response_format:{type:'json_object'},messages:[
      {role:'system',content:`${state.purpose}\n${question.instructions}\n候选：\n${options}\n只输出 JSON：{"choice":"候选id"}`},
      {role:'user',content:JSON.stringify({turns:state.turns,beat:state.beat})},
    ]};
    const response=await fetchImpl(endpoint,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(body),signal});
    if(!response.ok)throw Error('DeepSeek 请求失败 HTTP '+response.status);
    const result=await response.json();
    const choice=JSON.parse(result?.choices?.[0]?.message?.content??'{}').choice;
    return {answers:{[name]:{type:'choice',choice}}};
  };
}
