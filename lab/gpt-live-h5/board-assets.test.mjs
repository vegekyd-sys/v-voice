import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSET_CONTEXT_EMPTY, createAssetEye, createAssetShelf, readCreation} from './board-assets.mjs';
import {assetFamily, createAssetsClient} from './board-assets-client.mjs';
import {createBoardDirector} from './board-director.mjs';
import {normalizeOp, normalizeScene, sceneWorks} from './board-scene.mjs';
import {CUE_INSTRUCTIONS, cueTurns, refineCueOp} from './board-cue.mjs';

const image = url => ({isError: false, media: {kind: 'image', url}, content: [{type: 'text', text: `图片已生成：${url}`}]});
const video = url => ({isError: false, media: {kind: 'video', url}, content: [{type: 'text', text: `视频已生成：${url}`}]});
const POSTER = 'https://cdn.example/poster.png', FILM = 'https://cdn.example/film.mp4';
// A director whose model writes `lines` (one reply per run).
const director = (replies = []) => createBoardDirector({complete: async function* () { yield (replies.shift() ?? '{"op":"none"}') + '\n'; },
  stream: {instructions: CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
const shelfOn = (board, options = {}) => { const shelf = createAssetShelf({director: board, lookWaitMs: 50, ...options}); board.shelf = shelf; return shelf; };

test('a creation command is read without being run', () => {
  assert.deepEqual(readCreation("makaron edit --image-model gemini-2.1 --aspect 16:9 '鸣人大战路飞的海报'"), {kind: 'image', prompt: '鸣人大战路飞的海报', reference: '', aspect: '16:9'});
  assert.deepEqual(readCreation("makaron video create --video-model fal-h3-max --duration 5 --video-resolution 768p --image 'https://cdn.example/poster.png' --script '<<<media_1>>> 两人冲向对方'"),
    {kind: 'video', prompt: '两人冲向对方', reference: 'https://cdn.example/poster.png'});
  assert.equal(readCreation('makaron video status task-1'), null);
  assert.equal(readCreation("makaron create --image out.png --title 'Voice 图片'"), null);
});

test('a picture asked for is on the board before it exists, and develops in place', async () => {
  const board = director(), shelf = shelfOn(board);
  const begun = shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '鸣人大战路飞的海报'", turn: {}});
  assert.equal(begun.id, 'a1');
  assert.deepEqual(sceneWorks(board.scene('call')), ['a1']);
  assert.equal(shelf.page('call').busy, true);
  assert.equal(shelf.context('call'), ASSET_CONTEXT_EMPTY, 'a thing still being made is not yet something V can speak of');
  const fact = await shelf.finish('call', 'a1', image(POSTER));
  assert.deepEqual(fact, {id: 'a1', kind: 'image', onBoard: true});
  assert.deepEqual(shelf.page('call').assets.map(({id, state, url}) => ({id, state, url})), [{id: 'a1', state: 'ready', url: POSTER}]);
  assert.match(shelf.context('call'), /a1 图片.*鸣人大战路飞的海报.*最新的是 a1/u);
});

test('"animate it": the id becomes the link, and the video takes the picture\'s frame', async () => {
  const board = director(), shelf = shelfOn(board);
  await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '海报'", turn: {}}).id, image(POSTER));
  const rev = board.scene('call').rev, page = board.scene('call').serial;
  const begun = shelf.begin('call', {command: "makaron video create --video-model fal-h3-max --duration 5 --image a1 --script '<<<media_1>>> 动起来'", turn: {}});
  assert.equal(begun.command, `makaron video create --video-model fal-h3-max --duration 5 --image '${POSTER}' --script '<<<media_1>>> 动起来'`);
  assert.equal(begun.id, 'a2');
  // Same page, same block: the print starts moving where it hangs.
  assert.equal(board.scene('call').serial, page);
  assert.deepEqual(board.scene('call').blocks.map(block => [block.id, block.asset]), [['w1', 'a2']]);
  assert.ok(board.scene('call').rev > rev);
  const fact = await shelf.finish('call', 'a2', video(FILM));
  assert.deepEqual(fact, {id: 'a2', kind: 'video', from: 'a1', onBoard: true});
  // A second video of the same picture is another version in the same frame, not a new page.
  shelf.begin('call', {command: "makaron video create --video-model fal-h3-max --image a2 --script '<<<media_1>>> 再来一版'", turn: {}});
  assert.equal(shelf.get('call', 'a3').from, 'a1', 'a video is not a reference picture; the picture it came from is');
  assert.deepEqual(board.canvas('call').zones.map(zone => zone.blocks.map(block => block.asset)), [['a3']]);
});

test('an id that is not on the shelf is refused before anything is submitted', () => {
  const shelf = shelfOn(director());
  const begun = shelf.begin('call', {command: "makaron video create --video-model fal-h3-max --image a7 --script '<<<media_1>>> 动'", turn: {}});
  assert.match(begun.error, /a7.*没有提交/u);
  assert.equal(shelf.page('call').assets.length, 0);
});

test('one request makes one thing of a kind; a failed first attempt is the same thing begun again', async () => {
  const shelf = shelfOn(director()), turn = {};
  const first = shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '海报'", turn});
  assert.equal(shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '海报，更热血'", turn}).id, first.id);
  await shelf.finish('call', first.id, {isError: true});
  assert.equal(shelf.get('call', first.id).state, 'failed');
  assert.equal(shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '海报'", turn}).id, first.id);
  assert.equal(shelf.get('call', first.id).state, 'making');
  assert.equal(shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '另一张'", turn: {}}).id, 'a2');
});

test('a video still rendering when the wait ends keeps its place; its later answer finishes it', async () => {
  const shelf = shelfOn(director());
  const begun = shelf.begin('call', {command: "makaron video create --video-model fal-h3-max --script '海浪'", turn: {}});
  assert.equal(await shelf.finish('call', begun.id, {isError: false, details: {status: 'pending'}, content: [{type: 'text', text: 'Task ID: t1'}]}), null);
  assert.equal(shelf.get('call', begun.id).state, 'making');
  // (`makaron video status t1` is not a creation: its result belongs to the video being made.)
  assert.equal(shelf.begin('call', {command: 'makaron video status t1', turn: {}}).id, undefined);
  assert.equal((await shelf.finish('call', undefined, video(FILM))).id, begun.id);
  assert.equal(shelf.get('call', begun.id).state, 'ready');
});

test('the eye names the thing and tells V what is in it; the page takes the name', async () => {
  const board = director();
  const shelf = shelfOn(board, {lookWaitMs: 500, see: async ({url, prompt}) => { assert.equal(url, POSTER); assert.equal(prompt, '海报'); return {name: '鸣人大战路飞', see: '左边是金发少年，右边是戴草帽的少年。', parts: [{h: '鸣人', box: [0, 100, 480, 900]}]}; }});
  let told = 0;
  shelf.watch('call', () => { told++; });
  const fact = await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '海报'", turn: {}}).id, image(POSTER));
  assert.deepEqual(fact, {id: 'a1', kind: 'image', name: '鸣人大战路飞', see: '左边是金发少年，右边是戴草帽的少年。', onBoard: true});
  assert.equal(board.scene('call').title, '鸣人大战路飞');
  assert.match(shelf.context('call'), /a1 图片「鸣人大战路飞」：左边是金发少年/u);
  assert.equal(told, 2, 'once when it is ready, once when it has been looked at');
  assert.deepEqual(shelf.digest('call'), [{id: 'a1', kind: 'image', name: '鸣人大战路飞', see: '左边是金发少年，右边是戴草帽的少年。'}]);
});

test('a slow look does not hold the result back', async () => {
  const shelf = shelfOn(director(), {lookWaitMs: 20, see: () => new Promise(resolve => setTimeout(resolve, 200, {name: '晚到', see: '晚到的描述', parts: []}))});
  const fact = await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '海报'", turn: {}}).id, image(POSTER));
  assert.equal(fact.see, undefined);
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.match(shelf.context('call'), /晚到的描述/u);
});

test('what the backend made comes onto the shelf from its result', () => {
  const board = director(), shelf = shelfOn(board);
  shelf.observe({type: 'tool.delivered', voiceSessionId: 'call', name: 'delegate_to_v', result: {result: `海报做好了。\n![鸣人大战路飞](${POSTER})\n还做了一个视频：${FILM}`}});
  shelf.observe({type: 'tool.delivered', voiceSessionId: 'call', name: 'web_search', result: {result: `![x](https://cdn.example/other.png)`}});
  assert.deepEqual(shelf.page('call').assets.map(({id, kind, source, name}) => ({id, kind, source, name})), [{id: 'a1', kind: 'image', source: 'backend', name: '鸣人大战路飞'}, {id: 'a2', kind: 'video', source: 'backend', name: undefined}]);
  assert.match(shelf.backendContext('call'), /a1 图片「鸣人大战路飞」（后台做的） 链接 https:\/\/cdn\.example\/poster\.png/u);
  // The same link again is the same thing.
  shelf.observe({type: 'tool.delivered', voiceSessionId: 'call', name: 'delegate_to_v', result: {result: POSTER}});
  assert.equal(shelf.page('call').assets.length, 2);
});

test('the caller taps a thing: it is "this one" until another is tapped', async () => {
  const shelf = shelfOn(director());
  await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '一'", turn: {}}).id, image(POSTER));
  await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '二'", turn: {}}).id, image('https://cdn.example/two.png'));
  assert.match(shelf.context('call'), /最新的是 a2/u);
  assert.equal(shelf.pick('call', 'a1'), true);
  assert.match(shelf.context('call'), /用户正点着 a1/u);
  assert.equal(shelf.pick('call', 'a9'), false);
  shelf.seen('call', ['a1']);
  assert.equal(shelf.shown('call', 'a1'), true);
  assert.equal(shelf.shown('call', 'a2'), false);
});

test('a made thing takes the page opened for the same request, and keeps it from being replaced', async () => {
  // The illustrator opens a page with a photograph of the subject when the caller has only just asked...
  const board = director(['{"op":"scene","title":"鸣人和路飞"}\n{"op":"put","block":{"id":"p1","t":"photo","query":"漩涡鸣人","cue":-1}}',
    // ...and names a page again once V has spoken.
    '{"op":"scene","title":"海报做好了"}\n{"op":"put","block":{"id":"p2","t":"photo","query":"路飞","cue":0}}']);
  const shelf = shelfOn(board);
  await board.run({owner: 'call', trigger: 'user', turns: [{role: 'user', text: '帮我生成一张鸣人大战路飞的海报'}]});
  assert.equal(board.scene('call').title, '鸣人和路飞');
  shelf.begin('call', {command: "makaron edit --image-model gemini-2.1 '海报'", turn: {}});
  assert.equal(board.scene('call').title, '鸣人和路飞');
  assert.deepEqual(board.scene('call').blocks.map(block => block.t), ['work'], 'the made thing is the page\'s print; the photograph gives way');
  await board.run({owner: 'call', trigger: 'assistant_end', turns: [{role: 'user', text: '帮我生成一张鸣人大战路飞的海报'}, {role: 'assistant', text: '海报做好啦，左边是鸣人，右边是路飞，两个人正冲向对方，气势特别足，你看看喜不喜欢，要不要我让它动起来。'}]});
  assert.equal(board.canvas('call').zones.length, 1, 'no second page beside the work');
  assert.deepEqual(board.scene('call').blocks.map(block => block.t), ['work'], 'and no photograph hung beside it');
});

test('the illustrator may hang a thing the shelf holds, and nothing else', async () => {
  const reply = '{"op":"scene","title":"讲讲这张海报"}\n{"op":"put","block":{"id":"n1","t":"sticky","text":"经典对冲构图","cue":1}}\n{"op":"put","block":{"id":"w9","t":"work","asset":"a1","cue":0}}\n{"op":"put","block":{"id":"w8","t":"work","asset":"a5","cue":1}}';
  const said = [{role: 'user', text: '讲讲这张海报'}, {role: 'assistant', text: '这张海报画的是两位少年漫主角的对决，左边是鸣人右边是路飞，构图是经典的对冲式，色调很热烈，很有张力。'}];
  const works = board => board.canvas('call').zones.map(zone => zone.blocks.map(block => block.t === 'work' ? block.asset : block.t));
  // On the shelf but on no page (its page was never drawn here): the illustrator hangs it; an id the shelf does not hold is dropped.
  const board = director([reply]), shelf = createAssetShelf({lookWaitMs: 10});
  board.shelf = shelf;
  shelf.add('call', {kind: 'image', url: POSTER, name: '海报'});
  await board.run({owner: 'call', trigger: 'assistant_end', turns: said});
  assert.deepEqual(works(board), [['sticky', 'a1']]);
  // Already up on its own page: it is not hung a second time on another.
  const second = director([reply]), held = shelfOn(second);
  held.add('call', {kind: 'image', url: POSTER, name: '海报'});
  await second.run({owner: 'call', trigger: 'assistant_end', turns: said});
  assert.deepEqual(works(second), [['a1'], ['sticky']]);
  // Asked for first on the new page: V goes back to the page the thing is on and draws there.
  const third = director(['{"op":"scene","title":"讲讲这张海报"}\n{"op":"put","block":{"id":"w9","t":"work","asset":"a1","cue":0}}\n{"op":"put","block":{"id":"n1","t":"sticky","text":"经典对冲构图","cue":1}}']), kept = shelfOn(third);
  kept.add('call', {kind: 'image', url: POSTER, name: '海报'});
  await third.run({owner: 'call', trigger: 'assistant_end', turns: said});
  assert.deepEqual(works(third), [['a1', 'sticky']]);
});

test('a lesson may ask for one picture to be drawn, where the call can make one', async () => {
  const made = [];
  const reply = '{"op":"scene","title":"光合作用"}\n{"op":"put","block":{"id":"l1","t":"list","items":[{"id":"i1","h":"阳光","cue":0}]}}\n{"op":"put","block":{"id":"w1","t":"work","make":"一片叶子里的小工厂，水彩","caption":"叶子工厂","cue":2}}';
  const said = [{role: 'user', text: '给十二讲讲光合作用'}, {role: 'assistant', text: '叶子要吃阳光。它还要喝水。你可以把叶子想成一座小工厂，阳光是电，水和空气是原料，做出来的是糖。'}];
  const board = director([reply, reply]);
  const shelf = shelfOn(board);
  // No executor: the block is dropped, the rest of the page is drawn.
  await board.run({owner: 'plain', trigger: 'assistant_end', turns: said});
  assert.deepEqual(board.scene('plain').blocks.map(block => block.t), ['list']);
  shelf.attach('call', async ({prompt, aspect}) => { made.push([prompt, aspect]); return image(POSTER); });
  await board.run({owner: 'call', trigger: 'assistant_end', turns: said});
  const work = board.scene('call').blocks.find(block => block.t === 'work');
  assert.equal(work.asset, 'a1');
  assert.equal(work.make, undefined);
  assert.ok(work.q, 'it appears when the voice reaches its clause');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(made, [['一片叶子里的小工厂，水彩', '4:3']]);
  assert.equal(shelf.get('call', 'a1').state, 'ready');
  assert.equal(shelf.get('call', 'a1').name, '叶子工厂');
});

test('a work block is an id on the shelf or words to draw from, and nothing else', () => {
  assert.deepEqual(normalizeOp({op: 'put', block: {id: 'w1', t: 'work', asset: 'a12', url: 'https://x/y.png'}}), {op: 'put', block: {id: 'w1', t: 'work', asset: 'a12'}});
  assert.deepEqual(normalizeOp({op: 'put', block: {id: 'w1', t: 'work', make: ' 一只猫 ', caption: '猫'}}), {op: 'put', block: {id: 'w1', t: 'work', make: '一只猫', caption: '猫'}});
  assert.equal(normalizeOp({op: 'put', block: {id: 'w1', t: 'work', asset: 'https://x/y.png'}}), null);
  assert.equal(normalizeOp({op: 'put', block: {id: 'w1', t: 'work'}}), null);
  const scene = normalizeScene({rev: 3, serial: 1, title: '海报', blocks: [{id: 'w1', t: 'work', asset: 'a1'}]});
  assert.deepEqual(sceneWorks(scene), ['a1']);
});

test('the eye reads the picture as bytes and returns what it saw, bounded', async () => {
  const seen = [];
  const see = createAssetEye({
    fetchImpl: async () => ({ok: true, headers: {get: () => 'image/png'}, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer}),
    complete: async function* ({messages}) { seen.push(messages[1].content); yield '好的：{"name":"鸣人大战路飞。","see":"左边是鸣人。","parts":[{"h":"鸣人","box":[480,900,0,100]},{"h":"","box":[0,0,1,1]},{"h":"路飞","box":[1,2]}]}'; },
  });
  assert.deepEqual(await see({url: POSTER, prompt: '海报'}), {name: '鸣人大战路飞', see: '左边是鸣人。', parts: [{h: '鸣人', box: [0, 100, 480, 900]}]});
  assert.equal(seen[0][0].image_url.url, 'data:image/png;base64,AQID');
  assert.equal(createAssetEye({complete: null}), null);
  assert.equal(await createAssetEye({fetchImpl: async () => { throw Error('x'); }, complete: async function* () { yield 'no json'; }})({url: POSTER}), null);
});

test('the page asks while something is being made, learns what each id is, and tells which one was tapped', async () => {
  const timers = [], bodies = [], shown = [];
  let reply = {assets: [{id: 'a1', kind: 'image', state: 'making', at: 1}], picked: '', busy: true, stamp: 1, rev: 4};
  const client = createAssetsClient({request: async body => { bodies.push(body); return reply; }, onChange: view => shown.push([...view.assets.values()].map(item => item.state).join(',') + '|' + view.picked),
    rev: () => 4, now: () => 0, setTimer: (run, wait) => { timers.push({run, wait}); return timers.length; }, clearTimer: () => {}});
  const tick = async () => { const next = timers.shift(); await next.run(); };
  client.scene({blocks: [{id: 'w1', t: 'work', asset: 'a1'}]});
  await tick();
  assert.deepEqual(shown, ['making|']);
  assert.equal(timers.length, 1, 'busy: asks again');
  reply = {assets: [{id: 'a1', kind: 'image', state: 'ready', url: POSTER, at: 1}], picked: '', busy: false, stamp: 2, rev: 4};
  await tick();
  assert.deepEqual(shown.at(-1), 'ready|');
  client.shown('a1'); client.pick('a1');
  assert.deepEqual(shown.at(-1), 'ready|a1', 'the tap shows at once');
  reply = {...reply, picked: 'a1', stamp: 3};
  while (timers.length) { await tick(); if (bodies.some(body => body.pick === 'a1')) break; }
  assert.ok(bodies.some(body => body.pick === 'a1' && body.seen?.includes('a1')));
  client.dispose();
});

test('every version of a thing is one family, oldest first', () => {
  const assets = new Map([['a1', {id: 'a1', kind: 'image'}], ['a2', {id: 'a2', kind: 'video', from: 'a1'}], ['a3', {id: 'a3', kind: 'image'}], ['a4', {id: 'a4', kind: 'image', from: 'a1'}]]);
  assert.deepEqual(assetFamily(assets, 'a2').map(item => item.id), ['a1', 'a2', 'a4']);
  assert.deepEqual(assetFamily(assets, 'a3').map(item => item.id), ['a3']);
  assert.deepEqual(assetFamily(assets, 'a9'), []);
});
