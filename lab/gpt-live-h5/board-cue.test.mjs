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
  // And one of more than two lines, at its commas.
  rows.push({key: 'u3', role: 'user', text: '跑步和游泳哪个更减肥？'}, {key: 'd', role: 'assistant', text: '同等心率下游泳消耗热量略高，水的阻力和散热会多烧能量，还能护关节，特别适合大体重、膝盖不好的人。'});
  const pieces = [0, 20, 40].map(said => boardNowLine(rows, {reply: 'd', said}).text);
  assert.ok(pieces.every(piece => Array.from(piece).length <= 30), pieces.join(' | '));
  assert.equal(pieces.join(''), '同等心率下游泳消耗热量略高，水的阻力和散热会多烧能量，还能护关节，特别适合大体重、膝盖不好的人。');
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

test('with onLines each line of the script is handed over once, as soon as it is written, and the lesson is what was handed over', async () => {
  const {createLessonWriter} = await import('./board-lesson.mjs');
  const text = JSON.stringify({title: '电车和油车', lines: [{say: '电车在家充一晚就满。', show: 'versus：电车/油车'}, {say: '油车三分钟加满。', show: '加一行 补能'}, {say: '你平时市区开吗？', show: ''}]});
  const handed = [], records = [];
  let wrote = 0;
  const complete = async function* () { for (const piece of text.match(/[\s\S]{1,7}/gu)) { wrote += piece.length; yield piece; await new Promise(resolve => setTimeout(resolve, 1)); } };
  const director = {streams: true, expect() {}, note() {}};
  const writer = createLessonWriter({complete, director, record: event => records.push(event), early: 2});
  const made = await writer.prepare({owner: 'o', topic: '电车和油车', onLines: lines => handed.push({lines, at: wrote})});
  assert.deepEqual(handed.flatMap(item => item.lines), ['电车在家充一晚就满。', '油车三分钟加满。', '你平时市区开吗？']);
  assert.ok(handed[0].at < text.indexOf('油车三分钟'), 'the first line before the second is written');
  assert.deepEqual(made.sentences, ['电车在家充一晚就满。', '油车三分钟加满。', '你平时市区开吗？']);
  assert.equal(records.find(event => event.type === 'board.lesson').streamed, 3);
});

test('a reply cut short after two lines were handed over is not written again: what was spoken stands', async () => {
  const {createLessonWriter} = await import('./board-lesson.mjs');
  const text = JSON.stringify({title: '灯塔', lines: [{say: '灯塔每晚把光扫过海面。', show: 'photo：灯塔'}, {say: '船看到光就知道离岸多远。', show: ''}]}).slice(0, -2);
  let calls = 0;
  const complete = async function* () { calls++; yield text; };
  const writer = createLessonWriter({complete, director: {streams: true, expect() {}, note() {}}, early: 2});
  const made = await writer.prepare({owner: 'o', topic: '灯塔', onLines: () => {}});
  assert.equal(calls, 1);
  assert.deepEqual(made.sentences, ['灯塔每晚把光扫过海面。', '船看到光就知道离岸多远。']);
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

test('a request to see pictures is a gallery: a list of real pictures, each with its own search; never a lesson on where to find them', async () => {
  const {CUE_SCRIPT_INSTRUCTIONS} = await import('./board-cue.mjs');
  const {LESSON_TOOL, LESSON_ROUTING} = await import('../realtime-direct-tools/tools.mjs');
  assert.match(CUE_INSTRUCTIONS, /"look":"gallery"/u);
  assert.match(CUE_SCRIPT_INSTRUCTIONS, /不是教他去哪里找图/u);
  assert.match(LESSON_TOOL.description, /找图/u);
  assert.match(LESSON_ROUTING, /不要交给 delegate_to_v/u);
  assert.match(LESSON_ROUTING, /没有真的调用工具，就不要说“我去找”/u);
  const gallery = normalizeOp({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [
    {id: 'a', h: '雨夜剑客', img: '影之刃零 雨夜剑客 战斗截图', cue: 0}, {id: 'b', h: 'Boss 战', img: '影之刃零 Boss战 截图', cue: 1}]}});
  assert.equal(gallery.block.look, 'gallery');
  // Without pictures it is an ordinary list.
  assert.equal(normalizeOp({op: 'put', block: {id: 'l', t: 'list', look: 'gallery', items: [{id: 'a', h: '一'}, {id: 'b', h: '二'}]}}).block.look, undefined);
});

test('before V has spoken: a print; a page of pictures only where V explains in its own words, names and photographs alone', () => {
  const refine = (block, options) => refineCueOp(normalizeOp({op: 'put', block}), {trigger: 'user', raw: {op: 'put', block}, ...options});
  const gallery = {id: 'g', t: 'list', look: 'gallery', items: [
    {id: 'a', h: '钟楼', img: '老城 钟楼', d: '建于某年', cue: 0, mark: 'star'}, {id: 'b', h: '石桥', img: '老城 石桥'}, {id: 'c', h: '半天走完'},
    {id: 'd', h: '码头', img: '老城 码头'}, {id: 'e', h: '集市', img: '老城 集市'}, {id: 'f', h: '城墙', img: '老城 城墙'}]};
  // (A script may be on its way, with a page of its own: nothing but the print, as before.)
  assert.equal(refine(gallery), null);
  assert.deepEqual(refine({id: 'p', t: 'photo', query: '老城', cue: -1}).block, {id: 'p', t: 'photo', query: '老城'});
  const opening = refine(gallery, {unscripted: true}).block;
  assert.equal(opening.look, 'gallery');
  assert.deepEqual(opening.items, [{id: 'a', h: '钟楼', img: '老城 钟楼'}, {id: 'b', h: '石桥', img: '老城 石桥'}, {id: 'd', h: '码头', img: '老城 码头'}, {id: 'e', h: '集市', img: '老城 集市'}], 'four at most; no notes, marks or cues; nothing without a picture');
  // A list of words, or a single picture, is not a page of pictures; nor is any other block.
  assert.equal(refine({id: 'l', t: 'list', items: [{id: 'a', h: '钟楼', img: '老城 钟楼'}, {id: 'b', h: '石桥', img: '老城 石桥'}]}, {unscripted: true}), null);
  assert.equal(refine({id: 'g', t: 'list', look: 'gallery', items: [{id: 'a', h: '钟楼', img: '老城 钟楼'}, {id: 'b', h: '石桥'}]}, {unscripted: true}), null);
  assert.equal(refine({id: 's', t: 'steps', items: [{id: 'a', h: '先到钟楼'}]}, {unscripted: true}), null);
});

test('the illustrator is told to judge what an answer is about: pictures for a set of things one can see, diagrams for what cannot be seen', async () => {
  const {CANVAS_CUE_INSTRUCTIONS} = await import('./board-cue.mjs');
  for (const text of [CUE_INSTRUCTIONS, CANVAS_CUE_INSTRUCTIONS]) {
    const at = text.indexOf('# 先看题材');
    assert.ok(at > text.indexOf('# 画面怎么跟着声音走') && at < text.indexOf('\n输出：每行一个 JSON 操作'));
    assert.equal(text.split('# 先看题材').length, 2);
  }
  assert.match(CUE_INSTRUCTIONS, /有 notes 时跳过这一节/u, 'a script\'s page follows its author\'s notes, as before');
  assert.match(CUE_INSTRUCTIONS, /整页不放照片/u);
  assert.match(CUE_INSTRUCTIONS, /加起来最多 6 张/u);
  assert.match(CUE_INSTRUCTIONS, /"unscripted":true/u);
});
