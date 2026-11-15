import assert from 'node:assert/strict';
import test from 'node:test';
import {CUE_INSTRUCTIONS, clauses, cueQuote, cueTurns, numbered, refineCueOp} from './board-cue.mjs';
import {createBoardDirector} from './board-director.mjs';
import {normalizeOp, spokenProgress} from './board-scene.mjs';

const said = '电车和油车最大的区别在补能。电车在家充一晚就满，油车去加油站三分钟加满。但是，冬天冷的时候，Model 3 的续航会缩水一截。你平时主要是市区开吗？';

test('clauses cut at punctuation, keep every character, and join a short lead-in to what follows', () => {
  const parts = clauses(said);
  assert.equal(parts.join(''), said);
  assert.deepEqual(parts.slice(3, 5), ['但是，冬天冷的时候，', 'Model 3 的续航会缩水一截。']);
  assert.equal(numbered(parts.slice(0, 2)), '[0]电车和油车最大的区别在补能。[1]电车在家充一晚就满，');
});

test('the instructions ask for clause numbers and never for copied words', () => {
  assert.match(CUE_INSTRUCTIONS, /cue/u);
  assert.doesNotMatch(CUE_INSTRUCTIONS, /"q"/u);
  assert.match(CUE_INSTRUCTIONS, /cue -1|cue 写 -1/u);
});

test('a cue stands for the first words of its clause whose head occurs nowhere earlier', () => {
  // Clause 1 starts with 电车, already said in clause 0: the quote moves forward inside clause 1.
  const quote = cueQuote(said, 1);
  assert.ok(quote.length >= 4);
  const all = said.replace(/[\s，。！？]/gu, '').toLowerCase();
  assert.equal(all.indexOf(quote.slice(0, 4)), all.indexOf(quote));
  assert.ok(all.indexOf(quote) >= '电车和油车最大的区别在补能'.length);
  assert.equal(cueQuote(said, -1), '');
  assert.equal(cueQuote('', 0), '');
});

test('a put hangs every piece on the clause the model chose; cue -1 shows at once', () => {
  const raw = {op: 'put', block: {id: 'v', t: 'versus', cue: -1, sides: [{h: 'Model 3'}, {h: '卡罗拉'}],
    items: [{id: 'a', h: '补能', cells: ['慢充一晚', '三分钟'], cue: 1}, {id: 'b', h: '冬天', cells: ['缩水', '不变'], cue: 4}]}};
  const op = refineCueOp(normalizeOp(raw), {said, trigger: 'assistant_end', raw});
  assert.equal(op.block.q, undefined);
  const scene = {blocks: [op.block], marks: []};
  const ahead = index => spokenProgress(scene, said, index).ahead;
  assert.deepEqual(ahead(0), ['v/a', 'v/b']);
  const second = said.indexOf('电车在家');
  assert.ok(!ahead(second + 6).includes('v/a'));
  assert.ok(ahead(second + 6).includes('v/b'));
  assert.deepEqual(ahead(said.length), []);
});

test('marks and arrows hang by cue; focus is the voice’s, not the model’s', () => {
  const mark = {op: 'mark', id: 'v/a', kind: 'check', cue: 2};
  assert.ok(refineCueOp(normalizeOp({...mark, q: 'x'}), {said, trigger: 'assistant_end', raw: mark}).q);
  assert.equal(refineCueOp(normalizeOp({...mark, q: 'x'}), {said, trigger: 'user', raw: mark}), null);
  const flow = {op: 'put', block: {id: 'f', t: 'flow', nodes: [{id: 'a', label: '电车', cue: 0}, {id: 'b', label: '油车', cue: 2}], edges: [['a', 'b', '对比', 2]]}};
  const op = refineCueOp(normalizeOp(flow), {said, trigger: 'assistant_end', raw: flow});
  assert.equal(op.block.edges[0].length, 4);
  assert.equal(refineCueOp({op: 'focus', id: 'v/a'}, {said, raw: {op: 'focus', id: 'v/a', cue: 1}}), null);
  // Before V speaks: a print and nothing else.
  const photo = {op: 'put', block: {id: 'p', t: 'photo', query: '故宫', cue: -1}};
  assert.equal(refineCueOp(normalizeOp(photo), {said: '', trigger: 'user', raw: photo}).block.t, 'photo');
  assert.equal(refineCueOp(normalizeOp(flow), {said: '', trigger: 'user', raw: flow}), null);
});

test('the director numbers V’s words for the model and marks its pages as cue pages', async () => {
  let asked = '';
  const complete = async function* ({messages}) {
    asked = messages[1].content;
    yield '{"op":"scene","title":"电车和油车"}\n{"op":"put","block":{"id":"v","t":"versus","cue":-1,"sides":[{"h":"Model 3"},{"h":"卡罗拉"}],"items":[{"id":"a","h":"补能","cells":["一晚","三分钟"],"cue":1}]}}\n';
  };
  const director = createBoardDirector({complete, stream: {instructions: CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
  await director.run({owner: 'o', trigger: 'assistant_end', turns: [{role: 'user', text: '电车和油车有什么区别'}, {role: 'assistant', text: said}]});
  assert.match(asked, /\[0\]电车和油车最大的区别在补能。\[1\]/u);
  const scene = director.scene('o');
  assert.equal(scene.cue, true);
  assert.ok(scene.blocks[0].items[0].q);
});

test('the line under a phone page is the sentence V is saying, or the question until V\'s voice reaches the reply', async () => {
  const {boardNowLine} = await import('./board-client.mjs');
  const rows = [{key: 'u', role: 'user', text: '故宫怎么逛？'}];
  assert.deepEqual(boardNowLine(rows, null), {who: 'user', text: '故宫怎么逛？'});
  rows.push({key: 'b', role: 'assistant', text: '从午门进去。抬头看铜狮子。最后从神武门出去。'});
  // The text is here, the voice is not: nothing of it is shown yet (11/15: two sentences showed whole).
  assert.deepEqual(boardNowLine(rows, null), {who: 'user', text: '故宫怎么逛？'});
  assert.deepEqual(boardNowLine(rows, {reply: 'a-older', said: 3}), {who: 'user', text: '故宫怎么逛？'});
  assert.equal(boardNowLine(rows, {reply: 'b', said: 0}).text, '从午门进去。');
  assert.equal(boardNowLine(rows, {reply: 'b', said: 8}).text, '抬头看铜狮子。');
  assert.equal(boardNowLine(rows, {reply: 'b', said: 99}).text, '最后从神武门出去。');
  // The voice stopped: the line stays where it was.
  assert.equal(boardNowLine(rows, null, {reply: 'b', said: 8}).text, '抬头看铜狮子。');
  // A long sentence is shown a clause at a time, cut at its semicolons.
  rows.push({key: 'u2', role: 'user', text: '我爸身体怎么样？'}, {key: 'c', role: 'assistant', text: '他69岁，做过搭桥；现在在康复里；体重125斤。不过以复查为准。'});
  assert.equal(boardNowLine(rows, {reply: 'c', said: 12}).text, '现在在康复里；');
});

test('the cue writer is told to picture things that can be seen and to tell every listed thing', async () => {
  const {CUE_SCRIPT_INSTRUCTIONS} = await import('./board-cue.mjs');
  assert.match(CUE_SCRIPT_INSTRUCTIONS, /list 带图/u);
  assert.match(CUE_INSTRUCTIONS, /看得见的东西用照片/u);
});
