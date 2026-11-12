// Loopback-only fixture for the call board: the real shared H5 and Voice
// service with a local stand-in for the voice model. No real identity, call or
// paid voice model. The board director is the real one when a model credential
// is provided (VOICE_BOARD_API_KEY or DEEPSEEK_API_KEY), else a scripted one.
//
//   node scripts/candidate/board.mjs            http://127.0.0.1:26327/
//
// Dial, open the text field and type one of: 电话是怎么接通的 / 对比一下两种方案 /
// 夜班现在怎么样 / 语音和画面的数据怎么流 / 你好
import {EventEmitter} from 'node:events';
import {WebSocketServer} from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
import {boardDirectorFromEnv, createBoardDirector} from '../../lab/gpt-live-h5/board-director.mjs';

const PORT = Number(process.env.BOARD_FIXTURE_PORT ?? 26327);
const ANSWERS = [
  [/接通|原理|怎么打/u, ['好，电话接通分三步。', '第一步是拨号，页面向语音服务要一个通话名额，同时打开麦克风。', '第二步是建立连接，服务把你的声音转给语音模型，模型的声音再传回来。', '第三步就是直接说话了，你随时可以打断我。', '整个过程一般两三秒。']],
  [/对比|比较|哪个/u, ['这两种方案我帮你并排看。', '实时视频的画面最有感染力，但是首帧要等十几秒，还按秒计费。', '讲解画面一秒内就能出来，适合承载准确的信息。', '所以我建议先做讲解画面，实时视频留给陪伴的场景。']],
  [/夜班|状态|怎么样/u, ['夜班现在一切正常。', '在产十二张卡，今晚已经交付三十一条，有两条在等你确认。', '并发上限是十五，现在用了八个。']],
  [/数据|流|架构/u, ['语音和画面是两条并行的线。', '你的声音进语音模型，它负责又快又自然地回答。', '同一段对话的文字同时交给画面导演，它只管屏幕上放什么。', '两边都不等对方，所以说话不会因为画面变慢。']],
];
const sentences = text => ANSWERS.find(([pattern]) => pattern.test(text))?.[1] ?? ['嗯，我在，你说。'];

const gateway = {ready: true, request: async (method, args) => {
  if (method === 'tools.catalog') return {groups: [{tools: []}]};
  if (method === 'sessions.resolve') return {key: args.key};
  if (method === 'sessions.describe') return {session: {key: args.key, agentId: 'makaron'}};
  if (method === 'chat.history') return {messages: []};
  throw Error('Local fixture RPC unavailable: ' + method);
}};

// Speaks a scripted answer phrase by phrase, the way a realtime model streams
// its caption ahead of the audio.
class Model extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.text = ''; this.timers = new Set(); setImmediate(() => this.emit('open')); }
  emitEvent(event) { if (this.readyState === 1) this.emit('message', Buffer.from(JSON.stringify(event)), false); }
  later(fn, ms) { const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, ms); this.timers.add(timer); }
  send(raw) {
    const event = JSON.parse(raw);
    if (event.type === 'session.update') { queueMicrotask(() => this.emitEvent({type: 'session.updated'})); return; }
    if (event.type === 'conversation.item.create' && event.item?.role === 'user') { this.text = event.item.content?.find(part => part.type === 'input_text')?.text ?? ''; return; }
    if (event.type === 'response.cancel') { this.quiet(); return; }
    if (event.type === 'response.create') { this.quiet(); this.later(() => this.respond(), 120); }
  }
  quiet() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
  respond() {
    // The service's connect instruction is not something the caller said.
    const id = 'fixture-' + Date.now(), greeting = /^电话已接通/u.test(this.text), text = greeting ? '' : this.text, phrases = greeting ? ['嗨，我在。'] : sentences(text);
    this.text = '';
    if (text) this.emitEvent({type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-' + id, transcript: text});
    this.emitEvent({type: 'response.created', response: {id}});
    let at = 500;
    for (const phrase of phrases) {
      const ms = Math.max(900, phrase.length * 170), samples = Math.round(ms * 24);
      this.later(() => {
        this.emitEvent({type: 'response.output_audio_transcript.delta', response_id: id, delta: phrase});
        const pcm = Buffer.alloc(samples * 2);
        for (let index = 0; index < samples; index++) {
          const t = index / 24000, envelope = Math.min(1, t / .08) * Math.min(1, (ms / 1000 - t) / .08);
          pcm.writeInt16LE(Math.sin(t * 2 * Math.PI * 300) * 1400 * Math.max(0, envelope) * (.5 + .5 * Math.sin(t * 2 * Math.PI * 3)), index * 2);
        }
        for (let offset = 0; offset < pcm.length; offset += 19200) this.emitEvent({type: 'response.output_audio.delta', response_id: id, delta: pcm.subarray(offset, offset + 19200).toString('base64')});
      }, at);
      at += ms;
    }
    this.later(() => {
      this.emitEvent({type: 'response.output_audio_transcript.done', response_id: id, transcript: phrases.join('')});
      this.emitEvent({type: 'response.done', response: {id, status: 'completed'}});
    }, at);
  }
  close() { if (this.readyState === 3) return; for (const timer of this.timers) clearTimeout(timer); this.readyState = 3; this.emit('close'); }
}

// Scripted director for layout work without a model credential: one picture
// per fixture topic, built block by block, then focus following V's phrases.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SCENES = [
  [/接通/u, '电话怎么接通', [{id: 's', t: 'steps', items: [{id: 'a', h: '拨号', d: '要一个通话名额，打开麦克风'}, {id: 'b', h: '建立连接', d: '声音转给语音模型，再传回来'}, {id: 'c', h: '直接说话', d: '随时可以打断'}]}], ['s/a', 's/b', 's/c'], {id: 'n', t: 'note', text: '整个过程一般两三秒'}],
  [/对比|比较/u, '两种画面方案', [{id: 'c', t: 'compare', cols: [{id: 'v', h: '实时视频', points: ['画面最有感染力', '首帧十几秒', '按秒计费']}, {id: 'e', h: '讲解画面', tag: '先做', points: ['一秒内出现', '信息准确', '成本很低']}]}], ['c/v', 'c/e', 'c/e'], {id: 'n', t: 'note', text: '先做讲解画面，实时视频留给陪伴'}],
  [/夜班/u, '夜班现在', [{id: 'k', t: 'stats', items: [{id: 'a', label: '在产', value: '12', unit: '张'}, {id: 'b', label: '今晚已交付', value: '31', unit: '条'}, {id: 'c', label: '等你确认', value: '2', unit: '条'}]}, {id: 'b', t: 'bars', h: '并发', items: [{id: 'u', label: '已用', value: 8}, {id: 'm', label: '上限', value: 15}]}], ['k/a', 'k/c', 'b/u'], null],
  [/数据|流|架构/u, '语音和画面两条线', [{id: 'f', t: 'flow', nodes: [{id: 'u', label: '你说的话'}, {id: 'v', label: '语音模型', sub: '又快又自然'}, {id: 'd', label: '画面导演', sub: '只管屏幕'}, {id: 'a', label: '你听到的回答'}, {id: 'b', label: '你看到的画面'}], edges: [['u', 'v', '声音'], ['u', 'd', '文字'], ['v', 'a'], ['d', 'b'], ['v', 'd', 'V 说的话']]}], ['f/v', 'f/d', 'f/b'], {id: 'n', t: 'note', text: '两边都不等对方'}],
];
async function* scriptedDirector({messages, signal}) {
  const request = JSON.parse(messages[1].content), said = request.conversation.map(turn => turn.text).join('\n');
  const topic = SCENES.find(([pattern]) => pattern.test(request.conversation.filter(turn => turn.role === 'user').at(-1)?.text ?? ''));
  const line = async (op, wait = 260) => { await pause(wait); return signal?.aborted ? '' : JSON.stringify(op) + '\n'; };
  if (!topic) { yield await line({op: 'none'}, 300); return; }
  const [, title, blocks, focus, note] = topic, empty = typeof request.screen === 'string' || request.screen.title !== title;
  if (empty) { yield await line({op: 'scene', title}, 500); for (const block of blocks) yield await line({op: 'put', block}); }
  if (request.trigger === 'assistant_progress') {
    const spoken = (request.conversation.at(-1)?.text.match(/[。！？]/gu) ?? []).length;
    yield await line({op: 'focus', id: focus[Math.min(focus.length - 1, Math.max(0, spoken - 2))]});
  }
  if (request.trigger === 'assistant_end') { if (note) yield await line({op: 'put', block: note}); yield await line({op: 'focus', id: ''}); }
  void said;
}

const real = boardDirectorFromEnv({...process.env, VOICE_BOARD: '1'}, {audit: event => console.log(JSON.stringify(event))});
const board = real ?? createBoardDirector({complete: scriptedDirector, audit: event => console.log(JSON.stringify(event))});
const service = createDirectVoiceService({gateway, wsModule: {WebSocket: Model, WebSocketServer}, apiKeys: {grok: 'LOCAL_FIXTURE_ONLY', seeduplex: 'LOCAL_FIXTURE_ONLY'},
  audit: event => board.observe(event), loadContext: async () => '', searchAcknowledgment: 'off'});
const bridge = createLiveH5Server({gateway, directVoice: service, board, defaultModel: 'grok', enableGrok: true,
  conversationEntries: [{id: 'board_fixture', agentId: 'makaron', callerId: 'tianyi', permissionProfile: 'personal-tianyi', sessionKey: 'agent:makaron:feishu:group:board_fixture',
    accountId: 'fixture', kind: 'group', accountLabel: '本地演示账号', displayName: '画面替身 · 非真实身份', accessToken: 'LOCAL_FIXTURE_NOT_A_REAL_SECRET_0000'}],
  callSummarize: async () => '', avatarEvaluate: async () => ({}), callControlEvaluate: async () => ({})});
const [handleRequest] = bridge.server.listeners('request');
bridge.server.removeListener('request', handleRequest);
bridge.server.on('request', (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/' && !url.searchParams.has('phone')) { url.searchParams.set('phone', 'board_fixture'); res.writeHead(302, {location: url.pathname + url.search}); res.end(); return; }
  handleRequest(req, res);
});
bridge.server.listen(PORT, '127.0.0.1', () => console.log(`BOARD_LOCAL http://127.0.0.1:${PORT}/  director=${real ? 'model' : 'scripted'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void bridge.dispose().finally(() => process.exit()));
