import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoardDirector} from './board-director.mjs';
import {LESSON_INSTRUCTIONS, createLessonWriter, parseLesson} from './board-lesson.mjs';
import {spokenProgress} from './board-scene.mjs';

const reply = JSON.stringify({title: '谁打得过谁', say: ['这就像石头剪刀布。', '杰尼龟喷水，浇灭小火龙的火。', '小火龙吐火，烧掉妙蛙种子的叶子。', '听懂了吗？'],
  blocks: [{id: 'f', t: 'flow', nodes: [{id: 'w', label: '杰尼龟', img: '杰尼龟', q: '杰尼龟喷水'}, {id: 'h', label: '小火龙', img: '小火龙', q: '小火龙吐火'}, {id: 'g', label: '妙蛙种子', img: '妙蛙种子', q: '烧掉妙蛙种子'}], edges: [['w', 'h'], ['h', 'g'], ['g', 'w']]},
    {id: 'n', t: 'sticky', text: '像石头剪刀布', q: '这就像石头'}, {id: 'x', t: 'html', text: '<script>'}]});

test('a lesson is one reply: the script and the picture each sentence brings', () => {
  const lesson = parseLesson('```json\n' + reply + '\n```');
  assert.equal(lesson.say.length, 4);
  assert.deepEqual(lesson.ops.map(op => op.op + (op.block?.t ?? '')), ['scene', 'putflow', 'putsticky']);
  assert.equal(lesson.ops[0].lesson, true);
  assert.equal(lesson.ops[2].block.q, '这就像石头', 'a whole block hangs on a sentence too');
  for (const bad of ['', 'not json', '{"say":["只有一句"],"blocks":[]}', JSON.stringify({title: 'x', say: ['a', 'b'], blocks: []})]) assert.equal(parseLesson(bad), null);
  assert.match(LESSON_INSTRUCTIONS, /block\.t/u, 'the block vocabulary is the director\'s');
});

test('the lesson goes on the call\'s board, is held while V speaks it, and its pieces wait for their sentence', async () => {
  let time = 0, models = 0;
  const director = createBoardDirector({now: () => time, complete: async function* () { models++; yield '{"op":"scene","title":"别的"}\n{"op":"put","block":{"id":"z","t":"sticky","text":"导演画的"}}\n'; }});
  const writer = createLessonWriter({director, now: () => time, complete: async function* () { yield reply.slice(0, 80); yield reply.slice(80); }});
  const script = await writer.prepare({owner: 'call-1', topic: '宝可梦属性相克', audience: '5岁小朋友'});
  assert.equal(script.say, '这就像石头剪刀布。杰尼龟喷水，浇灭小火龙的火。小火龙吐火，烧掉妙蛙种子的叶子。听懂了吗？');
  const scene = director.scene('call-1');
  assert.deepEqual([scene.title, scene.lesson, scene.blocks.map(block => block.t)], ['谁打得过谁', true, ['flow', 'sticky']]);
  // The page asks as V starts speaking: it gets the prepared picture, and no model is called.
  const seen = [];
  const held = await director.run({owner: 'call-1', trigger: 'assistant_progress', turns: [{role: 'assistant', text: '这就像石头剪刀布。'}], clientRev: 0, onOp: op => seen.push(op.op)});
  assert.deepEqual([held.reason, seen, models], ['lesson', ['sync'], 0]);
  // Nothing is on the page before it is said.
  assert.deepEqual(spokenProgress(scene, script.say, 0).ahead, ['n', 'f/w', 'f/h', 'f/g']);
  assert.deepEqual(spokenProgress(scene, script.say, 14), {focus: 'f/w', ahead: ['f/h', 'f/g']});
  // After the script has been said the director draws again; so it does when the caller speaks during it.
  time += 60000;
  assert.equal((await director.run({owner: 'call-1', trigger: 'assistant_end', turns: [{role: 'assistant', text: 'x'}], clientRev: scene.rev})).reason, 'drawn');
  await writer.prepare({owner: 'call-2', topic: 't'});
  time += 5000;
  assert.equal((await director.run({owner: 'call-2', trigger: 'user', turns: [{role: 'user', text: '等一下'}], clientRev: 0})).reason, 'drawn');
});

test('an unusable reply writes no lesson and leaves the board alone', async () => {
  const director = createBoardDirector({complete: async function* () {}});
  const writer = createLessonWriter({director, complete: async function* () { yield '抱歉，我不会'; }});
  assert.equal(await writer.prepare({owner: 'call-1', topic: 'x'}), null);
  assert.equal(director.scene('call-1').rev, 0);
  assert.equal(createLessonWriter({}).available, false);
});
