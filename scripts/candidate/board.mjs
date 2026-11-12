// Loopback-only fixture for the call board: the real shared H5 and Voice
// service with a local stand-in for the voice model. No real identity, call or
// paid voice model. The board director is the real one when a model credential
// is provided (VOICE_BOARD_API_KEY or DEEPSEEK_API_KEY), else a scripted one.
//
//   node scripts/candidate/board.mjs            http://127.0.0.1:26327/
//
// Dial with Grok Voice (the only model with a stand-in here; 豆包 is disabled and
// GPT Live reports an error), open the text field and type one of: 电话是怎么接通的 /
// 对比一下两种方案 / 夜班现在怎么样 / 语音和画面的数据怎么流 / 讲讲埃菲尔铁塔 / 你好.
// The stand-in does not listen: speaking into the microphone does nothing.
import {EventEmitter} from 'node:events';
import {WebSocketServer} from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
import {boardDirectorFromEnv, createBoardDirector} from '../../lab/gpt-live-h5/board-director.mjs';
import {createPhotoFinder} from '../../lab/gpt-live-h5/board-photo.mjs';
import {readFile} from 'node:fs/promises';

const PORT = Number(process.env.BOARD_FIXTURE_PORT ?? 26327);
const ANSWERS = [
  [/接通|原理|怎么打/u, ['好，电话接通分三步。', '第一步是拨号，页面向语音服务要一个通话名额，同时打开麦克风。', '第二步是建立连接，服务把你的声音转给语音模型，模型的声音再传回来。', '第三步就是直接说话了，你随时可以打断我。', '整个过程一般两三秒。']],
  [/对比|比较|哪个/u, ['这两种方案我帮你并排看。', '实时视频的画面最有感染力，但是首帧要等十几秒，还按秒计费。', '讲解画面一秒内就能出来，适合承载准确的信息。', '所以我建议先做讲解画面，实时视频留给陪伴的场景。']],
  [/夜班|状态|怎么样/u, ['夜班现在一切正常。', '在产十二张卡，今晚已经交付三十一条，有两条在等你确认。', '并发上限是十五，现在用了八个。']],
  [/铁塔|埃菲尔/u, ['埃菲尔铁塔在巴黎的战神广场。', '它一八八九年为世博会建成，当时很多人嫌它丑。', '塔高三百三十米，曾经是世界最高的建筑。', '现在每年有大约七百万人登塔。']],
  [/宝可梦|相克/u, ['就像石头剪刀布。', '杰尼龟喷水，浇灭小火龙的火，水赢。', '小火龙吐火，烧掉妙蛙种子的叶子，火赢。', '妙蛙种子把杰尼龟的水喝光，草赢。']],
  [/数据|流|架构/u, ['语音和画面是两条并行的线。', '你的声音进语音模型，它负责又快又自然地回答。', '同一段对话的文字同时交给画面导演，它只管屏幕上放什么。', '两边都不等对方，所以说话不会因为画面变慢。']],
];
// The diagram kit, one topic per shape (for layout work).
ANSWERS.unshift(
  [/积木|方程/u, ['十二，我们来摆正方形积木。', '先拿四块积木，摆成一个正方形，每边两块。', '再拿九块积木，每边三块。', '十六块积木摆成正方形，每边刚好四块。', '所以四乘四等于十六。', '那二十五块，每边几块呀？']],
  [/电动车|油车/u, ['电动车和油车，我一项一项比。', '动力上，特斯拉靠电机，卡罗拉靠发动机。', '补能，电车在家过夜充，油车几分钟加满。', '每公里花费，电车便宜不少。', '跑长途，油车更省心。', '它们也有一样的地方：都有四个轮子，都要上保险。']],
  [/旧金山|行程/u, ['旧金山三天，一天一区。', '第一天上午去渔人码头，下午坐船去恶魔岛。', '第二天早上走金门大桥，中午到索萨利托。', '第三天上双子峰，最后去渡轮大厦。']],
  [/低空/u, ['低空经济是三百米以下的生意。', '送外卖的无人机飞在一百二十米。', '载人飞行器飞到三百米。', '民航客机在一万米。', '最底下是电池和电机，往上是电控，再往上才是飞行器。']],
  [/关系/u, ['电动车和低空飞行器是两样东西。', '电动车在地上跑，载人、拉货。', '飞行器在天上飞，送外卖、载人。', '它们共用电池、电机和电控。', '所以电动车先把路修好了。']],
  [/乐高/u, ['乐高是这样一步步来的。', '一九三二年，木匠开了木工坊。', '一九四九年，第一块塑料积木。', '一九五八年，凸点加圆管定型。', '一九七八年，小人仔诞生。']],
);
const sentences = text => ANSWERS.find(([pattern]) => pattern.test(text))?.[1] ?? ['嗯，我在，你说。'];

const gateway = {ready: true, request: async (method, args) => {
  if (method === 'tools.catalog') return {groups: [{tools: []}]};
  if (method === 'sessions.resolve') return {key: args.key};
  if (method === 'sessions.describe') return {session: {key: args.key, agentId: 'makaron'}};
  if (method === 'chat.history') return {messages: []};
  if (method === 'talk.client.create') throw Error('本地替身只支持 Grok Voice');
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
const KIT = [
  [/积木|方程/u, '摆正方形', [
    {id: 't', t: 'tiles', h: '摆一摆', items: [{id: 'a', rows: 2, cols: 2, h: '4 块', tone: 'butter', q: '先拿四块积木'}, {id: 'b', rows: 3, cols: 3, h: '9 块', tone: 'peach', q: '再拿九块积木'}, {id: 'c', rows: 4, cols: 4, h: '16 块', tone: 'sky', q: '十六块积木'}, {id: 'd', n: 25, per: 5, lit: 0, h: '25 块？', q: '那二十五块'}]},
    {id: 'f', t: 'formula', items: [{id: 'x', h: '4', d: '每边几块', tone: 'sky', q: '所以四乘四'}, {id: 'm', h: '×', q: '所以四乘四'}, {id: 'y', h: '4', d: '有几排', tone: 'sky', q: '所以四乘四'}, {id: 'e', h: '=', q: '等于十六'}, {id: 'r', h: '16', d: '一共', tone: 'butter', mark: 'ring', q: '等于十六'}]}]],
  [/电动车|油车/u, '电动车和油车', [
    {id: 'v', t: 'versus', sides: [{h: '特斯拉 Model 3', img: '特斯拉 Model 3'}, {h: '丰田卡罗拉', img: '丰田卡罗拉'}], items: [{id: 'a', h: '动力', icon: '⚙️', cells: ['电池 + 电机', '汽油发动机'], q: '动力上'}, {id: 'b', h: '补能', icon: '🔌', cells: ['在家过夜充', '几分钟加满'], win: 1, q: '补能'}, {id: 'c', h: '每公里', icon: '💰', cells: ['便宜不少', '油费更高'], win: 0, q: '每公里花费'}, {id: 'd', h: '长途', icon: '🛣️', cells: ['要规划充电', '更省心'], win: 1, q: '跑长途'}]},
    {id: 'o', t: 'overlap', a: {h: '电动车', points: ['电机', '充电桩'], q: '特斯拉靠电机'}, b: {h: '油车', points: ['发动机', '加油站'], q: '卡罗拉靠发动机'}, both: {h: '都有', points: ['四个轮子', '要上保险'], q: '都有四个轮子'}}]],
  [/旧金山|行程/u, '旧金山三日', [
    {id: 'd1', t: 'timeline', w: 'third', h: '第一天', items: [{id: 'a', when: '上午', h: '渔人码头', img: '渔人码头', q: '渔人码头'}, {id: 'b', when: '下午', h: '恶魔岛', d: '提前订票', img: '恶魔岛', q: '恶魔岛'}]},
    {id: 'd2', t: 'timeline', w: 'third', h: '第二天', items: [{id: 'a', when: '早上', h: '金门大桥', img: '金门大桥', q: '金门大桥'}, {id: 'b', when: '中午', h: '索萨利托', img: '索萨利托', q: '索萨利托'}]},
    {id: 'd3', t: 'timeline', w: 'third', h: '第三天', items: [{id: 'a', when: '上午', h: '双子峰', img: '双子峰', q: '双子峰'}, {id: 'b', when: '傍晚', h: '渡轮大厦', img: '旧金山渡轮大厦', q: '渡轮大厦'}]}]],
  [/低空/u, '低空经济', [
    {id: 's', t: 'scale', w: 'half', h: '飞多高', unit: '米', dir: 'up', items: [{id: 'a', at: 120, h: '外卖无人机', icon: '🚁', q: '一百二十米'}, {id: 'b', at: 300, h: '载人飞行器', icon: '🛸', q: '飞到三百米'}, {id: 'c', at: 10000, h: '民航客机', icon: '✈️', q: '一万米'}]},
    {id: 'k', t: 'stack', w: 'half', h: '谁托着谁', items: [{id: 'a', h: '飞行器', d: '无人机、载人机', icon: '🚁', q: '再往上才是飞行器'}, {id: 'b', h: '电控', icon: '🎛️', q: '往上是电控'}, {id: 'c', h: '电池和电机', d: '电动车先做成熟', icon: '🔋', q: '最底下是电池'}]}]],
  [/关系/u, '电动车和低空经济', [
    {id: 'o', t: 'overlap', a: {h: '电动车', points: ['地上跑', '载人拉货'], img: '比亚迪', q: '电动车在地上跑'}, b: {h: '飞行器', points: ['天上飞', '送外卖、载人'], img: '亿航EH216', q: '飞行器在天上飞'}, both: {h: '共用', points: ['电池', '电机', '电控'], q: '它们共用电池'}},
    {id: 'n', t: 'sticky', text: '电动车先把路修好了', q: '所以电动车先把路'}]],
  [/乐高/u, '乐高怎么来的', [
    {id: 'h', t: 'timeline', items: [{id: 'a', when: '1932', h: '木工坊', icon: '🪵', q: '一九三二年'}, {id: 'b', when: '1949', h: '塑料积木', icon: '🧱', q: '一九四九年'}, {id: 'c', when: '1958', h: '凸点定型', icon: '🔩', mark: 'ring', q: '一九五八年'}, {id: 'd', when: '1978', h: '小人仔', img: '乐高小人', q: '一九七八年'}]}]],
];
const SCENES = [
  ...KIT,
  [/接通/u, '电话怎么接通', [{id: 's', t: 'steps', items: [{id: 'a', h: '拨号', d: '要一个通话名额，打开麦克风', icon: '📞', q: '第一步是拨号'}, {id: 'b', h: '建立连接', d: '声音转给语音模型，再传回来', icon: '🔌', q: '第二步是建立连接'}, {id: 'c', h: '直接说话', d: '随时可以打断', icon: '🗣️', mark: 'underline', q: '第三步就是直接说话'}]}], {id: 'n', t: 'sticky', text: '整个过程一般两三秒'}],
  [/对比|比较/u, '两种画面方案', [{id: 'c', t: 'compare', cols: [{id: 'v', h: '实时视频', icon: '🎬', points: ['画面最有感染力', '首帧十几秒', '按秒计费'], q: '实时视频的画面'}, {id: 'e', h: '讲解画面', icon: '✏️', tag: '先做', mark: 'ring', points: ['一秒内出现', '信息准确', '成本很低'], q: '讲解画面一秒内'}]}], {id: 'n', t: 'sticky', tone: 'blush', text: '先做讲解画面，实时视频留给陪伴'}],
  [/夜班/u, '夜班现在', [{id: 'k', t: 'stats', items: [{id: 'a', label: '在产', value: '12', unit: '张', q: '在产十二张卡'}, {id: 'b', label: '今晚已交付', value: '31', unit: '条', mark: 'check', q: '已经交付三十一条'}, {id: 'c', label: '等你确认', value: '2', unit: '条', mark: 'ring', q: '有两条在等你'}]}, {id: 'b', t: 'bars', h: '并发', items: [{id: 'u', label: '已用', value: 8, q: '现在用了八个'}, {id: 'm', label: '上限', value: 15, q: '并发上限是十五'}]}], null],
  [/铁塔|埃菲尔/u, '埃菲尔铁塔', [{id: 'p', t: 'photo', query: '埃菲尔铁塔', caption: '巴黎 · 战神广场'}, {id: 'l', t: 'list', items: [{id: 'a', h: '1889 年世博会', d: '建成时很多人嫌它丑', icon: '🎡', q: '一八八九年为世博会'}, {id: 'b', h: '高 330 米', d: '曾是世界最高建筑', icon: '📏', mark: 'ring', q: '塔高三百三十米'}, {id: 'c', h: '每年约 700 万人登塔', icon: '🧗', mark: 'underline', q: '现在每年有大约'}]}], {id: 'n', t: 'sticky', tone: 'sky', text: '一开始是临时建筑，差点被拆'}],
  [/宝可梦|相克/u, '谁打得过谁', [{id: 'f', t: 'flow', nodes: [{id: 'w', label: '杰尼龟', sub: '水', img: '杰尼龟', q: '杰尼龟喷水'}, {id: 'h', label: '小火龙', sub: '火', img: '小火龙', q: '小火龙吐火'}, {id: 'g', label: '妙蛙种子', sub: '草', img: '妙蛙种子', q: '妙蛙种子把'}], edges: [['w', 'h', '水灭火'], ['h', 'g', '火烧草'], ['g', 'w', '草吸水']]}], {id: 'n', t: 'sticky', text: '像石头剪刀布'}],
  [/数据|流|架构/u, '语音和画面两条线', [{id: 'f', t: 'flow', nodes: [{id: 'u', label: '你说的话', icon: '🗣️'}, {id: 'v', label: '语音模型', sub: '又快又自然', q: '你的声音进语音模型'}, {id: 'd', label: '画面导演', sub: '只管屏幕', icon: '✏️', q: '交给画面导演'}, {id: 'a', label: '你听到的回答', icon: '👂'}, {id: 'b', label: '你看到的画面', icon: '👀', q: '屏幕上放什么'}], edges: [['u', 'v', '声音'], ['u', 'd', '文字'], ['v', 'a'], ['d', 'b'], ['v', 'd', 'V 说的话']]}], {id: 'n', t: 'sticky', text: '两边都不等对方'}],
];
async function* scriptedDirector({messages, signal}) {
  const request = JSON.parse(messages[1].content);
  const topic = SCENES.find(([pattern]) => pattern.test(request.conversation.filter(turn => turn.role === 'user').at(-1)?.text ?? ''));
  const line = async (op, wait = 260) => { await pause(wait); return signal?.aborted ? '' : JSON.stringify(op) + '\n'; };
  if (!topic) { yield await line({op: 'none'}, 300); return; }
  const [, title, blocks, note] = topic, empty = typeof request.screen === 'string' || request.screen.title !== title;
  if (empty) { yield await line({op: 'scene', title, ...(process.env.BOARD_FIXTURE_LESSON === '1' && KIT.includes(topic) ? {lesson: true} : {})}, 500); for (const block of blocks) yield await line({op: 'put', block}); }
  if (request.trigger === 'assistant_end' && note) yield await line({op: 'put', block: note});
  if (!empty && request.trigger !== 'assistant_end') yield await line({op: 'none'}, 200);
}

const real = boardDirectorFromEnv({...process.env, VOICE_BOARD: '1'}, {audit: event => console.log(JSON.stringify(event))});
const board = real ?? createBoardDirector({complete: scriptedDirector, audit: event => console.log(JSON.stringify(event))});
const service = createDirectVoiceService({gateway, wsModule: {WebSocket: Model, WebSocketServer}, apiKeys: {grok: 'LOCAL_FIXTURE_ONLY'},
  audit: event => { board.observe(event); if (/^call\./u.test(event.type)) console.log(JSON.stringify({type: event.type, voiceSessionId: event.voiceSessionId, model: event.model, message: event.message})); }, loadContext: async () => '', searchAcknowledgment: 'off'});
// Real pictures when Wikipedia is reachable; otherwise a bundled image, so the print is never missing in a layout check.
const wikipedia = createPhotoFinder({braveKey: process.env.VOICE_BOARD_BRAVE_KEY ?? ''});
const boardPhotos = {find: async query => await wikipedia.find(query) ?? {bytes: await readFile(new URL('../../lab/gpt-live-h5/assets/v-operator-home-1024.webp', import.meta.url)), type: 'image/webp', title: query, source: '本地替身'}};
const bridge = createLiveH5Server({gateway, directVoice: service, board, boardPhotos, defaultModel: 'grok', enableGrok: true,
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
