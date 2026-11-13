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
  assert.equal(sticky.q, '可是妙蛙种子不怕', 'a quote that is gone falls back to the closing sentence, not to the question after it');
  const scene = lesson.ops.reduce(applyOp, emptyScene()), said = lesson.say.join('');
  const upTo = words => spokenProgress(scene, said, said.indexOf(words) + words.length).ahead;
  assert.deepEqual(upTo('十二，我们'), ['b2', 'b1/n1', 'b1/n2', 'b1/n3', 'b1/n1>n2', 'b1/n2>n3', 'b1/n3>n1']);
  assert.deepEqual(upTo('火属性的小火龙会'), ['b2', 'b1/n3', 'b1/n2>n3', 'b1/n3>n1']);
  assert.deepEqual(upTo('草属性的妙蛙种子'), ['b2', 'b1/n2>n3', 'b1/n3>n1']);
  assert.deepEqual(upTo('妙蛙种子怕火，火一烧'), ['b2', 'b1/n3>n1']);
  assert.deepEqual(upTo('不怕杰尼龟，草会'), []);
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

test('a topic with facts the models get wrong comes with a reference', async () => {
  const {lessonReference} = await import('./board-lesson.mjs');
  assert.match(lessonReference('用传说级的宝可梦讲属性相克'), /冰：草、地面、飞行、龙/u);
  assert.equal(lessonReference('火箭怎么飞上去'), '');
  const seen = [];
  const writer = createLessonWriter({director: {present() {}}, complete: async function* ({messages}) { seen.push(JSON.parse(messages[1].content)); yield reply; }});
  await writer.prepare({owner: 'c', topic: '属性相克', ask: '给十二讲讲宝可梦'});
  await writer.prepare({owner: 'd', topic: '乐高是怎么来的'});
  assert.match(seen[0].reference, /电打地面/u);
  assert.equal('reference' in seen[1], false);
});

test('both writers start at once: the preferred one wins if it is quick, the other is used when it is not', async () => {
  const other = JSON.stringify({title: '备用', say: ['第一句话。', '第二句话。'], blocks: [{id: 'n', t: 'sticky', text: '备用的'}]});
  const timed = (text, ms) => async function* ({signal}) { await new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('aborted')); }, {once: true}); }); yield text; };
  const run = async (preferredMs, fallbackMs, preferredText = reply) => {
    const shown = [];
    const writer = createLessonWriter({director: {present: (id, ops) => shown.push(ops[0].title)}, preferMs: 60, totalMs: 200, complete: timed(preferredText, preferredMs), fallback: timed(other, fallbackMs)});
    const script = await writer.prepare({owner: 'c', topic: 't'});
    return script ? shown[0] : null;
  };
  assert.equal(await run(30, 5), '谁打得过谁', 'the fallback was ready first, but the preferred lesson came in time');
  assert.equal(await run(120, 5), '备用', 'the preferred writer was slow');
  assert.equal(await run(5, 20, 'no'), '备用', 'the preferred writer came back with nothing usable');
  assert.equal(await run(500, 500), null, 'neither in time: no lesson');
});

test('a lesson in English: sentences keep their length and their spaces, and pieces hang on enough letters', async () => {
  const {spokenScript} = await import('./board-lesson.mjs');
  const english = {title: 'Three days in San Francisco', say: ['Three days, one neighbourhood a day, so you never backtrack.', 'Day one starts at Fisherman\'s Wharf, where the sea lions nap in the sun.', 'In the afternoon take the boat to Alcatraz; book that ticket first.'],
    blocks: [{id: 'd1', t: 'timeline', items: [{id: 'a', when: 'Morning', h: 'Fisherman\'s Wharf', img: 'Fisherman\'s Wharf', q: 'Day one starts at'}, {id: 'b', when: 'Afternoon', h: 'Alcatraz', img: 'Alcatraz Island', q: 'take the boat to Alcatraz'}]}]};
  const lesson = parseLesson(JSON.stringify(english));
  assert.equal(lesson.say[1].length, 72, 'not cut at the sixty characters a Chinese sentence gets');
  const said = spokenScript(lesson.say);
  assert.match(said, /backtrack\. Day one starts/u);
  const timeline = lesson.ops[1].block;
  assert.ok(timeline.items.every(item => item.q.length >= 16));
  const scene = lesson.ops.reduce(applyOp, emptyScene());
  const upTo = words => spokenProgress(scene, said, said.indexOf(words) + words.length).ahead;
  assert.deepEqual(upTo('never backtrack.'), ['d1/a', 'd1/b']);
  assert.deepEqual(upTo('Day one starts at Fisherman'), ['d1/b']);
  assert.deepEqual(upTo('take the boat to Alcatraz'), []);
  assert.match(LESSON_INSTRUCTIONS, /全部写英文/u);
});

test('the writer is given the diagram kit, and a diagram\'s piece appears where the writer put it', () => {
  for (const type of ['tiles', 'formula', 'timeline', 'versus', 'overlap', 'stack', 'scale']) assert.match(LESSON_INSTRUCTIONS, new RegExp(`"t":"${type}"`, 'u'));
  const lesson = parseLesson(JSON.stringify({title: '摆正方形', say: ['十二，我们用积木摆正方形。', '先拿四块积木，每边两块。', '十六块积木摆成正方形，每边四块。', '所以四乘四等于十六。'],
    blocks: [{id: 't', t: 'tiles', items: [{id: 'a', rows: 2, cols: 2, h: '积木', q: '先拿四块积木'}, {id: 'b', rows: 4, cols: 4, h: '16 块', q: '十六块积木'}]},
      {id: 'f', t: 'formula', items: [{id: 'x', h: '4', q: '所以四乘四'}, '×', {id: 'y', h: '4', q: '所以四乘四'}, '=', {id: 'r', h: '16', q: '等于十六'}]}]}));
  const [tiles, formula] = lesson.ops.filter(op => op.op === 'put').map(op => op.block);
  assert.equal(tiles.items[0].q, '先拿四块积木每边', 'not on the first passing mention of 积木');
  assert.deepEqual(formula.items.map(item => item.q), ['所以四乘四等于十', '所以四乘四等于十', '所以四乘四等于十', '所以四乘四等于十', '等于十六'], 'a sign comes with the term before it');
});

test('V\'s own answer is illustrated in the lesson\'s vocabulary, hung on the words V said', async () => {
  const {parseIllustration, ILLUSTRATE_INSTRUCTIONS} = await import('./board-lesson.mjs');
  const said = '最核心的是存影像的东西不一样：胶卷相机靠胶卷感光，拍一张耗一格。数码相机靠电子传感器，拍了马上能看。你更想用哪种？';
  const reply = JSON.stringify({mode: 'new', title: '胶卷 vs 数码', blocks: [{id: 'v', t: 'versus', sides: ['胶卷相机', '数码相机'], items: [{id: 'a', h: '感光', cells: ['胶卷', '**电子传感器**'], q: '胶卷相机靠胶卷感光'}, {id: 'b', h: '看照片', cells: ['洗出来', '马上能看'], win: 1, q: '拍了马上能看'}]}, {id: 'n', t: 'sticky', text: '差别在存影像的东西'}]});
  const made = parseIllustration(reply, said);
  assert.deepEqual([made.add, made.ops[0].lesson, made.ops[0].late, made.ops.map(op => op.block?.t ?? op.op)], [false, true, true, ['scene', 'versus', 'sticky']]);
  const scene = made.ops.reduce(applyOp, emptyScene());
  assert.equal(scene.late, true);
  const upTo = words => spokenProgress(scene, said, said.indexOf(words) + words.length).ahead;
  assert.deepEqual(upTo('不一样：胶卷相机靠'), ['n', 'v/b']);
  assert.deepEqual(upTo('拍了马上能看'), []);
  // Added to the page already up: only new pieces, under ids of their own.
  const added = parseIllustration(JSON.stringify({mode: 'add', blocks: [{id: 'v', t: 'sticky', text: '还要有充电位'}]}), '唯一要提前搞定的就是固定充电位，不然天天找桩反而麻烦。', ['v', 'n']);
  assert.deepEqual([added.add, added.ops.map(op => [op.op, op.block.id])], [true, [['put', 'x3']]]);
  assert.equal(parseIllustration(JSON.stringify({mode: 'add', blocks: [{id: 'q', t: 'sticky', text: 'x'}]}), 'x', []).add, false, 'nothing to add to: a new page');
  assert.deepEqual(parseIllustration('{"none":true}', said), {ops: [], add: false, none: true});
  assert.equal(parseIllustration('不会', said), null);
  assert.match(ILLUSTRATE_INSTRUCTIONS, /"t":"versus"/u);
  // The quick writer goes first; the page is described to it.
  const asked = [];
  const writer = createLessonWriter({director: {present() {}}, complete: async function* () { asked.push('slow'); yield reply; }, fallback: async function* ({messages}) { asked.push(JSON.parse(messages[1].content)); yield reply; }});
  const drawn = await writer.illustrate({owner: 'c', asked: '区别是什么', said, evidence: [{name: 'web_search', text: '胶卷是银盐'}], screen: {title: '相机史', blocks: [{id: 't', t: 'timeline', items: []}]}});
  assert.equal(drawn.writer, 'preferred');
  const request = asked.find(item => typeof item === 'object');
  assert.deepEqual([request.said, request.screen, request.evidence], [said, {title: '相机史', blocks: [{id: 't', t: 'timeline'}]}, '【web_search】胶卷是银盐']);
});

test('V\'s backend can write the lesson: it is briefed with the writer\'s rules, and its reply is read like any lesson', () => {
  const shown = [];
  const writer = createLessonWriter({director: {present: (id, ops) => shown.push(ops.length), release() {}}, complete: async function* () {}});
  const brief = writer.brief({topic: '我们的夜班模式', audience: '成年人', ask: '讲解一下我们的夜班模式'});
  assert.match(brief, /先用你自己的工具查清楚/u);
  assert.match(brief, /"t":"versus"/u);
  const script = writer.accept({owner: 'c', topic: 't', text: '好的，这是讲稿：\n' + JSON.stringify({title: '电车和油车', say: ['电车每公里只要**几分钱**。', '油车每公里要几毛。'], blocks: [{id: 'n', t: 'sticky', text: '电车每公里**几分钱**'}]})});
  assert.equal(script.say, '电车每公里只要几分钱。油车每公里要几毛。', 'highlighter marks stay on the page, not in what is said');
  assert.equal(shown.length, 1);
  assert.equal(writer.accept({owner: 'c', topic: 't', text: '我查不到。'}), null);
});

test('the streaming illustrator: a print before V speaks, then only what V has said, hung on V\'s words', async () => {
  const {refineStreamOp, STREAM_INSTRUCTIONS} = await import('./board-lesson.mjs');
  const put = block => normalizeOp({op: 'put', block});
  const {normalizeOp} = await import('./board-scene.mjs');
  // Before V has answered: the page may be opened and a print of the thing put up. No facts.
  assert.deepEqual(refineStreamOp(normalizeOp({op: 'scene', title: '故宫'}), {trigger: 'user'}), {op: 'scene', title: '故宫', lesson: true, late: true});
  assert.equal(refineStreamOp(put({id: 'p', t: 'photo', query: '故宫', q: '随便'}), {trigger: 'user'}).block.q, undefined);
  assert.equal(refineStreamOp(put({id: 'l', t: 'list', items: [{h: '太和殿'}]}), {trigger: 'user'}), null);
  // Half-way through: the item V has named stays, the one V has not said is left out for now.
  const said = '先顺着中轴线走：午门进去就是太和殿，皇帝登基都在这。';
  const list = {id: 'l', t: 'list', items: [{id: 'a', h: '太和殿', d: '登基的地方', q: '午门进去就是太和殿'}, {id: 'b', h: '珍宝馆', d: '金瓯永固杯', q: '一定要去珍宝馆'}]};
  const half = refineStreamOp(put(list), {said, trigger: 'assistant_progress'});
  assert.deepEqual(half.block.items.map(item => [item.id, item.q]), [['a', '太和殿皇帝登基都']]);
  const more = refineStreamOp(put(list), {said: said + '别只走中间，一定要去珍宝馆看金瓯永固杯。', trigger: 'assistant_end'});
  assert.deepEqual(more.block.items.map(item => item.id), ['a', 'b'], 'and comes when V gets to it');
  // A block with nothing V has said is not put up at all.
  assert.equal(refineStreamOp(put({id: 'x', t: 'list', items: [{h: '钟表馆', q: '钟表馆也值得'}]}), {said, trigger: 'assistant_progress'}), null);
  assert.match(STREAM_INSTRUCTIONS, /只能在后面追加/u);
});

test('with the streaming illustrator a lesson is a script with a note per sentence; the page is the illustrator\'s', async () => {
  const {parseScript, SCRIPT_INSTRUCTIONS, STREAM_INSTRUCTIONS} = await import('./board-lesson.mjs');
  const written = JSON.stringify({title: '摆正方形', say: ['十二，我们用积木摆正方形。', '四个一排，摆四排，正好十六个。', '所以四乘四等于十六。', '那五个一排摆五排，是几个呀？', '听懂了吗？'], show: ['photo：积木', 'tiles：4 排每排 4 个，标“16 个”', 'formula：4 × 4 = 16，16 圈出', 'tiles：5 排每排 5 个，空格子', '']});
  const script = parseScript('```json\n' + written + '\n```');
  assert.equal(script.say.length, 4, 'one closing question');
  assert.deepEqual(script.show, ['photo：积木', 'tiles：4 排每排 4 个，标“16 个”', 'formula：4 × 4 = 16，16 圈出', 'tiles：5 排每排 5 个，空格子']);
  assert.equal(parseScript('{"say":["只有一句"]}'), null);
  for (const kind of ['tiles', 'formula', 'timeline', 'versus', 'overlap', 'stack', 'scale', 'flow']) assert.match(SCRIPT_INSTRUCTIONS, new RegExp(kind, 'u'));
  assert.match(STREAM_INSTRUCTIONS, /notes 是这段话的作者留的画面提示/u);
  // The writer hands over the script and leaves its notes with the director; it puts up no page and holds nothing.
  const events = [];
  const director = {streams: true, note: (id, notes) => events.push(['note', id, notes.title, notes.lines.length, notes.lines[1]]), hold: () => events.push(['hold']), present: () => events.push(['present'])};
  const asked = [];
  const writer = createLessonWriter({director, complete: async function* ({messages}) { asked.push(messages[0].content === SCRIPT_INSTRUCTIONS); yield written; }});
  const prepared = await writer.prepare({owner: 'c', topic: '平方', audience: '5岁小朋友十二'});
  assert.equal(prepared.say, '十二，我们用积木摆正方形。四个一排，摆四排，正好十六个。所以四乘四等于十六。那五个一排摆五排，是几个呀？');
  assert.deepEqual(events, [['note', 'c', '摆正方形', 4, {say: '四个一排，摆四排，正好十六个。', show: 'tiles：4 排每排 4 个，标“16 个”'}]]);
  assert.deepEqual(asked, [true]);
  assert.match(writer.brief({topic: 't'}), /"show":\[/u);
  assert.equal(writer.accept({owner: 'd', topic: 't', text: written}).sentences.length, 4);
  assert.equal(events.at(-1)[1], 'd');
});

test('an item hangs on the sentence that first tells it, not on a closing line that names them all again', async () => {
  const {refineStreamOp} = await import('./board-lesson.mjs');
  const said = '先从一笔房贷说起：银行把钱借给收入不高的人，这叫次级贷款。银行不想自己扛风险，就把几千笔房贷打包成一份债券卖出去。评级机构给这些打包债券打了 AAA，养老基金就放心买了。房价一跌，第一批人还不上钱。一句话：借钱买房、打包转卖、评级放行、房价一跌，整条链就断了。';
  const op = refineStreamOp({op: 'put', block: {id: 'b1', t: 'steps', items: [
    {id: 's1', h: '借钱买房', d: '次级贷款', q: '借钱买房打包转卖'}, {id: 's2', h: '打包转卖', d: '几千笔房贷做成债券', q: '打包转卖评级放行'},
    {id: 's3', h: '评级放行', d: 'AAA，养老基金买入', q: '评级放行房价一跌'}, {id: 's4', h: '房价一跌', d: '第一批人还不上钱', q: '房价一跌第一批人'}]}}, {said, trigger: 'assistant_end'});
  assert.deepEqual(op.block.items.map(item => item.q.slice(0, 4)), ['先从一笔', '银行不想', '评级机构', '房价一跌']);
});
