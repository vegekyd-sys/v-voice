import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODEL_TRAITS,TOOL_BRIEFS,UNBRIEFED,modelTraits,toolBriefs} from './capabilities.mjs';
import {TOOLS,LESSON_TOOL,SPEAKER_VOLUME_TOOL,LOOK_TOOL} from './tools.mjs';
import {LOCATION_TOOL} from './device-location.mjs';
import {DIRECT_MODELS} from './session.mjs';
import {gptLiveDelegationPolicy} from './gpt-live-provider.mjs';

const offerable=[...TOOLS,LESSON_TOOL,SPEAKER_VOLUME_TOOL,LOOK_TOOL,LOCATION_TOOL].map(tool=>tool.name);
const briefed=TOOL_BRIEFS.flatMap(brief=>brief.tools);

test('every model a call can choose has its traits, and every trait has a known value',()=>{
  for(const {id} of DIRECT_MODELS){
    const traits=MODEL_TRAITS[id];
    assert(traits,`${id} has no traits in capabilities.mjs`);
    assert(['function','delegation'].includes(traits.tools));
    assert(['lesson','speech'].includes(traits.explains));
    assert(['text','speech'].includes(traits.typedInput),`${id}.typedInput`);
    for(const key of ['hostToolSpeech','typedTurns','compactResults','nativeDuplex'])assert.equal(typeof traits[key],'boolean',`${id}.${key}`);
  }
  // A model this file does not know takes part in nothing model-specific.
  assert.deepEqual(modelTraits('a-new-model'),{tools:'function',explains:'lesson',hostToolSpeech:false,typedTurns:true,typedInput:'text',compactResults:false,nativeDuplex:false});
});

test('a tool a call can be offered is either told to delegation models or left out on purpose',()=>{
  for(const name of offerable)assert.equal(briefed.includes(name)+UNBRIEFED.includes(name),1,`${name}: add it to TOOL_BRIEFS or UNBRIEFED`);
  for(const name of [...briefed,...UNBRIEFED])assert(offerable.includes(name),`${name} is not a tool any call is offered`);
});

test('a delegation model is told exactly the briefs of the tools its call has',()=>{
  const names=new Set(['web_search','lark_read','show_content','end_call','process']);
  assert.deepEqual(toolBriefs(names),['搜索：上网查新闻、比分、股价、天气、价格、公开资料，几秒内回来','飞书：飞书日程和飞书资料（只读）','上屏：把已有的真实内容放到屏幕上','挂断：结束这通电话']);
  assert(!toolBriefs(names,{display:false}).some(line=>line.startsWith('上屏')));
  const policy=gptLiveDelegationPolicy(names);
  for(const line of toolBriefs(names))assert(policy.includes(`- ${line}\n`),line);
  for(const brief of TOOL_BRIEFS)if(!brief.tools.some(name=>names.has(name)))assert(!policy.includes(brief.line),brief.line);
});

// The rule that keeps capabilities shared: session.mjs asks a trait. A model's name is compared only
// where the model itself is meant: its bridge, its voices, its connection and its own persona.
test('shared call code asks traits; a model name is compared only for transport, voice or persona',()=>{
  const source=readFileSync(new URL('./session.mjs',import.meta.url),'utf8').split('\n');
  const named=source.map((line,index)=>({line,at:index+1})).filter(({line})=>/model\s*[!=]==\s*['"]/u.test(line));
  assert(named.length>0);
  for(const {line,at} of named)assert.match(line,/Bridge\(|Voice\(|voice:|preconnect|GPT_LIVE_IDENTITY|scriptedLessons|grokSpeed/u,`session.mjs:${at} compares a model name for shared behaviour; add a trait in capabilities.mjs instead`);
});

test('the tool-choice policy a function-tool model reads is the text a delegation model\'s router reads',async()=>{
  const {toolChoicePolicy,routerNotes,directInstructions}=await import('./session.mjs');
  const {LESSON_ROUTING}=await import('./tools.mjs');
  for(const sessionBound of [false,true]){
    const policy=toolChoicePolicy({sessionBound});
    assert(directInstructions([],'','seeduplex',{sessionBound}).includes(policy));
    assert(directInstructions([],'','grok',{sessionBound}).includes(policy));
    assert(routerNotes({sessionBound}).startsWith(policy));
  }
  assert(routerNotes({lessons:true}).includes(LESSON_ROUTING));assert(!routerNotes({}).includes(LESSON_ROUTING));
  // How pictures on the screen are named: in a function-tool model's instructions, and in the router's notes.
  const {ASSET_POLICY}=await import('../gpt-live-h5/board-assets.mjs');
  assert(routerNotes({screen:ASSET_POLICY}).endsWith(ASSET_POLICY));assert(!routerNotes({}).includes(ASSET_POLICY));
  assert(routerNotes({publicVoice:true}).startsWith(toolChoicePolicy({publicVoice:true})));
});

test('the router is given each tool\'s whole description, as a function-tool model is',async()=>{
  const {createRouterCompletion}=await import('./gpt-live-router.mjs');
  const {TOOLS}=await import('./tools.mjs');
  let sent;
  const complete=createRouterCompletion({apiKey:'k',endpoint:'https://router.example/v1',model:'m',fetchImpl:async(url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'web_search',arguments:'{"query":"q"}'}}]}}]})};}});
  await complete({system:'s',user:'u',tools:TOOLS});
  for(const tool of TOOLS)assert.equal(sent.tools.find(item=>item.function.name===tool.name).function.description,tool.description);
});
