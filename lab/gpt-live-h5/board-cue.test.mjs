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

test('the line under a phone page is the sentence V is saying, or the question before V answers', async () => {
  const {boardNowLine} = await import('./board-client.mjs');
  const rows = [{key: 'u', role: 'user', text: '故宫怎么逛？'}];
  assert.deepEqual(boardNowLine(rows, null), {who: 'user', text: '故宫怎么逛？'});
  rows.push({key: 'a', role: 'assistant', text: '好，我整理下。'});
  assert.deepEqual(boardNowLine(rows, null), {who: 'v', text: '好，我整理下。'});
  rows.push({key: 'b', role: 'assistant', text: '从午门进去。抬头看铜狮子。最后从神武门出去。'});
  assert.equal(boardNowLine(rows, {reply: 'b', said: 0}).text, '从午门进去。');
  assert.equal(boardNowLine(rows, {reply: 'b', said: 8}).text, '抬头看铜狮子。');
  assert.equal(boardNowLine(rows, {reply: 'b', said: 99}).text, '最后从神武门出去。');
  // Not followed (no audio cursor for this reply): its last sentence, not the whole reply.
  assert.equal(boardNowLine(rows, null).text, '最后从神武门出去。');
});

test('the cue writer is told to picture things that can be seen and to tell every listed thing', async () => {
  const {CUE_SCRIPT_INSTRUCTIONS} = await import('./board-cue.mjs');
  assert.match(CUE_SCRIPT_INSTRUCTIONS, /list 带图/u);
  assert.match(CUE_INSTRUCTIONS, /看得见的东西用照片/u);
});

test('the cue writer writes a line at a time; a script still being written is read line by line', async () => {
  const {CUE_SCRIPT_INSTRUCTIONS} = await import('./board-cue.mjs');
  const {partialScript, parseScript} = await import('./board-lesson.mjs');
  assert.match(CUE_SCRIPT_INSTRUCTIONS, /"lines":\[\{"say"/u);
  const full = JSON.stringify({title: '欧洲城市', lines: [{say: '先看布拉格，桥上有三十尊雕像。', show: 'list 带图：布拉格'}, {say: '再说威尼斯，"水城"。', show: 'list 加一项 威尼斯'}, {say: '你想去哪座？', show: ''}]});
  assert.equal(partialScript(full.slice(0, 10)), null);
  assert.deepEqual(partialScript(full.slice(0, full.indexOf('再说'))).say, ['先看布拉格，桥上有三十尊雕像。']);
  // (A line counts once its note is complete too.)
  assert.equal(partialScript(full.slice(0, full.indexOf('加一项'))).say.length, 1);
  assert.deepEqual(partialScript(full.slice(0, full.indexOf('你想'))).show, ['list 带图：布拉格', 'list 加一项 威尼斯']);
  assert.deepEqual(parseScript(full).say.length, 3);
});

test('the writer hands its first lines to the illustrator while it is still writing (early)', async () => {
  const {createLessonWriter} = await import('./board-lesson.mjs');
  const text = JSON.stringify({title: '电车和油车', lines: [{say: '电车在家充一晚就满。', show: 'versus：电车/油车'}, {say: '油车三分钟加满。', show: '加一行 补能'}, {say: '冬天电车续航缩水。', show: '加一行 冬天'}, {say: '你平时市区开吗？', show: ''}]});
  const notes = [], records = [];
  let wrote = 0;
  const complete = async function* () { for (const piece of text.match(/[\s\S]{1,9}/gu)) { wrote += piece.length; yield piece; await new Promise(resolve => setTimeout(resolve, 1)); } };
  const director = {streams: true, expect() {}, note(owner, value) { notes.push({...value, at: wrote}); }};
  const writer = createLessonWriter({complete, director, record: event => records.push(event), early: 2});
  const made = await writer.prepare({owner: 'o', topic: '电车和油车', ask: '电车和油车有什么区别'});
  assert.equal(made.sentences.length, 4);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].partial, true);
  assert.deepEqual(notes[0].lines.map(line => line.say), ['电车在家充一晚就满。', '油车三分钟加满。']);
  assert.ok(notes[0].at < text.length, 'before the script was finished');
  assert.equal(notes[1].partial, undefined);
  assert.equal(notes[1].lines.length, 4);
  const lesson = records.find(event => event.type === 'board.lesson');
  assert.equal(lesson.earlyKept, true);
  assert.ok(Number.isFinite(lesson.earlyMs));
});

test('a script\'s first lines and then the whole script are drawn one after the other on one page; a screen that joined sees both', async () => {
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const complete = async function* ({messages}) {
    const request = JSON.parse(messages[1].content);
    requests.push(request.trigger);
    if (requests.length === 1) {
      yield '{"op":"scene","title":"电车和油车","cue":-1}\n';
      await gate;
      yield '{"op":"put","block":{"id":"v","t":"versus","cue":-1,"sides":[{"h":"电车"},{"h":"油车"}],"items":[{"id":"a","h":"补能","cells":["一晚","三分钟"],"cue":0}]}}\n';
    } else yield '{"op":"put","block":{"id":"v","t":"versus","cue":-1,"sides":[{"h":"电车"},{"h":"油车"}],"items":[{"id":"a","h":"补能","cells":["一晚","三分钟"],"cue":0},{"id":"b","h":"冬天","cells":["缩水","不变"],"cue":2}]}}\n';
  };
  const director = createBoardDirector({complete, stream: {instructions: CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
  const first = '电车在家充一晚就满。油车三分钟加满。', whole = first + '冬天电车续航缩水。你平时市区开吗？';
  director.note('o', {title: '电车和油车', ask: '电车和油车', script: first, lines: [], partial: true});
  await new Promise(resolve => setTimeout(resolve, 5));
  director.note('o', {title: '电车和油车', ask: '电车和油车', script: whole, lines: []});
  const seen = [];
  const joined = director.run({owner: 'o', trigger: 'assistant_end', turns: [{role: 'assistant', text: whole}], onOp: op => seen.push(op)});
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(requests, ['assistant_progress'], 'the whole script waits for the first lines\' run');
  release();
  assert.equal((await joined).reason, 'joined');
  assert.deepEqual(requests, ['assistant_progress', 'assistant_end']);
  assert.deepEqual(director.scene('o').blocks[0].items.map(item => item.id), ['a', 'b']);
  assert.ok(seen.some(op => op.scene?.blocks?.[0]?.items?.length === 2), 'the joined screen got the whole script\'s piece');
});
