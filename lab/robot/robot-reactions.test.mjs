import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ROBOT_REACTIONS,ROBOT_REACTION_CHOICES,robotReaction} from './robot-catalog.mjs';
import {AVATAR_CATALOG} from '../gpt-live-h5/avatar-catalog.mjs';
import {robotReactionForPicture} from './robot-semantics.mjs';
import {createRobotReactionDriver,createDeepSeekChoiceEvaluator} from './robot-reactions.mjs';
const choice=picture=>({answers:{picture:{type:'choice',choice:picture}}});
function harness(evaluate,options={}){const sent=[];const driver=createRobotReactionDriver({evaluate,send:e=>sent.push(e),...options});return {driver,sent};}
test('every shared semantic pose maps to an existing physical rendering',()=>{
 assert.equal(new Set(ROBOT_REACTIONS.map(r=>r.id)).size,ROBOT_REACTIONS.length);
 for(const r of ROBOT_REACTIONS)for(const id of r.next)assert(robotReaction(id));
 assert(!('hello' in ROBOT_REACTION_CHOICES));
 for(const p of AVATAR_CATALOG.filter(p=>p.id!=='idle'))assert(robotReaction(robotReactionForPicture(p.id)),p.id);
 assert.equal(robotReactionForPicture('listen-3'),'comfort');assert.equal(robotReactionForPicture('listen-4'),'celebrate');
 assert.equal(robotReactionForPicture('reaction-2'),'listen-attentive');assert.equal(robotReactionForPicture('not-real'),null);
});
test('user meaning uses H5 candidates and meaning prompt, never a separate robot classifier',async()=>{
 let input;const h=harness(async(state,questions)=>{input={state,questions};return choice('web-4');});
 h.driver.observe({type:'transcript',role:'user',text:'意外的话',final:false});assert.equal(input,undefined);
 h.driver.observe({type:'transcript',role:'user',text:'我中彩票了！',final:true});await delay(5);
 assert.deepEqual(h.sent,[{type:'reaction',id:'surprised',beat:'user_meaning'}]);
 assert('listen-3' in input.questions.picture.criteria);assert(!input.questions.reaction);
 assert.match(input.state.purpose,/不能把抱怨直接模仿为愤怒/);h.driver.dispose();
});
test('unavailable selector stays neutral even when text contains emotion keywords',async()=>{
 for(const evaluate of [null,async()=>{throw Error('down');},async()=>choice('laugh')]){
  const h=harness(evaluate);h.driver.observe({type:'transcript',role:'user',text:'不是好笑，也不想庆祝，谢谢。',final:true});await delay(5);
  assert.equal(h.sent[0].id,'listen-attentive');h.driver.dispose();
 }
});
test('newer user meaning supersedes pending old choice',async()=>{
 let release,n=0;const gate=new Promise(r=>release=r);
 const h=harness(async()=>{if(++n===1){await gate;return choice('listen-4');}return choice('listen-3');});
 h.driver.observe({type:'transcript',role:'user',text:'哈哈',final:true});
 h.driver.observe({type:'transcript',role:'user',text:'其实我很难过',final:true});release();await delay(10);
 assert.deepEqual(h.sent.map(e=>e.id),['comfort']);h.driver.dispose();
});
test('same meaning remains same instead of rotating to a contradictory emotion',async()=>{
 const seen=[];const h=harness(async(s,q)=>{seen.push(Object.keys(q.picture.criteria));return choice('listen-3');});
 for(const text of ['难过','还是难过','没有好转']){h.driver.observe({type:'transcript',role:'user',text,final:true});await delay(5);}
 assert.deepEqual(h.sent.map(x=>x.id),['comfort','comfort','comfort']);assert(seen.every(ids=>ids.includes('listen-3')));h.driver.dispose();
});
test('whole assistant sentences are paced and tool notices cannot classify',async()=>{
 let clock=1000;const beats=[];const h=harness(async s=>{beats.push(s.beat.kind);return choice('reaction-7');},{now:()=>clock});
 h.driver.observe({type:'transcript',role:'assistant',text:'我来',final:false});assert.equal(beats.length,0);
 h.driver.observe({type:'transcript',role:'assistant',text:'解释。',final:false});await delay(5);
 clock+=1000;h.driver.observe({type:'transcript',role:'assistant',text:'第二句。',final:false});await delay(5);assert.equal(beats.length,1);
 clock+=6000;h.driver.observe({type:'transcript',role:'assistant',text:'第三句。',final:false});await delay(5);
 h.driver.observe({type:'transcript',role:'assistant',source:'tool-start',text:'我查一下。',final:true});assert.deepEqual(beats,['assistant_start','assistant_progress']);h.driver.dispose();
});
test('tasks update separate status badges without inventing conversational emotion',()=>{
 let calls=0;const h=harness(async()=>{calls++;return choice('listen-4');},{status:true});
 for(const e of [{type:'tool.call',callId:'a',name:'web_search'},{type:'tool.call',callId:'b',name:'delegate_to_v'},
 {type:'tool.call',callId:'c',name:'set_speaker_volume'},{type:'tool.result',callId:'a',name:'web_search'},{type:'tool.result',callId:'b',name:'delegate_to_v'},
 {type:'tool.call',callId:'d',name:'look'},{type:'tool.error',callId:'d',name:'look'}])h.driver.observe(e);
 assert.deepEqual(h.sent.map(e=>e.id),['web','background','done','look','none']);assert(h.sent.every(e=>e.type==='status'));assert.equal(calls,0);h.driver.dispose();
});
test('DeepSeek transport carries the shared picture answer shape',async()=>{
 let request;const evaluate=createDeepSeekChoiceEvaluator({apiKey:'fixture',fetchImpl:async(url,init)=>{request=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{content:'{"choice":"listen-3"}'}}]})};}});
 assert.deepEqual(await evaluate({purpose:'p',turns:[],beat:{}},{picture:{type:'choice',instructions:'i',criteria:{'listen-3':'温柔'}}}),choice('listen-3'));
 assert.match(request.messages[0].content,/listen-3: 温柔/);
});

test('head gesture is part of the same semantic evaluation and rejects arbitrary motor commands',async()=>{
 for(const [gesture,expected] of [['nod','nod-agree'],['shake','shake-no'],['move:90','comfort'],['none','comfort']]){
  let count=0;const h=harness(async(s,q)=>{count++;assert(q.picture&&q.headGesture);return {answers:{...choice('listen-3').answers,headGesture:{type:'choice',choice:gesture}}};});
  h.driver.observe({type:'transcript',role:'user',text:'这个说法不对',final:true});await delay(5);
  assert.equal(count,1);assert.equal(h.sent[0].id,expected);h.driver.dispose();
 }
});
test('DeepSeek returns both face and head from one bounded response',async()=>{
 const evaluate=createDeepSeekChoiceEvaluator({apiKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"picture":"listen-5","headGesture":"shake"}'}}]})})});
 const result=await evaluate({purpose:'p'},{picture:{instructions:'face',criteria:{}},headGesture:{instructions:'head',criteria:{}}});
 assert.equal(result.answers.picture.choice,'listen-5');assert.equal(result.answers.headGesture.choice,'shake');
});
