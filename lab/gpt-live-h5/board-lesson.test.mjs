import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoardDirector} from './board-director.mjs';
import {LESSON_INSTRUCTIONS, createLessonWriter, parseLesson, settleLesson} from './board-lesson.mjs';
import {applyOp, emptyScene, spokenProgress} from './board-scene.mjs';

const reply = JSON.stringify({title: '谁打得过谁', say: ['这就像石头剪刀布。', '杰尼龟喷水，浇灭小火龙的火。', '小火龙吐火，烧掉妙蛙种子的叶子。', '听懂了吗？'],
  blocks: [{id: 'f', t: 'flow', nodes: [{id: 'w', label: '杰尼龟', img: '杰尼龟', q: '杰尼龟喷水'}, {id: 'h', label: '小火龙', img: '小火龙', q: '小火龙吐火'}, {id: 'g', label: '妙蛙种子', img: '妙蛙种子', q: '烧掉妙蛙种子'}], edges: [['w', 'h'], ['h', 'g'], ['g', 'w']]},
    {id: 'n', t: 'sticky', text: '像石头剪刀布', q: '这就像石头'}, {id: 'x', t: 'html', text: '<script>'}]});

test('a lesson is one reply: the script and the picture each sentence brings', () => {
  const lesson = parseLesson('```json\n' + reply + '\n```');
  assert.equal(lesson.say.length, 4);
  assert.deepEqual(lesson.ops.map(op => op.op + (op.block?.t ?? '')), ['scene', 'putflow', 'putsticky']);
  assert.equal(lesson.ops[0].lesson, true);
  assert.equal(lesson.ops[2].block.q, '这就像石头剪刀布', 'a whole block hangs on a sentence too');
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
  assert.deepEqual(spokenProgress(scene, script.say, 0).ahead, ['n', 'f/w', 'f/h', 'f/g', 'f/w>h', 'f/h>g', 'f/g>w']);
  // 杰尼龟 has been named; 小火龙 (later in the same sentence) has not, nor has any arrow's far end.
  assert.deepEqual(spokenProgress(scene, script.say, 14), {focus: 'f/w', ahead: ['f/h', 'f/g', 'f/w>h', 'f/h>g', 'f/g>w']});
  assert.deepEqual(spokenProgress(scene, script.say, 22).ahead, ['f/g', 'f/h>g', 'f/g>w'], 'each thing appears as its name is said, and an arrow once both ends are there');
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

// The lesson Tianyi's five-year-old was given on 2026-11-12, as the model wrote it.
const asWritten = {title: '宝可梦属性相克', say: ['十二，我们来玩一个小游戏，猜猜谁能打赢谁。', '宝可梦分好多种属性，就像不同颜色的小朋友。', '水属性的杰尼龟喷水，火属性的小火龙会怕水，水就能把火浇灭。', '草属性的妙蛙种子怕火，火一烧叶子就蔫了。', '可是妙蛙种子不怕杰尼龟，草会把水喝光。', '你来猜一猜，皮卡丘是电属性，碰上杰尼龟谁会赢呀？', '听懂了吗？你想不想再猜一次？'],
  blocks: [{id: 'b1', t: 'flow', nodes: [{id: 'n1', label: '水', sub: '喷水的杰尼龟', q: '杰尼龟喷水', img: '杰尼龟'}, {id: 'n2', label: '火', sub: '小火龙', q: '草属性的妙蛙种子', img: '小火龙'}, {id: 'n3', label: '草', sub: '妙蛙种子', q: '草属性的妙蛙种子怕火', img: '妙蛙种子'}], edges: [['n1', 'n2', '水克火'], ['n2', 'n3', '火克草'], ['n3', 'n1', '草克水']]},
    {id: 'b2', t: 'sticky', text: '水火草，转圈圈', q: '听懂了吗'}]};

test('a picture hangs on where the script names each thing, whatever the model claimed', () => {
  const lesson = parseLesson(JSON.stringify(asWritten));
  assert.equal(lesson.say.length, 6, 'one closing question, not two');
  const [flow, sticky] = lesson.ops.filter(op => op.op === 'put').map(op => op.block);
  // The thing the script names is the heading; its category is the small print.
  assert.deepEqual(flow.nodes.map(node => [node.label, node.sub]), [['杰尼龟', '水'], ['小火龙', '火'], ['妙蛙种子', '草']]);
  // 小火龙 was hung on the sentence about 妙蛙种子; it now hangs on its own name.
  assert.deepEqual(flow.nodes.map(node => node.q), ['杰尼龟喷水火属性', '小火龙会怕水水就', '妙蛙种子怕火火一']);
  // Each arrow waits for the words that state it: grass beats water is said a sentence after both are on the page.
  // (The first arrow has no words of its own after its far end: it comes with 小火龙.)
  assert.deepEqual(flow.edges.map(edge => edge[3]), [undefined, '火火一烧叶子就蔫', '杰尼龟草会把水喝']);
  assert.equal(sticky.q, '你来猜一猜皮卡丘', 'a quote that is gone falls back to the last sentence');
  const scene = lesson.ops.reduce(applyOp, emptyScene()), said = lesson.say.join('');
  const upTo = words => spokenProgress(scene, said, said.indexOf(words) + words.length).ahead;
  assert.deepEqual(upTo('十二，我们'), ['b2', 'b1/n1', 'b1/n2', 'b1/n3', 'b1/n1>n2', 'b1/n2>n3', 'b1/n3>n1']);
  assert.deepEqual(upTo('火属性的小火龙会'), ['b2', 'b1/n3', 'b1/n2>n3', 'b1/n3>n1']);
  assert.deepEqual(upTo('草属性的妙蛙种子'), ['b2', 'b1/n2>n3', 'b1/n3>n1']);
  assert.deepEqual(upTo('妙蛙种子怕火，火一烧'), ['b2', 'b1/n3>n1']);
  assert.deepEqual(upTo('不怕杰尼龟，草会'), ['b2']);
});

test('a lesson that needs no repair is left as written', () => {
  const lesson = {say: ['埃菲尔铁塔在巴黎。', '它有三百多米高。'], ops: [{op: 'scene', title: '铁塔', lesson: true},
    {op: 'put', block: {id: 'p', t: 'photo', query: '埃菲尔铁塔', q: '埃菲尔铁塔'}}, {op: 'put', block: {id: 'l', t: 'list', items: [{id: 'a', h: '三百多米', q: '它有三百多米'}, {id: 'b', h: '凯旋门', img: '巴黎凯旋门'}]}}]};
  const settled = settleLesson(lesson);
  assert.deepEqual(settled.say, lesson.say);
  assert.equal(settled.ops[1].block.q, '埃菲尔铁塔在巴黎');
  assert.deepEqual(settled.ops[2].block.items, [{id: 'a', h: '三百多米', q: '三百多米高'}, {id: 'b', h: '凯旋门', img: '巴黎凯旋门'}], 'named where it is said; a thing the script never names is not held back');
});

test('the writer is told the caller\'s words and what it said before, and the director waits from the start', async () => {
  const seen = [], events = [];
  const director = {hold: id => events.push('hold ' + id), release: id => events.push('release ' + id), present: id => events.push('present ' + id)};
  let good = true;
  const writer = createLessonWriter({director, complete: async function* ({messages}) { seen.push(JSON.parse(messages[1].content)); yield good ? reply : 'no'; }});
  await writer.prepare({owner: 'c', topic: '属性相克', audience: '5岁小朋友十二', ask: '你给十二讲解一下'});
  good = false;
  await writer.prepare({owner: 'c', topic: '用传说宝可梦再讲', ask: '用传说级的宝可梦来讲解'});
  assert.deepEqual(seen[0], {topic: '属性相克', audience: '5岁小朋友十二', ask: '你给十二讲解一下'});
  assert.equal(seen[1].before.title, '谁打得过谁');
  assert.match(seen[1].before.say, /^这就像石头剪刀布/u);
  assert.deepEqual(events, ['hold c', 'present c', 'hold c', 'release c']);
});
