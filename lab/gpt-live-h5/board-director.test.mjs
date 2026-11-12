import assert from 'node:assert/strict';
import test from 'node:test';
import {BOARD_INSTRUCTIONS, boardDirectorFromEnv, boundedBoardRequest, createBoardDirector, mayAskForLesson, createChatCompletionStream} from './board-director.mjs';

const lines = (...ops) => ops.map(op => JSON.stringify(op)).join('\n');
const scripted = (...replies) => {
  const calls = [];
  const complete = async function* ({messages, signal}) {
    calls.push({messages, signal});
    const reply = replies.shift() ?? lines({op: 'none'});
    for (const chunk of typeof reply === 'function' ? await reply(signal) : reply.match(/[\s\S]{1,17}/gu)) yield chunk;
  };
  return {complete, calls};
};
const turns = [{role: 'user', text: '给我讲讲语音通话是怎么接通的'}];
const steps = {op: 'put', block: {id: 's', t: 'steps', items: [{id: 'a', h: '拨号'}, {id: 'b', h: '建立连接'}, {id: 'c', h: '开始说话'}]}};

test('operations stream to the page in order, each with the revision it produced', async () => {
  const {complete, calls} = scripted(lines({op: 'scene', title: '通话接通'}, steps, {op: 'focus', id: 's/a'}));
  const director = createBoardDirector({complete}), seen = [];
  const result = await director.run({owner: 'call-1', trigger: 'user', turns, onOp: op => seen.push(op)});
  assert.deepEqual(seen.map(op => [op.op, op.rev]), [['scene', 1], ['put', 2], ['focus', 3]]);
  assert.deepEqual([result.reason, result.ops, result.rev], ['drawn', 3, 3]);
  assert.equal(calls[0].messages[0].content, BOARD_INSTRUCTIONS);
  const request = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual([request.trigger, request.screen, request.conversation], ['user', '（画面现在是空的）', turns]);
});

test('the next run reads the current screen back and edits it in place', async () => {
  const {complete, calls} = scripted(lines({op: 'scene', title: '通话接通'}, steps), lines({op: 'focus', id: 's/b'}));
  const director = createBoardDirector({complete}), seen = [];
  await director.run({owner: 'call-1', trigger: 'user', turns});
  await director.run({owner: 'call-1', trigger: 'assistant_progress', turns, clientRev: 2, onOp: op => seen.push(op)});
  assert.deepEqual(seen, [{op: 'focus', id: 's/b', rev: 3}]);
  assert.equal(JSON.parse(calls[1].messages[1].content).screen.blocks[0].id, 's');
  assert.equal(director.scene('call-1').focus, 's/b');
});

test('a page that missed operations receives the whole scene first', async () => {
  const {complete} = scripted(lines({op: 'scene', title: '通话接通'}, steps), lines({op: 'none'}));
  const director = createBoardDirector({complete}), seen = [];
  await director.run({owner: 'call-1', trigger: 'user', turns});
  const result = await director.run({owner: 'call-1', trigger: 'assistant_end', turns, clientRev: 1, onOp: op => seen.push(op)});
  assert.deepEqual(seen.map(op => op.op), ['sync']);
  assert.equal(seen[0].scene.rev, 2);
  assert.equal(result.reason, 'none');
});

test('invalid, repeated and excess operations never reach the page', async () => {
  const many = Array.from({length: 40}, (_, index) => ({op: 'focus', id: index % 2 ? 's/a' : 's/b'}));
  const {complete} = scripted(lines({op: 'scene', title: 'x'}, {op: 'put', block: {id: 'h', t: 'html', text: '<script>'}}, {op: 'run', code: '1'}, steps, steps, {op: 'focus', id: 's/zz'}, ...many));
  const director = createBoardDirector({complete}), seen = [];
  const result = await director.run({owner: 'call-1', trigger: 'user', turns, onOp: op => seen.push(op)});
  assert.equal(seen.length, 24);
  assert.equal(result.ops, 24);
  assert.equal(seen.some(op => op.block?.t === 'html' || op.op === 'run'), false);
  assert.equal(seen.filter(op => op.op === 'put').length, 1);
});

test('lookup results become evidence for that call only', async () => {
  const {complete, calls} = scripted();
  const director = createBoardDirector({complete});
  director.observe({type: 'tool.delivered', voiceSessionId: 'call-1', name: 'feishu_calendar', result: {output: {content: [{type: 'text', text: '{"events":[{"summary":"周会","start":"10:00"}]}'}]}}});
  director.observe({type: 'tool.delivered', voiceSessionId: 'call-1', name: 'exec', result: {output: {content: [{type: 'text', text: 'secret shell output'}]}}});
  director.observe({type: 'tool.delivered', voiceSessionId: 'call-1', name: 'web_search', result: {error: '搜索失败'}});
  director.observe({type: 'tool.delivered', voiceSessionId: 'call-2', name: 'memory_search', result: '别人的记忆'});
  director.observe({type: 'tool.invoke', voiceSessionId: 'call-1', name: 'web_search', args: {query: 'x'}});
  await director.run({owner: 'call-1', trigger: 'evidence', turns});
  const request = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(request.evidence, [{tool: 'feishu_calendar', result: '{"events":[{"summary":"周会","start":"10:00"}]}'}]);
  for (let index = 0; index < 6; index++) director.observe({type: 'tool.delivered', voiceSessionId: 'call-1', name: 'web_search', result: 'r' + index + 'x'.repeat(5000)});
  await director.run({owner: 'call-1', trigger: 'evidence', turns});
  const later = JSON.parse(calls[1].messages[1].content).evidence;
  assert.deepEqual(later.map(item => item.result.slice(0, 2)), ['r2', 'r3', 'r4', 'r5']);
  assert.equal(later.every(item => item.result.length === 3000), true);
});

test('a new run retires the one still writing; its late lines are ignored', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const {complete} = scripted(async () => { await gate; return [lines({op: 'scene', title: '旧的'})]; }, lines({op: 'scene', title: '新的'}));
  const director = createBoardDirector({complete}), seen = [];
  const first = director.run({owner: 'call-1', trigger: 'user', turns, onOp: op => seen.push(op.title)});
  const second = await director.run({owner: 'call-1', trigger: 'user', turns, onOp: op => seen.push(op.title)});
  release();
  assert.equal((await first).reason, 'superseded');
  assert.equal(second.reason, 'drawn');
  assert.deepEqual(seen, ['新的']);
  assert.equal(director.scene('call-1').title, '新的');
});

test('a provider failure keeps what was drawn and reports it', async () => {
  const events = [];
  const complete = async function* () { yield lines({op: 'scene', title: '半张'}) + '\n'; throw Error('upstream 503'); };
  const director = createBoardDirector({complete, audit: event => events.push(event)});
  const result = await director.run({owner: 'call-1', trigger: 'user', turns});
  assert.deepEqual([result.reason, result.ops], ['provider_failed', 1]);
  assert.equal(director.scene('call-1').title, '半张');
  assert.deepEqual([events[0].type, events[0].voiceSessionId, events[0].trigger], ['board.run', 'call-1', 'user']);
  assert.equal((await createBoardDirector().run({owner: 'x', trigger: 'user', turns})).reason, 'unavailable');
});

test('calls are bounded: rate, owners and forget', async () => {
  let time = 0;
  const {complete, calls} = scripted();
  const director = createBoardDirector({complete, now: () => time, maxOwners: 2});
  for (let index = 0; index < 400; index++) await director.run({owner: 'busy', trigger: 'assistant_progress', turns});
  assert.equal((await director.run({owner: 'busy', trigger: 'user', turns})).reason, 'rate_limited');
  assert.equal(calls.length, 400);
  time += 16 * 60000;
  assert.equal((await director.run({owner: 'busy', trigger: 'user', turns})).reason, 'none');
  const drawn = scripted(lines({op: 'scene', title: 'a'}));
  const small = createBoardDirector({complete: drawn.complete, now: () => time, maxOwners: 2});
  await small.run({owner: 'one', trigger: 'user', turns});
  await small.run({owner: 'two', trigger: 'user', turns});
  await small.run({owner: 'three', trigger: 'user', turns});
  assert.equal(small.scene('one').rev, 0, 'the oldest call was evicted');
  small.forget('three');
  assert.equal(small.scene('three').rev, 0);
});

test('page requests are validated and bounded', () => {
  const ok = boundedBoardRequest({trigger: 'user', rev: 0, turns: [{role: 'user', text: ' 你好 '}, {role: 'assistant', text: 'a'.repeat(1500)}, {role: 'document', text: 'd'.repeat(2000)}]});
  assert.deepEqual([ok.trigger, ok.clientRev, ok.turns[0].text, ok.turns[1].text.length, ok.turns[2].text.length], ['user', 0, '你好', 800, 2000]);
  for (const bad of [null, {trigger: 'tool', rev: 0, turns: [{role: 'user', text: 'x'}]}, {trigger: 'user', rev: -1, turns: [{role: 'user', text: 'x'}]},
    {trigger: 'user', rev: 0, turns: []}, {trigger: 'user', rev: 0, turns: Array(9).fill({role: 'user', text: 'x'})},
    {trigger: 'user', rev: 0, turns: [{role: 'system', text: 'x'}]}, {trigger: 'user', rev: 0, turns: [{role: 'user', text: 'x'.repeat(2001)}]},
    {trigger: 'user', rev: 0, turns: [{role: 'user', text: '   '}]}]) assert.equal(boundedBoardRequest(bad), null);
});

test('the model stream is read as server-sent deltas with thinking off', async () => {
  const requests = [];
  const sse = ['data: {"choices":[{"delta":{"content":"{\\"op\\":"}}]}\n\ndata: {"choices":[{"delta":{"con', 'tent":"\\"none\\"}"}}]}\n\n: ping\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"late"}}]}\n\n'];
  const fetchImpl = async (url, init) => { requests.push({url, init}); return {ok: true, status: 200, body: (async function* () { for (const part of sse) yield Buffer.from(part); })()}; };
  const complete = createChatCompletionStream({apiKey: 'test-key', model: 'm', endpoint: 'https://model.invalid/chat', extra: {thinking: {type: 'disabled'}}, fetchImpl});
  let text = '';
  for await (const chunk of complete({messages: [{role: 'user', content: 'x'}]})) text += chunk;
  assert.equal(text, '{"op":"none"}');
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual([body.model, body.stream, body.thinking.type, requests[0].init.headers.authorization], ['m', true, 'disabled', 'Bearer test-key']);
  const failing = createChatCompletionStream({apiKey: 'k', model: 'm', endpoint: 'https://model.invalid/chat', fetchImpl: async () => ({ok: false, status: 503})});
  await assert.rejects(async () => { for await (const _ of failing({messages: []})); }, /HTTP 503/u);
});

test('the board is off unless the flag and a credential are both present', async () => {
  assert.equal(boardDirectorFromEnv({}), null);
  assert.equal(boardDirectorFromEnv({VOICE_BOARD: '1'}), null);
  assert.equal(boardDirectorFromEnv({DEEPSEEK_API_KEY: 'k', OPENROUTER_API_KEY: 'k'}), null);
  const requests = [], fetchImpl = async (url, init) => { requests.push({url, body: JSON.parse(init.body), key: init.headers.authorization}); return {ok: false, status: 500}; };
  const run = env => boardDirectorFromEnv({VOICE_BOARD: '1', ...env}, {fetchImpl}).run({owner: 'x', trigger: 'user', turns});
  assert.equal((await run({DEEPSEEK_API_KEY: 'direct', OPENROUTER_API_KEY: 'router'})).reason, 'provider_failed');
  await run({OPENROUTER_API_KEY: 'router'});
  await run({OPENROUTER_API_KEY: 'router', VOICE_BOARD_MODEL: 'vendor/other'});
  assert.deepEqual(requests.map(r => [new URL(r.url).host, r.body.model, r.key]), [
    ['api.deepseek.com', 'deepseek-flash', 'Bearer direct'],
    ['openrouter.ai', 'deepseek/deepseek-v4.1-flash', 'Bearer router'],
    ['openrouter.ai', 'vendor/other', 'Bearer router']]);
  assert.deepEqual([requests[0].body.thinking, requests[1].body.reasoning], [{type: 'disabled'}, {enabled: false}]);
});

test('a picture is not replaced while V is still mid-sentence', async () => {
  const other = [{op: 'scene', title: '另一个话题'}, {op: 'put', block: {id: 'n', t: 'note', text: '不该出现'}}];
  const {complete} = scripted(lines({op: 'scene', title: '通话接通'}, steps), lines(...other), lines({op: 'scene', title: '通话接通'}, {op: 'focus', id: 's/b'}), lines(...other));
  const director = createBoardDirector({complete}), seen = [];
  await director.run({owner: 'call-1', trigger: 'user', turns});
  const progress = await director.run({owner: 'call-1', trigger: 'assistant_progress', turns, clientRev: 2, onOp: op => seen.push(op.op)});
  assert.deepEqual([progress.reason, seen, director.scene('call-1').title, director.scene('call-1').blocks.length], ['none', [], '通话接通', 1]);
  await director.run({owner: 'call-1', trigger: 'assistant_progress', turns, clientRev: 2, onOp: op => seen.push(op.op)});
  assert.deepEqual(seen, ['focus'], 'naming the current picture again is harmless');
  const end = await director.run({owner: 'call-1', trigger: 'assistant_end', turns, clientRev: 3});
  assert.deepEqual([end.reason, director.scene('call-1').title], ['drawn', '另一个话题']);
});

test('a new question starts without the last question\'s lookup results', async () => {
  const {complete, calls} = scripted();
  const director = createBoardDirector({complete});
  director.observe({type: 'tool.delivered', voiceSessionId: 'call-1', name: 'web_search', result: '大熊猫的资料'});
  await director.run({owner: 'call-1', trigger: 'assistant_end', turns});
  await director.run({owner: 'call-1', trigger: 'user', turns: [{role: 'user', text: '换个话题，讲讲 HTTPS'}]});
  director.observe({type: 'tool.delivered', voiceSessionId: 'call-1', name: 'web_search', result: 'HTTPS 的资料'});
  await director.run({owner: 'call-1', trigger: 'evidence', turns});
  const evidence = calls.map(call => JSON.parse(call.messages[1].content).evidence?.map(item => item.result));
  assert.deepEqual(evidence, [['大熊猫的资料'], undefined, ['HTTPS 的资料']]);
});

test('while a lesson is being written the director draws nothing, and a run in flight is dropped', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const director = createBoardDirector({complete: async function* () { await gate; yield '{"op":"scene","title":"抢先画的"}\n{"op":"put","block":{"id":"z","t":"sticky","text":"导演画的"}}\n'; }});
  const early = director.run({owner: 'c', trigger: 'user', turns: [{role: 'user', text: '给十二讲讲属性相克'}]});
  director.hold('c');
  release();
  await early;
  assert.equal(director.scene('c').blocks.length, 0, 'the picture guessed for the same question never shows');
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'assistant', text: '好，我想想怎么讲'}]})).reason, 'lesson');
  director.release('c');
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'assistant', text: 'x'}]})).reason, 'drawn');
});

test('with lessons on, a request to explain is not guessed at; what V then says is drawn as usual', async () => {
  let models = 0;
  const director = createBoardDirector({defers: mayAskForLesson, complete: async function* () { models++; yield '{"op":"scene","title":"t"}\n{"op":"put","block":{"id":"z","t":"sticky","text":"x"}}\n'; }});
  assert.equal((await director.run({owner: 'c', trigger: 'user', turns: [{role: 'user', text: '那你用传说级的宝可梦再给十二讲解一下'}]})).reason, 'deferred');
  assert.equal(models, 0);
  assert.equal((await director.run({owner: 'c', trigger: 'user', turns: [{role: 'user', text: '明天天气怎么样'}]})).reason, 'drawn');
  assert.notEqual((await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '给我讲讲火箭'}, {role: 'assistant', text: '火箭靠往下喷气飞上去。'}]})).reason, 'deferred');
  assert.equal(models, 2);
});

test('with an illustrator the board draws one way: nothing before V has answered, then a page for the answer', async () => {
  const calls = [];
  const page = [{op: 'scene', title: '胶卷 vs 数码', lesson: true, late: true}, {op: 'put', block: {id: 'n', t: 'sticky', text: '差别在存影像的东西', q: '存影像的东西'}}];
  let models = 0;
  const director = createBoardDirector({complete: async function* () { models++; }, illustrate: async args => { calls.push(args); return args.said.includes('不知道') ? null : {ops: page, add: false, writer: 'preferred'}; }});
  const long = '最核心的是存影像的东西不一样：胶卷相机靠涂了银盐的胶卷感光，拍一张耗一格，要洗出来才能看到；数码相机靠电子传感器，拍了马上能看。';
  const turns = [{role: 'user', text: '数码相机和胶卷相机的区别'}, {role: 'assistant', text: long}];
  assert.equal((await director.run({owner: 'c', trigger: 'user', turns: turns.slice(0, 1)})).reason, 'waiting');
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_progress', turns})).reason, 'waiting');
  const seen = [];
  const drawn = await director.run({owner: 'c', trigger: 'assistant_end', turns, onOp: op => seen.push(op.op)});
  assert.deepEqual([drawn.reason, seen, models, calls.length], ['drawn', ['sync'], 0, 1]);
  assert.deepEqual([calls[0].asked, calls[0].said, calls[0].screen], ['数码相机和胶卷相机的区别', long, null]);
  assert.deepEqual([director.scene('c').title, director.scene('c').late], ['胶卷 vs 数码', true]);
  // The same answer is not drawn twice; a short reply leaves the page alone.
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_end', turns, clientRev: director.scene('c').rev})).reason, 'same');
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '好的'}, {role: 'assistant', text: '好，有需要再叫我。'}]})).reason, 'none');
  assert.equal(calls.length, 1);
  // A lookup makes even a short answer worth a page.
  director.observe({type: 'tool.delivered', name: 'web_search', voiceSessionId: 'c', result: {results: [{title: '上海明天阴转小雨'}]}});
  const weather = await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '明天天气'}, {role: 'assistant', text: '上海明天阴转小雨，气温16到20度。'}]});
  assert.deepEqual([weather.reason, calls.at(-1).evidence.length], ['drawn', 1]);
});

test('streaming: the page opens when the caller has asked, grows while V speaks, and every step reaches the page whole', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  const replies = [
    '{"op":"scene","title":"故宫看什么"}\n{"op":"put","block":{"id":"p","t":"photo","query":"故宫"}}\n{"op":"put","block":{"id":"l","t":"list","items":[{"h":"编的"}]}}\n',
    '{"op":"put","block":{"id":"l","t":"list","items":[{"id":"a","h":"太和殿","q":"午门进去就是太和殿"},{"id":"b","h":"珍宝馆","q":"一定要去珍宝馆"}]}}\n',
    '{"op":"put","block":{"id":"l","t":"list","items":[{"id":"a","h":"太和殿","q":"午门进去就是太和殿"},{"id":"b","h":"珍宝馆","q":"一定要去珍宝馆"}]}}\n{"op":"put","block":{"id":"n","t":"sticky","text":"别只走中间"}}\n',
  ];
  let asked = 0;
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* ({messages}) { assert.equal(messages[0].content, STREAM_INSTRUCTIONS); yield replies[asked++]; }});
  const seen = [];
  const run = (trigger, turns) => director.run({owner: 'c', trigger, turns, clientRev: director.scene('c').rev, onOp: op => seen.push([op.op, op.scene.blocks.map(block => block.t + ':' + (block.items?.length ?? 1)).join(' '), op.scene.late])});
  const user = {role: 'user', text: '介绍一下故宫，有什么好玩的'};
  assert.equal((await run('user', [user])).reason, 'drawn');
  assert.deepEqual(seen.at(-1), ['sync', 'photo:1', true], 'a title and a print; the made-up item is refused');
  const half = '先顺着中轴线走：午门进去就是太和殿，皇帝登基都在这。';
  await run('assistant_progress', [user, {role: 'assistant', text: half}]);
  assert.deepEqual(seen.at(-1), ['sync', 'photo:1 list:1', true]);
  await run('assistant_end', [user, {role: 'assistant', text: half + '别只走中间，一定要去珍宝馆看金瓯永固杯。'}]);
  assert.deepEqual(seen.at(-1), ['sync', 'photo:1 list:2 sticky:1', true]);
  // Lookup results alone draw nothing, and a few words are not an answer.
  assert.equal((await run('evidence', [user])).reason, 'waiting');
  assert.equal((await run('assistant_end', [user, {role: 'assistant', text: '好，我查一下。'}])).reason, 'waiting');
  assert.equal(asked, 3);
});

test('streaming: the same comparison continued grows the one table; a fifth block is not added', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  const said = '动力上电车靠电机，油车靠发动机。补能上电车要充电，油车三分钟加满。保养上电车项目少。冬天电车续航打折。卖车时油车更保值。';
  const row = (id, h, q) => ({id, h, cells: ['甲', '乙'], q});
  const table = (id, items) => JSON.stringify({op: 'put', block: {id, t: 'versus', sides: ['电车', '油车'], items}});
  const note = id => JSON.stringify({op: 'put', block: {id, t: 'sticky', text: '备注', q: '卖车时油车更保值'}});
  const lines = [table('v1', [row('a', '动力', '动力上电车靠电机')]), table('v2', [row('a', '补能', '补能上电车要充电'), row('b', '动力', '动力上电车靠电机')]), note('n1'), note('n2'), note('n3'), note('n4')];
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* () { yield lines.join('\n') + '\n'; }});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '区别'}, {role: 'assistant', text: said}]});
  const scene = director.scene('c');
  assert.deepEqual(scene.blocks.map(block => block.t), ['versus', 'sticky', 'sticky', 'sticky']);
  assert.deepEqual(scene.blocks[0].items.map(item => item.h), ['动力', '补能']);
});

test('streaming: the author\'s notes reach the illustrator with their script only, and it is told what the last pages looked like', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  const requests = [];
  const pages = ['{"op":"scene","title":"摆正方形"}\n{"op":"put","block":{"id":"t","t":"tiles","items":[{"id":"a","rows":4,"cols":4,"q":"四个一排"}]}}\n', '{"op":"scene","title":"别的"}\n{"op":"put","block":{"id":"l","t":"list","items":[{"id":"a","h":"电池","q":"电池是关键"}]}}\n'];
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* ({messages}) { requests.push(JSON.parse(messages[1].content)); yield pages[requests.length - 1]; }});
  assert.equal(director.streams, true);
  const script = '十二，我们用积木摆正方形。四个一排，摆四排，正好十六个。';
  director.note('c', {title: '摆正方形', script, lines: [{say: '十二，我们用积木摆正方形。', show: ''}, {say: '四个一排，摆四排，正好十六个。', show: 'tiles：4 排每排 4 个'}]});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '讲讲平方'}, {role: 'assistant', text: script}]});
  assert.equal(requests[0].notes.lines[1].show, 'tiles：4 排每排 4 个');
  assert.equal(director.scene('c').blocks[0].t, 'tiles');
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '那电动车呢'}, {role: 'assistant', text: '电动车最要紧的是电池，电池是关键，决定能跑多远。'}]});
  assert.equal('notes' in requests[1], false, 'a later answer is not drawn from an earlier script\'s notes');
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '再说说'}, {role: 'assistant', text: '电动车最要紧的是电池，电池是关键，决定能跑多远，也决定价格。'}]}).catch(() => {});
  assert.deepEqual(requests[2].recent, ['tiles']);
});
