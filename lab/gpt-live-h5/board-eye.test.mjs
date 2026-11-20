import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoardDirector} from './board-director.mjs';
import {CANVAS_CUE_INSTRUCTIONS, CANVAS_SCRIPT_INSTRUCTIONS, CUE_INSTRUCTIONS, cueTurns, refineCueOp} from './board-cue.mjs';
import {EYE_INSTRUCTIONS, lookAt} from './board-eye.mjs';
import {normalizeOp, scenePictures, spokenProgress} from './board-scene.mjs';

const said = '这就是超梦，是用梦幻的基因造出来的宝可梦。你看它脑袋后面，有一根管子连到后背。它的尾巴又粗又长，是紫色的。它最厉害的是念力。';
const stage = {id: 's', t: 'stage', base: 'photo', cue: -1, items: [{id: 'a', k: 'pic', img: '超梦 全身 官方立绘', h: '超梦', cue: -1}]};

test('a stage keeps its photographs, names and pins, and drops what does not hold together', () => {
  const op = normalizeOp({op: 'put', block: {id: 's', t: 'stage', base: 'row', items: [
    {id: 'a', k: 'pic', img: '卡罗拉 正面'}, {id: 'b', k: 'pic', img: 'Model 3 正面', q: '右边是特斯拉'},
    {id: 'n1', k: 'pin', on: 'a', box: [600, 700, 200, 500], h: '进气格栅', q: '这一大块进气格栅'},
    {id: 'n2', k: 'pin', on: 'z', box: [0, 0, 10, 10], h: '不在'}, {id: 'n3', k: 'pin', on: 'b', h: '没有框'},
    {k: 'chip', h: '只在球场', at: [100, 2000]}], edges: [['a', 'b', '对比'], ['a', 'n1', '指到圈']]}});
  assert.deepEqual(op.block.items.map(item => item.id), ['a', 'b', 'c1', 'n1']);
  assert.deepEqual(op.block.items.find(item => item.id === 'n1').box, [200, 500, 600, 700]);
  assert.deepEqual(op.block.items.find(item => item.k === 'chip').at, [100, 1000]);
  assert.deepEqual(op.block.edges, [['a', 'b', '对比']]);
  assert.deepEqual([...scenePictures({blocks: [op.block]})], ['卡罗拉 正面', 'Model 3 正面']);
  assert.equal(normalizeOp({op: 'put', block: {id: 's', t: 'stage', items: [{k: 'chip', h: '只有一个', at: [1, 1]}]}}), null);
  assert.equal(normalizeOp({op: 'put', block: {id: 's', t: 'stage', base: 'pitch', items: [{k: 'chip', h: '门将', at: [500, 950]}, {k: 'chip', h: '中卫', at: [500, 800]}]}}).block.base, 'pitch');
});

test('the voice reaches a pin by its words; a photograph without words of its own is up from the start', () => {
  const block = normalizeOp({op: 'put', block: {...stage, items: [...stage.items, {id: 'n1', k: 'pin', on: 'a', box: [600, 500, 800, 900], h: '尾巴', q: '它的尾巴又粗又长'}]}}).block;
  const scene = {blocks: [block]};
  const before = spokenProgress(scene, said, 10), after = spokenProgress(scene, said, said.indexOf('尾巴') + 2);
  assert.deepEqual([before.focus, before.ahead], ['', ['s/n1']]);
  assert.deepEqual([after.focus, after.ahead], ['s/n1', []]);
});

test('cues become words; before V speaks only the stage\'s photographs go up', () => {
  const raw = {op: 'put', block: {...stage, items: [...stage.items, {id: 'b', k: 'pic', img: '梦幻', h: '梦幻', cue: 0}]}};
  const spoken = refineCueOp(normalizeOp(raw), {said, trigger: 'assistant_end', raw});
  assert.equal(spoken.block.items[0].q, undefined);
  assert.ok(spoken.block.items[1].q.startsWith('这就是超梦'));
  const early = refineCueOp(normalizeOp(raw), {said: '', trigger: 'user', raw});
  assert.deepEqual(early.block.items.map(item => [item.id, item.q]), [['a', undefined], ['b', undefined]]);
});

test('the canvas instructions add the stage and keep everything the cue illustrator had', () => {
  assert.ok(CANVAS_CUE_INSTRUCTIONS.includes('# 画布 stage') && CANVAS_CUE_INSTRUCTIONS.includes('# 画面怎么跟着声音走'));
  assert.ok(CANVAS_CUE_INSTRUCTIONS.length > CUE_INSTRUCTIONS.length && CANVAS_SCRIPT_INSTRUCTIONS.includes('# 画布'));
  assert.ok(!/(^|[^A-Za-z])q([^A-Za-z]|$)/mu.test(CANVAS_CUE_INSTRUCTIONS.slice(CANVAS_CUE_INSTRUCTIONS.indexOf('# 画布 stage'), CANVAS_CUE_INSTRUCTIONS.indexOf('输出：每行一个 JSON 操作'))));
});

test('the eye sees each photograph, and only pins it can hang on a clause V says come back', async () => {
  let asked = null;
  const complete = async function* ({messages}) {
    asked = messages;
    yield '{"pins":[{"cue":3,"on":"a","where":"脑后","kind":"ring","box":[420,40,560,200],"label":"管子"},';
    yield '{"cue":4,"on":"a","kind":"ring","box":[600,500,800,900],"label":"尾巴"},{"cue":4,"on":"a","box":[1,1,2,2],"label":"重复"},{"cue":99,"on":"a","box":[1,1,2,2]},{"cue":1,"on":"x","box":[1,1,2,2]}]}';
  };
  const pins = await lookAt({complete, said, shots: [{id: 'a', h: '超梦', img: '超梦', bytes: Buffer.from('jpeg'), type: 'image/jpeg'}]});
  assert.equal(asked[0].content, EYE_INSTRUCTIONS);
  assert.deepEqual(asked[1].content.map(part => part.type), ['text', 'image_url', 'text']);
  assert.ok(asked[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.ok(asked[1].content[2].text.includes('[4]它的尾巴又粗又长'));
  assert.deepEqual(pins.map(pin => [pin.h, pin.on]), [['管子', 'a'], ['尾巴', 'a']]);
  assert.ok(pins[1].q.startsWith('它的尾巴'));
});

test('a streamed page with a stage gets its pins once the photographs are seen; written again it keeps them', async () => {
  const pages = [[{op: 'scene', title: '超梦长什么样'}, {op: 'put', block: stage}, {op: 'put', block: {id: 'l', t: 'list', h: '特点', cue: 4, items: [{id: 'x', h: '念力最强', cue: 4}]}}],
    [{op: 'put', block: {...stage, id: 's2'}}]];
  let runs = 0;
  const complete = async function* () { yield pages[runs++].map(op => JSON.stringify(op)).join('\n') + '\n'; };
  const looked = [];
  const eye = {find: async query => ({bytes: Buffer.from(query), type: 'image/png'}),
    see: async ({shots, said: words}) => { looked.push([shots.map(shot => shot.id), words.length]); return [{id: 'n1', k: 'pin', on: 'a', box: [600, 500, 800, 900], kind: 'ring', h: '尾巴', q: '它的尾巴又粗又长'}]; }};
  const director = createBoardDirector({complete, eye, stream: {instructions: CANVAS_CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
  const seen = [];
  const first = await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '超梦长什么样'}, {role: 'assistant', text: said}], onOp: op => seen.push(op)});
  assert.deepEqual([first.reason, first.eye.pins, looked.length], ['drawn', 1, 1]);
  const pinnedStage = () => director.scene('c').blocks.find(block => block.t === 'stage');
  assert.deepEqual(pinnedStage().items.map(item => item.k), ['pic', 'pin']);
  assert.equal(seen.at(-1).scene.blocks[0].items.at(-1).h, '尾巴');
  // The same answer drawn again (under another id): the same stage, its pin kept, the photographs not looked at twice.
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '超梦长什么样'}, {role: 'assistant', text: said}]});
  assert.deepEqual([director.scene('c').blocks.filter(block => block.t === 'stage').length, pinnedStage().id, pinnedStage().items.map(item => item.k), looked.length], [1, 's', ['pic', 'pin'], 1]);
});

test('a stage takes the place of the print put up while the caller was asking', async () => {
  const pages = [[{op: 'scene', title: '超梦'}, {op: 'put', block: {id: 'p', t: 'photo', query: '超梦', cue: -1}}], [{op: 'put', block: stage}]];
  let runs = 0;
  const complete = async function* () { yield pages[runs++].map(op => JSON.stringify(op)).join('\n') + '\n'; };
  const director = createBoardDirector({complete, stream: {instructions: CANVAS_CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
  await director.run({owner: 'c', trigger: 'user', turns: [{role: 'user', text: '超梦长什么样'}]});
  assert.deepEqual(director.scene('c').blocks.map(block => block.t), ['photo']);
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '超梦长什么样'}, {role: 'assistant', text: said}]});
  assert.deepEqual(director.scene('c').blocks.map(block => block.t), ['stage']);
});

test('beside a stage the other blocks are words: no second set of pictures, no sketch', async () => {
  const cars = {id: 's', t: 'stage', base: 'row', items: [{id: 'a', k: 'pic', img: 'Model 3', cue: -1}, {id: 'b', k: 'pic', img: '卡罗拉', cue: -1}]};
  const versus = {id: 'v', t: 'versus', sides: [{h: '电车', img: 'Model 3'}, {h: '油车', img: '卡罗拉'}], items: [{id: 'r', h: '格栅', cells: ['没有', '有'], cue: 2}]};
  const draw = {id: 'd', t: 'draw', items: [{id: 'x', k: 'rect', p: [10, 10, 20, 20], cue: 3}]};
  const pages = [[{op: 'scene', title: '电车油车'}, {op: 'put', block: versus}, {op: 'put', block: cars}, {op: 'put', block: draw}]];
  const complete = async function* () { yield pages.shift().map(op => JSON.stringify(op)).join('\n') + '\n'; };
  const director = createBoardDirector({complete, stream: {instructions: CANVAS_CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '电车和油车外观有什么区别'}, {role: 'assistant', text: '左边是电车 Model 3，右边是油车卡罗拉。电车车头没有格栅，油车有。再看车尾，电车没有排气管。'}]});
  const scene = director.scene('c');
  assert.deepEqual(scene.blocks.map(block => block.t), ['versus', 'stage']);
  assert.deepEqual(scene.blocks[0].sides.map(side => side.img), [undefined, undefined]);
});

test('with the canvas on, a print becomes a canvas of one photograph and is looked at', async () => {
  const pages = [[{op: 'scene', title: '太和殿'}, {op: 'put', block: {id: 'p', t: 'photo', query: '太和殿 正面', caption: '太和殿', cue: -1}}]];
  const complete = async function* () { yield pages.shift().map(op => JSON.stringify(op)).join('\n') + '\n'; };
  let looked = 0;
  const eye = {find: async () => ({bytes: Buffer.from('x'), type: 'image/jpeg'}), see: async () => { looked++; return []; }};
  const director = createBoardDirector({complete, eye, stream: {instructions: CANVAS_CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '太和殿有什么好看的'}, {role: 'assistant', text: '这是太和殿，故宫里最大的一座殿。它的屋顶有两层，叫重檐庑殿顶。'}]});
  const [stage] = director.scene('c').blocks;
  assert.deepEqual([stage.t, stage.base, stage.items[0].img, stage.items[0].h, looked], ['stage', 'photo', '太和殿 正面', '太和殿', 1]);
});
