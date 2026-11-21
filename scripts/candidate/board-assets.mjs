// Loopback-only fixture for the board's shelf of made things (board-assets.mjs):
// the real shared H5, Voice service, creation executor and shelf, with local
// stand-ins for the voice model, the Makaron CLI (it makes nothing: a public
// sample picture and video after a wait), the illustrator and the eye.
// No real identity, call, paid model or paid generation.
//
//   node scripts/candidate/board-assets.mjs            http://127.0.0.1:26329/
//
// Dial with Grok Voice, open the text field and type, in order:
//   帮我生成一张海报        a sketch on the board, then the picture develops
//   把它动起来              the video takes the picture's frame
//   给我讲讲光合作用        a lesson page that asks for one picture to be drawn
//   找几张山的图片          a page of found photographs; tap one to look at it large, turn, save
//   把这张改成卡通版        the photograph looked at last is what the picture is made from
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
import {createVoiceMediaCli} from '../../lab/realtime-direct-tools/media-cli.mjs';
import {createBoardDirector} from '../../lab/gpt-live-h5/board-director.mjs';
import {createAssetShelf} from '../../lab/gpt-live-h5/board-assets.mjs';

const PORT = Number(process.env.BOARD_FIXTURE_PORT ?? 26329);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const FOUND = ['这张是清晨的山谷。', '这张是林子里的小路。', '这张是雪山下的湖。', '这张是傍晚的山脊。'];
const PHOTOS = [['清晨 山谷 实拍', '清晨的山谷', 1018], ['林间 小路 实拍', '林间小路', 1043], ['雪山 湖 实拍', '雪山下的湖', 1036], ['傍晚 山脊 实拍', '傍晚的山脊', 1039]];
// (Call of 11/21 16:19: two rows of found photographs and a picture drawn for the same page.)
const TOGETHER = ['这张是清晨的山谷，雾还没散。', '这张是林子里的小路。', '这张是雪山下的湖，水很蓝。', '这张是傍晚的山脊。', '最后这张是现画的，把山谷和湖画在了一起。'];
const LESSON = ['叶子其实是一座小工厂。', '它白天张开小嘴，吸进空气里的二氧化碳。', '根把水从土里送上来。', '阳光一照，工厂就开工了，把水和二氧化碳做成糖。', '多出来的氧气，就从叶子上吐给我们呼吸。'];

const gateway = {ready: true, request: async (method, args) => {
  if (method === 'tools.catalog') return {groups: [{tools: [{id: 'exec', description: '执行'}, {id: 'process', description: '跟进'}]}]};
  if (method === 'sessions.resolve') return {key: args.key};
  if (method === 'sessions.describe') return {session: {key: args.key, agentId: 'makaron'}};
  if (method === 'chat.history') return {messages: []};
  throw Error('Local fixture RPC unavailable: ' + method);
}};

// The voice model's stand-in: speaks a line, calls the creation tool the way a
// realtime model does, follows the execution, and says what it was told is in
// the picture. The thing it animates is the one its instructions say is on screen.
class Model extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.text = ''; this.instructions = ''; this.outputs = []; this.calls = 0; this.timers = new Set(); setImmediate(() => this.emit('open')); }
  emitEvent(event) { if (this.readyState === 1) this.emit('message', Buffer.from(JSON.stringify(event)), false); }
  later(fn, ms) { const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, ms); this.timers.add(timer); }
  quiet() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
  send(raw) {
    const event = JSON.parse(raw);
    if (process.env.BOARD_FIXTURE_DEBUG === '1' && event.type !== 'input_audio_buffer.append') console.log('MODEL<', event.type, JSON.stringify(event.item ?? event.session?.instructions?.slice(-120) ?? '').slice(0, 200));
    if (event.type === 'session.update') { if (typeof event.session?.instructions === 'string') this.instructions = event.session.instructions; queueMicrotask(() => this.emitEvent({type: 'session.updated'})); return; }
    if (event.type === 'conversation.item.create' && event.item?.role === 'user') { this.text = event.item.content?.find(part => part.type === 'input_text')?.text ?? ''; return; }
    if (event.type === 'conversation.item.create' && event.item?.type === 'function_call_output') { try { this.outputs.push(JSON.parse(event.item.output)); } catch { this.outputs.push({}); } return; }
    if (event.type === 'response.cancel') { this.quiet(); return; }
    // (Its own timer: a cancel that follows at once stops what is being said, not the answer to come.)
    if (event.type === 'response.create') { this.quiet(); clearTimeout(this.answer); this.answer = setTimeout(() => this.respond(), 120); }
  }
  say(phrases, {tool = null, heard = ''} = {}) {
    const id = 'fixture-' + Date.now() + '-' + (++this.calls);
    if (heard) this.emitEvent({type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-' + id, transcript: heard});
    this.emitEvent({type: 'response.created', response: {id}});
    let at = 300;
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
      if (phrases.length) this.emitEvent({type: 'response.output_audio_transcript.done', response_id: id, transcript: phrases.join('')});
      if (tool) this.emitEvent({type: 'response.function_call_arguments.done', response_id: id, call_id: 'call-' + id, name: tool.name, arguments: JSON.stringify(tool.args)});
      this.emitEvent({type: 'response.done', response: {id, status: 'completed'}});
    }, at);
  }
  respond() {
    if (this.outputs.length) {
      const output = this.outputs.shift(); this.outputs = [];
      const session = output.sessionId ?? output.details?.sessionId;
      if ((output.status ?? output.details?.status) === 'running' && session) return this.say([], {tool: {name: 'process', args: {action: 'poll', sessionId: session, timeout: 5000}}});
      if (output.media) return this.say(output.media.kind === 'video' ? ['动起来了，你看。'] : ['做好啦。', ...(output.media.see ? [output.media.see] : []), '要不要我让它动起来？']);
      return this.say([typeof output.error === 'string' || output.isError ? '这次没做成。' : '好了。']);
    }
    const greeting = /^电话已接通/u.test(this.text), text = greeting ? '' : this.text;
    this.text = '';
    if (greeting) return this.say(['嗨，我在。']);
    if (/动起来|视频|animate/iu.test(text)) {
      // (What "it" is comes from the lines the service keeps current in the instructions.)
      const at = this.instructions.match(/用户正点着 (a\d+)/u)?.[1] ?? text.match(/a\d+/u)?.[0] ?? this.instructions.match(/最新的是 (a\d+)/u)?.[1] ?? 'a1';
      return this.say(['好，我让它动起来。'], {heard: text, tool: {name: 'exec', args: {command: `makaron video create --video-model fal-h3-max --duration 5 --video-resolution 768p --image ${at} --script '<<<media_1>>> 画面里的景物动起来，镜头缓缓推进'`, timeoutSeconds: 120, completionLine: '视频好了。', failureLine: '视频没做成。'}}});
    }
    if (/同框/u.test(text)) return this.say(TOGETHER, {heard: text});
    if (/找几张|图片给我看/u.test(text)) return this.say(FOUND, {heard: text});
    if (/改成|卡通|照这张/u.test(text)) {
      const at = this.instructions.match(/用户正点着 ([ap]\d+)/u)?.[1] ?? 'p1';
      return this.say(['好，照这张来画。'], {heard: text, tool: {name: 'exec', args: {command: `makaron edit --image-model gemini-2.1 --image ${at} '${text.replace(/['\\]/gu, '')}'`, timeoutSeconds: 120, completionLine: '画好了。', failureLine: '没画成。'}}});
    }
    if (/生成|画一张|海报|再来一版/u.test(text)) return this.say(['好，我来画。'], {heard: text, tool: {name: 'exec', args: {command: `makaron edit --image-model gemini-2.1 --aspect 16:9 '${text.replace(/['\\]/gu, '')}，电影海报，热血对决构图'`, timeoutSeconds: 120, completionLine: '图好了。', failureLine: '图没画成。'}}});
    if (/光合/u.test(text)) return this.say(LESSON, {heard: text});
    return this.say(['嗯，我在，你说。'], {heard: text});
  }
  close() { if (this.readyState === 3) return; this.quiet(); clearTimeout(this.answer); this.readyState = 3; this.emit('close'); }
}

// The illustrator's stand-in: nothing for a creation request (the made thing goes up by itself);
// for the lesson, a list and one picture asked to be drawn, each hung on V's words.
async function* scriptedIllustrator({messages, signal}) {
  const request = JSON.parse(messages[1].content), asked = request.conversation.filter(turn => turn.role === 'user').at(-1)?.text ?? '';
  const line = async (op, wait = 240) => { await pause(wait); return signal?.aborted ? '' : JSON.stringify(op) + '\n'; };
  if (/同框/u.test(asked) && request.trigger !== 'user') {
    yield await line({op: 'scene', title: '山谷和湖'});
    yield await line({op: 'put', block: {id: 'g1', t: 'list', look: 'gallery', h: '山谷', items: [{id: 'g1-1', h: PHOTOS[0][1], img: PHOTOS[0][0], q: '这张是清晨的山谷'}, {id: 'g1-2', h: PHOTOS[1][1], img: PHOTOS[1][0], q: '这张是林子里的'}]}});
    yield await line({op: 'put', block: {id: 'g2', t: 'list', look: 'gallery', h: '湖', items: [{id: 'g2-1', h: PHOTOS[2][1], img: PHOTOS[2][0], q: '这张是雪山下的湖'}, {id: 'g2-2', h: PHOTOS[3][1], img: PHOTOS[3][0], q: '这张是傍晚的山脊'}]}});
    if (request.make) yield await line({op: 'put', block: {id: 'w1', t: 'work', make: '清晨的山谷和雪山下的湖画在同一个画面里，水彩风景', caption: '山谷和湖同框', q: '最后这张是现画的'}});
    return;
  }
  if (/找几张|图片给我看/u.test(asked) && request.trigger !== 'user') {
    yield await line({op: 'scene', title: '山里的照片'});
    yield await line({op: 'put', block: {id: 'g1', t: 'list', look: 'gallery', items: PHOTOS.map(([img, h], index) => ({id: `i${index + 1}`, h, img}))}});
    return;
  }
  if (!/光合/u.test(asked) || request.trigger === 'user') { yield await line({op: 'none'}); return; }
  yield await line({op: 'scene', title: '叶子的小工厂'});
  yield await line({op: 'put', block: {id: 'l1', t: 'list', h: '工厂要的东西', items: [{id: 'a', h: '二氧化碳', d: '叶子的小嘴吸进来', icon: '💨', q: '吸进空气里的'}, {id: 'b', h: '水', d: '根从土里送上来', icon: '💧', q: '根把水从土里'}, {id: 'c', h: '阳光', d: '工厂的电', icon: '☀️', q: '阳光一照'}]}});
  if (request.make) yield await line({op: 'put', block: {id: 'w1', t: 'work', make: '一片绿叶的剖面，里面是一座卡通小工厂，阳光从上方照进来，水从根部送上来，水彩儿童绘本风格', caption: '叶子里的工厂', q: '阳光一照'}});
  yield await line({op: 'put', block: {id: 'n1', t: 'sticky', text: '吸进二氧化碳，吐出氧气', q: '多出来的氧气'}});
}

const log = event => console.log(JSON.stringify(event));
const board = createBoardDirector({complete: scriptedIllustrator, audit: log, record: log, stream: {instructions: '', refine: op => op, cue: true}});
// The eye's stand-in: a moment's look, then what it "saw".
const SEEN = [{name: '河谷晨光', see: '画面中间是一条蜿蜒的河，两边是陡峭的山谷，左边山坡有阳光，右边还在阴影里。'}, {name: '林间小鹿', see: '一只小鹿站在画面中间偏右，正回头看，背景是虚化的树林。'}, {name: '山间公路', see: '一条公路从画面下方伸向远处的雪山。'}];
let looks = 0;
const assets = createAssetShelf({director: board, audit: log, see: process.env.BOARD_FIXTURE_LOOK === '0' ? null : async () => { await pause(1300); return {...SEEN[looks++ % SEEN.length], parts: []}; }});
board.shelf = assets; assets.audience = 'all';
// Found photographs' stand-in: public sample pictures, and their own addresses as the ones they are "lent" under.
const sample = query => `https://picsum.photos/id/${PHOTOS.find(([name]) => name === query)?.[2] ?? 1015}/900/600.jpg`;
const kept = new Map();
const boardPhotos = {find: query => { if (!kept.has(query)) kept.set(query, fetch(sample(query)).then(async response => response.ok ? {bytes: Buffer.from(await response.arrayBuffer()), type: 'image/jpeg', title: query, source: '本地替身'} : null, () => null)); return kept.get(query); }};
assets.share = async query => ({url: sample(query), until: Date.now() + 30 * 60000});
const mediaCli = createVoiceMediaCli({environment: {PATH: process.env.PATH, MAKARON_API_KEY: 'LOCAL_FIXTURE_ONLY'}, binary: fileURLToPath(new URL('./fixtures/makaron-standin.mjs', import.meta.url)), pollIntervalMs: 1500});
const service = createDirectVoiceService({gateway, wsModule: {WebSocket: Model, WebSocketServer}, apiKeys: {grok: 'LOCAL_FIXTURE_ONLY'}, mediaCli, assets,
  audit: event => { board.observe(event); assets.observe(event); if (/^(call\.|tool\.media|board\.)/u.test(event.type)) log({type: event.type, phase: event.phase, ok: event.ok, chars: event.chars, message: event.message}); if (event.type === 'tool.delivered') log({type: event.type, name: event.name, result: JSON.stringify(event.result ?? null).slice(0, 400)}); }, loadContext: async () => '', searchAcknowledgment: 'off'});
const bridge = createLiveH5Server({gateway, directVoice: service, board, boardAssets: assets, boardPhotos, defaultModel: 'grok', enableGrok: true,
  conversationEntries: [{id: 'board_fixture', agentId: 'makaron', callerId: 'tianyi', permissionProfile: 'personal-tianyi', sessionKey: 'agent:makaron:feishu:group:board_fixture',
    accountId: 'fixture', kind: 'group', accountLabel: '本地演示账号', displayName: '作品替身 · 非真实身份', accessToken: 'LOCAL_FIXTURE_NOT_A_REAL_SECRET_0000'}],
  callSummarize: async () => '', avatarEvaluate: async () => ({}), callControlEvaluate: async () => ({})});
const [handleRequest] = bridge.server.listeners('request');
bridge.server.removeListener('request', handleRequest);
bridge.server.on('request', (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  // The plain address is the fixed personal entry, the only one whose calls have their own creation
  // executor. BOARD_FIXTURE_ENTRY=bound dials as a conversation's entry instead (no executor).
  if (process.env.BOARD_FIXTURE_ENTRY === 'bound' && url.pathname === '/' && !url.searchParams.has('phone')) { url.searchParams.set('phone', 'board_fixture'); res.writeHead(302, {location: url.pathname + url.search}); res.end(); return; }
  handleRequest(req, res);
});
bridge.server.listen(PORT, '127.0.0.1', () => console.log(`BOARD_ASSETS_LOCAL http://127.0.0.1:${PORT}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void bridge.dispose().finally(() => process.exit()));
