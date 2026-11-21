#!/usr/bin/env node
// Where a request goes: done by the voice model itself, or handed to V's backend. Each case is
// spoken (synthesized speech, 16 kHz PCM beside the cases: audio/<sha1 of the words>.pcm) to the real voice model (SeedDuplex) with the real instructions and tool declarations of
// the code under test (VOICE_EVAL_ROOT, default this checkout); everything a tool would do is a
// stand-in here: no Gateway, no backend task, no message sent, nothing generated or paid for but
// the voice model's own turn. What is recorded is what was set going: a creation command, a
// backend task, a lookup, a lesson, or nothing.
//
//   node routing-eval.mjs cases.json out-dir [repeats]
//
// Run on V through a Candidate's launcher (routing-eval-on-v.sh): the voice model's key is the
// Candidate's own and is never printed.
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const [casesFile, out, repeats = '1'] = process.argv.slice(2);
if (!casesFile || !out) throw Error('Usage: routing-eval.mjs cases.json out-dir [repeats]');
const root = resolve(process.env.VOICE_EVAL_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)));
const from = path => import(pathToFileURL(join(root, path)));
const {createDirectVoiceService} = await from('lab/realtime-direct-tools/session.mjs');
const {createVoiceMediaCli} = await from('lab/realtime-direct-tools/media-cli.mjs');
const {createBoardDirector, boardCompletionFromEnv} = await from('lab/gpt-live-h5/board-director.mjs');
const shelfModule = await from('lab/gpt-live-h5/board-assets.mjs');
const {TOOLS} = await from('lab/realtime-direct-tools/tools.mjs');
// (Code from before the check existed has no such module.)
const materialModule = await from('lab/realtime-direct-tools/material-check.mjs').catch(() => null);
const {WebSocket} = createRequire(join(root, 'package.json'))('ws');
const key = process.env.VOLCENGINE_REALTIME_API_KEY ?? process.env.DOUBAO_SPEECH_API_KEY;
if (!key) throw Error('The voice model credential is not in this environment');
const cases = JSON.parse(await readFile(casesFile, 'utf8')).filter(item => !process.env.ROUTING_ONLY || new RegExp(process.env.ROUTING_ONLY, 'u').test(item.id));
await mkdir(out, {recursive: true});
const speech = async text => readFile(join(dirname(resolve(casesFile)), 'audio', createHash('sha1').update(text).digest('hex') + '.pcm'));
const standin = fileURLToPath(new URL('./fixtures/makaron-standin.mjs', import.meta.url));
// (A check the code under test may make with the board's own text model, where it has one.)
const boardModel = boardCompletionFromEnv({...process.env, VOICE_BOARD: '1', VOICE_BOARD_MAX_TOKENS: '120'});

const FOUND = {
  memory_search: {results: [{path: 'memory/notes.md', snippet: '（替身记忆）上次通话聊的是周末去杭州的两天行程：第一天西湖和灵隐寺，第二天龙井村。', score: 0.82}]},
  web_search: {results: [{title: '（替身搜索结果）', url: 'https://example.com/a', snippet: '这是评测用的替身搜索结果：珠穆朗玛峰高 8848.86 米；昨天的比赛主队 112 比 105 获胜，头号得分手拿下 31 分。'}]},
  web_fetch: {text: '（替身网页正文）这是评测用的网页内容。'},
  read: {text: '（替身文件内容）'},
};
const AGENDA = {events: [{summary: '（替身日程）产品周会', start: '14:00', end: '15:00'}, {summary: '（替身日程）接孩子', start: '17:30', end: '18:00'}]};

async function run(item, round) {
  const record = {id: item.id, round, calls: [], effects: [], said: '', errors: []};
  const seen = {model: {}, sent: {}, client: {}}, count = (bag, name) => { bag[name] = (bag[name] ?? 0) + 1; };
  const began = Date.now(), stamp = () => Date.now() - began;
  let turnAt = 0, instructionChars = 0, toolCount = 0, lastDone = 0, lastActivity = 0, busyAt = 0;
  let closing = false;
  const effect = (kind, detail = '') => { if (closing) return; record.effects.push({at: stamp(), turn: turnAt ? 1 : 0, kind, detail: String(detail).slice(0, 400)}); lastActivity = Date.now(); };
  const fail = name => item.setup?.fail?.[name];
  const gateway = {ready: true, request: async (method, args) => {
    if (method === 'tools.catalog') return {groups: [{tools: [...TOOLS.map(tool => ({id: tool.name, description: tool.description})), {id: 'process', description: '跟进'}]}]};
    if (method === 'sessions.resolve') return {key: args.key};
    if (method === 'sessions.describe') return {session: {key: args.key, agentId: 'makaron'}};
    if (method === 'chat.history') return {messages: []};
    if (method === 'voice.product.task.start') { effect('back', args.publicQuestion ?? args.question); return {taskId: 'task-eval', runId: 'run-eval'}; }
    if (method === 'voice.product.task.read') return {taskId: 'task-eval', status: 'running', runs: ['run-eval'], progress: []};
    if (method === 'voice.product.task.lookup') return {found: false};
    if (method === 'voice.product.task.cancel') { effect('control', 'cancel'); return {ok: true, cancelled: true}; }
    if (method === 'voice.product.task.control') { effect('control', args.mode ?? 'control'); return {ok: true}; }
    if (method === 'tools.invoke') {
      effect('lookup', `${args.name} ${JSON.stringify(args.args ?? {})}`);
      if (fail(args.name)) return {ok: false, error: {code: 'tool_error', message: fail(args.name)}};
      const details = FOUND[args.name] ?? {ok: true};
      return {ok: true, output: {content: [{type: 'text', text: JSON.stringify(details)}], details}};
    }
    throw Error('Routing evaluation: no such Gateway method ' + method);
  }};
  class Spy extends WebSocket {
    constructor(...args) {
      super(...args);
      this.on('error', error => record.errors.push('model socket: ' + String(error?.message ?? error).slice(0, 160)));
      this.on('message', raw => {
        let event; try { event = JSON.parse(raw.toString()); } catch { count(seen.model, 'unparsed'); return; }
        count(seen.model, event.type);
        if (event.type === 'response.function_call_arguments.done') for (const call of event.items ?? []) { record.calls.push({at: stamp(), turn: turnAt ? 1 : 0, name: call.name, args: String(call.arguments ?? '').slice(0, 600)}); lastActivity = Date.now(); }
        if (event.type === 'response.done') lastDone = Date.now();
        if (/^response\.|speech_started|TTS/u.test(event.type ?? '')) busyAt = Date.now();
      });
    }
    send(data, ...rest) {
      try { const event = JSON.parse(data); count(seen.sent, event.type); if (event.type === 'session.update' || event.type === 'session.create') { if (typeof event.session?.instructions === 'string') instructionChars = event.session.instructions.length; if (Array.isArray(event.session?.tools)) toolCount = event.session.tools.length; } } catch {}
      return super.send(data, ...rest);
    }
  }
  class Client extends EventEmitter {
    readyState = 1;
    send(raw) { let event; try { event = JSON.parse(raw); } catch { return; } count(seen.client, event.type); if (event.type === 'error') record.errors.push('client: ' + String(event.message ?? event.error ?? '').slice(0, 160)); if (event.type === 'ready') this.ready = true; if (event.type === 'transcript' && event.role === 'assistant' && turnAt && typeof event.text === 'string') record.said = event.text.slice(0, 300); if (event.type === 'transcript' && event.role === 'user' && turnAt && typeof event.text === 'string') record.heard = event.text.slice(0, 200); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  }
  class Server { handleUpgrade(_req, socket, _head, done) { done(socket); } close() {} }
  const board = createBoardDirector({complete: async function* () { yield '{"op":"none"}\n'; }, stream: {instructions: '', refine: op => op, cue: true}});
  const assets = shelfModule.createAssetShelf({director: board, see: null, ...(shelfModule.SELF_IMAGE ? {standing: [shelfModule.SELF_IMAGE]} : {})});
  board.shelf = assets; assets.audience = 'all';
  assets.share = async query => ({url: 'https://picsum.photos/id/1015/900/600.jpg', until: Date.now() + 30 * 60000});
  const cli = createVoiceMediaCli({environment: {PATH: process.env.PATH, MAKARON_API_KEY: 'ROUTING_EVAL_ONLY', STANDIN_SPEED: '6', TMPDIR: out}, binary: standin, pollIntervalMs: 800, baseDirectory: out});
  const mediaCli = item.setup?.entry === 'no-executor' ? null : {forCall: async () => { const runner = await cli.forCall(); return {...runner, execute: (command, ...rest) => { effect('make', command); return runner.execute(command, ...rest); }}; }};
  const lesson = new Proxy({available: true, source: 'service', audience: 'owner',
    prepare: async ({topic}) => { effect('lesson', topic); return {title: String(topic).slice(0, 12), say: '（评测替身讲稿）好，这件事简单说是这样的。', show: []}; }}, {get: (target, name) => name in target ? target[name] : () => null});
  const calendar = async args => { effect('lookup', 'feishu_calendar ' + JSON.stringify(args)); if (fail('feishu_calendar')) throw Error(fail('feishu_calendar')); return AGENDA; };
  const larkRead = async args => { effect('lookup', 'lark_read ' + JSON.stringify(args)); if (fail('lark_read')) throw Error(fail('lark_read')); return {items: []}; };
  let service, timer;
  const client = new Client();
  try {
    service = createDirectVoiceService({gateway, wsModule: {WebSocket: Spy, WebSocketServer: Server}, apiKeys: {seeduplex: key}, mediaCli, assets, lesson, calendar, larkRead,
      ...(materialModule && boardModel ? {materialCheck: materialModule.createMaterialCheck({complete: boardModel})} : {}), loadContext: async () => '', searchAcknowledgment: 'off',
      audit: event => { board.observe?.(event); assets.observe?.(event); if (event.type === 'tool.delivered' && event.status && event.status !== 'ok') record.errors.push(`${event.name}: ${event.status}`); }});
    const reservation = await service.reserve({model: 'seeduplex', sessionKey: 'agent:makaron:feishu:group:routing_eval', inputSampleRate: 16000, ...(item.setup?.entry === 'bound' ? {sessionBound: true} : {})});
    const id = reservation.voiceSessionId;
    service.upgrade({}, client, Buffer.alloc(0), id, reservation.relayTicket);
    for (const deadline = Date.now() + 15000; !client.ready && Date.now() < deadline && client.readyState === 1;) await delay(20);
    if (!client.ready) throw Error('the voice model did not become ready');
    // The microphone: silence, or what is being said, twenty milliseconds at a time.
    let voice = null, offset = 0, spoken = () => {};
    timer = setInterval(() => {
      const frame = Buffer.alloc(640);
      if (voice) { voice.copy(frame, 0, offset, Math.min(offset + 640, voice.length)); offset += 640; if (offset >= voice.length) { voice = null; spoken(); } }
      client.emit('message', frame, true);
    }, 20);
    const say = async text => { const pcm = await speech(text); await new Promise(done => { spoken = done; offset = 0; voice = pcm; }); };
    client.emit('message', Buffer.from(JSON.stringify({type: 'greeting'})), false);
    // The greeting is let through first.
    for (const deadline = Date.now() + 8000; !lastDone && Date.now() < deadline;) await delay(50);
    await delay(1500);
    for (const thing of item.setup?.assets ?? []) assets.add(id, {kind: thing.kind ?? 'image', url: thing.url ?? `https://cdn.example.com/eval/${encodeURIComponent(thing.name)}.${thing.kind === 'video' ? 'mp4' : 'png'}`, name: thing.name, source: 'made'});
    for (const photo of item.setup?.photos ?? []) assets.found(id, {query: photo.query ?? photo.name, name: photo.name});
    if (item.setup?.assets?.length || item.setup?.photos?.length) await delay(1400);
    const said = Array.isArray(item.say) ? item.say : [item.say];
    for (const [index, text] of said.entries()) {
      const last = index === said.length - 1;
      if (last) turnAt = Date.now();
      lastDone = 0; lastActivity = 0;
      await say(text);
      const asked = Date.now();
      // Until the answer has ended and nothing more has been set going for a while.
      for (const deadline = asked + (last ? 22000 : 16000); Date.now() < deadline && client.readyState === 1;) {
        await delay(100);
        if (lastDone && Date.now() - lastDone > (last ? 2600 : 1500) && Date.now() - busyAt > 1500 && (!lastActivity || Date.now() - lastActivity > 2600)) break;
      }
    }
  } catch (error) { record.errors.push(String(error?.message ?? error).slice(0, 200)); }
  finally { closing = true; clearInterval(timer); await service?.dispose().catch(() => {}); }
  record.instructionChars = instructionChars; record.tools = toolCount; record.ms = stamp();
  if (process.env.ROUTING_DEBUG === '1') record.seen = seen;
  return record;
}

/** What the last thing said set going, in the order it happened: make / back / lookup / lesson / control / talk. */
export function routeOf(record) {
  const kinds = [];
  for (const row of record.effects.filter(row => row.turn)) if (!kinds.includes(row.kind)) kinds.push(row.kind);
  for (const call of record.calls.filter(call => call.turn)) {
    const kind = call.name === 'delegate_to_v' ? 'back' : ['end_call', 'cancel_task', 'openclaw_agent_control'].includes(call.name) ? 'control' : call.name === 'current_time' ? 'lookup' : call.name === 'show_content' ? 'show' : '';
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds.length ? kinds : ['talk'];
}
/** A case's verdict: {ok, why}. `expect.route` lists the acceptable routes (each a kind, or kinds joined with "+", all of which must be there); `expect.never` lists kinds that must not be there. */
export function verdict(item, record) {
  if (record.errors.some(error => /did not become ready|credential/u.test(error))) return {ok: false, why: 'not run: ' + record.errors[0]};
  const kinds = routeOf(record), expect = item.expect ?? {};
  const fits = (expect.route ?? []).some(route => route.split('+').every(kind => kinds.includes(kind)));
  if (expect.route && !fits) return {ok: false, why: `went ${kinds.join('+')}, wanted ${expect.route.join(' or ')}`};
  for (const kind of expect.never ?? []) if (kinds.includes(kind)) return {ok: false, why: `went ${kind}, which it must not`};
  const made = record.effects.filter(row => row.turn && row.kind === 'make').map(row => row.detail).join('\n'), asked = record.calls.filter(call => call.turn && call.name === 'exec').map(call => call.args).join('\n');
  if (expect.command && kinds.includes('make') && !new RegExp(expect.command, 'u').test(asked + '\n' + made)) return {ok: false, why: `made without ${expect.command}`};
  return {ok: true, why: kinds.join('+')};
}

const results = [], queue = [];
// Sessions are started at least a few seconds apart.
let gate = Promise.resolve();
const paced = work => { const turn = gate.then(() => delay(Number(process.env.ROUTING_GAP_MS ?? 4000))); gate = turn.catch(() => {}); return turn.then(work); };
for (let round = 1; round <= Number(repeats); round++) for (const item of cases) queue.push(async () => {
  // (The voice service refuses new sessions for a while after too many: wait and try the case again.)
  let record = await paced(() => run(item, round));
  for (let tries = 0; tries < 3 && record.errors.some(error => /未完成|did not become ready/u.test(error)); tries++) { await delay(25000); record = await paced(() => run(item, round)); }
  const judged = verdict(item, record);
  results.push({...record, route: routeOf(record), ...judged});
  console.log(JSON.stringify({id: item.id, round, ok: judged.ok, why: judged.why, calls: record.calls.filter(call => call.turn).map(call => call.name), said: record.said.replace(/\s+/gu, '').slice(0, 60), chars: record.instructionChars, ms: record.ms, ...(record.errors.length ? {errors: record.errors.slice(0, 2)} : {})}));
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
});
await Promise.all(Array.from({length: Number(process.env.ROUTING_LANES ?? 2)}, async () => { while (queue.length) await queue.shift()(); }));
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
const passed = results.filter(row => row.ok).length;
console.log(JSON.stringify({cases: cases.length, runs: results.length, passed, failed: results.length - passed}));
// (The voice model's socket and the stand-in generator may still hold the loop open.)
process.exit(0);
