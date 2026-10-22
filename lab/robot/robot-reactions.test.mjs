import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ROBOT_REACTIONS,ROBOT_REACTION_CHOICES,robotReaction} from './robot-catalog.mjs';
import {createRobotReactionDriver,ruleReaction,createDeepSeekChoiceEvaluator,freshReaction} from './robot-reactions.mjs';

test('catalog is unique, renderable and every continuation exists', () => {
  assert.equal(new Set(ROBOT_REACTIONS.map(r => r.id)).size, ROBOT_REACTIONS.length);
  assert(ROBOT_REACTIONS.length >= 30, 'a rich reaction set');
  for (const r of ROBOT_REACTIONS) for (const id of r.next) assert(robotReaction(id));
  assert(!('hello' in ROBOT_REACTION_CHOICES), 'wake greeting is device-local, not a model choice');
  assert(ROBOT_REACTIONS.every(r => r.holdMs >= 1000 && r.holdMs <= 4000));
});

test('keyword fallback stays conservative', () => {
  assert.equal(ruleReaction('user', '哈哈哈太好笑了'), 'laugh');
  assert.equal(ruleReaction('user', '拜拜啦'), 'bye');
  assert.equal(ruleReaction('user', '今天有点难过'), 'sad');
  assert.equal(ruleReaction('user', '今天上海天气怎么样？'), 'listen-curious');
  assert.equal(ruleReaction('user', '我刚下班'), 'listen-attentive');
  assert.equal(ruleReaction('assistant', '明天下午三点开会'), 'explain');
});

function harness(evaluate, options = {}) {
  const sent = [];
  const driver = createRobotReactionDriver({evaluate, send: e => sent.push(e), assistantBeatMs: 60, ...options});
  return {driver, sent};
}

test('a finished user turn asks the classifier and pushes its reaction', async () => {
  const calls = [];
  const {driver, sent} = harness(async (state, questions) => {calls.push({state, questions});return {answers:{reaction:{type:'choice',choice:'surprised'}}};});
  driver.observe({type:'transcript', role:'user', text:'我中彩票了', final:false});
  assert.equal(calls.length, 0, 'partial ASR never triggers a reaction');
  driver.observe({type:'transcript', role:'user', text:'我中彩票了！', final:true});
  await delay(5);
  assert.deepEqual(sent, [{type:'reaction', id:'surprised', beat:'user_meaning'}]);
  assert.equal(calls[0].state.turns.at(-1).text, '我中彩票了！');
  assert('celebrate' in calls[0].questions.reaction.criteria);
});

test('tool activity reacts immediately without the classifier', async () => {
  let called = false;
  const {driver, sent} = harness(async () => {called = true;return null;});
  driver.observe({type:'tool.call', name:'web_search'});
  driver.observe({type:'tool.call', name:'memory_search'});
  driver.observe({type:'tool.error', name:'web_search'});
  assert.deepEqual(sent.map(e => e.id), ['searching', 'remember', 'oops']);
  assert.equal(called, false);
});

test('classifier failure or an invalid choice falls back to rules', async () => {
  const {driver, sent} = harness(async () => {throw Error('down');});
  driver.observe({type:'transcript', role:'user', text:'谢谢你呀', final:true});
  await delay(5);
  assert.equal(sent[0].id, 'thanks');
  const second = harness(async () => ({answers:{reaction:{type:'choice', choice:'not-a-reaction'}}}));
  second.driver.observe({type:'transcript', role:'user', text:'拜拜', final:true});
  await delay(5);
  assert.equal(second.sent[0].id, 'bye');
});

test('a slow choice for an older user turn is dropped when a newer turn arrives', async () => {
  let release;
  const gate = new Promise(r => {release = r;});
  let n = 0;
  const {driver, sent} = harness(async () => {n++;if (n === 1) {await gate;return {answers:{reaction:{type:'choice',choice:'laugh'}}};}return {answers:{reaction:{type:'choice',choice:'sad'}}};});
  driver.observe({type:'transcript', role:'user', text:'哈哈', final:true});
  driver.observe({type:'transcript', role:'user', text:'其实我很难过', final:true});
  release();
  await delay(10);
  assert.deepEqual(sent.map(e => e.id), ['sad']);
});

test('assistant speech yields start and paced progress beats from whole sentences', async () => {
  const beats = [];
  const {driver} = harness(async state => {beats.push(state.beat.kind);return {answers:{reaction:{type:'choice',choice:'explain'}}};});
  driver.observe({type:'transcript', role:'assistant', text:'好的，', final:false});
  driver.observe({type:'transcript', role:'assistant', text:'我来想想。然后', final:false});
  await delay(5);
  assert.deepEqual(beats, ['assistant_start']);
  driver.observe({type:'transcript', role:'assistant', text:'这是第二句。', final:false});
  await delay(5);
  assert.deepEqual(beats, ['assistant_start'], 'progress is paced');
  await delay(70);
  driver.observe({type:'transcript', role:'assistant', text:'第三句来了。', final:false});
  await delay(5);
  assert.deepEqual(beats, ['assistant_start', 'assistant_progress']);
  driver.observe({type:'transcript', role:'assistant', source:'tool-start', text:'我查一下。', final:true});
  await delay(5);
  assert.equal(beats.length, 2, 'tool-start notices are not conversation beats');
});

test('DeepSeek evaluator returns the Decision answer shape', async () => {
  let request;
  const evaluate = createDeepSeekChoiceEvaluator({apiKey:'k', fetchImpl: async (url, init) => {request = JSON.parse(init.body);return {ok:true, json: async () => ({choices:[{message:{content:'{"choice":"laugh"}'}}]})};}});
  const result = await evaluate({purpose:'p', turns:[{role:'user', text:'哈哈'}], beat:{kind:'user_meaning', text:'哈哈'}}, {reaction:{type:'choice', instructions:'i', criteria:{laugh:'笑'}}});
  assert.deepEqual(result, {answers:{reaction:{type:'choice', choice:'laugh'}}});
  assert.equal(request.response_format.type, 'json_object');
  assert.match(request.messages[0].content, /laugh: 笑/);
});

test('recent faces leave the candidate list and a repeated pick is swapped for a fresh one', async () => {
  const seen = [];
  const {driver, sent} = harness(async (state, questions) => {seen.push(Object.keys(questions.reaction.criteria));return {answers:{reaction:{type:'choice', choice:'explain'}}};});
  for (const text of ['第一句', '第二句', '第三句']) {
    driver.observe({type:'transcript', role:'user', text, final:true});
    await delay(5);
  }
  assert.deepEqual(sent.map(e => e.id), ['explain', 'nod-agree', 'listen-attentive'], 'never the same face twice in a row');
  assert(seen[1].every(id => id !== 'explain'), 'the last face is not offered again');
  assert(!seen[2].includes('nod-agree') && !seen[2].includes('explain'));
});

test('goodbye and apologies keep their meaning even when repeated', () => {
  assert.equal(freshReaction('bye', 'user', ['bye']), 'bye');
  assert.equal(freshReaction('laugh', 'user', ['laugh']), robotReaction('laugh').next[0] ?? 'listen-attentive');
});

test('one tool used several times in a row shows one searching face', () => {
  const {driver, sent} = harness(null);
  driver.observe({type:'tool.call', name:'web_search'});
  driver.observe({type:'tool.call', name:'web_search'});
  assert.deepEqual(sent.map(e => e.id), ['searching']);
});

test('task status badge follows pending tool calls like the web avatar', () => {
  const {driver, sent} = harness(null, {status: true});
  const status = () => sent.filter(e => e.type === 'status').map(e => e.id);
  driver.observe({type:'tool.call', callId:'a', name:'web_search'});
  driver.observe({type:'tool.call', callId:'b', name:'delegate_to_v'});
  driver.observe({type:'tool.call', callId:'c', name:'set_speaker_volume'});
  driver.observe({type:'tool.result', callId:'a', name:'web_search'});
  assert.deepEqual(status(), ['web', 'background'], 'a finished search leaves the background task showing');
  driver.observe({type:'tool.result', callId:'b', name:'delegate_to_v'});
  assert.deepEqual(status(), ['web', 'background', 'done']);
  driver.observe({type:'tool.call', callId:'d', name:'memory_search'});
  driver.observe({type:'tool.error', callId:'d', name:'memory_search'});
  assert.deepEqual(status(), ['web', 'background', 'done', 'memory', 'none']);
  driver.observe({type:'tool.call', callId:'e', name:'look'});
  assert.equal(status().at(-1), 'look', 'the camera has its own badge');
});

test('task status stays off unless the device asks for it', () => {
  const {driver, sent} = harness(null);
  driver.observe({type:'tool.call', callId:'a', name:'web_search'});
  driver.observe({type:'tool.result', callId:'a', name:'web_search'});
  assert(!sent.some(e => e.type === 'status'));
});
