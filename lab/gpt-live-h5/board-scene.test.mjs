import assert from 'node:assert/strict';
import test from 'node:test';
import {applyOp, createLineParser, emptyScene, flowLayout, focusExists, normalizeOp, normalizeScene, scalePositions, sceneDigest, spokenFocus, spokenProgress} from './board-scene.mjs';

const put = block => normalizeOp({op: 'put', block});
const run = (...ops) => ops.reduce((scene, op) => applyOp(scene, normalizeOp(op)), emptyScene());

test('model text is bounded and stripped to plain fields', () => {
  const op = put({id: 's', t: 'steps', h: 'x'.repeat(90), onclick: 'alert(1)', items: [
    {id: 'a', h: '  第一步\n准备  ', d: 'd'.repeat(400), html: '<b>'}, '只有标题', {id: 'bad id!', h: '第三步'}, {d: '没有标题'}]});
  assert.deepEqual(Object.keys(op.block), ['id', 't', 'items', 'h']);
  assert.equal(op.block.h.length, 40);
  assert.deepEqual(op.block.items.map(item => item.id), ['a', 'i2', 'i3']);
  assert.equal(op.block.items[0].h, '第一步 准备');
  assert.equal(op.block.items[0].d.length, 160);
  assert.equal('html' in op.block.items[0], false);
});

test('unknown operations, block types and empty blocks are dropped', () => {
  for (const raw of [null, [], {op: 'eval'}, {op: 'put'}, {op: 'put', block: {id: 'a', t: 'html', text: '<script>'}},
    {op: 'put', block: {id: 'a', t: 'list', items: []}}, {op: 'put', block: {t: 'note', text: '没有 id'}},
    {op: 'put', block: {id: 'c', t: 'compare', cols: [{h: '只有一列'}]}}, {op: 'focus', id: 'a/b/c'}, {op: 'del', id: ''}]) {
    assert.equal(normalizeOp(raw), null);
  }
});

test('every block type keeps its shape', () => {
  assert.deepEqual(put({id: 'n', t: 'note', text: '先定方向'}).block, {id: 'n', t: 'note', text: '先定方向'});
  assert.deepEqual(put({id: 'c', t: 'compare', cols: [{id: 'l', h: '方案 A', tag: '推荐', points: ['快', '', 3]}, {h: '方案 B', points: ['稳']}]}).block.cols,
    [{id: 'l', h: '方案 A', points: ['快', '3'], tag: '推荐'}, {id: 'c2', h: '方案 B', points: ['稳']}]);
  assert.deepEqual(put({id: 'k', t: 'stats', items: [{label: '在产', value: 12, unit: '张'}, {label: '缺值'}]}).block.items,
    [{id: 'n1', label: '在产', value: '12', unit: '张'}]);
  assert.equal(put({id: 'b', t: 'bars', items: [{label: 'A', value: '3'}, {label: 'B', value: 'x'}]}), null);
  assert.deepEqual(put({id: 'b', t: 'bars', unit: '秒', items: [{label: 'A', value: '3'}, {label: 'B', value: 7.5}]}).block.items.map(i => i.value), [3, 7.5]);
  assert.deepEqual(put({id: 't', t: 'table', cols: ['项', '值'], rows: [['a'], ['b', 2, '多余'], '不是行']}).block.rows, [['a', ''], ['b', '2']]);
  const flow = put({id: 'f', t: 'flow', nodes: [{id: 'a', label: '麦克风'}, {id: 'b', label: '模型', sub: '实时'}],
    edges: [['a', 'b', '音频'], ['a', 'x'], ['b', 'b'], {from: 'b', to: 'a'}]}).block;
  assert.deepEqual(flow.edges, [['a', 'b', '音频'], ['b', 'a', '']]);
});

test('duplicate ids inside one block stay addressable', () => {
  const block = put({id: 's', t: 'list', items: [{id: 'a', h: '一'}, {id: 'a', h: '二'}]}).block;
  assert.deepEqual(block.items.map(item => item.id), ['a', 'i2']);
});

test('a scene is edited in place, and only real changes advance the revision', () => {
  let scene = run({op: 'scene', title: '夜班'}, {op: 'put', block: {id: 's', t: 'steps', items: [{id: 'a', h: '一'}, {id: 'b', h: '二'}]}},
    {op: 'put', block: {id: 'n', t: 'note', text: '结论'}}, {op: 'focus', id: 's/b'});
  assert.equal(scene.rev, 4);
  assert.equal(scene.focus, 's/b');
  assert.equal(scene.serial, 1);
  const same = applyOp(scene, put({id: 'n', t: 'note', text: '结论'}));
  assert.equal(same, scene);
  assert.equal(applyOp(scene, normalizeOp({op: 'focus', id: 's/missing'})), scene);
  assert.equal(applyOp(scene, normalizeOp({op: 'none'})), scene);
  scene = applyOp(scene, put({id: 's', t: 'steps', items: [{id: 'a', h: '一'}]}));
  assert.equal(scene.blocks.length, 2);
  assert.equal(scene.blocks[0].items.length, 1);
  assert.equal(scene.focus, '', 'focus on a removed item is cleared');
  scene = applyOp(scene, normalizeOp({op: 'del', id: 'n'}));
  assert.deepEqual(scene.blocks.map(block => block.id), ['s']);
  // A new picture is only announced: the old one stays until a block arrives.
  const before = scene;
  assert.equal(applyOp(scene, normalizeOp({op: 'scene', title: '夜班'})), scene, 're-announcing the picture on screen changes nothing');
  scene = applyOp(scene, normalizeOp({op: 'scene', title: '新话题'}));
  assert.deepEqual([scene.title, scene.blocks, scene.serial, scene.pending, scene.rev], ['夜班', before.blocks, 1, '新话题', before.rev + 1]);
  assert.deepEqual(sceneDigest(scene), {title: '新话题', focus: '', blocks: [], note: '新画面已开，还没有内容；放入第一个区块后屏幕才会换过去'});
  scene = applyOp(scene, put({id: 'n', t: 'note', text: '第一块'}));
  assert.deepEqual([scene.title, scene.blocks.map(block => block.id), scene.serial, scene.pending, scene.focus], ['新话题', ['n'], 2, null, '']);
  scene = applyOp(applyOp(scene, normalizeOp({op: 'scene', title: '又一张'})), normalizeOp({op: 'clear'}));
  assert.deepEqual([scene.title, scene.blocks.length, scene.pending], ['', 0, null]);
});

test('a board never grows past its block limit', () => {
  let scene = emptyScene();
  for (let index = 0; index < 10; index++) scene = applyOp(scene, put({id: 'n' + index, t: 'note', text: '第' + index}));
  assert.equal(scene.blocks.length, 6);
});

test('a full scene from the service is revalidated before it is shown', () => {
  const source = run({op: 'scene', title: '对比'}, {op: 'put', block: {id: 'c', t: 'compare', cols: [{id: 'l', h: 'A', points: []}, {id: 'r', h: 'B', points: []}]}}, {op: 'focus', id: 'c/r'});
  const copy = normalizeScene(JSON.parse(JSON.stringify({...source, blocks: [...source.blocks, {id: 'x', t: 'iframe', src: 'https://example.invalid'}]})));
  assert.deepEqual(copy, source);
  assert.equal(normalizeScene({rev: 'x', blocks: []}), null);
  assert.equal(sceneDigest(emptyScene()), null);
  assert.deepEqual(Object.keys(sceneDigest(source)), ['title', 'focus', 'blocks']);
  assert.equal(focusExists(source, 'c'), true);
});

test('streamed lines apply as they complete; fences and prose are ignored', () => {
  const seen = [], parser = createLineParser(value => seen.push(value));
  parser.feed('```json\n{"op":"scene","ti');
  assert.equal(seen.length, 0);
  parser.feed('tle":"a"}\n好的，下面是画面：\n{"op":"put",broken}\n{"op":"focus","id":"s"},\n{"op":"none"}');
  assert.deepEqual(seen, [{op: 'scene', title: 'a'}, {op: 'focus', id: 's'}]);
  parser.end();
  assert.deepEqual(seen.at(-1), {op: 'none'});
});

test('a flow is laid out as a ring, a row or layers, whichever its edges describe', () => {
  const n = (...ids) => ids.map(id => ({id, label: id}));
  const ring = flowLayout(n('w', 'f', 'g'), [['w', 'f'], ['f', 'g'], ['g', 'w']]);
  assert.equal(ring.shape, 'ring');
  assert.deepEqual([Math.round(ring.position.w.x), Math.round(ring.position.w.y)], [50, 6], 'the first node is at the top');
  assert.equal(ring.position.f.x > 50 && ring.position.g.x < 50, true, 'going round clockwise');
  const extra = flowLayout(n('e', 'w', 'f', 'g'), [['w', 'f'], ['f', 'g'], ['g', 'w'], ['e', 'w']]);
  assert.deepEqual([extra.shape, extra.layers], ['ring', [['w', 'f', 'g', 'e']]], 'a node that only points into the loop joins the circle after it');
  const chain = flowLayout(n('a', 'b', 'c'), [['a', 'b'], ['b', 'c']]);
  assert.deepEqual([chain.shape, chain.position.a.y, chain.position.a.x < chain.position.b.x], ['row', 50, true]);
  const phone = flowLayout(n('a', 'b', 'c', 'd'), [['a', 'b'], ['b', 'c'], ['c', 'd']], {narrow: true});
  assert.deepEqual([phone.shape, phone.layers], ['ring', [['a', 'b', 'c', 'd']]], 'on a phone a long chain goes round a circle, in order, so all of it is in view');
  const seven = n('a', 'b', 'c', 'd', 'e', 'f', 'g');
  assert.equal(flowLayout(seven, seven.slice(1).map((node, index) => [seven[index].id, node.id]), {narrow: true}).shape, 'layers', 'too many for a circle: it stands up');
  const {shape, layers, position} = flowLayout(n('a', 'b', 'c', 'd'), [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]);
  assert.deepEqual([shape, layers], ['layers', [['a'], ['b', 'c'], ['d']]]);
  assert.deepEqual([position.a.y, position.d.y, position.b.x < position.c.x], [0, 100, true]);
  assert.deepEqual(flowLayout(n('a', 'b'), []).layers, [['a', 'b']]);
});


test('the focus mark follows what V has said aloud, by each item\'s quote', () => {
  const said = '好，分三步。第一步是拨号，页面要一个名额。第二步是建立连接，声音转给模型。第三步直接说话。';
  const scene = run({op: 'scene', title: '接通'}, {op: 'put', block: {id: 's', t: 'steps', items: [
    {id: 'a', h: '拨号', q: '第一步是拨号'}, {id: 'b', h: '建立连接', q: '第二步是 建立连接，'}, {id: 'c', h: '直接说话', q: '第三步直接说话'}, {id: 'd', h: '没讲到'}, {id: 'e', h: '抄错了', q: '第四步是挂断'}]}});
  assert.equal(scene.blocks[0].items[1].q, '第二步是 建立连接，');
  const at = phrase => Array.from(said).join('').indexOf(phrase);
  assert.equal(spokenFocus(scene, said, 3), '', 'V has not reached any item');
  assert.equal(spokenFocus(scene, said, at('第一步') + 4), 's/a', 'counts as soon as V starts the quote');
  assert.equal(spokenFocus(scene, said, at('第二步') - 1), 's/a');
  assert.equal(spokenFocus(scene, said, at('第二步') + 5), 's/b', 'punctuation and spaces in a quote do not matter');
  assert.equal(spokenFocus(scene, said, 999), 's/c');
  assert.equal(spokenFocus(emptyScene(), said, 999), '');
  const repeated = run({op: 'put', block: {id: 's', t: 'steps', items: [{id: 'a', h: 'Server Hello', q: 'Server Hello本身'}, {id: 'b', h: '证书链', q: '然后发证书链'}]}});
  assert.equal(spokenFocus(repeated, '第一，Server Hello本身。然后发证书链。最后是Server Hello Done。', 999), 's/b', 'a later mention does not pull the mark back');
  const columns = run({op: 'put', block: {id: 'c', t: 'compare', cols: [{id: 'l', h: 'A', q: '第一步是拨号', points: []}, {id: 'r', h: 'B', points: []}]}});
  assert.equal(spokenFocus(columns, said, 999), 'c/l');
});

test('icons, marks, paper colours, notes and photographs are kept only in their allowed forms', () => {
  const block = put({id: 'l', t: 'list', tone: 'butter', items: [{id: 'a', h: '塔高', icon: '📏', mark: 'ring'}, {id: 'b', h: '字不是图标', icon: 'abc', mark: 'explode'}, {id: 'c', h: '太长', icon: '🎡🎡🎡🎡🎡'}]}).block;
  assert.deepEqual(block.items, [{id: 'a', h: '塔高', mark: 'ring', icon: '📏'}, {id: 'b', h: '字不是图标'}, {id: 'c', h: '太长'}]);
  assert.equal(block.tone, 'butter');
  assert.equal('tone' in put({id: 'l', t: 'list', tone: 'green', items: [{h: 'x'}]}).block, false);
  assert.deepEqual(put({id: 'n', t: 'sticky', tone: 'blush', text: '先做讲解画面', html: '<b>'}).block, {id: 'n', t: 'sticky', text: '先做讲解画面', tone: 'blush'});
  assert.deepEqual(put({id: 'p', t: 'photo', query: ' 埃菲尔铁塔 ', caption: '巴黎', src: 'https://evil.example/x.jpg'}).block, {id: 'p', t: 'photo', query: '埃菲尔铁塔', caption: '巴黎'});
  assert.equal(put({id: 'p', t: 'photo', caption: '没有查询词'}), null);
  assert.deepEqual(put({id: 'k', t: 'stats', items: [{label: '等你确认', value: 2, mark: 'ring'}]}).block.items, [{id: 'n1', label: '等你确认', value: '2', mark: 'ring'}]);
});

test('items V has written about but not yet said are reported as ahead', () => {
  const said = '在产十二张卡，今晚已经交付三十一条，有两条在等你确认。';
  const scene = run({op: 'put', block: {id: 'k', t: 'stats', items: [{id: 'a', label: '在产', value: 12, q: '在产十二张卡'}, {id: 'b', label: '已交付', value: 31, q: '已经交付三十一条'}, {id: 'c', label: '等确认', value: 2, q: '有两条在等你'}, {id: 'd', label: '没讲', value: 0}, {id: 'e', label: '抄错', value: 1, q: '并不存在的话'}]}});
  assert.deepEqual(spokenProgress(scene, said, 0), {focus: '', ahead: ['k/a', 'k/b', 'k/c']});
  // Without quotes the items still follow the voice where V used their own words.
  const bare = run({op: 'put', block: {id: 's', t: 'steps', items: [{id: 'a', h: 'Client Hello'}, {id: 'b', h: '验证证书，发预主密钥'}, {id: 'c', h: '画面上才有的词'}]}},
    {op: 'put', block: {id: 'k', t: 'stats', items: [{id: 'n', label: '咖啡因', value: 96, unit: '毫克'}, {id: 'm', label: '杯', value: 1}]}});
  const reply = '首先客户端发Client Hello，然后客户端验证证书真假，冲泡咖啡平均96毫克。';
  assert.deepEqual(spokenProgress(bare, reply, 0), {focus: '', ahead: ['s/a', 's/b', 'k/n']});
  assert.deepEqual(spokenProgress(bare, reply, 22), {focus: 's/a', ahead: ['s/b', 'k/n']});
  assert.deepEqual(spokenProgress(bare, reply, 999), {focus: 'k/n', ahead: []});
  assert.deepEqual(spokenProgress(scene, said, 6), {focus: 'k/a', ahead: ['k/b', 'k/c']});
  assert.deepEqual(spokenProgress(scene, said, said.indexOf('已经') + 5), {focus: 'k/b', ahead: ['k/c']});
  assert.deepEqual(spokenProgress(scene, said, 999), {focus: 'k/c', ahead: []});
});

test('the diagram kit: every shape keeps its form, bounded, and survives being read back', () => {
  const put = block => normalizeOp({op: 'put', block})?.block;
  const kit = [
    {id: 't', t: 'tiles', items: [{id: 'a', rows: 4, cols: 4, h: '16 块', tone: 'sky', q: '十六块'}, {n: 25, lit: 0}, {n: 500, per: 99}, {n: 0}]},
    {id: 'f', t: 'formula', parts: ['x', '×', {h: 'x', d: '藏起来的数', tone: 'butter'}, '=', {h: '9', mark: 'ring', q: '等于九'}]},
    {id: 'm', t: 'timeline', w: 'third', items: [{when: '1932', h: '木工坊'}, {when: '1949', h: '塑料积木', img: '乐高积木'}]},
    {id: 'v', t: 'versus', sides: ['电动车', {h: '油车', img: '丰田卡罗拉'}], items: [{h: '补能', cells: ['过夜充', '几分钟'], win: 1, q: '补能'}, {h: '长途', cells: ['要规划'], win: 7}, {h: '', cells: ['x', 'y']}]},
    {id: 'o', t: 'overlap', a: {h: '电动车', points: ['地上跑']}, b: {h: '飞行器', points: ['天上飞']}, both: ['电池', '电机']},
    {id: 's', t: 'stack', shape: 'pyramid', layers: ['飞行器', {h: '电控'}, {h: '电池和电机', d: '最底下'}]},
    {id: 'k', t: 'scale', unit: '米', dir: 'up', marks: [{at: 120, h: '无人机'}, {at: 10000, h: '客机'}, {at: 'x', h: '不算'}]},
  ].map(put);
  assert.deepEqual(kit.map(block => block?.t), ['tiles', 'formula', 'timeline', 'versus', 'overlap', 'stack', 'scale']);
  assert.deepEqual(kit[0].items.map(item => [item.n, item.per, item.lit]), [[16, 4, undefined], [25, 5, 0], [60, 10, undefined]]);
  assert.deepEqual(kit[1].items.map(item => item.h).join(' '), 'x × x = 9');
  assert.equal(kit[2].w, 'third');
  assert.deepEqual(kit[3].items.map(item => [item.h, item.cells, item.win]), [['补能', ['过夜充', '几分钟'], 1], ['长途', ['要规划', ''], undefined]]);
  assert.deepEqual(kit[4].items.map(item => [item.id, item.h, item.points]), [['a', '电动车', ['地上跑']], ['both', undefined, ['电池', '电机']], ['b', '飞行器', ['天上飞']]]);
  assert.equal(kit[5].shape, 'pyramid');
  assert.deepEqual(kit[6].items.map(item => item.at), [120, 10000]);
  // The page validates what the service sends again: the stored form must read back unchanged.
  for (const block of kit) assert.deepEqual(put(block), block);
  for (const bad of [{id: 'x', t: 'formula', parts: ['x']}, {id: 'x', t: 'versus', sides: ['只有一边'], items: []}, {id: 'x', t: 'overlap', a: {h: 'a'}, b: {h: 'b'}}, {id: 'x', t: 'scale', items: [{at: 1, h: 'a'}]}]) assert.equal(put(bad), undefined);
  // Marks far apart in magnitude are spaced by their logarithm.
  assert.deepEqual(scalePositions([{at: 100}, {at: 1000}, {at: 10000}, {at: 1000000}]), [0, 25, 50, 100]);
  assert.deepEqual(scalePositions([{at: 0}, {at: 5}, {at: 10}]), [0, 50, 100]);
  // The pieces of a kit block wait for V's words like any item.
  const scene = [{op: 'scene', title: 't'}, {op: 'put', block: kit[0]}, {op: 'put', block: kit[1]}].reduce(applyOp, emptyScene());
  assert.deepEqual(spokenProgress(scene, '先摆十六块。四乘四等于九。', 2).ahead, ['t/a', 'f/p5']);
});

test('every picture a page asks for may be fetched, the sides of a comparison included', async () => {
  const {scenePictures} = await import('./board-scene.mjs');
  const scene = [{op: 'scene', title: 't'}, {op: 'put', block: {id: 'v', t: 'versus', sides: [{h: '胶卷相机', img: '胶卷相机'}, {h: '数码相机', img: '数码相机'}], items: [{h: '感光', cells: ['胶卷', '传感器']}]}},
    {op: 'put', block: {id: 'm', t: 'timeline', items: [{when: '1888', h: '柯达', img: '柯达相机'}, {when: '1975', h: '数码'}]}}].reduce(applyOp, emptyScene());
  assert.deepEqual([...scenePictures(scene)].sort(), ['数码相机', '柯达相机', '胶卷相机']);
});

test('a pen mark is made on something already on the page when V says its words', async () => {
  const {markedBlocks} = await import('./board-scene.mjs');
  const versus = {id: 'v', t: 'versus', sides: ['电车', '油车'], items: [{id: 'a', h: '补能', cells: ['慢充', '三分钟'], q: '补能上'}]};
  let scene = [{op: 'scene', title: 't'}, {op: 'put', block: versus}].map(normalizeOp).reduce(applyOp, emptyScene());
  const mark = normalizeOp({op: 'mark', id: 'v/a', kind: 'check', q: '所以选油车'});
  assert.deepEqual(mark, {op: 'mark', id: 'v/a', kind: 'check', q: '所以选油车'});
  scene = applyOp(scene, mark);
  assert.equal(applyOp(scene, mark), scene, 'one mark on a thing');
  assert.equal(applyOp(scene, normalizeOp({op: 'mark', id: 'v/zz', kind: 'ring', q: 'x'})), scene, 'only on what is there');
  for (const bad of [{op: 'mark', id: 'v', kind: 'ring', q: 'x'}, {op: 'mark', id: 'v/a', kind: 'blob', q: 'x'}, {op: 'mark', id: 'v/a', kind: 'ring'}]) assert.equal(normalizeOp(bad), null);
  const said = '补能上油车快。所以选油车。';
  const before = spokenProgress(scene, said, 7), after = spokenProgress(scene, said, said.length);
  assert.deepEqual([before.ahead, after.ahead], [['mark:0'], []]);
  assert.equal(markedBlocks(scene, new Set(before.ahead))[0].items[0].mark, undefined);
  assert.equal(markedBlocks(scene, new Set(after.ahead))[0].items[0].mark, 'check');
  assert.deepEqual(normalizeScene(JSON.parse(JSON.stringify(scene))).marks, scene.marks, 'and survives being sent to the page');
});

test('draw: a sketch of plain shapes, each with its numbers checked', async () => {
  const {normalizeOp} = await import('./board-scene.mjs');
  const op = normalizeOp({op: 'put', block: {id: 'g', t: 'draw', h: '勾股', items: [
    {id: 'a', k: 'poly', p: [40, 40, 40, 25, 60, 40], q: '直角三角形'}, {id: 'b', k: 'rect', p: [25, 25, 15, 15], h: '3²=9', tone: 'butter'},
    {id: 'c', k: 'circle', p: [8, 30]}, {id: 'd', k: 'blob', p: [1, 2, 3, 4]}, {id: 'e', k: 'text', p: [5, 5]}, {id: 'f', k: 'wave', p: [0, 0, 500, 'x']}, {id: 'h', k: 'arrow', p: [0, 0, 500, 30]}]}});
  assert.deepEqual(op.block.items.map(item => item.id), ['a', 'b', 'h']);
  assert.deepEqual(op.block.items[2].p, [0, 0, 105, 30]);
  assert.equal(op.block.items[1].tone, 'butter');
});
