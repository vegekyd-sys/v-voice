import {asksForLesson,lessonResearch} from './tools.mjs';
import {datedQuery} from './search-result.mjs';

// Not a tool: what the voice model can say by itself (an explanation, a story, an opinion). Offered to
// the router when the call has no lesson tool, so a delegation for such a thing has somewhere to go.
export const GPT_LIVE_SELF_TOOL=Object.freeze({type:'function',name:'answer_directly',description:'不需要任何工具：让前台语音模型自己回答。用于讲解、科普、讲故事、看法和建议、常识，以及复述刚才已经查到的结果。凡是需要实时信息、用户自己的资料或实际操作的，不选这个。',parameters:{type:'object',properties:{},additionalProperties:false}});

// GPT Live has no function tools: it hands the backend one sentence in its own
// words. The slow part of GPT Live One was answering every such sentence with
// the whole V agent. Here a sentence that one of this call's own tools can
// answer is turned into that tool call, and only real work goes to the agent.
const TIME=/几点|星期几|周几|礼拜几|几月几[号日]|(?:今天|明天|现在).{0,4}(?:几号|日期|什么时间)/u;
const TIME_ONLY=/股|价|天气|新闻|比分|汇率|航班|日程|会议|安排|提醒|闹钟/u;
const ENDS=/挂断|挂电话|挂了吧|结束(?:通话|电话|这通)|拜拜|再见|回头见|下次再聊|\bbye\b/iu;
const DISCUSSES=/讲讲|讲一|怎么做|功能|你能|能不能|可以.{0,6}吗/u;
const SEARCH=/上网|搜[一索]?|查[一]?[下查找询]|新闻|股价|天气|气温|汇率|比分|赛果|价格|多少钱|最新|票房|排名|今天.{0,12}(?:怎么样|如何|情况)|\bsearch\b|\bnews\b|\bweather\b/iu;
const WRITES=/发(?:给|到|送|消息|邮件|飞书|群)|创建|新建|预约|预订|订[一个张]|改(?:一下|到|成|期)|删(?:除|掉)|取消(?:日程|会议|提醒)|写(?:一[篇份个]|成|报告|文档)|整理成|提醒我|记[一]?下|保存|安排(?:一[个下]|会议)/u;
const AGENDA=/日程|日历|行程|有什么(?:会|安排)|有没有会|几个会/u,OTHER_DAY=/明天|后天|昨天|前天|下周|上周|这周|本周|周[一二三四五六日末]|星期|礼拜|\d+\s*[月号日]|下个月/u;
// A lookup that says everything it needs: its own words are the query. Anything that leans on
// what was said before ("那另一场呢") goes to the routing model, which is given the conversation.
const LOOKUP=/新闻|头条|股价|股票|天气|气温|下雨|汇率|比分|赛果|比赛结果|票房|油价|金价|多少钱|\bnews\b|\bweather\b|\bstock\b/iu;
const LEANS=/^(?:那|再|还|又|刚才|刚刚|上面|接着|继续|另)|它|这个|那个|这场|那场|另一|其他|上次|之前|怎么样了|具体/u;
const OWN=/^(?:你还?记得|我(?:的|们的|们家)?(?:儿子|女儿|孩子|老婆|太太|妻子|老公|爸爸?|妈妈?|父母|家人|生日|狗|猫))/u;
const ASKING=/^(?:请|麻烦)?(?:你)?(?:帮我|给我|替我)?(?:上网)?(?:查一?[下查]|搜一?[下索]?|看一?[下看]|搜索|查询)(?:一下)?[，,\s]*/u;
// A story is told the way a lesson is: a script read aloud with real pictures on the page, begun in
// seconds. (Handed to the agent, the same request came back as a generated image two minutes later.)
const STORY=/(?:讲|说|来|听).{0,14}故事|故事.{0,8}(?:讲|听)|\btell (?:me|us) a story\b/iu,MAKES_NEW=/生成|画[一几]?[张个幅]|做[一几]?[张个段]|视频|动起来|发[到给](?:群|飞书)/u;
const MEDIA=/(?:画|生成|做|出|来)[一几]?[张个幅段条]?.{0,12}(?:图|画|照片|视频|海报|头像|壁纸)|让.{0,8}动起来/u;

const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
// What can be decided from the sentence alone, without a model. Only cases where the wrong guess is
// cheap: the time, today's own agenda, an explanation, hanging up, a self-contained lookup.
export function quickRoute(text,names,{userText}={}){
  const has=name=>names.has(name),said=String(text??'').trim(),asked=String(userText??'').trim()||said;
  if(!said)return null;
  if(has('end_call')&&ENDS.test(said)&&!DISCUSSES.test(said)&&Array.from(said).length<=24)return {name:'end_call',args:{},via:'quick'};
  if(has('current_time')&&TIME.test(said)&&!TIME_ONLY.test(said)&&Array.from(said).length<=24)return {name:'current_time',args:{},via:'quick'};
  if(has('feishu_calendar')&&AGENDA.test(said)&&!OTHER_DAY.test(said)&&!WRITES.test(said)&&Array.from(said).length<=24)return {name:'feishu_calendar',args:{},via:'quick'};
  // No lesson tool: the voice model explains and tells stories itself. What it needs facts for (today's
  // world, the caller's own) is looked up first; everything else it is simply told to say.
  if(has('answer_directly')&&(asksForLesson(asked)||STORY.test(asked))&&!WRITES.test(said)&&!MAKES_NEW.test(said)&&Array.from(said).length<=120){
    const needs=lessonResearch(asked);
    if(needs==='memory_search'&&has('memory_search'))return {name:'memory_search',args:{query:said.slice(0,200)},via:'quick'};
    if(needs==='web_search'&&has('web_search'))return {name:'web_search',args:{query:datedQuery(said.slice(0,160))},via:'quick'};
    if(!needs)return {name:'answer_directly',args:{},via:'quick'};
  }
  if(has('explain_on_board')&&asksForLesson(asked)&&!WRITES.test(said)&&!MEDIA.test(said))return {name:'explain_on_board',args:{topic:said.slice(0,400)},via:'quick'};
  if(has('explain_on_board')&&STORY.test(asked)&&!WRITES.test(said)&&!MAKES_NEW.test(said)&&Array.from(said).length<=80)return {name:'explain_on_board',args:{topic:said.slice(0,400)},via:'quick'};
  const length=Array.from(said).length;
  if(length>=5&&length<=40&&!LEANS.test(said)&&!WRITES.test(said)&&!MEDIA.test(said)){
    if(has('memory_search')&&OWN.test(said)&&!LOOKUP.test(said))return {name:'memory_search',args:{query:said},via:'quick'};
    if(has('web_search')&&LOOKUP.test(said)&&!OWN.test(said)&&!AGENDA.test(said)){
      const query=said.replace(ASKING,'').replace(/[。？！?!.]+$/u,'').trim()||said;
      return {name:'web_search',args:{query:/今天|现在|今年|本赛季|这赛季|最新|目前|today|now|latest|this (?:year|season)/iu.test(query)?`${query} ${today()}`:query},via:'quick'};
    }
  }
  return null;
}
// Used when the routing model is unavailable or too slow.
export function fallbackRoute(text,names,{userText}={}){
  const said=String(text??'').trim();
  const quick=quickRoute(said,names,{userText});if(quick)return {...quick,via:'fallback'};
  if(names.has('web_search')&&SEARCH.test(said)&&!WRITES.test(said)&&!MEDIA.test(said))return {name:'web_search',args:{query:said.slice(0,200)},via:'fallback'};
  if(names.has('delegate_to_v'))return {name:'delegate_to_v',args:{question:said.slice(0,2000),...(userText&&userText!==said?{context:`用户原话：${String(userText).slice(0,600)}`}:{})},via:'fallback'};
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
export function createDelegationRouter({complete=null,now=()=>new Date(),audit=()=>{}}={}){
  return async function route({text,userText,tools,notes='',history=[],running=false,speculative=false,signal}){
    const names=new Set(tools.map(tool=>tool.name)),startedAt=performance.now();
    // `ahead`: chosen from the caller's words before the model delegated; used only if it does.
    const done=choice=>{audit({type:'gpt-live.routed',name:choice?.name??null,via:choice?.via??'none',elapsedMs:Math.round(performance.now()-startedAt),...(speculative?{ahead:true}:{})});return choice;};
    const quick=quickRoute(text,names,{userText});
    if(quick)return done(quick);
    if(complete){
      try{
        const choice=await complete({signal,tools,system:[ROUTER_PROMPT,`当前上海时间：${now().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})}。`,notes].filter(Boolean).join('\n'),
          user:[recent(history),`后台任务：${running?'有一件正在执行':'没有正在执行的'}`,`要办的事：${String(text).slice(0,2000)}`,userText&&userText!==text?`用户刚才的原话：${String(userText).slice(0,600)}`:''].filter(Boolean).join('\n')});
        if(choice&&names.has(choice.name))return done({...choice,via:'model'});
        audit({type:'gpt-live.route-rejected',name:choice?.name??null});
      }catch(error){
        const message=String(error?.message??error).slice(0,300);
        audit({type:'gpt-live.route-failed',message});console.warn(JSON.stringify({type:'voice.gpt-live-route-failed',message}));
      }
    }
    return done(fallbackRoute(text,names,{userText}));
  };
}
