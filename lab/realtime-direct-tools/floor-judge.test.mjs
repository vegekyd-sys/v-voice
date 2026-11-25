import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFloorJudge,floorJudgeMessages,FLOOR_JUDGE_INSTRUCTIONS} from './floor-judge.mjs';

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
