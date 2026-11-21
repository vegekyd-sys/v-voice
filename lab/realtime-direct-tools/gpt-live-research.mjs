// What GPT Live 1.1 is designed to lean on is a stronger model behind it that looks things up
// properly. On the ChatGPT (Codex) login its own hosted delegation is refused (the backend call
// answers 401), so the same subscription's Responses endpoint is asked here instead: one model
// with built-in web search, which reads the pages it finds, where `web_search` returns six
// passages of 500 characters.
const RESPONSES_URL='https://chatgpt.com/backend-api/codex/responses';
const ANSWER_MAX_CHARS=1800;
export const GPT_LIVE_RESEARCH_TOOL=Object.freeze({type:'function',name:'web_answer',
  description:'先给搜索摘要里的初步答案，同时读网页原文核对，约二十秒后补充或更正。用于需要具体数据、名单、逐项细节、比较、核实的当前信息：阵容和每人数据、每场比分和得分、产品参数和价格对比、一件事的来龙去脉，或者用户说“不对”“查清楚”“详细说说”。只要一句话的近况（天气、股价、新闻标题、一个比分）用 web_search。',
  parameters:{type:'object',properties:{question:{type:'string',description:'要查清的完整问题：保留对象、时间和用户要的那几项；“今年”“现在”写成具体日期。'}},required:['question'],additionalProperties:false}});
const today=now=>new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const instructions=now=>`You are the research backend of a Chinese voice assistant on a phone call. Today is ${today(now)} (Asia/Shanghai). Search the web and read the pages before answering; for anything current, trust the newest dated source over what you remember, and say plainly when a result is not out yet or could not be found. Answer in Chinese, in plain spoken sentences: the direct answer first, then every item that was asked for with its key names, numbers and dates, each in one sentence. At most ten sentences. No headings, no bullet marks, no links, no source names in brackets.`;
// Citations and markup are for a page; this is read by a voice model.
export const spokenAnswer=text=>String(text??'').replace(/\(\[[^\]]*\]\([^)]*\)\)/gu,'').replace(/\[([^\]]*)\]\([^)]*\)/gu,'$1').replace(/[*_`#>]+/gu,'').replace(/[ \t]+\n/gu,'\n').replace(/\n{2,}/gu,'\n').replace(/[ \t]{2,}/gu,' ').trim();

/** `research({question, context, signal})` -> {answer, searches, elapsedMs}; throws when nothing usable came back. */
export function createGptLiveResearch({resolveAuth,model,effort='low',fetchImpl=fetch,timeoutMs=45000,now=()=>Date.now(),newId=()=>globalThis.crypto.randomUUID()}){
  if(typeof resolveAuth!=='function'||!model)throw Error('GPT Live research needs a login and a model');
  return async function research({question,context='',signal}={}){
    const asked=String(question??'').trim();if(!asked)throw Error('没有要查的问题');
    const startedAt=now(),controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,timeoutMs);
    try{
      const auth=await resolveAuth();
      const response=await fetchImpl(RESPONSES_URL,{method:'POST',signal:controller.signal,
        headers:{Authorization:`Bearer ${auth.token}`,'chatgpt-account-id':auth.accountId,'content-type':'application/json','OpenAI-Beta':'responses=experimental',originator:'codex_cli_rs',session_id:newId(),accept:'text/event-stream'},
        body:JSON.stringify({model,instructions:instructions(startedAt),
          input:[{type:'message',role:'user',content:[{type:'input_text',text:[context&&`通话里刚才说到的（只用来理解问题指的是什么）：\n${String(context).slice(-1200)}`,`要查清的问题：${asked.slice(0,600)}`].filter(Boolean).join('\n\n')}]}],
          tools:[{type:'web_search'}],tool_choice:'auto',parallel_tool_calls:true,reasoning:{effort},store:false,stream:true,include:[]})});
      if(!response.ok)throw Error(`research HTTP ${response.status}`);
      let buffer='',text='',searches=0,failed='';
      const take=block=>{
        const data=block.split('\n').find(line=>line.startsWith('data:'));if(!data)return;
        let event;try{event=JSON.parse(data.slice(5));}catch{return;}
        if(event.type==='response.output_item.added'&&event.item?.type==='web_search_call')searches++;
        else if(event.type==='response.output_text.delta'&&typeof event.delta==='string')text+=event.delta;
        else if(event.type==='response.failed'||event.type==='error')failed=String(event.response?.error?.code??event.error?.code??'failed').replace(/[^\w.-]/gu,'').slice(0,60);
      };
      const decoder=new TextDecoder();
      for await(const chunk of response.body){
        buffer+=decoder.decode(chunk,{stream:true});
        for(let index;(index=buffer.indexOf('\n\n'))>=0;){take(buffer.slice(0,index));buffer=buffer.slice(index+2);}
      }
      if(buffer.trim())take(buffer);
      const answer=spokenAnswer(text);
      if(!answer)throw Error(`research ${failed||'empty'}`);
      return {answer:Array.from(answer).slice(0,ANSWER_MAX_CHARS).join(''),searches,elapsedMs:Math.round(now()-startedAt)};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
}
