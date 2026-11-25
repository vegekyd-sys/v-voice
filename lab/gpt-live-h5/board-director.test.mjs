import assert from 'node:assert/strict';
import test from 'node:test';
import {BOARD_INSTRUCTIONS, boardDirectorFromEnv, boardRequest, boundedBoardRequest, createBoardDirector, mayAskForLesson, createChatCompletionStream, nameLanguage, LANGUAGE_INSTRUCTIONS} from './board-director.mjs';

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

test('the canvas: pages stay; a new topic opens a page, V can go back to one, and nothing on a page is replaced or pictured twice', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  const line = value => JSON.stringify(value) + '\n';
  const replies = [
    line({op: 'scene', title: '故宫'}) + line({op: 'put', block: {id: 'p1', t: 'photo', query: '故宫'}}) + line({op: 'put', block: {id: 'l', t: 'list', items: [{id: 'a', h: '太和殿', img: '太和殿', q: '午门进去就是太和殿'}, {id: 'b', h: '故宫全景', img: '故宫', q: '午门进去就是太和殿'}]}}),
    line({op: 'scene', title: '电车和油车'}) + line({op: 'put', block: {id: 'p1', t: 'photo', query: '特斯拉 Model 3'}}) + line({op: 'put', block: {id: 'p2', t: 'photo', query: '丰田卡罗拉'}}),
    line({op: 'zone', id: 'z1'}) + line({op: 'put', block: {id: 'p1', t: 'photo', query: '故宫珍宝馆'}}) + line({op: 'put', block: {id: 'n', t: 'sticky', text: '珍宝馆要另买票', q: '珍宝馆要另买票'}}),
  ];
  let asked = 0;
  const requests = [];
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* ({messages}) { requests.push(JSON.parse(messages[1].content)); yield replies[asked++]; }});
  const say = (asking, answer) => director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: asking}, {role: 'assistant', text: answer}]});
  await say('介绍故宫', '先顺着中轴线走：午门进去就是太和殿，皇帝登基都在这，很值得看。');
  await say('电车和油车的区别', '特斯拉 Model 3 靠电池和电机，丰田卡罗拉靠发动机烧汽油，这是最大的不同。');
  let canvas = director.canvas('c');
  assert.deepEqual([canvas.zones.map(zone => zone.title), canvas.active], [['故宫', '电车和油车'], 'z2']);
  assert.deepEqual(canvas.zones[1].blocks.map(block => block.query), ['特斯拉 Model 3'], 'a page has one large print');
  assert.deepEqual(canvas.zones[0].blocks[1].items.map(item => item.img), ['太和殿', undefined], 'the thing in the print is not pictured again');
  await say('回到故宫那一页，珍宝馆呢', '珍宝馆在东北角，珍宝馆要另买票，里面是金银玉器，值得专门去看一趟。');
  canvas = director.canvas('c');
  assert.deepEqual([canvas.zones.map(zone => zone.title), canvas.active], [['故宫', '电车和油车'], 'z1']);
  assert.deepEqual(canvas.zones[0].blocks.map(block => [block.t, block.query ?? block.text ?? block.items.length]), [['photo', '故宫'], ['list', 2], ['sticky', '珍宝馆要另买票']], 'the first print stays; another print for the page is not added');
  assert.deepEqual(requests[2].canvas.map(zone => [zone.id, zone.title, zone.room]), [['z1', '故宫', 2]], 'the illustrator is shown the other pages and how much room each has');
});

test('a script\'s page is started when the script arrives; the caller\'s screen joins that run instead of starting another (call 8686df57)', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* () {
    calls++;
    yield '{"op":"scene","title":"罗马三天"}\n';
    await gate;
    yield '{"op":"put","block":{"id":"l","t":"list","items":[{"id":"a","h":"斗兽场","q":"第一天从斗兽场开始"}]}}\n';
  }});
  const script = '罗马景点散，先按三天排。第一天从斗兽场开始，票和古罗马广场是同一张。';
  director.note('c', {title: '罗马三天', ask: '那罗马怎么玩', script, lines: [{say: script, show: ''}]});
  const seen = [];
  const joined = director.run({owner: 'c', trigger: 'assistant_end', clientRev: 0, onOp: op => seen.push(op), turns: [{role: 'user', text: '那罗马怎么玩'}, {role: 'assistant', text: script}]});
  await new Promise(resolve => setTimeout(resolve, 5));
  release();
  assert.equal((await joined).reason, 'joined');
  assert.equal(calls, 1);
  assert.equal(seen.at(-1).scene.blocks[0].t, 'list');
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_end', clientRev: director.scene('c').rev, turns: [{role: 'assistant', text: script}]})).reason, 'same');
  assert.equal(calls, 1);
  // A voice whose captions arrive a clause at a time, in its own punctuation, and a reading that
  // was interrupted and picks up in the middle: still this script's page, never drawn again.
  for (const text of ['罗马景点散,', '罗马景点散,先按三天排。', '第一天从斗兽场开始,票和古罗马广场是同一张。'])
    assert.equal((await director.run({owner: 'c', trigger: 'assistant_progress', clientRev: director.scene('c').rev, turns: [{role: 'assistant', text}]})).reason, 'same');
  assert.equal(calls, 1);
  // Words that are not in the script are a new reply.
  assert.notEqual((await director.run({owner: 'c', trigger: 'assistant_end', clientRev: director.scene('c').rev, turns: [{role: 'assistant', text: '佛罗伦萨其实更适合慢慢逛，两天就够了。'}]})).reason, 'same');
});

test('hedged: a reply that has not started in time is raced by a second request', async () => {
  const {hedged} = await import('./board-director.mjs');
  let calls = 0;
  const complete = async function* ({signal}) {
    const mine = ++calls;
    if (mine === 1) await new Promise(resolve => { const timer = setTimeout(resolve, 500); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }); });
    yield `reply ${mine}`;
  };
  const chunks = [];
  for await (const chunk of hedged(complete, {messages: []}, 20)) chunks.push(chunk);
  assert.deepEqual(chunks, ['reply 2']);
  calls = 5;
  const quick = [];
  for await (const chunk of hedged(async function* () { calls++; yield 'a'; yield 'b'; }, {messages: []}, 20)) quick.push(chunk);
  assert.deepEqual(quick, ['a', 'b']);
  assert.equal(calls, 6);
});

test('a page opened under the title of a page already on the canvas goes back to that page (two runs for one answer, 11/14)', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  const line = value => JSON.stringify(value) + '\n';
  const replies = [
    line({op: 'scene', title: '属性克制'}) + line({op: 'put', block: {id: 'p', t: 'photo', query: '皮卡丘'}}),
    line({op: 'scene', title: '电车和油车'}) + line({op: 'put', block: {id: 'p', t: 'photo', query: '特斯拉 Model 3'}}),
    line({op: 'scene', title: '属性克制'}) + line({op: 'put', block: {id: 'q', t: 'photo', query: '杰尼龟'}}),
  ];
  let asked = 0;
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* () { yield replies[asked++]; }});
  for (const text of ['讲讲属性克制', '电车和油车', '再说属性克制']) await director.run({owner: 'c', trigger: 'user', turns: [{role: 'user', text}]});
  const canvas = director.canvas('c');
  assert.deepEqual(canvas.zones.map(zone => zone.title), ['属性克制', '电车和油车']);
  assert.equal(director.scene('c').title, '属性克制');
  assert.equal(director.scene('c').serial, canvas.zones[0].serial, 'the same page, not a new one');
  assert.deepEqual(director.scene('c').blocks.map(block => block.query), ['皮卡丘'], 'with what it had');
});

test('a lesson starting keeps the title and print being drawn for the question; it drops a page drawn from V\'s holding line (call b101ecc7)', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* () {
    yield '{"op":"scene","title":"故宫"}\n';
    await gate;
    yield '{"op":"put","block":{"id":"p","t":"photo","query":"故宫"}}\n';
  }});
  const run = director.run({owner: 'q', trigger: 'user', turns: [{role: 'user', text: '故宫怎么逛'}]});
  await new Promise(resolve => setTimeout(resolve, 5));
  director.expect('q');
  release();
  const result = await run;
  assert.equal(result.reason, 'drawn');
  assert.deepEqual(director.scene('q').blocks.map(block => block.t), ['photo']);
});

test('a shelf refresh retains both photo gallery pages without a streaming illustrator', () => {
  const board = createBoardDirector(scripted());
  for (const name of ['卢浮宫', '凯旋门']) board.gallery('call', name, [{name, query:name}]);
  assert.deepEqual(board.state('call').canvas.zones.map(zone=>zone.title), ['卢浮宫','凯旋门']);
});
test('a caller\'s turn that draws nothing leaves the script\'s page in place for the rest of the reading', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  let calls = 0, next = null;
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, complete: async function* () {
    calls++;
    if (next) { yield next; return; }
    yield '{"op":"scene","title":"罗马三天"}\n{"op":"put","block":{"id":"l","t":"list","items":[{"id":"a","h":"斗兽场","q":"第一天从斗兽场开始"}]}}\n';
  }});
  const script = '罗马景点散，先按三天排。第一天从斗兽场开始，票和古罗马广场是同一张。';
  director.note('c', {title: '罗马三天', ask: '那罗马怎么玩', script, lines: [{say: script, show: ''}]});
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_end', clientRev: 0, turns: [{role: 'assistant', text: script}]})).reason, 'joined');
  // A cough, heard as a turn of the caller's: the director draws nothing for it.
  next = '{"op":"none"}\n';
  const cough = await director.run({owner: 'c', trigger: 'user', clientRev: director.scene('c').rev, turns: [{role: 'assistant', text: '罗马景点散，先按三天排。'}, {role: 'user', text: '嗯'}]});
  assert.notEqual(cough.reason, 'drawn');
  const before = calls;
  assert.equal((await director.run({owner: 'c', trigger: 'assistant_progress', clientRev: director.scene('c').rev, turns: [{role: 'user', text: '嗯'}, {role: 'assistant', text: '第一天从斗兽场开始，票和古罗马广场是同一张。'}]})).reason, 'same');
  assert.equal(calls, before);
});

// A page drawn from V's own words (no script): which pictures it holds, and that each is searched for once.
const cuePage = async () => { const {CUE_INSTRUCTIONS, cueTurns, refineCueOp} = await import('./board-cue.mjs'); return {instructions: CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true}; };
const line = value => JSON.stringify(value) + '\n';
const picture = (id, h, img, cue) => ({id, h, img, ...(cue === undefined ? {} : {cue})});

test('pictures of an answer: a thing written again keeps its picture; the same list written again is one list; each picture is asked for once', async () => {
  const said = ['老城有三处值得看。先到钟楼，', '老城有三处值得看。先到钟楼，楼顶能看到全城。再走到石桥，', '老城有三处值得看。先到钟楼，楼顶能看到全城。再走到石桥，桥头有石狮子。最后是码头。'];
  const replies = [
    line({op: 'scene', title: '老城'}) + line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [picture('a', '钟楼', '老城 钟楼', 1), picture('b', '城墙', '老城 城墙')]}}),
    // The same thing under other search words, the item V has not come to left out, a new one under a used id.
    line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [picture('a', '钟楼', '钟楼 全景 实拍', 1), {...picture('b', '石桥', '老城 石桥', 3), d: '桥头石狮子'}]}}),
    line({op: 'put', block: {id: 'g', t: 'list', items: [picture('x', '码头', '老城 码头', 5), {...picture('y', '钟楼', '钟楼 夜景'), d: '看全城'}]}}),
  ];
  const fetched = [];
  const director = createBoardDirector({stream: await cuePage(), prefetch: query => fetched.push(query), complete: async function* () { yield replies.shift(); }});
  const user = {role: 'user', text: '老城怎么逛'};
  for (const [index, text] of said.entries()) await director.run({owner: 'c', trigger: index < 2 ? 'assistant_progress' : 'assistant_end', turns: [user, {role: 'assistant', text}]});
  const scene = director.scene('c');
  assert.deepEqual(scene.blocks.map(block => [block.id, block.look]), [['g', 'gallery']], 'one list, still a page of pictures');
  assert.deepEqual(scene.blocks[0].items.map(item => [item.id, item.h, item.img, item.d]), [['a', '钟楼', '老城 钟楼', '看全城'], ['b', '城墙', '老城 城墙', undefined], ['b2', '石桥', '老城 石桥', '桥头石狮子'], ['x', '码头', '老城 码头', undefined]]);
  assert.ok(scene.blocks[0].items[0].q, 'what the new wording leaves out is kept');
  assert.deepEqual(fetched, ['老城 钟楼', '老城 城墙', '老城 石桥', '老城 码头']);
  // The caller speaks again: the list may then be drawn anew under the same ids ("show me more").
  replies.push(line({op: 'none'}), line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [picture('a', '钟楼', '钟楼 夜景', 0), picture('b', '城墙', '城墙 夜景', 0), picture('b2', '石桥', '石桥 夜景', 0), picture('x', '码头', '码头 夜景', 0)]}}));
  await director.run({owner: 'c', trigger: 'user', turns: [user, {role: 'assistant', text: said[2]}, {role: 'user', text: '换几张晚上的'}]});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [user, {role: 'assistant', text: said[2]}, {role: 'user', text: '换几张晚上的'}, {role: 'assistant', text: '好，给你换成晚上拍的这几张看看。'}]});
  assert.deepEqual(director.scene('c').blocks[0].items.map(item => item.img), ['钟楼 夜景', '城墙 夜景', '石桥 夜景', '码头 夜景']);
});

test('pictures of an answer: a page holds six; a guess V has not come to gives up its place; a script\'s page is its author\'s', async () => {
  const {PAGE_PICTURES} = await import('./board-director.mjs');
  assert.equal(PAGE_PICTURES, 6);
  const names = ['钟楼', '石桥', '码头', '集市', '城墙', '茶馆', '戏台', '渡口'];
  const said = '老城值得看的有：' + names.slice(2).map(name => `${name}很热闹。`).join('');
  const user = {role: 'user', text: '老城有什么可看的'};
  // Opened on the question (two guesses), then V tells six other things.
  const replies = [
    line({op: 'scene', title: '老城'}) + line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [picture('a', names[0], '老城 钟楼'), picture('b', names[1], '老城 石桥')]}}),
    line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [picture('a', names[0], '老城 钟楼'), picture('b', names[1], '老城 石桥'), ...names.slice(2).map((name, index) => picture(`n${index}`, name, `老城 ${name}`, index + 1))]}})
      + line({op: 'put', block: {id: 'p', t: 'photo', query: '老城 全景', cue: 0}}),
  ];
  const requests = [];
  const director = createBoardDirector({stream: await cuePage(), complete: async function* ({messages}) { requests.push(JSON.parse(messages[1].content)); yield replies.shift(); }});
  await director.run({owner: 'c', trigger: 'user', turns: [user], unscripted: true});
  assert.equal(requests[0].unscripted, true);
  assert.deepEqual(director.scene('c').blocks[0].items.map(item => item.h), names.slice(0, 2), 'a page of pictures before V has said a word');
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [user, {role: 'assistant', text: said}], unscripted: true});
  assert.equal('unscripted' in requests[1], false, 'said only where it changes what may be drawn');
  const scene = director.scene('c');
  assert.deepEqual(scene.blocks.map(block => block.t), ['list'], 'no print beside six pictures');
  assert.deepEqual(scene.blocks[0].items.filter(item => item.img).map(item => item.h), names.slice(2), 'the six things V told; the two guesses gave way');
  // V tells two more things: the page is full, and their names go in a list beside the pictures
  // (a gallery shows only what is pictured). Written again, it is the same two lists.
  const eight = [...names.slice(2), '码头边的灯塔', '老井'], longer = said + '码头边的灯塔很热闹。老井很热闹。';
  const whole = line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: eight.map((name, index) => picture(`n${index}`, name, `老城 ${name}`, index + 1))}});
  replies.push(whole, whole);
  for (let again = 0; again < 2; again++) {
    await director.run({owner: 'c', trigger: 'assistant_end', turns: [user, {role: 'assistant', text: longer}], unscripted: true});
    assert.deepEqual(director.scene('c').blocks.map(block => [block.id, block.look, block.items.map(item => item.h), block.items.filter(item => item.img).length]),
      [['g', 'gallery', names.slice(2), 6], ['g-rest', undefined, ['码头边的灯塔', '老井'], 0]]);
  }
  assert.ok(director.scene('c').blocks[1].items.every(item => item.q), 'each still comes up when V gets to it');
  // Without the word that V explains by itself, the question alone gets a print at most.
  const plain = createBoardDirector({stream: await cuePage(), complete: async function* ({messages}) { requests.push(JSON.parse(messages[1].content)); yield line({op: 'scene', title: '老城'}) + line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [picture('a', names[0], '老城 钟楼'), picture('b', names[1], '老城 石桥')]}}); }});
  await plain.run({owner: 'c', trigger: 'user', turns: [user]});
  assert.deepEqual(['unscripted' in requests.at(-1), plain.scene('c').blocks.length], [false, 0]);
  // A script's page (the author's notes go with it) keeps every picture its author asked for,
  // and is a page of pictures only where the author asked for one.
  const script = names.map(name => `${name}很热闹。`).join('');
  for (const [hint, look] of [['list 带图：加一项', undefined], ['图集：加一张', 'gallery']]) {
    const lesson = createBoardDirector({stream: await cuePage(), complete: async function* () { yield line({op: 'scene', title: '老城'}) + line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: names.map((name, index) => picture(`n${index}`, name, `老城 ${name}`, index))}}); }});
    lesson.note('c', {title: '老城', script, lines: names.map(name => ({say: `${name}很热闹。`, show: `${hint} ${name}`}))});
    await lesson.run({owner: 'c', trigger: 'assistant_end', turns: [user, {role: 'assistant', text: script}]});
    assert.deepEqual([lesson.scene('c').blocks[0].items.filter(item => item.img).length, lesson.scene('c').blocks[0].look], [8, look]);
  }
});

test('pictures of an answer: a thing written twice in one list is on the page once', async () => {
  const said = '老城先看钟楼，楼顶能看到全城。再看石桥，桥头有石狮子。回头再说钟楼，晚上会亮灯。';
  const director = createBoardDirector({stream: await cuePage(), complete: async function* () {
    yield line({op: 'scene', title: '老城'}) + line({op: 'put', block: {id: 'g', t: 'list', look: 'gallery', items: [picture('a', '钟楼', '老城 钟楼', 0), picture('b', '石桥', '老城 石桥', 2), picture('c', '钟楼', '老城 钟楼', 4), {id: 'd', h: '石桥', cue: 3}]}})
      // (Steps may come to the same thing twice: nothing is pictured, nothing is taken out.)
      + line({op: 'put', block: {id: 's', t: 'steps', items: [{id: 'a', h: '上楼', cue: 1}, {id: 'b', h: '过桥', cue: 3}, {id: 'c', h: '上楼', cue: 5}]}});
  }});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [{role: 'user', text: '老城怎么逛'}, {role: 'assistant', text: said}]});
  assert.deepEqual(director.scene('c').blocks.map(block => block.items.map(item => item.h)), [['钟楼', '石桥'], ['上楼', '过桥', '上楼']]);
});

test('pictures of an answer: a comparison written again with its rows in another order is the one table', async () => {
  const said = ['甲车和乙车差不多大。先说续航，两台都够用。', '甲车和乙车差不多大。先说续航，两台都够用。再说价格，甲车便宜一些。'];
  const row = (id, h, cue) => ({id, h, cells: ['甲', '乙'], cue});
  const table = items => line({op: 'put', block: {id: 'v', t: 'versus', sides: [{h: '甲车', img: '甲车 外观'}, {h: '乙车', img: '乙车 外观'}], items}});
  const replies = [line({op: 'scene', title: '甲车和乙车'}) + table([row('a', '续航', 1)]), table([row('a', '价格', 3), row('b', '续航', 1)])];
  const director = createBoardDirector({stream: await cuePage(), complete: async function* () { yield replies.shift(); }});
  const user = {role: 'user', text: '甲车和乙车怎么选'};
  await director.run({owner: 'c', trigger: 'assistant_progress', turns: [user, {role: 'assistant', text: said[0]}]});
  await director.run({owner: 'c', trigger: 'assistant_end', turns: [user, {role: 'assistant', text: said[1]}]});
  assert.deepEqual(director.scene('c').blocks.map(block => [block.t, block.items.map(item => `${item.id}:${item.h}`)]), [['versus', ['a:续航', 'a2:价格']]]);
});

test('the page is written in the language V speaks, which is named for the director: asked once for each reply, beside the run', async () => {
  const {STREAM_INSTRUCTIONS, refineStreamOp} = await import('./board-lesson.mjs');
  const requests = [], heard = [], seen = [];
  let name = 'français（法语）';
  const director = createBoardDirector({stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}, hear: async words => { heard.push(words); return name; },
    eye: {find: async () => ({bytes: Buffer.from('jpeg'), type: 'image/jpeg'}), see: async args => { seen.push(args.language); return []; }},
    complete: async function* ({messages}) { requests.push(JSON.parse(messages[1].content)); yield requests.length === 1 ? '{"op":"scene","title":"Autour de la ville"}\n{"op":"put","block":{"id":"a","t":"list","items":[{"id":"a1","h":"Le vieux port","img":"vieux port","q":"le vieux port"}]}}\n' : '{"op":"none"}\n'; }});
  const french = "Alors, autour de la ville, tu as le vieux port, et puis";
  const run = (trigger, text, role = 'assistant') => director.run({owner: 'c', trigger, turns: [{role: 'user', text: 'Et autour ?'}, ...(role === 'assistant' ? [{role, text}] : [])]});
  // The first run of a reply asks beside itself and goes without a name; the next has it.
  await run('assistant_progress', french);
  assert.deepEqual(heard, [french]);assert.equal('language' in requests[0], false);
  await run('assistant_progress', french + " le marché couvert, qui est très animé le matin,");
  assert.equal(heard.length, 1, 'the same reply, longer, is not asked about again');
  assert.equal(requests[1].language, 'français（法语）');assert.equal(Object.keys(requests[1]).at(-1), 'language', 'last, after the words it is the language of');
  assert.equal(seen.at(-1), 'français（法语）', 'the labels on a picture are written in it too');
  // Before V answers the next question the page goes with the language V spoke last.
  await run('user', '', 'user');assert.equal(requests.at(-1).language, 'français（法语）');
  // V changes language (a call that came back, 11/24): asked again, and the run after that is told.
  name = '中文';
  const chinese = '好呀，那我们换一个城市，先说说老城区，';
  await run('assistant_progress', chinese);assert.equal(heard.length, 2);assert.equal(requests.at(-1).language, 'français（法语）');
  await run('assistant_progress', chinese + '那里有一条很长的石板路，两边都是小店，');assert.equal(requests.at(-1).language, '中文');
  // A sound of agreement is not asked about, and a director without the ability is not told anything.
  await run('assistant_end', 'Mm-hmm.');assert.equal(heard.length, 2);
  assert.equal('language' in JSON.parse(boardRequest({trigger: 'user', scene: director.scene('c'), turns: [], evidence: []})), false);
  assert.match(BOARD_INSTRUCTIONS, /请求里的 language 是 V 说话的语言/u);assert.match(BOARD_INSTRUCTIONS, /不要因为画面上是另一种语言就接着用那种语言写/u);
});
test('the language is named in one short line', async () => {
  const says = reply => nameLanguage({words: 'x'.repeat(400), complete: async function* ({messages}) { assert.equal(messages[0].content, LANGUAGE_INSTRUCTIONS); assert.equal(messages[1].content.length, 120); yield* reply; }});
  assert.equal(await says(['「fran', 'çais（法语）」\n这句话是法语。']), 'français（法语）');
  assert.equal(await says(['中文。']), '中文');
  assert.equal(await says(['']), '');
  assert.equal(await says(['这句话里夹着好几种语言，很难说主要是哪一种，可能是英语也可能是别的']), '', 'an essay is not a name');
});
