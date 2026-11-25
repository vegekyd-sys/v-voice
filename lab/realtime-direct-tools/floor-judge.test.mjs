import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFloorJudge,floorJudgeMessages,FLOOR_JUDGE_INSTRUCTIONS,createDecisionJudge,floorDecisionState,floorDecisionQuestions,floorJudgeFromEnv} from './floor-judge.mjs';

const stream = (...parts) => async function* ({signal}) { for (const part of parts) { if (signal.aborted) return; yield part; } };

test('the judge reads the model\'s first 是/否 and stops listening there', async () => {
  let clock = 0;
  const yes = await createFloorJudge({complete: stream('是', '的，这是对 V 说的'), now: () => (clock += 200)})({heard: '你为什么这样讲', said: '三条边', ahead: '工地上'});
  assert.equal(yes.toV, true); assert.equal(yes.answer, '是'); assert.equal(yes.ms, 200);
  assert.equal((await createFloorJudge({complete: stream('否')})({heard: '可以啊'})).toV, false);
});

test('no clear answer, a failure or no answer in time is no judgement', async () => {
  assert.equal((await createFloorJudge({complete: stream('不确定，听不清楚这句话到底是谁说的')})({heard: '嗯'})).toV, null);
  assert.equal((await createFloorJudge({complete: async function* () { throw Error('HTTP 500'); }})({heard: '嗯'})).toV, null);
  const slow = async function* ({signal}) { await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true})); };
  assert.equal((await createFloorJudge({complete: slow, timeoutMs: 20})({heard: '嗯'})).toV, null);
});

test('the judge is told what V was saying, what comes next and what was heard; no word decides it', () => {
  const [system, user] = floorJudgeMessages({said: '直角边是三和四', ahead: '斜边就是五', heard: '我也要我也要', recent: [{role: 'user', text: '讲讲勾股定理'}]});
  assert.equal(system.content, FLOOR_JUDGE_INSTRUCTIONS);
  for (const part of ['直角边是三和四', '斜边就是五', '我也要我也要', '讲讲勾股定理']) assert(user.content.includes(part));
  assert(!floorJudgeMessages({heard: '嗯'})[1].content.includes('接下来'), 'nothing invented when there is nothing ahead');
});

const decision = noul => async () => ({answers: {addressedNow: {type: 'noul', noul}}});

test('the decision judge turns one probability into 是/否 at the threshold', async () => {
  assert.equal((await createDecisionJudge({evaluate: decision(0.91), threshold: 0.5})({heard: '你重新说'})).toV, true);
  assert.equal((await createDecisionJudge({evaluate: decision(0.07), threshold: 0.5})({heard: '可以啊'})).probability, 0.07);
  assert.equal((await createDecisionJudge({evaluate: decision(0.07)})({heard: '可以啊'})).toV, false);
  assert.equal((await createDecisionJudge({evaluate: decision(0.5)})({heard: '嗯'})).toV, true, 'the threshold itself counts as 是');
});

test('a missing, invalid or aborted decision is no judgement', async () => {
  assert.equal((await createDecisionJudge({evaluate: async () => ({answers: {}})})({heard: '嗯'})).toV, null);
  assert.equal((await createDecisionJudge({evaluate: decision('high')})({heard: '嗯'})).toV, null);
  assert.equal((await createDecisionJudge({evaluate: async () => { throw Error('HTTP 500'); }})({heard: '嗯'})).toV, null);
  const stalled = createDecisionJudge({evaluate: (_s, _q, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('abort')))), timeoutMs: 20});
  // AbortSignal.timeout is unref'd, so keep the loop alive for it to fire.
  const [verdict] = await Promise.all([stalled({heard: '嗯'}), new Promise(resolve => setTimeout(resolve, 60))]);
  assert.equal(verdict.toV, null);
});

test('the decision judge sends the utterance, what V is saying around it and who spoke', () => {
  const state = floorDecisionState({said: '直角边是三和四', ahead: '斜边就是五', heard: '我也要我也要', recent: [{role: 'user', text: '讲讲勾股定理'}], speaker: '爸爸'});
  assert.equal(state.saidNow, '直角边是三和四');
  assert.equal(state.saidAhead, '斜边就是五');
  assert.equal(state.speaker, '爸爸');
  assert.equal(state.recent[0].role, '有人');
  assert.equal(floorDecisionState({heard: '嗯'}).speaker, null);
  const questions = floorDecisionQuestions();
  assert.equal(questions.addressedNow.type, 'noul');
  assert(questions.addressedNow.instructions.includes('没叫 V 的名字'));
  // A recognised line can join talk to several people: who it opens to is asked about, by meaning.
  assert(questions.addressedNow.instructions.includes('连成一句'));
  assert(questions.addressedNow.instructions.includes('冲谁开的口'));
});

test('the env judge is absent without the router key and can be turned off', async () => {
  assert.equal(floorJudgeFromEnv({}), null);
  assert.equal(floorJudgeFromEnv({OPENROUTER_API_KEY: 'x', VOICE_FLOOR_JUDGE: '0'}), null);
  const judge = floorJudgeFromEnv({OPENROUTER_API_KEY: 'x'}, {evaluate: decision(0.9)});
  assert.equal((await judge({heard: '你重新说'})).toV, true);
});
