
// Not a tool: what the voice model can say by itself (an explanation, a story, an opinion). Offered to
// the router when the call has no lesson tool, so a delegation for such a thing has somewhere to go.
export const GPT_LIVE_SELF_TOOL=Object.freeze({type:'function',name:'answer_directly',description:'不需要任何工具：让前台语音模型自己回答。用于讲解、科普、讲故事、看法和建议、常识，以及复述刚才已经查到的结果。凡是需要实时信息、用户自己的资料或实际操作的，不选这个。',parameters:{type:'object',properties:{},additionalProperties:false}});

// GPT Live has no function tools: it hands the backend one sentence in its own
// words. The slow part of GPT Live One was answering every such sentence with
// the whole V agent. Here a sentence that one of this call's own tools can
// answer is turned into that tool call, and only real work goes to the agent.
//
// Which tool is a model's judgement, given the conversation. There were fixed patterns in front of
// it once (the time, a farewell, a lookup, an explanation, by their words): they decided seven of
// forty-nine choices on real calls, saved about a second each, and could only be wrong by keyword.
/** When the model gives no usable choice: the agent decides, or nothing does. Never a guess by keyword. */
export function fallbackRoute(text,names,{userText}={}){
  const said=String(text??'').trim();
  if(said&&names.has('delegate_to_v'))return {name:'delegate_to_v',args:{question:said.slice(0,2000),...(userText&&userText!==said?{context:`用户原话：${String(userText).slice(0,600)}`}:{})},via:'fallback'};
  return null;
}
const ROUTER_PROMPT=`你是语音助手 V 的工具调度器。前台语音模型把用户刚说的一件要办的事交给你（通常就是用户的原话），你只选一个工具并填好参数，不回答问题、不解释。
规则：
- 能用一步直接工具办完的事（上网搜索、读一个网页、查时间、查个人记忆、查飞书日程或资料、把已有内容放到屏幕、讲解一个东西、结束通话、取消任务），选对应的直接工具。问到用户自己的事（家人、偏好、以前说过或定过的事、项目历史）先查个人记忆。
- web_search 的 query 写成适合搜索引擎的关键词，保留人名、公司名、日期和用户指定的条件；问“今天、现在、今年、本赛季、最新”的事时带上当天日期，并把“今年”写成具体年份。
- 这句话是对刚才那件事的追问、纠正或补充（再看一下、具体多少、另一场呢、不对是……、查得怎么样了）时，结合“最近对话”把对象补全，沿用上一次用的工具并写出更具体的参数；绝不能改去查无关的东西（例如时间）。
- memory_search 的 query 写成几个关键词（项目名、人名、事情的名字），去掉“帮我查一下”“呃”这类口头语；问的是某件事“现在怎么样、进展如何”，关键词里带上“进展 现状”。
- 用户话里的称呼照原样保留：语音转写可能把名字写成数字或同音字，不要把它改写成年龄、数量或别的意思。
- 有 answer_directly、没有讲解工具时：讲解、科普、讲故事、看法、常识由前台自己讲，选 answer_directly；要讲的是今天的事或用户自己的事，先选搜索或记忆工具查资料（它拿到资料后自己讲）。
- 有 answer_directly、没有讲解工具时，用户想看图、想多看几张（看的是现成的真实照片：景点、藏品、菜、动物、人物、产品）也选 answer_directly：页面会自己找照片贴出来，前台接着讲这些东西就行。创作工具只用于用户明确要新做一样东西（生成、画一张、做一张海报、把图做成视频）。
- 有讲解工具时：讲故事、讲解、科普、找图给用户看（“配上图”“用图片讲”“给我看看”“发个图片”“多来几张”），选讲解工具：真实图片和画面会跟着声音出现，几秒就能开始；topic 里写清用户点名要的角色和东西。只有用户明确要“生成、画、做一张新图”或要把东西发到群里，才交给 delegate_to_v。
- 只有“后台任务”一栏写着正在执行时，才可以选查进度、补充要求或取消后台任务的工具。
- 需要多步、反复查证、写操作（发消息、改日程、写文档、发到群里）、或者没有合适的直接工具时，选 delegate_to_v；question 保留用户的完整目标、对象、时间和条件，不要扩大用户没有要求的范围。
- 只能使用下面提供的工具，参数必须符合各自的定义。`;

/** Chat-completions function calling against any OpenAI-compatible endpoint. */
export function createRouterCompletion({apiKey,endpoint,model,extra={},fetchImpl=fetch,timeoutMs=3500}){
  return async function complete({system,user,tools,signal}){
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,timeoutMs);
    try{
      const response=await fetchImpl(endpoint,{method:'POST',signal:controller.signal,
        headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
        body:JSON.stringify({model,stream:false,temperature:0,max_tokens:400,tool_choice:'required',
          messages:[{role:'system',content:system},{role:'user',content:user}],
          tools:tools.map(tool=>({type:'function',function:{name:tool.name,description:String(tool.description??'').slice(0,320),parameters:tool.parameters}})),...extra})});
      // The provider's reason (a refused schema or parameter) goes to the private log only.
      if(!response.ok)throw Error(`router HTTP ${response.status} ${String(await Promise.resolve(response.text?.()).catch(()=>'')??'').replace(/\s+/gu,' ').slice(0,240)}`.trim());
      const call=(await response.json())?.choices?.[0]?.message?.tool_calls?.[0]?.function;
      if(!call||typeof call.name!=='string')return null;
      const args=typeof call.arguments==='string'?JSON.parse(call.arguments||'{}'):call.arguments;
      return args&&typeof args==='object'&&!Array.isArray(args)?{name:call.name,args}:null;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
}
// The routing model: its own endpoint when named, otherwise the board's.
export function routerCompletionFromEnv(env=process.env,{fetchImpl}={}){
  const apiKey=env.VOICE_GPT_LIVE_ROUTER_API_KEY??env.VOICE_BOARD_API_KEY??env.DEEPSEEK_API_KEY??env.OPENROUTER_API_KEY;
  if(!apiKey)return null;
  const openrouter=apiKey===env.OPENROUTER_API_KEY&&!env.VOICE_GPT_LIVE_ROUTER_API_KEY&&!env.VOICE_BOARD_API_KEY&&!env.DEEPSEEK_API_KEY;
  const endpoint=env.VOICE_GPT_LIVE_ROUTER_ENDPOINT??(openrouter?'https://openrouter.ai/api/v1/chat/completions':env.VOICE_BOARD_ENDPOINT??'https://api.deepseek.com/chat/completions');
  const model=env.VOICE_GPT_LIVE_ROUTER_MODEL??(openrouter?'deepseek/deepseek-v4.1-flash':'deepseek-flash');
  const extra=openrouter?{reasoning:{enabled:false}}:endpoint.includes('deepseek.com')?{thinking:{type:'disabled'}}:{};
  return createRouterCompletion({apiKey,endpoint,model,extra,fetchImpl,timeoutMs:Number(env.VOICE_GPT_LIVE_ROUTER_TIMEOUT_MS)||3500});
}

// The delegation names no subject of its own: the application keeps the conversation
// and works out what a follow-up ("再看一下") refers to.
const clip=(text,limit)=>Array.from(String(text)).slice(0,limit).join('');
const recent=history=>{
  const lines=(Array.isArray(history)?history:[]).slice(-8).map(entry=>entry?.role==='tool'?`（刚才用了 ${entry.name}${entry.query?`：${clip(entry.query,120)}`:''}）`:entry?.text?`${entry.role==='user'?'用户':'V'}：${clip(entry.text,160)}`:'').filter(Boolean);
  return lines.length?`最近对话（从早到晚）：\n${lines.join('\n')}`:'';
};
/**
 * Turn one delegated sentence into one call of a tool this call was given.
 * `tools` are the session's own declarations, so the choice can never widen
 * what the caller may do; the session still validates and authorizes the call.
 */
// OpenAI's Decisions API answers "which of these" in about 0.3 s (measured on V: 48 of 48 right,
// median 297 ms; the function-calling model 733 ms) but returns the chosen value only, no arguments.
// So it runs beside the function-calling request: a tool that takes no arguments (the time, hanging
// up, "say it yourself", cancelling) is settled by it at once, and everything else waits for the
// arguments as before. Nothing gets slower; without a key it is not there.
const DECISIONS_URL='https://api.openai.com/v1/decisions';
export function createDecisionsChooser({apiKey,model='gpt-6-luna',fetchImpl=fetch,timeoutMs=1200}){
  return async function choose({system,user,tools,signal}){
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,timeoutMs);
    try{
      const response=await fetchImpl(DECISIONS_URL,{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
        body:JSON.stringify({model,input:[{role:'developer',content:[{type:'input_text',text:system}]},{role:'user',content:[{type:'input_text',text:user}]}],
          questions:[{type:'choice',name:'tool',instructions:'这件要办的事该用哪一个工具？只选一个。',choices:tools.map(tool=>({value:tool.name,description:String(tool.description??'').slice(0,300)}))}]})});
      if(!response.ok)throw Error(`decisions HTTP ${response.status}`);
      const answer=(await response.json())?.answers?.find(item=>item?.name==='tool'&&item.type==='choice');
      return typeof answer?.choice==='string'?{name:answer.choice,confidence:Number(answer.confidence)||0}:null;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
}
export function decisionsChooserFromEnv(env=process.env,{fetchImpl}={}){
  const apiKey=env.VOICE_GPT_LIVE_DECISIONS_API_KEY;
  return apiKey?createDecisionsChooser({apiKey,...(env.VOICE_GPT_LIVE_DECISIONS_MODEL?{model:env.VOICE_GPT_LIVE_DECISIONS_MODEL}:{}),...(fetchImpl?{fetchImpl}:{})}):null;
}
// Three things the voice model sometimes does and a list of words cannot tell: it says goodbye and
// never asks for the hang-up; it promises to think or look and nothing is running; the caller says
// their own goodbye while the call is being hung up. Each is a judgement of what was just said, in
// its conversation: a probability from the Decisions API where there is a key, a yes or no from the
// routing model where there is not. (They were patterns once: "拜拜", "我想想", "先这样".)
const JUDGE_SYSTEM='你在旁听一通电话，判断助手 V 和对方刚说的话属于哪种情况。只根据给出的对话判断。';
const JUDGE={
  farewell:'V 刚才这句话是在向对方道别、结束这通电话，而且从对话看对方也想结束通话或已经道别。只是谈到“再见”这个词、转述别人的话，或者对方并不想结束，都不算。',
  promise:'V 刚才这句话只是答应去想、去查、去办，或者让对方等一下，却没有给出对方要的实质内容。已经给出了答案或内容、只是寒暄、表示自己在听或请对方接着说（对方还没提出要查、要办的事），都不算。',
  stays:'对方最后这句话只是在道别、道谢或附和结束通话，没有提出新的问题、要求或反对。',
};
const heard=({reply='',userText='',history=[]})=>[recent(history.slice(-6)),userText&&`对方最后说：“${String(userText).slice(0,300)}”`,reply&&`V 刚才说：“${String(reply).slice(0,400)}”`].filter(Boolean).join('\n');
/** `judge({reply,userText,history,signal})` -> {farewell, promise, stays}, each 0..1. Throws when there is no answer. */
export function createReplyJudge({apiKey='',model='gpt-6-luna',complete=null,fetchImpl=fetch,timeoutMs=1500}={}){
  if(!apiKey&&!complete)return null;
  return async function judge({reply='',userText='',history=[],signal}={}){
    const said=heard({reply,userText,history});
    if(!apiKey){
      // No probabilities here: the routing model answers yes or no to each.
      const answer=await complete({signal,system:JUDGE_SYSTEM,user:said,tools:[{type:'function',name:'verdict',description:'给出这三项判断。',parameters:{type:'object',additionalProperties:false,required:Object.keys(JUDGE),
        properties:Object.fromEntries(Object.entries(JUDGE).map(([name,description])=>[name,{type:'boolean',description}]))}}]});
      if(answer?.name!=='verdict')throw Error('judge gave no verdict');
      return Object.fromEntries(Object.keys(JUDGE).map(name=>[name,answer.args?.[name]===true?1:0]));
    }
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,timeoutMs);
    try{
      const response=await fetchImpl(DECISIONS_URL,{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
        body:JSON.stringify({model,input:[{role:'developer',content:[{type:'input_text',text:JUDGE_SYSTEM}]},{role:'user',content:[{type:'input_text',text:said}]}],
          questions:Object.entries(JUDGE).map(([name,instructions])=>({type:'predicate',name,instructions}))})});
      if(!response.ok)throw Error(`decisions HTTP ${response.status}`);
      const answers=(await response.json())?.answers??[];
      return Object.fromEntries(Object.keys(JUDGE).map(name=>[name,Number(answers.find(item=>item?.name===name&&item.type==='predicate')?.probability)||0]));
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
}
export const replyJudgeFromEnv=(env=process.env,{fetchImpl,complete=null}={})=>createReplyJudge({apiKey:env.VOICE_GPT_LIVE_DECISIONS_API_KEY??'',complete,...(env.VOICE_GPT_LIVE_DECISIONS_MODEL?{model:env.VOICE_GPT_LIVE_DECISIONS_MODEL}:{}),...(fetchImpl?{fetchImpl}:{})});
const takesNothing=tool=>Object.keys(tool?.parameters?.properties??{}).length===0;
const SURE=0.5;
export function createDelegationRouter({complete=null,choose=null,now=()=>new Date(),audit=()=>{}}={}){
  return async function route({text,userText,tools,notes='',history=[],running=false,speculative=false,signal}){
    const names=new Set(tools.map(tool=>tool.name)),startedAt=performance.now();
    // `ahead`: chosen from the caller's words before the model delegated; used only if it does.
    // (What the model handed over goes to the call's private record with the choice, as the caller's words do.
    // Measured: on this login it is the caller's own words, so the model decides whether, never which.)
    const done=choice=>{audit({type:'gpt-live.routed',name:choice?.name??null,via:choice?.via??'none',elapsedMs:Math.round(performance.now()-startedAt),...(speculative?{ahead:true}:{said:String(text??'').slice(0,200)})});return choice;};
    if(complete){
      // The function-calling request can be given up once the quicker answer has settled the matter.
      const full=new AbortController(),stop=()=>full.abort();
      if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
      try{
        const request={tools,system:[ROUTER_PROMPT,`当前上海时间：${now().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})}。`,notes].filter(Boolean).join('\n'),
          user:[recent(history),`后台任务：${running?'有一件正在执行':'没有正在执行的'}`,`要办的事：${String(text).slice(0,2000)}`,userText&&userText!==text?`用户刚才的原话：${String(userText).slice(0,600)}`:''].filter(Boolean).join('\n')};
        const filled=complete({...request,signal:full.signal});filled.catch(()=>{});
        if(choose){
          const picked=await choose({...request,signal}).catch(()=>null),tool=picked&&tools.find(item=>item.name===picked.name);
          if(tool&&takesNothing(tool)&&picked.confidence>=SURE){stop();return done({name:tool.name,args:{},via:'decision'});}
        }
        const choice=await filled;
        if(choice&&names.has(choice.name))return done({...choice,via:'model'});
        audit({type:'gpt-live.route-rejected',name:choice?.name??null});
      }catch(error){
        const message=String(error?.message??error).slice(0,300);
        audit({type:'gpt-live.route-failed',message});console.warn(JSON.stringify({type:'voice.gpt-live-route-failed',message}));
      }finally{signal?.removeEventListener('abort',stop);}
    }
    return done(fallbackRoute(text,names,{userText}));
  };
}
