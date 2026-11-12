import assert from 'node:assert/strict';
import test from 'node:test';
import {applyOp, createLineParser, emptyScene, flowLayout, focusExists, normalizeOp, normalizeScene, sceneDigest} from './board-scene.mjs';

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
  scene = applyOp(scene, normalizeOp({op: 'scene', title: '新话题'}));
  assert.deepEqual([scene.title, scene.blocks.length, scene.serial], ['新话题', 0, 2]);
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

test('flow layout layers a graph and survives cycles', () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => ({id, label: id}));
  const {layers, position} = flowLayout(nodes, [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'a']]);
  assert.deepEqual(layers, [['a'], ['b', 'c'], ['d']]);
  assert.deepEqual([position.a.y, position.d.y], [0, 100]);
  assert.equal(position.b.x < position.c.x, true);
  assert.deepEqual(flowLayout(nodes.slice(0, 2), []).layers, [['a', 'b']]);
});
