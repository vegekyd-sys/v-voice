import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoardDirector} from './board-director.mjs';
import {CANVAS_CUE_INSTRUCTIONS, CANVAS_SCRIPT_INSTRUCTIONS, CUE_INSTRUCTIONS, clauseOf, cueTurns, refineCueOp} from './board-cue.mjs';
import {EYE_INSTRUCTIONS, lookAt} from './board-eye.mjs';
import {applyOp, emptyScene, heroPhoto, normalizeOp, normalizeScene, pictureSubjects, spokenProgress} from './board-scene.mjs';

const said = '这就是超梦，是用梦幻的基因造出来的宝可梦。你看它脑袋后面，有一根管子连到后背。它的尾巴又粗又长，是紫色的。它最厉害的是念力。';
const stream = {instructions: CANVAS_CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true, canvas: true};
const lines = (...ops) => ops.map(op => JSON.stringify(op)).join('\n') + '\n';
const page = (...blocks) => blocks.reduce((scene, block) => applyOp(scene, normalizeOp({op: 'put', block})), emptyScene());

test('places are pinned on a picture of the page, in place of those it had; a scene carries them', () => {
  let scene = page({id: 'l', t: 'list', items: [{id: 'a', h: '翠玉白菜', img: '白菜', q: '先看翠玉白菜'}, {id: 'b', h: '肉形石', img: '肉形石', q: '再看肉形石'}]});
  const pin = normalizeOp({op: 'pin', img: '白菜', items: [{box: [600, 700, 200, 500], label: '小虫', q: '菜叶上停着两只'}, {box: [1, 2], q: '没有框'}, {box: [1, 2, 3, 4]}]});
  assert.deepEqual(pin.items, [{box: [200, 500, 600, 700], kind: 'ring', q: '菜叶上停着两只', h: '小虫'}]);
  scene = applyOp(scene, pin);
  scene = applyOp(scene, normalizeOp({op: 'pin', img: '肉形石', items: [{box: [0, 0, 500, 500], kind: 'point', q: '一层层的纹路'}]}));
  assert.deepEqual(scene.pins.map(item => [item.img, item.kind]), [['白菜', 'ring'], ['肉形石', 'point']]);
  assert.equal(applyOp(scene, pin), scene);
  scene = applyOp(scene, normalizeOp({op: 'pin', img: '白菜', items: []}));
  assert.deepEqual(scene.pins.map(item => item.img), ['肉形石']);
  // What reaches the page: the pins of pictures that are on it, and the canvas's flag.
  const sent = normalizeScene({...scene, canvas: true, pins: [...scene.pins, {img: '不在页面上', box: [1, 1, 2, 2], q: '别的'}]});
  assert.deepEqual([sent.canvas, sent.pins.map(item => item.img)], [true, ['肉形石']]);
});

test('while V is on a place, the mark is on what its picture belongs to, and the place is named', () => {
  let scene = page({id: 'l', t: 'list', items: [{id: 'a', h: '翠玉白菜', img: '白菜', q: '先看翠玉白菜'}, {id: 'b', h: '肉形石', img: '肉形石', q: '再看肉形石'}]});
  scene = applyOp(scene, normalizeOp({op: 'pin', img: '白菜', items: [{box: [1, 2, 300, 400], label: '小虫', q: '菜叶上停着两只'}]}));
  const words = '先看翠玉白菜，它只有十八厘米高。菜叶上停着两只小虫。再看肉形石，像一块红烧肉。';
  const at = text => spokenProgress(scene, words, words.indexOf(text) + text.length);
  assert.deepEqual(at('先看翠玉'), {focus: 'l/a', ahead: ['l/b', 'pin:0'], pin: -1});
  assert.deepEqual(at('菜叶上停'), {focus: 'l/a', ahead: ['l/b'], pin: 0});
  assert.deepEqual(at('再看肉形'), {focus: 'l/b', ahead: [], pin: -1});
});

test('the pictures the eye looks at: the page\'s only print, a list\'s, and the two of a comparison together', () => {
  const print = {id: 'p', t: 'photo', query: '超梦 全身', caption: '超梦'};
  const only = page(print, {id: 'l', t: 'list', items: [{id: 'x', h: '念力最强'}]});
  assert.equal(heroPhoto(only)?.id, 'p');
  assert.deepEqual(pictureSubjects(only), [{img: '超梦 全身', name: '超梦', q: ''}]);
  const mixed = page(print, {id: 'l', t: 'steps', items: [{id: 'a', h: '太和殿', img: '太和殿', q: '最前面是太和殿'}, {id: 'b', h: '东六宫'}]},
    {id: 'v', t: 'versus', sides: [{h: '油车', img: '卡罗拉'}, {h: '电车', img: 'Model 3'}], items: [{id: 'r', h: '车头', cells: ['格栅', '封闭']}]},
    {id: 't', t: 'timeline', items: [{id: 'm', when: '1406', h: '开工', img: '午门'}, {id: 'n', when: '1420', h: '建成'}]});
  assert.equal(heroPhoto(mixed), null);
  assert.deepEqual(pictureSubjects(mixed), [{img: '太和殿', name: '太和殿', q: '最前面是太和殿'}, {img: '卡罗拉', name: '油车', q: '', group: 'v'}, {img: 'Model 3', name: '电车', q: '', group: 'v'}]);
});

test('a pitch is names placed where they stand; before V speaks nothing of it goes up', () => {
  const raw = {op: 'put', block: {id: 's', t: 'stage', cue: 0, items: [{id: 'gk', h: '门将', at: [500, 2000], cue: 0}, {id: 'cb', h: '中卫', at: [400, 800], cue: 1}, {h: '没有位置'}], edges: [['gk', 'cb', '传'], ['gk', 'x', '没有']]}};
  const op = normalizeOp(raw);
  assert.deepEqual([op.block.base, op.block.items.map(item => item.at), op.block.edges], ['pitch', [[500, 1000], [400, 800]], [['gk', 'cb', '传']]]);
  assert.equal(normalizeOp({op: 'put', block: {id: 's', t: 'stage', items: [{h: '只有一个', at: [1, 1]}]}}), null);
  assert.equal(refineCueOp(op, {said: '', trigger: 'user', raw}), null);
  assert.ok(refineCueOp(op, {said: '门将站在最里面，中卫在他身前。', trigger: 'assistant_end', raw}).block.items[1].q.startsWith('中卫'));
});

test('the canvas instructions are today\'s with the pointer laid over them', () => {
  assert.ok(CANVAS_CUE_INSTRUCTIONS.includes('# 指针：讲到哪，指到哪') && CANVAS_CUE_INSTRUCTIONS.includes('# 画面怎么跟着声音走'));
  assert.ok(CANVAS_CUE_INSTRUCTIONS.length > CUE_INSTRUCTIONS.length && CANVAS_SCRIPT_INSTRUCTIONS.includes('# 指针'));
  // (Everything today's illustrator is told, it is still told.)
  assert.equal(CANVAS_CUE_INSTRUCTIONS.replace(/\n# 指针：讲到哪，指到哪[\s\S]*?(?=\n\n输出：每行一个 JSON 操作)/u, '').replace(/\n\n输出：/u, '\n输出：'), CUE_INSTRUCTIONS);
  assert.equal(clauseOf(said, '它的尾巴又粗又长'), 4);
});

test('the eye sees each picture, and only places it can hang on a clause V says come back', async () => {
  let asked = null;
  const complete = async function* ({messages}) {
    asked = messages;
    yield '{"pins":[{"cue":3,"on":"a","where":"脑后","kind":"ring","box":[420,40,560,200],"label":"管子"},';
    yield '{"cue":4,"on":"a","kind":"ring","box":[600,500,800,900],"label":"尾巴"},{"cue":4,"on":"a","box":[1,1,2,2],"label":"重复"},{"cue":99,"on":"a","box":[1,1,2,2]},{"cue":1,"on":"x","box":[1,1,2,2]},{"cue":5,"on":"a","box":[1,1,2,2],"label":"没有排气管"}]}';
  };
  const shots = [{id: 'a', h: '超梦', img: '超梦', bytes: Buffer.from('jpeg'), type: 'image/jpeg'}];
  const places = await lookAt({complete, said, shots});
  assert.equal(asked[0].content, EYE_INSTRUCTIONS);
  assert.deepEqual(asked[1].content.map(part => part.type), ['text', 'image_url', 'text']);
  assert.ok(asked[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.ok(asked[1].content[2].text.includes('[4]它的尾巴又粗又长'));
  assert.deepEqual(places.map(place => [place.h, place.on]), [['管子', 'a'], ['尾巴', 'a']]);
  assert.ok(places[1].q.startsWith('它的尾巴'));
  // Given only the clauses about this picture, a place on another clause is not this picture's.
  const part = await lookAt({complete, said, shots, from: 4, to: 5});
  assert.ok(asked[1].content[2].text.startsWith('V 讲这张照片的话：[4]') && !asked[1].content[2].text.includes('[3]'));
  assert.deepEqual(part.map(place => place.h), ['尾巴']);
});

test('the page\'s only print is looked at with all V says; drawn again for the same words it is not looked at twice', async () => {
  const drawn = () => lines({op: 'scene', title: '超梦长什么样'}, {op: 'put', block: {id: 'p', t: 'photo', query: '超梦 全身', caption: '超梦', cue: -1}}, {op: 'put', block: {id: 'l', t: 'list', h: '特点', items: [{id: 'x', h: '念力最强', cue: 6}]}});
  const complete = async function* () { yield drawn(); };
  const looked = [];
  const eye = {find: async query => ({bytes: Buffer.from(query), type: 'image/png'}),
    see: async ({shots, from, to}) => { looked.push([shots.map(shot => shot.img).join(), from, to]); return [{on: 'a', box: [600, 500, 800, 900], kind: 'ring', h: '尾巴', q: '它的尾巴又粗又长'}]; }};
  const director = createBoardDirector({complete, eye, stream});
  const turns = [{role: 'user', text: '超梦长什么样'}, {role: 'assistant', text: said}], seen = [];
  const first = await director.run({owner: 'c', trigger: 'assistant_end', turns, onOp: op => seen.push(op)});
  assert.deepEqual([first.reason, first.eye.pins, first.eye.shots, looked], ['drawn', 1, 1, [['超梦 全身', 0, 7]]]);
  assert.deepEqual([director.scene('c').canvas, director.scene('c').blocks.map(block => block.t), director.scene('c').pins.map(item => [item.img, item.h])], [true, ['photo', 'list'], [['超梦 全身', '尾巴']]]);
  assert.equal(seen.at(-1).scene.pins[0].h, '尾巴');
  await director.run({owner: 'c', trigger: 'assistant_end', turns});
  assert.deepEqual([looked.length, director.scene('c').pins.length], [1, 1]);
});

test('a list\'s pictures are each looked at by themselves, with the clauses about them; a comparison\'s together', async () => {
  const words = '台北故宫在外双溪的山脚下。最有名的是翠玉白菜，菜叶上停着两只小虫。还有肉形石，一块石头雕得像块红烧肉。毛公鼎上刻了五百多个字。';
  const list = {id: 'l', t: 'list', items: [{id: 'a', h: '翠玉白菜', d: '玉雕的菜叶', img: '翠玉白菜', cue: 1}, {id: 'b', h: '肉形石', img: '肉形石', cue: 3}, {id: 'c', h: '毛公鼎', img: '毛公鼎', cue: 5}]};
  const versus = {id: 'v', t: 'versus', sides: [{h: '油车', img: '卡罗拉'}, {h: '电车', img: 'Model 3'}], items: [{id: 'r', h: '车头', cells: ['格栅', '封闭'], cue: 5}]};
  const complete = async function* () { yield lines({op: 'scene', title: '台北故宫'}, {op: 'put', block: list}, {op: 'put', block: versus}); };
  const asked = [];
  const eye = {find: async query => query === '毛公鼎' ? null : {bytes: Buffer.from(query), type: 'image/png'},
    see: async ({shots, from, to}) => { asked.push([shots.map(shot => shot.img).join(), from, to]); return shots.map(shot => ({on: shot.id, box: [1, 1, 500, 500], kind: 'ring', h: '看这里', q: shot.img === '翠玉白菜' ? '菜叶上停着两只' : '一块石头雕得像'})); }};
  const director = createBoardDirector({complete, eye, stream});
  const turns = [{role: 'user', text: '介绍一下台北故宫'}, {role: 'assistant', text: words}];
  const run = await director.run({owner: 'c', trigger: 'assistant_end', turns});
  // (The bronze was not found and is not looked at; the list's item keeps its picture.)
  assert.deepEqual(asked.sort(), [['卡罗拉,Model 3', undefined, undefined], ['翠玉白菜', 1, 3], ['肉形石', 3, 5]]);
  assert.deepEqual(director.scene('c').pins.map(item => item.img).sort(), ['Model 3', '卡罗拉', '翠玉白菜', '肉形石']);
  assert.deepEqual([run.eye.pins, run.eye.shots, director.scene('c').blocks[0].items[0].img], [4, 4, '翠玉白菜']);
  await director.run({owner: 'c', trigger: 'assistant_end', turns});
  assert.equal(asked.length, 3);
});

test('the places pinned on a picture go when the picture does', async () => {
  const pages = [lines({op: 'scene', title: '展品'}, {op: 'put', block: {id: 'l', t: 'list', items: [{id: 'a', h: '翠玉白菜', img: '翠玉白菜', cue: 0}, {id: 'b', h: '肉形石', img: '肉形石', cue: 1}]}}),
    lines({op: 'put', block: {id: 'l', t: 'list', items: [{id: 'a', h: '翠玉白菜', img: '翠玉白菜 特写', cue: 0}, {id: 'b', h: '肉形石', img: '肉形石', cue: 1}]}})];
  const complete = async function* () { yield pages.shift(); };
  const eye = {find: async query => ({bytes: Buffer.from(query), type: 'image/png'}), see: async ({shots}) => shots[0].img === '翠玉白菜 特写' ? [] : [{on: 'a', box: [1, 1, 9, 9], kind: 'ring', h: '看', q: shots[0].img.startsWith('翠玉') ? '先看翠玉白菜它' : '再看肉形石像一'}]};
  const director = createBoardDirector({complete, eye, stream});
  const words = '先看翠玉白菜，它只有十八厘米高。再看肉形石，像一块红烧肉。';
  await director.run({owner: 'c', trigger: 'assistant_progress', turns: [{role: 'user', text: '展品'}, {role: 'assistant', text: words}]});
  assert.deepEqual(director.scene('c').pins.map(item => item.img).sort(), ['翠玉白菜', '肉形石'].sort());
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '展品'}, {role: 'assistant', text: words}]});
  assert.deepEqual(director.scene('c').pins.map(item => item.img), ['肉形石']);
});

test('a later answer on the same page looks only at the pictures it is about', async () => {
  const first = '先看翠玉白菜，它只有十八厘米高。再看肉形石，像一块红烧肉。', second = '肉形石确实有意思，一层层的纹路是石头自己长出来的。', third = '好的，没问题，下次想看别的再告诉我，我随时都在。';
  const list = {id: 'l', t: 'list', items: [{id: 'a', h: '翠玉白菜', img: '翠玉白菜', cue: 0}, {id: 'b', h: '肉形石', img: '肉形石', cue: 2}]};
  const pages = [lines({op: 'scene', title: '展品'}, {op: 'put', block: list}), lines({op: 'none'}), lines({op: 'none'})];
  const complete = async function* () { yield pages.shift(); };
  const asked = [];
  const eye = {find: async query => ({bytes: Buffer.from(query), type: 'image/png'}), see: async ({shots}) => { asked.push(shots[0].img); return []; }};
  const director = createBoardDirector({complete, eye, stream});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '有哪些展品'}, {role: 'assistant', text: first}]});
  assert.deepEqual(asked.sort(), ['翠玉白菜', '肉形石']);
  // The next answer is about one of them: only that picture is looked at. The one after is about neither.
  const turns = [{role: 'user', text: '有哪些展品'}, {role: 'assistant', text: first}, {role: 'user', text: '肉形石'}];
  const again = await director.run({owner: 'c', trigger: 'assistant_end', turns: [...turns, {role: 'assistant', text: second}]});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [...turns, {role: 'assistant', text: second}, {role: 'user', text: '谢谢'}, {role: 'assistant', text: third}]});
  assert.deepEqual([asked, again.eye.shots], [['翠玉白菜', '肉形石', '肉形石'], 1]);
});
