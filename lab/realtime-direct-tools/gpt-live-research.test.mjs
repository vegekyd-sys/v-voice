import test from 'node:test';import assert from 'node:assert/strict';
import {createGptLiveResearch,spokenAnswer,GPT_LIVE_RESEARCH_TOOL} from './gpt-live-research.mjs';
const sse=events=>new ReadableStream({start(controller){const bytes=new TextEncoder().encode(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));controller.enqueue(bytes.slice(0,37));controller.enqueue(bytes.slice(37));controller.close();}});
test('the stronger model is asked on the same login, with web search, and its answer comes back as speech',async()=>{
  const requests=[];
  const research=createGptLiveResearch({resolveAuth:async()=>({token:'tok',accountId:'acct'}),model:'strong-model',newId:()=>'id-1',now:()=>Date.parse('2026-11-21T07:00:00Z'),
    fetchImpl:async(url,init)=>{requests.push({url,init});return {ok:true,status:200,body:sse([{type:'response.output_item.added',item:{type:'web_search_call'}},{type:'response.output_item.added',item:{type:'web_search_call'}},
      {type:'response.output_text.delta',delta:'甲队 **11 胜 4 负**，东部第二。 '},{type:'response.output_text.delta',delta:'([nba.com](https://www.nba.com/x?utm_source=openai))\n\n首发是 A、B、C。'},{type:'response.completed',response:{}}])};}});
  const found=await research({question:'甲队本赛季的阵容和战绩',context:'用户：聊聊甲队'});
  assert.deepEqual(found,{answer:'甲队 11 胜 4 负，东部第二。\n首发是 A、B、C。',searches:2,elapsedMs:0});
  const {url,init}=requests[0],body=JSON.parse(init.body);
  assert.equal(url,'https://chatgpt.com/backend-api/codex/responses');assert.equal(init.headers.Authorization,'Bearer tok');assert.equal(init.headers['chatgpt-account-id'],'acct');
  assert.equal(body.model,'strong-model');assert.deepEqual(body.tools,[{type:'web_search'}]);assert.equal(body.stream,true);assert.equal(body.store,false);assert.deepEqual(body.reasoning,{effort:'low'});
  assert.match(body.instructions,/Today is 2026-11-21/u);assert.match(body.input[0].content[0].text,/通话里刚才说到的[\s\S]*聊聊甲队[\s\S]*要查清的问题：甲队本赛季的阵容和战绩$/u);
});
test('a refused or empty answer is an error, never an invented one',async()=>{
  const make=response=>createGptLiveResearch({resolveAuth:async()=>({token:'t',accountId:'a'}),model:'m',fetchImpl:async()=>response});
  await assert.rejects(make({ok:false,status:429})({question:'x'}),/research HTTP 429/u);
  await assert.rejects(make({ok:true,status:200,body:sse([{type:'response.failed',response:{error:{code:'rate_limit_exceeded'}}}])})({question:'x'}),/research rate_limit_exceeded/u);
  await assert.rejects(make({ok:true,status:200,body:sse([])})({question:''}),/没有要查的问题/u);
  assert.throws(()=>createGptLiveResearch({resolveAuth:async()=>({}),model:''}),/needs a login and a model/u);
});
test('markup and citations are taken out of what a voice will say',()=>{
  assert.equal(spokenAnswer('**结论**：先看 [官网](https://a.b/c)。 ([x.com](https://x.com/y))\n\n- 第二点'),'结论：先看 官网。\n- 第二点');
  assert.equal(GPT_LIVE_RESEARCH_TOOL.name,'web_answer');assert.deepEqual(GPT_LIVE_RESEARCH_TOOL.parameters.required,['question']);
});
