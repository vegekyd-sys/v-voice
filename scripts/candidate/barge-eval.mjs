#!/usr/bin/env node
// Whether V stops a lesson for what is said while the lesson still plays on the phone. Each case
// asks for a lesson (spoken, so the real voice model calls explain_on_board), the lesson's script is
// the case's own (a stand-in writer returns it), and a simulated phone plays V's audio at real time
// and reports its playback the way the web page does (playback.state / playback.stats). When the
// lesson has played for `atMs`, the case's utterance is spoken into the microphone. Recorded: whether
// the lesson was cut (an audio.clear that empties the phone's queue while the lesson is in it), how
// long after the utterance ended, what V said, and whether the service released the phone's hold.
//
// The real voice model (SeedDuplex) runs with the real instructions, tools and service code of the
// code under test (VOICE_EVAL_ROOT, default this checkout); every tool is a stand-in: no Gateway,
// no backend task, nothing generated or paid for but the voice model's own turns.
//
//   node barge-eval.mjs cases.json scripts.json audio-dir out-dir [repeats]
//
// cases.json: [{id, kind: genuine|side, script: <key of scripts.json>, request, say, atMs}]
// audio-dir: <sha1 of text>.pcm, 16 kHz s16le mono, for every request and utterance.
// Run on V through a Candidate's launcher (barge-eval-run.sh): the model key is never printed.
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const [casesFile, scriptsFile, audioDir, out, repeats = '1'] = process.argv.slice(2);
if (!casesFile || !scriptsFile || !audioDir || !out) throw Error('Usage: barge-eval.mjs cases.json scripts.json audio-dir out-dir [repeats]');
const root = resolve(process.env.VOICE_EVAL_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)));
const from = path => import(pathToFileURL(join(root, path)));
const {createDirectVoiceService} = await from('lab/realtime-direct-tools/session.mjs');
const {createBoardDirector} = await from('lab/gpt-live-h5/board-director.mjs');
const shelfModule = await from('lab/gpt-live-h5/board-assets.mjs');
const {TOOLS} = await from('lab/realtime-direct-tools/tools.mjs');
const {WebSocket} = createRequire(join(root, 'package.json'))('ws');
// BARGE_FLOOR_JUDGE=1: the code under test judges whether speech over V is said to V, exactly as the
// service does (the Decisions API; the board's text model only if that route is not configured).
const floorModule = await from('lab/realtime-direct-tools/floor-judge.mjs');
const floorJudge = process.env.BARGE_FLOOR_JUDGE !== '1' ? null
  : (floorModule.floorJudgeFromEnv(process.env) ?? floorModule.createFloorJudge({complete: (await from('lab/gpt-live-h5/board-director.mjs')).boardCompletionFromEnv({...process.env, VOICE_BOARD_MAX_TOKENS: '8'})}));
const key = process.env.VOLCENGINE_REALTIME_API_KEY ?? process.env.DOUBAO_SPEECH_API_KEY;
if (!key) throw Error('The voice model credential is not in this environment');
const only = process.env.BARGE_ONLY ? new RegExp(process.env.BARGE_ONLY, 'u') : null;
const cases = JSON.parse(await readFile(casesFile, 'utf8')).filter(item => !only || only.test(item.id));
const scripts = JSON.parse(await readFile(scriptsFile, 'utf8'));
await mkdir(out, {recursive: true});
const speech = text => readFile(join(audioDir, createHash('sha1').update(text).digest('hex') + '.pcm'));
const MS_PER_BYTE_24K = 1000 / 48000;

async function run(item, round) {
  const began = Date.now(), stamp = () => Date.now() - began;
  const record = {id: item.id, kind: item.kind, round, errors: [], events: [], said: [], heard: []};
  const note = (kind, detail = {}) => record.events.push({at: stamp(), kind, ...detail});
  const gateway = {ready: true, request: async (method, args) => {
    if (method === 'tools.catalog') return {groups: [{tools: TOOLS.map(tool => ({id: tool.name, description: tool.description}))}]};
    if (method === 'sessions.resolve') return {key: args.key};
    if (method === 'sessions.describe') return {session: {key: args.key, agentId: 'makaron'}};
    if (method === 'chat.history') return {messages: []};
    if (method === 'voice.product.task.start') { note('backend', {question: String(args.question ?? '').slice(0, 120)}); return {taskId: 'task-eval', runId: 'run-eval'}; }
    if (method === 'voice.product.task.read') return {taskId: 'task-eval', status: 'running', runs: ['run-eval'], progress: []};
    if (method === 'voice.product.task.lookup') return {found: false};
    if (method === 'voice.product.task.cancel') return {ok: true, cancelled: true};
    if (method === 'voice.product.task.control') return {ok: true};
    if (method === 'tools.invoke') {
      note('lookup', {name: args.name});
      const details = {results: [{title: '（替身结果）', url: 'https://example.com/a', snippet: '这是评测用的替身搜索结果。'}]};
      return {ok: true, output: {content: [{type: 'text', text: JSON.stringify(details)}], details}};
    }
    throw Error('Barge evaluation: no such Gateway method ' + method);
  }};
  // The phone: plays what it is sent at real time, in order, and reports as the web page does.
  const phone = {queue: [], speaking: false, lessonId: null, lessonStartedAt: 0, lessonPlayedMs: 0, lessonTotalMs: 0, lessonDone: false, cut: null};
  const queuedMs = () => phone.queue.reduce((n, chunk) => n + chunk.ms, 0);
  class Client extends EventEmitter {
    readyState = 1;
    send(raw) {
      let e; try { e = JSON.parse(raw); } catch { return; }
      if (e.type === 'ready') this.ready = true;
      if (e.type === 'error') record.errors.push('client: ' + String(e.message ?? '').slice(0, 160));
      if (e.type === 'audio') {
        const ms = Buffer.from(e.audio, 'base64').length * MS_PER_BYTE_24K;
        phone.queue.push({id: e.responseId ?? null, ms, source: e.source});
        if (e.source === 'injected-speech' && phone.lessonWanted && !phone.lessonId) { phone.lessonId = e.responseId ?? 'anonymous'; phone.lessonStartedAt = stamp(); note('lesson.audio', {responseId: e.responseId}); }
        if (phone.lessonId && e.responseId === phone.lessonId) phone.lessonTotalMs += ms;
      }
      if (e.type === 'audio.clear') {
        const head = phone.queue[0]?.id;
        // As the page does: a clear for a response that is not the one playing leaves the queue alone.
        if (typeof e.retiredResponseId === 'string' && head && head !== e.retiredResponseId) { note('clear.ignored', {reason: e.reason}); return; }
        const hadLesson = phone.lessonId && phone.queue.some(chunk => chunk.id === phone.lessonId);
        note('clear', {reason: e.reason, lesson: Boolean(hadLesson), droppedMs: Math.round(queuedMs())});
        if (hadLesson && !phone.cut && phone.uttStart) phone.cut = {at: stamp(), reason: e.reason, droppedMs: Math.round(queuedMs())};
        phone.queue = phone.queue.filter(() => false);
      }
      if (['input.speech.started', 'input.speech.stopped', 'input.speech.ignored', 'playback.duck', 'tool.call', 'audio.done'].includes(e.type)) note(e.type, {...(e.name ? {name: e.name} : {}), ...(e.recognized !== undefined ? {recognized: e.recognized} : {}), ...(e.preservedResponseId !== undefined ? {preserved: e.preservedResponseId === phone.lessonId} : {}), ...(e.type === 'audio.done' ? {lesson: Boolean(phone.lessonId) && e.responseId === phone.lessonId} : {}), ...(e.duck !== undefined ? {duck: e.duck} : {})});
      if (e.type === 'tool.call' && e.name === 'explain_on_board') phone.lessonWanted = true;
      if (e.type === 'transcript' && e.final && typeof e.text === 'string') {
        if (e.role === 'user') { record.heard.push({at: stamp(), text: e.text.slice(0, 200)}); }
        else record.said.push({at: stamp(), source: e.source ?? null, text: e.text.slice(0, 200)});
      }
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  }
  class Server { handleUpgrade(_req, socket, _head, done) { done(socket); } close() {} }
  const board = createBoardDirector({complete: async function* () { yield '{"op":"none"}\n'; }, stream: {instructions: '', refine: op => op, cue: true}});
  const assets = shelfModule.createAssetShelf({director: board, see: null, ...(shelfModule.SELF_IMAGE ? {standing: [shelfModule.SELF_IMAGE]} : {})});
  board.shelf = assets; assets.audience = 'all';
  const script = scripts[item.script];
  if (!script) throw Error('No script ' + item.script);
  const lesson = new Proxy({available: true, source: 'service', audience: 'owner',
    prepare: async ({topic}) => { note('lesson.prepare', {topic: String(topic).slice(0, 60)}); return {title: String(topic).slice(0, 12), say: script, show: []}; }}, {get: (target, name) => name in target ? target[name] : () => null});
  let service, mic, player;
  const client = new Client();
  try {
    service = createDirectVoiceService({...JSON.parse(process.env.BARGE_SERVICE_OPTIONS || '{}'), gateway, wsModule: {WebSocket, WebSocketServer: Server}, apiKeys: {seeduplex: key}, mediaCli: null, assets, lesson, ...(floorJudge ? {floorJudge} : {}),
      loadContext: async () => '', searchAcknowledgment: 'off', audit: event => { board.observe?.(event); assets.observe?.(event); if (event.type === 'audio.clear' || event.type === 'input.speech.release' || event.type === 'playback.note' || event.type === 'floor.judged' || event.type === 'floor.dropped') note('audit.' + event.type, {reason: event.reason, ...(event.remainingMs ? {remainingMs: event.remainingMs, playedMs: event.playedMs} : {}), ...(event.type === 'floor.judged' ? {toV: event.toV, ms: event.ms} : {}), ...(event.type === 'floor.dropped' ? {kind: event.kind} : {})}); }});
    const reservation = await service.reserve({model: 'seeduplex', sessionKey: 'agent:makaron:feishu:group:barge_eval', inputSampleRate: 16000});
    const id = reservation.voiceSessionId;
    service.upgrade({}, client, Buffer.alloc(0), id, reservation.relayTicket);
    for (const deadline = Date.now() + 15000; !client.ready && Date.now() < deadline && client.readyState === 1;) await delay(20);
    if (!client.ready) throw Error('the voice model did not become ready');
    const report = value => client.emit('message', Buffer.from(JSON.stringify(value)), false);
    // Playback at real time (20 ms a tick), with the reports a web page sends.
    let statsAt = 0;
    player = setInterval(() => {
      let budget = 20;
      while (budget > 0 && phone.queue.length) {
        const head = phone.queue[0], used = Math.min(budget, head.ms);
        head.ms -= used; budget -= used;
        if (head.id === phone.lessonId && phone.lessonId) phone.lessonPlayedMs += used;
        if (head.ms <= 0.01) phone.queue.shift();
      }
      if (phone.lessonId && !phone.lessonDone && phone.lessonPlayedMs > 0 && !phone.queue.some(chunk => chunk.id === phone.lessonId)) { phone.lessonDone = true; note('lesson.ended', {playedMs: Math.round(phone.lessonPlayedMs)}); }
      const speaking = phone.queue.length > 0;
      if (speaking !== phone.speaking) { phone.speaking = speaking; report({type: 'playback.state', speaking}); }
      if (Date.now() - statsAt >= 2000) { statsAt = Date.now(); report({type: 'playback.stats', queuedOutputBytes: Math.round(queuedMs() * 48), outputBytes: 0, clears: 0, underflows: 0}); }
    }, 20);
    // The microphone: silence, or what is being said, twenty milliseconds at a time.
    let voice = null, offset = 0, spoken = () => {};
    mic = setInterval(() => {
      const frame = Buffer.alloc(640);
      if (voice) { voice.copy(frame, 0, offset, Math.min(offset + 640, voice.length)); offset += 640; if (offset >= voice.length) { voice = null; spoken(); } }
      client.emit('message', frame, true);
    }, 20);
    const say = async text => { const pcm = await speech(text); await new Promise(done => { spoken = done; offset = 0; voice = pcm; }); };
    report({type: 'greeting'});
    for (const deadline = Date.now() + 9000; !record.said.length && Date.now() < deadline;) await delay(50);
    for (const deadline = Date.now() + 8000; phone.speaking && Date.now() < deadline;) await delay(50);
    await delay(800);
    await say(item.request);
    for (const deadline = Date.now() + 40000; !phone.lessonId && Date.now() < deadline && client.readyState === 1;) await delay(50);
    if (!phone.lessonId) { record.invalid = 'no lesson'; return record; }
    // Wait for the moment the utterance began in the real call (earlier if the lesson is shorter here).
    const utterancePcm = await speech(item.say), utteranceMs = utterancePcm.length / 32;
    for (let target = item.atMs; ; await delay(20)) {
      if (phone.lessonDone || phone.cut) break;
      // (The whole lesson is known once generated: leave room for the utterance and a decision.)
      if (record.events.some(row => row.kind === 'audio.done' && row.lesson)) target = Math.min(item.atMs, Math.max(2500, phone.lessonTotalMs - utteranceMs - 6000));
      if (phone.lessonPlayedMs >= target) break;
    }
    if (phone.lessonDone || phone.cut) { record.invalid = phone.cut ? 'cut before utterance' : 'lesson ended before utterance'; return record; }
    phone.uttStart = stamp(); record.utterance = {atMs: Math.round(phone.lessonPlayedMs), ms: Math.round(utteranceMs), lessonMs: Math.round(phone.lessonTotalMs)};
    note('utterance.start');
    await say(item.say);
    phone.uttEnd = stamp(); note('utterance.end');
    // Until V has cut the lesson and answered, the lesson has ended, or long enough to know it went on.
    for (const deadline = Date.now() + 12000; Date.now() < deadline && client.readyState === 1;) {
      await delay(100);
      if (phone.cut && Date.now() - began - phone.cut.at > 3000) break;
      if (phone.lessonDone && Date.now() - began - phone.uttEnd > 4000) break;
    }
    record.lessonRemainingMs = Math.round(phone.queue.filter(chunk => chunk.id === phone.lessonId).reduce((n, chunk) => n + chunk.ms, 0));
  } catch (error) { record.errors.push(String(error?.message ?? error).slice(0, 200)); }
  finally {
    clearInterval(mic); clearInterval(player);
    record.cut = phone.cut ? {...phone.cut, afterEndMs: phone.cut.at - phone.uttEnd, afterStartMs: phone.cut.at - phone.uttStart} : null;
    const heardAt = record.heard.find(row => row.at >= (phone.uttStart ?? Infinity));
    if (record.cut && heardAt) record.cut.afterHeardMs = phone.cut.at - heardAt.at;
    record.reply = record.said.filter(row => row.at >= (phone.uttStart ?? Infinity) && !row.source).map(row => row.text).join(' / ').slice(0, 300);
    record.heardText = record.heard.filter(row => row.at >= (phone.uttStart ?? Infinity)).map(row => row.text).join(' / ');
    record.released = record.events.some(row => row.kind === 'input.speech.ignored' && row.at >= (phone.uttStart ?? Infinity));
    record.ms = stamp();
    await service?.dispose().catch(() => {});
  }
  return record;
}

const results = [], queue = [];
let gate = Promise.resolve();
const paced = work => { const turn = gate.then(() => delay(Number(process.env.BARGE_GAP_MS ?? 4000))); gate = turn.catch(() => {}); return turn.then(work); };
for (let round = 1; round <= Number(repeats); round++) for (const item of cases) queue.push(async () => {
  let record = await paced(() => run(item, round));
  for (let tries = 0; tries < 2 && (record.errors.some(error => /未完成|did not become ready/u.test(error)) || record.invalid === 'no lesson'); tries++) { await delay(record.invalid ? 4000 : 25000); record = await paced(() => run(item, round)); }
  results.push(record);
  console.log(JSON.stringify({id: item.id, round, kind: item.kind, invalid: record.invalid, cut: record.cut ? Math.round(record.cut.afterEndMs) : null, released: record.released, heard: record.heardText?.slice(0, 40), reply: record.reply?.slice(0, 60), ...(record.errors.length ? {errors: record.errors.slice(0, 2)} : {})}));
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
});
await Promise.all(Array.from({length: Number(process.env.BARGE_LANES ?? 2)}, async () => { while (queue.length) await queue.shift()(); }));
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
const valid = results.filter(row => !row.invalid && !row.errors.length);
const rate = kind => { const rows = valid.filter(row => row.kind === kind); return `${rows.filter(row => row.cut).length}/${rows.length}`; };
console.log(JSON.stringify({runs: results.length, valid: valid.length, genuineCut: rate('genuine'), sideCut: rate('side')}));
process.exit(0);
