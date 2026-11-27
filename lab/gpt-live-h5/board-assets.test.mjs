import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSET_CONTEXT_EMPTY, SELF_IMAGE, createAssetEye, createAssetShelf, pictureName, readCreation, asksOnlyToFind} from './board-assets.mjs';
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
  assert.deepEqual(readCreation("makaron edit --image-model gpt-image-2.6-flare --aspect 16:9 '鸣人大战路飞的海报'"), {kind: 'image', prompt: '鸣人大战路飞的海报', reference: '', aspect: '16:9'});
  assert.deepEqual(readCreation("makaron video create --video-model fal-h3-max --duration 5 --video-resolution 768p --image 'https://cdn.example/poster.png' --script '<<<media_1>>> 两人冲向对方'"),
    {kind: 'video', prompt: '两人冲向对方', reference: 'https://cdn.example/poster.png'});
  assert.equal(readCreation('makaron video status task-1'), null);
  assert.equal(readCreation("makaron create --image out.png --title 'Voice 图片'"), null);
});

test('a picture asked for is on the board before it exists, and develops in place', async () => {
  const board = director(), shelf = shelfOn(board);
  const begun = shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '鸣人大战路飞的海报'", turn: {}});
  assert.equal(begun.id, 'a1');
  assert.deepEqual(sceneWorks(board.scene('call')), ['a1']);
  assert.equal(shelf.page('call').busy, true);
  assert.equal(shelf.context('call'), '屏幕素材现状：还没有做好的图片或视频。正在做、还没好：图片。', 'V knows it is on its way, and that it is not there yet');
  assert.equal(shelf.context('nobody'), ASSET_CONTEXT_EMPTY);
  const fact = await shelf.finish('call', 'a1', image(POSTER));
  assert.deepEqual(fact, {id: 'a1', kind: 'image', onBoard: true});
  assert.deepEqual(shelf.page('call').assets.map(({id, state, url}) => ({id, state, url})), [{id: 'a1', state: 'ready', url: POSTER}]);
  assert.match(shelf.context('call'), /a1 图片.*鸣人大战路飞的海报.*最新的是 a1/u);
});

test('"animate it": the id becomes the link, and the video takes the picture\'s frame', async () => {
  const board = director(), shelf = shelfOn(board);
  await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '海报'", turn: {}}).id, image(POSTER));
  const rev = board.scene('call').rev, page = board.scene('call').serial;
  const begun = shelf.begin('call', {command: "makaron video create --video-model fal-h3-max --duration 5 --image a1 --script '<<<media_1>>> 动起来'", turn: {}});
  assert.equal(begun.command, `makaron video create --video-model fal-h3-max --duration 5 --image '${POSTER}' --script '<<<media_1>>> 动起来'`);
  assert.equal(begun.id, 'a2');
  // Same page, same block: the print starts moving where it hangs.
  assert.equal(board.scene('call').serial, page);
  assert.deepEqual(board.scene('call').blocks.map(block => [block.id, block.asset]), [['w1', 'a2']]);
  assert.ok(board.scene('call').rev > rev);
  const fact = await shelf.finish('call', 'a2', video(FILM));
  assert.deepEqual(fact, {id: 'a2', kind: 'video', from: 'a1', references: ['a1'], onBoard: true});
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
  const first = shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '海报'", turn});
  assert.equal(shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '海报，更热血'", turn}).id, first.id);
  await shelf.finish('call', first.id, {isError: true});
  assert.equal(shelf.get('call', first.id).state, 'failed');
  assert.equal(shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '海报'", turn}).id, first.id);
  assert.equal(shelf.get('call', first.id).state, 'making');
  assert.equal(shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '另一张'", turn: {}}).id, 'a2');
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
  const fact = await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '海报'", turn: {}}).id, image(POSTER));
  assert.deepEqual(fact, {id: 'a1', kind: 'image', name: '鸣人大战路飞', see: '左边是金发少年，右边是戴草帽的少年。', onBoard: true});
  assert.equal(board.scene('call').title, '鸣人大战路飞');
  assert.match(shelf.context('call'), /a1 图片「鸣人大战路飞」：左边是金发少年/u);
  assert.equal(told, 2, 'once when it is ready, once when it has been looked at');
  assert.deepEqual(shelf.digest('call'), [{id: 'a1', kind: 'image', name: '鸣人大战路飞', see: '左边是金发少年，右边是戴草帽的少年。'}]);
});

test('a slow look does not hold the result back', async () => {
  const shelf = shelfOn(director(), {lookWaitMs: 20, see: () => new Promise(resolve => setTimeout(resolve, 200, {name: '晚到', see: '晚到的描述', parts: []}))});
  const fact = await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '海报'", turn: {}}).id, image(POSTER));
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
  await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '一'", turn: {}}).id, image(POSTER));
  await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '二'", turn: {}}).id, image('https://cdn.example/two.png'));
  assert.match(shelf.context('call'), /最新的是 a2/u);
  assert.equal(shelf.pick('call', 'a1'), true);
  assert.match(shelf.context('call'), /用户正点着 a1/u);
  assert.equal(shelf.pick('call', 'a9'), false);
  shelf.seen('call', ['a1']);
  assert.equal(shelf.shown('call', 'a1'), true);
  assert.equal(shelf.shown('call', 'a2'), false);
});

test('what the caller asks V to make is the turn\'s picture: what was drawn for the turn is taken back, and nothing more is drawn', async () => {
  // (Call of 11/21: the illustrator opened a page under the request's words, with a photograph, then
  // listed V's "on it"; the made thing went up on a second page and the view went back and forth.)
  const board = director(['{"op":"scene","title":"海贼王海报"}\n{"op":"put","block":{"id":"l0","t":"list","items":[{"id":"i1","h":"强者天下","cue":0}]}}',
    '{"op":"scene","title":"Q版海报"}\n{"op":"put","block":{"id":"p1","t":"photo","query":"路飞","cue":-1}}',
    '{"op":"none"}', '{"op":"put","block":{"id":"l2","t":"list","items":[{"id":"i1","h":"圆乎乎","cue":0}]}}']);
  const shelf = shelfOn(board), long = '最近能查到海报的是强者天下，它是系列第十部剧场版，尾田荣一郎第一次当总制作，上映海报上草帽一伙全员集结，整张海报走复古风。';
  await board.run({owner: 'call', trigger: 'assistant_end', turns: [{role: 'user', text: '查一下海贼王剧场版的海报'}, {role: 'assistant', text: long}]});
  const before = board.scene('call');
  assert.equal(before.title, '海贼王海报');
  await board.run({owner: 'call', trigger: 'user', turns: [{role: 'user', text: '把那个海报变成Q版的'}]});
  assert.equal(board.scene('call').title, 'Q版海报');
  shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare 'Q版海贼王海报'", turn: {}});
  // The page drawn for the request is gone; the thing has a page of its own, further on from the one V was on.
  const pages = board.canvas('call').zones;
  assert.deepEqual(pages.map(page => [page.title, page.blocks.map(block => block.t)]), [['海贼王海报', ['list']], ['', ['work']]]);
  assert.equal(board.scene('call').from, 'z1');
  assert.ok(board.scene('call').rev > before.rev);
  // V's words about making it are not drawn, this turn or while it is still being made.
  const said = [{role: 'user', text: '把那个海报变成Q版的'}, {role: 'assistant', text: '好，把海贼王剧场版海报改成全员Q版卡通风格。正在调整，会保留原海报的构图，把所有人都改成圆乎乎的Q版样子，稍等一下就好。'}];
  assert.equal((await board.run({owner: 'call', trigger: 'assistant_end', turns: said})).reason, 'making');
  assert.equal((await board.run({owner: 'call', trigger: 'user', turns: [{role: 'user', text: '继续呀'}]})).reason, 'making');
  assert.equal(board.canvas('call').zones.length, 2);
  // Made, and the caller has moved on: the board is drawn as ever.
  await shelf.finish('call', 'a1', image(POSTER));
  await board.run({owner: 'call', trigger: 'user', turns: [{role: 'user', text: '这张图好在哪'}]});
  assert.equal((await board.run({owner: 'call', trigger: 'assistant_end', turns: [{role: 'user', text: '这张图好在哪'}, {role: 'assistant', text: '这张图好在全员都变成了圆乎乎的Q版，构图和原来的海报一样，颜色更亮，看起来特别热闹，很适合做成贴纸或者头像。'}]})).reason, 'drawn');
});

test('things made one after another share a page; the video of one takes its frame without leaving the page', async () => {
  const board = director(), shelf = shelfOn(board), make = words => shelf.begin('call', {command: `makaron edit --image-model gpt-image-2.6-flare '${words}'`, turn: {}});
  await shelf.finish('call', make('Q版海报').id, image(POSTER));
  const page = board.scene('call').serial;
  shelf.begin('call', {command: "makaron video create --video-model fal-h3-max --image a1 --script '<<<media_1>>> 搞怪'", turn: {}});
  await shelf.finish('call', 'a2', video(FILM));
  await shelf.finish('call', make('路飞单人海报').id, image('https://cdn.example/luffy.png'));
  await shelf.finish('call', make('索隆单人海报').id, image('https://cdn.example/zoro.png'));
  assert.equal(board.scene('call').serial, page);
  assert.equal(board.canvas('call').zones.length, 1);
  assert.deepEqual(board.scene('call').blocks.map(block => [block.asset, block.w]), [['a2', 'half'], ['a3', 'half'], ['a4', 'half']]);
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

test('a lesson\'s script may ask for one picture to be drawn, where the call can make one; nothing else may', async () => {
  const made = [];
  const reply = '{"op":"scene","title":"光合作用"}\n{"op":"put","block":{"id":"l1","t":"list","items":[{"id":"i1","h":"阳光","cue":0}]}}\n{"op":"put","block":{"id":"w1","t":"work","make":"一片叶子里的小工厂，水彩","caption":"叶子工厂","cue":2}}';
  const script = '叶子要吃阳光。它还要喝水。你可以把叶子想成一座小工厂，阳光是电，水和空气是原料，做出来的是糖。';
  const said = [{role: 'user', text: '给十二讲讲光合作用'}, {role: 'assistant', text: script}];
  const notes = {title: '光合作用', ask: '给十二讲讲光合作用', script, lines: [{say: '叶子要吃阳光。', show: 'list：阳光'}, {say: '你可以把叶子想成一座小工厂', show: '现画：一片叶子里的小工厂，水彩'}]};
  const types = (board, owner) => board.scene(owner).blocks.map(block => block.t);
  // V's own answer (no script): the illustrator's wish for a picture is not a request to make one.
  const plain = director([reply]), free = shelfOn(plain);
  free.attach('call', async () => { made.push('unasked'); return image(POSTER); });
  await plain.run({owner: 'call', trigger: 'assistant_end', turns: said});
  assert.deepEqual(types(plain, 'call'), ['list']);
  // A script, but a call with no executor of its own: the picture is left out, the rest is drawn.
  const bound = director([reply]);
  shelfOn(bound);
  bound.note('call', notes);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(types(bound, 'call'), ['list']);
  // A script that does not itself ask for a drawn picture: the illustrator's wish is not enough (a picture is paid for).
  const sober = director([reply]), still = shelfOn(sober);
  still.attach('call', async () => { made.push('unscripted'); return image(POSTER); });
  sober.note('call', {...notes, lines: [{say: '叶子要吃阳光。', show: 'list：阳光'}, {say: '你可以把叶子想成一座小工厂', show: '图集：加一张 叶子'}]});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(types(sober, 'call'), ['list']);
  assert.deepEqual(made, []);
  // A script on a call that can make one: the sketch is on the page at once, the picture follows.
  const board = director([reply, reply]), shelf = shelfOn(board);
  shelf.attach('call', async ({prompt, aspect}) => { made.push([prompt, aspect]); return image(POSTER); });
  board.note('call', notes);
  await new Promise(resolve => setTimeout(resolve, 20));
  const work = board.scene('call').blocks.find(block => block.t === 'work');
  assert.equal(work.asset, 'a1');
  assert.equal(work.make, undefined);
  assert.ok(work.q, 'it appears when the voice reaches its clause');
  assert.deepEqual(made, [['一片叶子里的小工厂，水彩', '4:3']]);
  assert.equal(shelf.get('call', 'a1').state, 'ready');
  assert.equal(shelf.get('call', 'a1').name, '叶子工厂');
  // The page asking again for the same script keeps the picture; no second one is made.
  await board.run({owner: 'call', trigger: 'assistant_end', turns: said});
  assert.equal(made.length, 1);
});

test('a lesson draws a picture only for a page with no photographs, and only where it has room', async () => {
  // (11/21–27: nine of the ten pictures drawn for the owner's lessons went up beside one to six photographs;
  // two more were made for a page already full and never shown.)
  const script = '叶子要吃阳光。它还要喝水。你可以把叶子想成一座小工厂，阳光是电，水和空气是原料，做出来的是糖。';
  const draw = '{"op":"put","block":{"id":"w1","t":"work","make":"一片叶子里的小工厂，水彩","caption":"叶子工厂","cue":2}}';
  const lines = show => [{say: '叶子要吃阳光。', show}, {say: '你可以把叶子想成一座小工厂', show: '现画：一片叶子里的小工厂，水彩'}];
  const attempt = async ({show, page}) => {
    const made = [], asked = [];
    const board = createBoardDirector({complete: async function* ({messages}) { asked.push(JSON.parse(messages.at(-1).content)); yield `{"op":"scene","title":"光合作用"}\n${page}\n${draw}\n`; },
      stream: {instructions: CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
    const shelf = shelfOn(board);
    shelf.attach('call', async ({prompt}) => { made.push(prompt); return image(POSTER); });
    board.note('call', {title: '光合作用', ask: '讲讲光合作用', script, lines: lines(show)});
    await new Promise(resolve => setTimeout(resolve, 20));
    return {made, offered: asked.some(request => request.make === true), types: board.scene('call').blocks.map(block => block.t)};
  };
  const words = '{"op":"put","block":{"id":"l1","t":"list","items":[{"id":"i1","h":"阳光","cue":0}]}}';
  // Nothing to show but words: the script's picture is drawn.
  const bare = await attempt({show: 'list：阳光', page: words});
  assert.deepEqual([bare.made.length, bare.offered, bare.types], [1, true, ['list', 'work']]);
  // The script shows a photograph or a pictured item: no picture is drawn, and the illustrator is not told it may.
  for (const show of ['photo：太阳', 'list 带图：加一项 阳光（配图 太阳）', '图集：几片叶子']) {
    const pictured = await attempt({show, page: words});
    assert.deepEqual([pictured.made.length, pictured.offered], [0, false], show);
  }
  // The illustrator put a photograph up on its own: the page has something to show, nothing is drawn.
  const photo = await attempt({show: 'list：阳光', page: '{"op":"put","block":{"id":"l1","t":"list","items":[{"id":"i1","h":"太阳","img":"太阳","cue":0}]}}'});
  assert.equal(photo.made.length, 0);
  // A print put up on the caller's question, before there was a script, is not the lesson's photograph: a story
  // told in drawn scenes still gets its picture.
  {
    const made = [];
    const board = createBoardDirector({complete: async function* ({messages}) {
      const request = JSON.parse(messages.at(-1).content);
      yield request.notes ? `${words}\n${draw}\n` : '{"op":"scene","title":"小恐龙"}\n{"op":"put","block":{"id":"p1","t":"photo","query":"小恐龙"}}\n';
    }, stream: {instructions: CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}});
    const shelf = shelfOn(board);
    shelf.attach('call', async ({prompt}) => { made.push(prompt); return image(POSTER); });
    await board.run({owner: 'call', trigger: 'user', turns: [{role: 'user', text: '讲个小恐龙的睡前故事'}]});
    board.note('call', {title: '小恐龙', ask: '讲个小恐龙的睡前故事', script, lines: lines('list：阳光')});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(made.length, 1, 'the opening print does not count');
  }
  // A page already holding four blocks: the picture would never be shown, so it is not made.
  const full = await attempt({show: 'list：阳光', page: ['s1', 's2', 's3', 's4'].map((id, n) => `{"op":"put","block":{"id":"${id}","t":"sticky","text":"第${n + 1}条","cue":0}}`).join('\n')});
  assert.deepEqual([full.made.length, full.types.length], [0, 4]);
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

test('a photograph found for the board can be the picture a thing is made from', async () => {
  const board = director(), shelf = shelfOn(board), lent = [];
  shelf.share = async query => { lent.push(query); return query.includes('取不到') ? null : {url: `https://voice.example/voice/board-shared/${lent.length}.jpg`, until: Date.now() + 60000}; };
  shelf.found('call', {query: '航海王 强者天下 上映海报', name: '上映海报'});
  shelf.found('call', {query: '航海王 强者天下 复古风 海报', name: '复古风海报'});
  shelf.found('call', {query: '航海王 强者天下 上映海报', name: '上映海报'});
  shelf.found('call', {query: '取不到的图', name: '取不到'});
  assert.match(shelf.context('call'), /还没有做好的图片或视频。搜到的照片（可当参考图）：p1「上映海报」、p2「复古风海报」、p3「取不到」。/u);
  // Tapped on the page, a photograph is "this one" like a made thing; it can be fetched to be saved.
  assert.equal(shelf.pick('call', 'p2'), true);
  assert.match(shelf.context('call'), /用户正点着 p2「复古风海报」。/u);
  assert.equal(shelf.pick('call', 'p9'), false);
  assert.deepEqual(shelf.page('call').photos.map(({id, query}) => [id, query]), [['p1', '航海王 强者天下 上映海报'], ['p2', '航海王 强者天下 复古风 海报'], ['p3', '取不到的图']]);
  assert.equal(await shelf.address('call', 'p1'), 'https://voice.example/voice/board-shared/1.jpg');
  assert.equal(await shelf.address('call', 'p3'), '');
  assert.equal(await shelf.address('call', 'p8'), '');
  shelf.pick('call', '');
  // Only the photograph the command names is lent out, and only then.
  const command = "makaron edit --image-model gpt-image-2.6-flare --image p2 '把这张海报改成全员Q版'";
  assert.match(shelf.begin('other', {command, turn: {}}).error, /没有可用的图片 p2/u);
  await shelf.lend('call', command);
  assert.deepEqual(lent, ['航海王 强者天下 上映海报', '取不到的图', '航海王 强者天下 复古风 海报']);
  const begun = shelf.begin('call', {command, turn: {}});
  assert.equal(begun.command, "makaron edit --image-model gpt-image-2.6-flare --image 'https://voice.example/voice/board-shared/3.jpg' '把这张海报改成全员Q版'");
  assert.equal(shelf.get('call', begun.id).from, 'p2');
  // The page is given the photograph too, so the frame can show what the thing is being made of.
  assert.deepEqual(shelf.page('call').assets.map(({id, source, from}) => [id, source, from]), [['p2', 'search', undefined], ['a1', 'made', 'p2']]);
  // One that cannot be fetched is said to be so; nothing is submitted with a made-up picture.
  await shelf.lend('call', "makaron edit --image-model gpt-image-2.6-flare --image p3 'x'");
  assert.match(shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare --image p3 'x'", turn: {}}).error, /「取不到」这张这次没能取到/u);
  // For V's backend the latest few are lent together, with their addresses.
  await shelf.lend('call');
  assert.match(shelf.backendContext('call'), /p1「上映海报」 链接 https:\/\/voice\.example\/voice\/board-shared\/\d\.jpg；p2「复古风海报」/u);
  // On the page, the photograph is the thing's source, not one of its versions.
  const page = new Map(shelf.page('call').assets.map(item => [item.id, item]));
  assert.deepEqual(assetFamily(page, 'a1').map(item => item.id), ['a1']);
});

test('a photograph is called on the shelf what it is called on the board', () => {
  const pages = [{blocks: [{id: 'p', t: 'photo', query: '故宫', caption: '紫禁城'}, {id: 'l', t: 'list', items: [{id: 'i1', h: '**复古风**海报', img: '强者天下 复古风'}]},
    {id: 'v', t: 'versus', sides: [{h: 'Model 3', img: '特斯拉 Model 3'}], items: []}]}, null];
  assert.equal(pictureName(pages, '故宫'), '紫禁城');
  assert.equal(pictureName(pages, '强者天下 复古风'), '复古风海报');
  assert.equal(pictureName(pages, '特斯拉 Model 3'), 'Model 3');
  assert.equal(pictureName(pages, '没在页上'), '没在页上');
  // Two rows each with a picture of the same name: the row's heading tells them apart.
  const rows = [{blocks: [{id: 'g1', t: 'list', h: '皮卡丘', items: [{id: 'a', h: '官方立绘', img: '皮卡丘 官方立绘'}, {id: 'b', h: '动画放电', img: '皮卡丘 动画'}]}, {id: 'g2', t: 'list', h: '路飞', items: [{id: 'c', h: '官方立绘', img: '路飞 官方立绘'}]}]}];
  assert.equal(pictureName(rows, '皮卡丘 官方立绘'), '皮卡丘 官方立绘');
  assert.equal(pictureName(rows, '路飞 官方立绘'), '路飞 官方立绘');
  assert.equal(pictureName(rows, '皮卡丘 动画'), '动画放电');
});

test('the frame of a thing that was not made leaves the page when the next thing goes up', async () => {
  const board = director(), shelf = shelfOn(board), make = words => shelf.begin('call', {command: `makaron edit --image-model gpt-image-2.6-flare '${words}'`, turn: {}});
  await shelf.finish('call', make('海报').id, image(POSTER));
  await shelf.finish('call', make('电影海报版').id, {isError: true});
  assert.deepEqual(board.scene('call').blocks.map(block => [block.asset, block.w]), [['a1', 'half'], ['a2', 'half']], 'it says so while nothing else has come');
  make('纯电影海报');
  assert.deepEqual(board.scene('call').blocks.map(block => [block.asset, block.w]), [['a1', 'half'], ['a3', 'half']]);
  // Alone again, a thing has the page's width.
  const one = director(), single = shelfOn(one), again = words => single.begin('call', {command: `makaron edit --image-model gpt-image-2.6-flare '${words}'`, turn: {}});
  await single.finish('call', again('一').id, {isError: true});
  again('二');
  assert.deepEqual(one.scene('call').blocks.map(block => [block.asset, block.w]), [['a2', undefined]]);
});

test('V is told of the photographs on the page in the order they stand there, whatever order they arrived in', async () => {
  const board = director(['{"op":"scene","title":"山里的照片"}\n{"op":"put","block":{"id":"g","t":"list","look":"gallery","items":[{"id":"i1","h":"清晨的山谷","img":"清晨 山谷"},{"id":"i2","h":"林间小路","img":"林间 小路"},{"id":"i3","h":"雪山下的湖","img":"雪山 湖"}]}}']);
  const shelf = shelfOn(board);
  await board.run({owner: 'call', trigger: 'assistant_end', turns: [{role: 'user', text: '找几张山的图片'}, {role: 'assistant', text: '这张是清晨的山谷，这张是林子里的小路，这张是雪山下的湖，三张都是实拍，挑一张你喜欢的，我可以照着它再画一张。'}]});
  shelf.found('call', {query: '城市 夜景', name: '城市夜景'});
  for (const [query, name] of [['雪山 湖', '雪山下的湖'], ['清晨 山谷', '清晨的山谷'], ['林间 小路', '林间小路']]) shelf.found('call', {query, name});
  assert.match(shelf.context('call'), /这一页上搜到的照片（按画面上的先后，可当参考图）：p3「清晨的山谷」、p4「林间小路」、p2「雪山下的湖」。之前页上的：p1「城市夜景」。/u);
});

test('a thing is made from a picture of each character, each named by what it is called on the board', async () => {
  // (Call of 11/21: "after p10's Zygarde", and p10 was a photograph of Luffy; and a command with two pictures was refused.)
  const board = director(), shelf = shelfOn(board, {see: async () => ({name: '尼卡海报', see: '白发的尼卡路飞在画面中间。', parts: []})});
  shelf.share = async query => ({url: `https://voice.example/voice/board-shared/${encodeURIComponent(query)}.jpg`, until: Date.now() + 60000});
  for (const [query, name] of [['路飞 齿轮四 弹跳人', '四档 弹跳人'], ['路飞 五档 太阳神尼卡 官方图', '五档 尼卡'], ['基格尔德 10%形态 官方图', '10%形态'], ['基格尔德 完全体形态', '基格尔德 完全体形态']]) shelf.found('call', {query, name});
  await shelf.finish('call', shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare '尼卡路飞电影海报'", turn: {}}).id, image(POSTER));
  await new Promise(resolve => setTimeout(resolve, 5));
  // Two characters, two pictures: the made poster as the base, the photograph of the other by its name.
  const command = "makaron edit --image-model gpt-image-2.6-flare --image 尼卡海报 --ref '基格尔德完全体' '两人正面对战'";
  await shelf.lend('call', command);
  const begun = shelf.begin('call', {command, turn: {}});
  assert.equal(begun.command, `makaron edit --image-model gpt-image-2.6-flare --image '${POSTER}' --ref 'https://voice.example/voice/board-shared/${encodeURIComponent('基格尔德 完全体形态')}.jpg' '两人正面对战'`);
  assert.deepEqual(shelf.get('call', begun.id).refs, ['a1', 'p4']);
  assert.equal(shelf.get('call', begun.id).from, 'a1');
  // V is told what the thing was really made from, by name; the page is given those pictures to show.
  const fact = await shelf.finish('call', begun.id, image('https://cdn.example/battle.png'));
  assert.deepEqual(fact.references, ['尼卡海报', '基格尔德 完全体形态']);
  assert.deepEqual(shelf.page('call').assets.map(({id, refs}) => [id, refs]), [['p4', undefined], ['a1', undefined], ['a2', ['a1', 'p4']]]);
  // A video with a picture of each, named in the script by its place.
  const film = "makaron video create --video-model fal-h3-max --image '五档尼卡' --image p4 --script '<<<media_1>>> 的路飞对战 <<<media_2>>> 的基格尔德'";
  await shelf.lend('call', film);
  assert.deepEqual(shelf.get('call', shelf.begin('call', {command: film, turn: {}}).id).refs, ['p2', 'p4']);
  // A name nothing on the screen goes by is said to be so, with what there is; nothing is submitted with a wrong picture.
  const wrong = shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare --ref '皮卡丘' 'x'", turn: {}});
  assert.match(wrong.error, /屏幕上没有叫「皮卡丘」的图片；本次没有提交。现有：p1「四档 弹跳人」、p2「五档 尼卡」、p3「10%形态」、p4「基格尔德 完全体形态」、a1「尼卡海报」/u);
});

test('a found photograph is looked at: one that is not the thing it was searched for is said to be so, and is not a picture to work from', async () => {
  // (My own test call of 11/21: "柴犬全身" was a photograph of a rubber stamp, and V gave it as the picture of the dog.)
  const looked = [];
  const shelf = shelfOn(director(), {see: async ({check, bytes}) => { looked.push([check.name, bytes.length]); return check.name === '柴犬全身' ? {see: '一枚印章和纸上的小狗线稿', fits: false} : {see: '一只趴着的布偶猫', fits: true}; }});
  shelf.picture = async query => ({bytes: Buffer.from(query), type: 'image/jpeg'});
  shelf.share = async query => ({url: `https://voice.example/s/${encodeURIComponent(query)}.jpg`, until: Date.now() + 60000});
  shelf.found('call', {query: '柴犬 站姿 全身', name: '柴犬全身'});
  shelf.found('call', {query: '柴犬 正脸 特写', name: '柴犬正脸'});
  shelf.found('call', {query: '布偶猫 趴沙发', name: '布偶猫趴沙发'});
  await Promise.all(shelf.page('call').photos.map(() => new Promise(resolve => setTimeout(resolve, 5))));
  assert.deepEqual(looked.map(([name]) => name).sort(), ['布偶猫趴沙发', '柴犬全身', '柴犬正脸']);
  assert.match(shelf.context('call'), /p1「柴犬全身」（搜错了，图里其实是：一枚印章和纸上的小狗线稿）、p2「柴犬正脸」、p3「布偶猫趴沙发」/u);
  const command = "makaron edit --image-model gpt-image-2.6-flare --ref 柴犬全身 --ref 布偶猫趴沙发 '一起坐在沙发上'";
  await shelf.lend('call', command);
  const refused = shelf.begin('call', {command, turn: {}});
  assert.match(refused.error, /「柴犬全身」这张搜到的图不对：图里其实是一枚印章和纸上的小狗线稿。本次没有提交。.*现有：p2「柴犬正脸」、p3「布偶猫趴沙发」/u);
  const right = "makaron edit --image-model gpt-image-2.6-flare --ref 柴犬正脸 --ref 布偶猫趴沙发 '一起坐在沙发上'";
  await shelf.lend('call', right);
  assert.deepEqual(shelf.get('call', shelf.begin('call', {command: right, turn: {}}).id).refs, ['p2', 'p3']);
});

test('the eye checks a found photograph against the name it was searched under', async () => {
  const asked = [];
  const see = createAssetEye({complete: async function* ({messages}) { asked.push(messages); yield '{"see":"一枚方形印章，旁边纸上有小狗线稿","fits":false}'; }});
  assert.deepEqual(await see({bytes: Buffer.from([1, 2, 3]), type: 'image/jpeg', check: {query: '柴犬 站姿 全身', name: '柴犬全身'}}), {see: '一枚方形印章，旁边纸上有小狗线稿', fits: false});
  assert.equal(asked[0][1].content[0].image_url.url, 'data:image/jpeg;base64,AQID');
  assert.match(asked[0][1].content[1].text, /按「柴犬 站姿 全身」搜到的，页面上叫它「柴犬全身」/u);
  // No picture to look at, or nothing said: not checked (and so not held against the photograph).
  assert.equal(await see({check: {query: 'x', name: 'x'}}), null);
});

test('a request only to find pictures is not one to draw any', () => {
  for (const said of ['V 帮我找几张皮卡丘和路飞的图片。', '搜一下布道石的照片', '有没有海贼王剧场版的海报', '查几张埃菲尔铁塔的壁纸给我看', '可以给我看一下现场的图片吗？']) assert.equal(asksOnlyToFind(said), true, said);
  for (const said of ['给十二讲讲光合作用', '找几张图，再画一张他们同框的', '帮我生成一张海报', '为什么天是蓝的，找图给我讲讲', '', '好的']) assert.equal(asksOnlyToFind(said), false, said);
});

test('V\'s own image is always at hand: named in a command, lent like a found photograph, never taken for a version', async () => {
  const board = director(), shelf = createAssetShelf({director: board, standing: [SELF_IMAGE]});
  board.shelf = shelf;
  const lent = [];
  shelf.share = async query => { lent.push(query); return {url: 'https://voice.example/board-shared/00000000000000000000000000000000.webp', until: Date.now() + 60000}; };
  // It is told to the voice model from the first moment, on an empty shelf too.
  assert.match(shelf.standingNote(), /常驻素材[^]*v「V 自己的形象」[^]*--image v/u);
  // (Said once beside the policy, not with every change of the screen.)
  assert.equal(shelf.context('call'), ASSET_CONTEXT_EMPTY);
  assert.deepEqual(shelf.names('call'), ['V 自己的形象']);
  // Not lent yet: it cannot be the reference, and nothing is submitted.
  assert.match(shelf.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare --image v '打电话的 V'", turn: {}}).error, /没能取到/u);
  // By its id, or by what the caller calls it.
  for (const [index, token] of ['v', 'V', "'你自己'", '"V 的形象"'].entries()) {
    const command = `makaron edit --image-model gpt-image-2.6-flare --image ${token} '打电话的 V，第 ${index} 张'`;
    await shelf.lend('call', command);
    const begun = shelf.begin('call', {command, turn: {}});
    assert.equal(begun.error, undefined, token);
    assert.match(begun.command, /--image 'https:\/\/voice\.example\/board-shared\//u, token);
  }
  assert.deepEqual(lent, [SELF_IMAGE.query]);
  // What was made from it says so; the portrait is its source, not one of its versions.
  const made = shelf.page('call').assets;
  assert.equal(made.find(item => item.id === 'v').source, 'search');
  assert.deepEqual(made.find(item => item.id === 'a1').refs, ['v']);
  // As a second picture beside one on the shelf.
  const poster = await shelf.finish('call', 'a1', image(POSTER));
  const both = shelf.begin('call', {command: `makaron edit --image-model gpt-image-2.6-flare --image ${poster.id} --ref v '把 V 放进海报'`, turn: {}});
  assert.equal(both.error, undefined);
  assert.equal((both.command.match(/https:/gu) ?? []).length, 2);
  // A shelf without one says nothing of it and knows no "v".
  const plain = createAssetShelf({director: director()});
  assert.equal(plain.context('call'), ASSET_CONTEXT_EMPTY);
  assert.equal(plain.standingNote(), '');
  assert.match(plain.begin('call', {command: "makaron edit --image-model gpt-image-2.6-flare --image v 'x'", turn: {}}).error, /屏幕上没有/u);
});

test('a call connected again as another session keeps its shelf and board, and what was begun before lands there', async () => {
  const board = director(), shelf = shelfOn(board);
  const begun = shelf.begin('first', {command: "makaron video create --video-model fal-h3-max --script 'a cat'", turn: {}});
  shelf.found('first', {query: '烤鸡', name: '烤鸡和扭结面包'});
  const told = []; shelf.watch('second', () => told.push(shelf.context('second')));
  assert.equal(board.adopt('second', 'first'), true);
  // The same things, under the new session; V there is told of them.
  assert.match(told.at(-1), /正在做、还没好：视频/u);
  assert.equal(shelf.page('second').assets[0].id, begun.id);
  assert.equal(shelf.page('second').call, 'second');
  assert.equal(shelf.page('first').assets.length, 0);
  assert.ok(board.scene('second').blocks.some(block => block.t === 'work' && block.asset === begun.id));
  // Finished under the old session's name: on the shelf where the call is now. A new thing gets a new id.
  assert.equal(shelf.heir('first'), 'second');
  const fact = await shelf.finish('first', begun.id, {media: {kind: 'video', url: 'https://cdn.example/cat.mp4'}});
  assert.equal(fact.id, begun.id);
  assert.equal(shelf.page('second').assets[0].state, 'ready');
  assert.notEqual(shelf.begin('second', {command: "makaron edit --image-model gpt-image-2.6-flare 'a dog'", turn: {}}).id, begun.id);
  // A session with things of its own is not overwritten; the old board of one that never had any is nothing to carry.
  shelf.begin('third', {command: "makaron edit --image-model gpt-image-2.6-flare 'x'", turn: {}});
  assert.equal(shelf.adopt('third', 'second'), false);
  assert.equal(board.adopt('fourth', 'nobody'), false);
});

test('a picture the caller points at is what is worked from', async () => {
  const shelf = shelfOn(director());
  shelf.found('call', {query: 'Oktoberfest hendl brezn', name: '烤鸡和扭结面包'});
  shelf.found('call', {query: 'Oktoberfest tent', name: '啤酒节大帐篷'});
  const video = "makaron video create --video-model fal-h3-max --script '脆皮烤鸡转动'";
  const begin = (said, command = video) => shelf.begin('call', {command, turn: {text: said}});
  const refused = begin('那个烤鸡的图片，我希望你做个 5 秒的视频，让它变得特别好吃的感觉。');
  assert.match(refused.error, /p1「烤鸡和扭结面包」[^]*--image p1[^]*<<<media_1>>>/u);
  assert.equal(shelf.page('call').assets.length, 0);
  shelf.pick('call', 'p2');
  assert.match(begin('把这张图片动起来').error, /p2/u);
  // Not pointed at, declined, or another thing altogether: made as asked.
  for (const said of ['帮我生成一张海报：烤鸡骑自行车', '再直接做一个五秒的视频，不用任何图片：一只橘猫', '那个好玩的视频再做一个', '']) assert.equal(begin(said).error, undefined, said);
});

test('the page outlives a gap in the connection and takes the next session\'s shelf whole', async () => {
  const {createAssetsClient} = await import('./board-assets-client.mjs');
  const timers = [], views = [], asked = [], synced = [];
  let clock = 0, reply = () => ({call: 'first', assets: [{id: 'a1', kind: 'video', state: 'ready'}], photos: [], picked: '', busy: false, stamp: 3});
  const client = createAssetsClient({now: () => clock, rev: () => 4, onChange: view => views.push(view.assets.get('a1')?.kind), onSync: value => synced.push(value),
    request: async body => { asked.push(body); return reply(); }, setTimer: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, clearTimer: () => {}});
  const turn = async () => { const timer = timers.shift(); clock += timer.ms; await timer.fn(); };
  client.poke(); await turn();
  assert.deepEqual(views, ['video']);
  // The connection is gone for a while: refused again and again, and it goes on asking.
  reply = () => { throw Error('409'); };
  for (let times = 0; times < 6; times++) { assert.ok(timers.length, 'still asking'); await turn(); }
  // Connected again as another session whose shelf happens to have the same stamp and an a1 of its own.
  reply = () => ({call: 'second', assets: [{id: 'a1', kind: 'image', state: 'ready'}], photos: [], picked: '', busy: false, stamp: 3, sync: {scene: {}}});
  await turn();
  assert.deepEqual(views, ['video', 'image']);
  assert.equal(asked.at(-1).call, 'first');
  assert.equal(synced.length, 1);
  // Where there never was one, two refusals end it.
  const none = [], never = createAssetsClient({request: async () => { throw Error('404'); }, setTimer: fn => { none.push(fn); return none.length; }, clearTimer: () => {}});
  never.poke(); for (let times = 0; none.length && times < 9; times++) await none.shift()();
  assert.equal(none.length, 0);
});
