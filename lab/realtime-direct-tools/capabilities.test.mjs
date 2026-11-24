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
    for(const key of ['hostToolSpeech','typedTurns','compactResults','nativeDuplex'])assert.equal(typeof traits[key],'boolean',`${id}.${key}`);
  }
  // A model this file does not know takes part in nothing model-specific.
  assert.deepEqual(modelTraits('a-new-model'),{tools:'function',explains:'lesson',hostToolSpeech:false,typedTurns:true,compactResults:false,nativeDuplex:false});
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
