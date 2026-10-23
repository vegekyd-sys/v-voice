import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer,request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import * as ws from 'ws';
import OpusScript from 'opusscript';
import {createDirectVoiceService} from './session.mjs';
import {TOOL_FAILURE_LINE,TOOL_RESULT_PROMPT_LINE} from './lookup-recovery.mjs';
import {TOOL_PROGRESS_LINES} from './tool-start-audio.mjs';
import {createDeviceEndpoint,parseDeviceEntries,BACKGROUND_LEAVE_LINE,UNHEARD_TURN_LINE} from './device-endpoint.mjs';
import {createStreamingSpeakerRoutingService} from '../speaker-native/stream-service.mjs';

const TOKEN = 'device-fixture-token-0123456789abcdef';
const SESSION = 'agent:makaron:feishu:group:oc_fixture';
const record = (overrides = {}) => ({id:'speaker-test',token:TOKEN,sessionKey:SESSION,agentId:'makaron',callerId:'tianyi',permissionProfile:'personal-tianyi',model:'seeduplex',...overrides});
const floatAudio = samples => {const b = Buffer.alloc(samples.length * 4);samples.forEach((v, i) => b.writeFloatLE(v, i * 4));return b.toString('base64');};

async function fixture(options = {}) {
  const peers = [], audit = [];
  class ProviderSocket extends EventEmitter {
    constructor(url) {super();this.url = url;this.readyState = 1;this.sent = [];peers.push(this);setImmediate(() => this.emit('open'));}
    send(raw) {const value = JSON.parse(raw);this.sent.push(value);
      if (value.type === 'session.update') queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({type:'session.updated'})), false));
      if (value.type === 'session.create') queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({type:'session.created',session:{id:'fixture-dialog'}})), false));}
    close() {this.readyState = 3;this.emit('close');}
  }
  const gateway = options.gateway ?? {request:async method => method === 'tools.catalog' ? {groups:[{tools:[{id:'web_search'}]}]} : {ok:true}};
  const directVoice = createDirectVoiceService({gateway,wsModule:{WebSocket:ProviderSocket,WebSocketServer:class {close() {}}},apiKeys:{seeduplex:'k',grok:'k'},speakerRouting:options.speakerRouting,toolProgressClips:options.toolProgressClips,lookupRecovery:{toolProgressMs:options.toolProgressMs??5000,toolProgressRepeatMs:options.toolProgressRepeatMs??5000,toolProgressMax:options.toolProgressMax??3,toolFailureMs:options.toolFailureMs??5000,resultSilenceMs:options.resultSilenceMs??5000,staleSpeechMs:options.staleSpeechMs??150},audit:v => audit.push(v)});
  let busy = false;
  const endpoint = createDeviceEndpoint({directVoice,wsModule:ws,devices:parseDeviceEntries([record(options.record),...(options.extraDevices ?? [])]),audit:v => audit.push(v),
    maxBufferedBytes:options.maxBufferedBytes,robotEvaluate:options.robotEvaluate,visionPath:options.visionPath,describeImage:options.describeImage,isSessionBusy:() => busy,tickMs:10,idleMs:options.idleMs ?? 5000,initialIdleMs:options.initialIdleMs ?? 5000,followUpMs:options.followUpMs ?? 5000,chatterMs:options.chatterMs ?? 5000,
    chatterSpeechGraceMs:options.chatterSpeechGraceMs ?? 5000,toolHoldMs:options.toolHoldMs ?? 5000,toolProgressMs:options.toolProgressMs ?? 5000,toolProgressRepeatMs:options.toolProgressRepeatMs ?? 5000,toolProgressMax:options.toolProgressMax ?? 3,toolFailureMs:options.toolFailureMs ?? 5000,staleSpeechMs:options.staleSpeechMs ?? 5000,
    resultSilenceMs:options.resultSilenceMs ?? 5000,unheardTurnMs:options.unheardTurnMs ?? 5000,inputSilentMs:options.inputSilentMs ?? 3000});
  const server = createServer((req, res) => {if (endpoint.visionPath && req.url === endpoint.visionPath) return endpoint.handleVision(req, res);res.writeHead(404);res.end();});
  server.on('upgrade', (req, socket, head) => endpoint.handleUpgrade(req, socket, head, {dialect:req.url.startsWith('/device/xiaozhi') ? 'xiaozhi' : 'native'}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/device/voice`;
  const connect = async (token = TOKEN) => {
    const client = new ws.WebSocket(url, {headers:{authorization:`Bearer ${token}`}});
    client.events = [];client.audio = [];
    client.on('message', (data, binary) => binary ? client.audio.push(Buffer.from(data)) : client.events.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {client.once('open', resolve);client.once('error', reject);});
    return client;
  };
  const until = async (predicate, label) => {for (let i = 0; i < 300 && !predicate(); i++) await delay(5);assert(predicate(), label);};
  return {directVoice,endpoint,server,url,connect,until,peers,audit,setBusy:v => {busy = v;},
    close:async () => {await endpoint.dispose();await directVoice.dispose();await new Promise(resolve => server.close(resolve));}};
}

test('device entries require a private token and an existing Feishu session binding', () => {
  assert.throws(() => parseDeviceEntries([record({token:'short'})]), /private token/);
  assert.throws(() => parseDeviceEntries([record({token:'x'.repeat(257)})]), /private token/);
  assert.throws(() => parseDeviceEntries([record({token:'bad token'.repeat(5)})]), /private token/);
  assert.throws(() => parseDeviceEntries([record({sessionKey:'agent:makaron:explicit:x'})]), /Feishu session/);
  assert.throws(() => parseDeviceEntries([record({callerId:'visitor'})]), /actor-scoped/);
  assert.throws(() => parseDeviceEntries([record({model:'gpt-live'})]), /model/);
  for (const inputGain of [0,5,NaN,Infinity,'2']) assert.throws(() => parseDeviceEntries([record({inputGain})]), /input gain/);
  for (const noiseGateRms of [-1,2001,NaN,'450']) assert.throws(() => parseDeviceEntries([record({noiseGateRms})]), /noise gate/);
  for (const followUpMs of [4999,60001,1.5,'30000']) assert.throws(() => parseDeviceEntries([record({followUpMs})]), /follow-up window/);
  assert.equal(parseDeviceEntries([record()])[0].followUpMs, null);
  assert.throws(() => parseDeviceEntries([record(), record({id:'speaker-two'})]), /private token/);
  assert.equal(parseDeviceEntries([record({models:['seeduplex','grok'],model:'grok'})])[0].model, 'grok');
});

test('an unknown device token is rejected before any voice session exists', async t => {
  const f = await fixture();t.after(f.close);
  await assert.rejects(f.connect('x'.repeat(40)), /401/);
  assert.equal(f.peers.length, 0);
});

test('a speaker call keeps native 16 kHz input and no screen when phone Speaker routing is enabled', async t => {
  const f = await fixture({speakerRouting:{reserve(){throw Error('Phone Speaker routing must not capture hardware');},has:()=>false,close(){}}});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  await f.until(() => device.events.some(e => e.type === 'hello'), 'hello');
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'call.ready');
  const ready = device.events.find(e => e.type === 'call.ready');
  assert.equal(ready.inputSampleRate, 16000);assert.equal(ready.outputSampleRate, 24000);assert.equal(ready.model, 'seeduplex');
  const setup = f.peers[0].sent.find(e => e.type === 'session.create');
  assert.match(setup.session.instructions, /当前终端没有内容展示屏幕/);
  assert.doesNotMatch(setup.session.instructions, /现在正在电话中和 Tianyi/);
  assert(!setup.session.tools.some(tool => tool.name === 'show_content'), 'a speaker has no display tool');
  assert(f.audit.some(e => e.type === 'call.created' && e.surface === 'speaker' && e.sessionKey === SESSION));

  // Device PCM is already at the upstream rate and reaches it unresampled.
  const frame = Buffer.alloc(640);frame.writeInt16LE(1234, 0);frame.writeInt16LE(-321, 638);
  device.send(frame, {binary:true});
  await f.until(() => f.peers[0].sent.some(e => e.type === 'input_audio_buffer.append'), 'input append');
  const sent = Buffer.from(f.peers[0].sent.find(e => e.type === 'input_audio_buffer.append').audio, 'base64');
  assert.deepEqual(sent, frame);

  // Provider output arrives as binary 24 kHz PCM16, not base64 JSON.
  const provider = f.peers[0];
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.created',response_id:'r1'})), false);
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.delta',response_id:'r1',delta:floatAudio([0.5,-0.5])})), false);
  await f.until(() => device.audio.length === 1, 'binary audio');
  assert.equal(device.audio[0].length, 4);
  assert.equal(device.audio[0].readInt16LE(0), 16384);
  assert(!device.events.some(e => e.type === 'transcript'), 'speaker receives no transcript text');
});

test('device end and disconnect both close the shared session', async t => {
  const f = await fixture();t.after(f.close);
  const device = await f.connect();
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  const id = device.events.find(e => e.type === 'call.ready').voiceSessionId;
  device.send(JSON.stringify({type:'call.end'}));
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'closed');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'device');
  assert.equal(f.directVoice.activity(id), null);
  assert.equal(f.endpoint.activeCalls(), 0);
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.filter(e => e.type === 'call.ready').length === 2, 'second call');
  const second = device.events.filter(e => e.type === 'call.ready')[1].voiceSessionId;
  device.close();
  await f.until(() => f.directVoice.activity(second) === null, 'disconnect closes');
});

test('silence after the last activity releases the model session', async t => {
  const f = await fixture({initialIdleMs:60,idleMs:60});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'idle close');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'idle');
  assert(f.audit.some(e => e.type === 'device.call' && e.stage === 'closed' && e.reason === 'idle'));
});

test('a session already in a browser call is not taken over by the speaker', async t => {
  const f = await fixture();t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  f.setBusy(true);
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.error'), 'busy');
  assert.equal(device.events.find(e => e.type === 'call.error').reason, 'session-busy');
  assert.equal(f.peers.length, 0);
});

test('a reconnecting device replaces its previous connection and call', async t => {
  const f = await fixture();t.after(f.close);
  const first = await f.connect();
  first.send(JSON.stringify({type:'call.start'}));
  await f.until(() => first.events.some(e => e.type === 'call.ready'), 'ready');
  const id = first.events.find(e => e.type === 'call.ready').voiceSessionId;
  const closed = new Promise(resolve => first.once('close', resolve));
  const second = await f.connect();t.after(() => second.close());
  await closed;
  await f.until(() => f.directVoice.activity(id) === null, 'old call closed');
  assert.equal(f.endpoint.connected().length, 1);
});

test('after a reply, silence past the follow-up window ends the call', async t => {
  const f = await fixture({followUpMs:80});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));
  await delay(30);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  const ended = Date.now();
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'follow-up close');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'idle');
  assert(Date.now() - ended >= 70, 'the follow-up window is honoured');
});

// Audit 2026-10-20 R1: barging in clears playback after the user's onset, so
// the follow-up window alone hung up 10 s into the utterance. The speech grace
// (longer than the follow-up window) must hold the call for that utterance.
test('someone barging in is still talking: the follow-up window does not hang up on them', async t => {
  const f = await fixture({followUpMs:80,chatterSpeechGraceMs:5000});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));
  await delay(30);
  // The user starts talking over V; the cleared playback stops a moment later.
  f.peers[0].emit('message', Buffer.from(JSON.stringify({type:'conversation.item.input_audio_transcription.started'})), false);
  await delay(10);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await delay(250);
  assert(!device.events.some(e => e.type === 'call.closed'), 'still listening to the utterance in progress');
});

test('room conversation that never becomes a request does not hold the session', async t => {
  const f = await fixture({followUpMs:1000,chatterMs:120,chatterSpeechGraceMs:150});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));
  await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await delay(20);
  const chatter = setInterval(() => f.peers[0].emit('message', Buffer.from(JSON.stringify({type:'conversation.item.input_audio_transcription.started'})), false), 15);
  t.after(() => clearInterval(chatter));
  // V first says why it is leaving, then the call closes once that line has played.
  await f.until(() => f.peers[0].sent.some(e => e.type === 'speech_text_buffer.commit' && e.text === BACKGROUND_LEAVE_LINE), 'parting line');
  clearInterval(chatter);
  assert(!device.events.some(e => e.type === 'call.closed'), 'still open while the line plays');
  // Room chatter tripping the speaker's barge-in must not cut the line.
  const before = f.peers[0].sent.length;
  device.send(JSON.stringify({type:'barge-in'}));
  await delay(20);
  assert(!f.peers[0].sent.slice(before).some(e => /cancel|clear|interrupt/.test(e.type ?? '')), 'barge-in ignored while leaving');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));
  await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'chatter close');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'background-speech');
});


// A lookup the test answers by hand, like a 27-48 s memory_search on the node.
const slowGateway = () => {
  const waiting = new Map();
  return {waiting,request:async (method, params) => {
    if (method === 'tools.catalog') return {groups:[{tools:[{id:'memory_search'},{id:'web_search'}]}]};
    if (method === 'tools.invoke') return new Promise(resolve => waiting.set(params.name, resolve));
    return {ok:true};
  }};
};
const PROGRESS = TOOL_PROGRESS_LINES.map((text, i) => ({text,pcm:Buffer.alloc(480, i + 1),sampleRate:24000,source:'cached-native-tool-progress',sha256:`fixture-${i}`}));
const provide = (f, value) => f.peers[0].emit('message', Buffer.from(JSON.stringify(value)), false);
const nativeCall = (f, callId, name, args = {}) => provide(f, {type:'response.function_call_arguments.done',items:[{call_id:callId,name,arguments:JSON.stringify(args)}]});
const waitFor = async (predicate, label, ms = 5000) => {const end = Date.now() + ms;while (!predicate() && Date.now() < end) await delay(10);assert(predicate(), label);};
const newsGateway = {request:async method => method === 'tools.catalog' ? {groups:[{tools:[{id:'web_search'}]}]} : {ok:true,output:{content:[{type:'text',text:'今日新闻摘要'}]}}};
// A lookup the Gateway refuses at once, like the unconfigured calendar on the
// Shanghai node did before local Feishu tools were gated on configuration.
const failingGateway = {request:async method => {if (method === 'tools.catalog') return {groups:[{tools:[{id:'web_search'}]}]};if (method === 'tools.invoke') throw Error('Gateway unavailable');return {ok:true};}};
const commits = f => f.peers[0].sent.filter(e => e.type === 'speech_text_buffer.commit').map(e => e.text);

test('a slow lookup while the room talks is answered, not taken for background talk (2026-10-20 10:55)', async t => {
  const gateway = slowGateway();
  const f = await fixture({gateway,toolProgressClips:PROGRESS,followUpMs:300,chatterMs:300,chatterSpeechGraceMs:150,staleSpeechMs:150,
    toolProgressMs:100,toolProgressRepeatMs:250,toolProgressMax:2,idleMs:10000,toolHoldMs:10000});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  // V's previous answer ends, then "你查一下呗" starts memory_search.
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  nativeCall(f, 'mem', 'memory_search', {query:'在帮哪些项目'});
  await f.until(() => gateway.waiting.has('memory_search'), 'lookup running');
  // Someone in the room talks over the wait; ASR starts a turn it never finishes.
  provide(f, {type:'conversation.item.input_audio_transcription.started'});
  // Well past the chatter window and its grace: the old rule left here.
  await waitFor(() => f.audit.filter(e => e.type === 'lookup.progress').length === 2, 'two progress lines, then no more');
  await delay(400);
  assert(!device.events.some(e => e.type === 'call.closed'), 'a running lookup holds the call');
  const progress = f.audit.filter(e => e.type === 'lookup.progress');
  assert.deepEqual(progress.map(e => e.played), [true,true]);
  assert(progress[1].waitedMs - progress[0].waitedMs >= 250, 'progress lines are spaced');
  assert.deepEqual(f.audit.filter(e => e.type === 'transcript' && e.source === 'tool-progress').map(e => e.text), PROGRESS.slice(0, 2).map(c => c.text));
  assert(device.audio.some(pcm => pcm.includes(PROGRESS[0].pcm)), 'the cached line reaches the speaker');
  assert.deepEqual(commits(f), [], 'no upstream TTS while the native function waits');

  gateway.waiting.get('memory_search')({ok:true,output:{content:[{type:'text',text:'V Voice、Makaron'}]}});
  await f.until(() => f.peers[0].sent.some(e => e.type === 'conversation.item.create' && JSON.stringify(e).includes('V Voice')), 'result to the model');
  await delay(150);
  assert(!device.events.some(e => e.type === 'call.closed'), 'the windows restart when the result is back');
  // V answers; only after that answer does the follow-up window close the call.
  provide(f, {type:'response.created',response_id:'answer'});
  provide(f, {type:'response.output_audio.delta',response_id:'answer',delta:floatAudio([0.1,-0.1])});
  provide(f, {type:'response.done',response_id:'answer',response:{id:'answer',status:'completed'}});
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  const answered = Date.now();
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'follow-up close');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'idle');
  assert(Date.now() - answered >= 250, 'counted from the answer');
  assert(!commits(f).includes(BACKGROUND_LEAVE_LINE));
});

test('a lookup that fails at once and gets no reply makes V say so instead of hanging up (2026-10-19 11:03)', async t => {
  // On the Shanghai node the unconfigured feishu_calendar failed in 1 ms; any lookup that fails at once.
  const f = await fixture({gateway:failingGateway,toolFailureMs:100,followUpMs:300,idleMs:300});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  nativeCall(f, 'cal', 'web_search', {query:'今天的工作安排'});
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'cal' && e.result.error), 'tool failed');
  await waitFor(() => commits(f).includes(TOOL_FAILURE_LINE), 'V says the lookup failed');
  assert(!device.events.some(e => e.type === 'call.closed'), 'not hung up in silence');
  assert(f.audit.some(e => e.type === 'lookup.failure-notice' && e.tool === 'web_search' && e.spoken));
  // The room then has the normal follow-up window to answer the question.
  provide(f, {type:'response.created',response_id:'line'});
  provide(f, {type:'response.done',response_id:'line',response:{id:'line',status:'completed'}});
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'follow-up close');
  assert.equal(commits(f).filter(text => text === TOOL_FAILURE_LINE).length, 1, 'said once');
});

test('a failed lookup V answers itself, or a new turn takes over, gets no extra line', async t => {
  const f = await fixture({gateway:failingGateway,toolFailureMs:100});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  nativeCall(f, 'cal', 'web_search', {query:'今天的工作安排'});
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'cal'), 'tool failed');
  // "日历的配置还没准备好，我帮你交给后台查可以吗？"
  provide(f, {type:'response.created',response_id:'sorry'});
  provide(f, {type:'response.output_audio.delta',response_id:'sorry',delta:floatAudio([0.1])});
  provide(f, {type:'response.done',response_id:'sorry',response:{id:'sorry',status:'completed'}});
  // Then the model chains a second lookup that fails too, and the user speaks before any line.
  nativeCall(f, 'cal2', 'web_search', {query:'明天的日程'});
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'cal2'), 'second failure');
  provide(f, {type:'conversation.item.input_audio_transcription.completed',transcript:'不用了，你上网查一下 NBA'});
  await delay(2600);
  assert(!commits(f).includes(TOOL_FAILURE_LINE));
});

test('a result swallowed by an ASR turn that opens right after it is offered, not hung up on (2026-10-20 11:30)', async t => {
  const f = await fixture({gateway:newsGateway,followUpMs:200,idleMs:200,resultSilenceMs:600,chatterSpeechGraceMs:100,inputSilentMs:100});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  nativeCall(f, 'news', 'web_search', {query:'最近新闻'});
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'news'), 'result delivered');
  // While "我上网查一下" is still playing, the provider hears a little echo or
  // background, opens a turn, and never finishes it; the clip ends after that.
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  provide(f, {type:'conversation.item.input_audio_transcription.started'});await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await delay(500);
  assert(!device.events.some(e => e.type === 'call.closed'), 'an unspoken result holds the follow-up window');
  await waitFor(() => commits(f).includes(TOOL_RESULT_PROMPT_LINE), 'V offers the result');
  assert(!device.events.some(e => e.type === 'call.closed'));
  assert(f.audit.some(e => e.type === 'lookup.result-prompt' && e.tool === 'web_search' && e.spoken));
});

test('a result V starts answering gets no prompt', async t => {
  const f = await fixture({gateway:newsGateway,resultSilenceMs:100});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  nativeCall(f, 'news', 'web_search', {query:'最近新闻'});
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'news'), 'result delivered');
  provide(f, {type:'response.created',response_id:'news-answer'});
  provide(f, {type:'response.output_audio.delta',response_id:'news-answer',delta:floatAudio([0.1])});
  provide(f, {type:'response.done',response_id:'news-answer',response:{id:'news-answer',status:'completed'}});
  await delay(2200);
  assert(!commits(f).includes(TOOL_RESULT_PROMPT_LINE));
});

test('a user turn that never gets text after the microphone went quiet is asked again, once (2026-10-20 11:29)', async t => {
  const f = await fixture({followUpMs:200,chatterMs:200,chatterSpeechGraceMs:2000,unheardTurnMs:400,inputSilentMs:250,staleSpeechMs:5000});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  // "给我讲个故事吧": the provider opens a turn while the user talks for 0.7 s...
  provide(f, {type:'conversation.item.input_audio_transcription.started'});
  const loud = Buffer.alloc(640);for (let i = 0; i < loud.length; i += 2) loud.writeInt16LE(i % 4 ? 3000 : -3000, i);
  for (let i = 0; i < 35; i++) {device.send(loud, {binary:true});await delay(20);}
  assert.deepEqual(commits(f), [], 'never while the microphone still hears speech');
  // ...then the robot gate sends silence, and no text ever comes.
  const quiet = Buffer.alloc(640);
  const silence = setInterval(() => device.send(quiet, {binary:true}), 20);t.after(() => clearInterval(silence));
  await waitFor(() => commits(f).includes(UNHEARD_TURN_LINE), 'V asks again');
  assert(!commits(f).includes(BACKGROUND_LEAVE_LINE), 'not taken for background talk first');
  assert(!device.events.some(e => e.type === 'call.closed'));
  const asked = f.audit.find(e => e.type === 'device.unheard-turn');
  assert(asked.spoken && asked.openMs >= 400);
  await delay(600);
  clearInterval(silence);
  assert.equal(commits(f).filter(text => text === UNHEARD_TURN_LINE).length, 1, 'asked once per stuck turn');
});

test('a request still being spoken when the chatter window closes is not cut off', async t => {
  const f = await fixture({followUpMs:2000,chatterMs:150,chatterSpeechGraceMs:500});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await delay(100);
  // A long question begins just before the window closes and runs past it.
  provide(f, {type:'conversation.item.input_audio_transcription.started'});
  await delay(300);
  assert.deepEqual(commits(f), [], 'still listening to the speaker');
  provide(f, {type:'conversation.item.input_audio_transcription.completed',transcript:'那你帮我看一下明天下午有没有空，顺便把会议改到周五'});
  await delay(400);
  assert.deepEqual(commits(f), [], 'a finished request is not background talk');
  assert(!device.events.some(e => e.type === 'call.closed'));
});

test('a device may keep listening longer after a reply than the household default', async t => {
  const f = await fixture({followUpMs:80,record:{followUpMs:5000}});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));
  await delay(30);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await delay(250);
  assert(!device.events.some(e => e.type === 'call.closed'), 'the device window, not the default, applies');
});

test('two authenticated devices cannot start calls in the same bound session', async t => {
  const secondToken = 'another-device-token-0123456789abcdef';
  const f = await fixture({extraDevices:[record({id:'speaker-second',token:secondToken})]});t.after(f.close);
  const first = await f.connect(), second = await f.connect(secondToken);
  t.after(() => {first.close();second.close();});
  // Send before either provider has become ready: reservations count as busy.
  first.send(JSON.stringify({type:'call.start'}));
  second.send(JSON.stringify({type:'call.start'}));
  await f.until(() => second.events.some(e => e.type === 'call.error'), 'second call rejected');
  assert.equal(second.events.find(e => e.type === 'call.error').reason, 'session-busy');
  assert.equal(f.endpoint.activeCalls(), 1);
});

test('a stalled speaker has bounded output memory and releases its provider', async t => {
  const f = await fixture({maxBufferedBytes:1024});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  const provider = f.peers[0];
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.created',response_id:'r1'})), false);
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.delta',response_id:'r1',delta:floatAudio(Array(1024).fill(0.25))})), false);
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'slow playback closes');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'slow-playback');
  assert.equal(f.endpoint.activeCalls(), 0);
  await f.until(() => provider.readyState === 3, 'provider closes after its bounded shutdown');
});

test('a story longer than the old 87-second cap plays whole instead of hanging up', async t => {
  const f = await fixture();t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  const provider = f.peers[0], second = floatAudio(Array(24000).fill(0.1));
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.started',response_id:'story'})), false);
  // The model hands over two minutes of speech far faster than real time.
  for (let i = 0; i < 120; i++) provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.delta',response_id:'story',delta:second})), false);
  await delay(50);
  assert(!device.events.some(e => e.type === 'call.closed'), 'a long answer is not a slow speaker');
  assert.equal(f.endpoint.activeCalls(), 1);
});

test('a confirmed device abort cancels the reply still being generated; a plain barge-in waits for speech', async t => {
  const start = async f => {
    const device = await f.connect();t.after(() => device.close());
    device.send(JSON.stringify({type:'call.start'}));
    await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
    f.peers[0].emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.started',response_id:'story'})), false);
    return device;
  };
  const aec = await fixture({record:{deviceBargeIn:true}});t.after(aec.close);
  (await start(aec)).send(JSON.stringify({type:'barge-in'}));
  await aec.until(() => aec.peers[0].sent.some(e => e.type === 'response.cancel'), 'upstream reply cancelled');
  assert(aec.audit.some(e => e.type === 'client.barge-in' && e.deviceId === 'speaker-test' && e.confirmed === true));

  // A speaker without echo cancellation cannot promote its own frame.
  const plain = await fixture();t.after(plain.close);
  (await start(plain)).send(JSON.stringify({type:'barge-in',confirmed:true}));
  await plain.until(() => plain.audit.some(e => e.type === 'client.barge-in'), 'barge-in audited');
  assert(!plain.peers[0].sent.some(e => e.type === 'response.cancel'));
  assert(plain.audit.some(e => e.type === 'client.barge-in' && e.deviceId === 'speaker-test' && e.confirmed === false));
  assert.throws(() => parseDeviceEntries([record({deviceBargeIn:'yes'})]), /deviceBargeIn/);
});

test('the same speaker protocol selects Grok without changing the phone default', async t => {
  const f = await fixture({record:{models:['seeduplex','grok']}});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start',model:'grok'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'grok ready');
  assert.equal(device.events.find(e => e.type === 'call.ready').model, 'grok');
  const setup = f.peers[0].sent.find(e => e.type === 'session.update');
  assert.equal(setup.session.audio.input.format.rate, 16000);
  assert.equal(setup.session.audio.output.format.rate, 24000);
  assert(!setup.session.tools.some(t => t.name === 'show_content'));
});


test('hardware microphone gain is opt-in and saturates signed PCM safely', async t => {
  const f = await fixture({record:{inputGain:2}});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  const frame = Buffer.alloc(640);
  [1000,-1000,20000,-20000].forEach((v,i) => frame.writeInt16LE(v,i*2));
  device.send(frame,{binary:true});
  await f.until(() => f.peers[0].sent.some(e => e.type === 'input_audio_buffer.append'), 'amplified PCM');
  const result = Buffer.from(f.peers[0].sent.find(e => e.type === 'input_audio_buffer.append').audio,'base64');
  assert.deepEqual([0,2,4,6].map(i => result.readInt16LE(i)),[2000,-2000,32767,-32768]);
  assert.equal(frame.readInt16LE(0),1000);
});


test('opt-in hardware noise gate preserves soft speech tails in sample time', async t => {
  const f = await fixture({record:{inputGain:2,noiseGateRms:450,noiseGateHoldMs:40}});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  const frame = level => {const b=Buffer.alloc(640);for(let i=0;i<b.length;i+=2)b.writeInt16LE(level,i);return b;};
  // Burst arrival deliberately differs from captured sample time.
  for(const level of [100,1000,100,100,100])device.send(frame(level),{binary:true});
  await f.until(() => f.peers[0].sent.filter(e => e.type === 'input_audio_buffer.append').length === 5, 'all frames paced');
  const levels=f.peers[0].sent.filter(e=>e.type==='input_audio_buffer.append').map(e=>Buffer.from(e.audio,'base64').readInt16LE(0));
  assert.deepEqual(levels,[0,2000,200,200,0]);
});

test('a device may absorb Wi-Fi stalls with a larger bounded playout lead', () => {
  assert.equal(parseDeviceEntries([record()])[0].playoutLeadMs, 480);
  assert.equal(parseDeviceEntries([record({playoutLeadMs:2000})])[0].playoutLeadMs, 2000);
  assert.throws(() => parseDeviceEntries([record({playoutLeadMs:100})]), /lead/);
  assert.throws(() => parseDeviceEntries([record({playoutLeadMs:9000})]), /lead/);
});

test('a robot device receives reactions chosen from the shared session; a plain speaker does not', async t => {
  const asked = [];
  const f = await fixture({record:{robot:true}, robotEvaluate: async state => {asked.push(state.beat);return {answers:{reaction:{type:'choice', choice:'laugh'}}};}});
  t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  const provider = f.peers[0];
  provider.emit('message', Buffer.from(JSON.stringify({type:'conversation.item.input_audio_transcription.completed', transcript:'哈哈哈你太逗了'})), false);
  await f.until(() => device.events.some(e => e.type === 'reaction'), 'reaction');
  assert.deepEqual(device.events.find(e => e.type === 'reaction'), {type:'reaction', id:'laugh', beat:'user_meaning'});
  assert.equal(asked[0].kind, 'user_meaning');
  assert(f.audit.some(e => e.type === 'robot.reaction' && e.id === 'laugh'));

  const plain = await fixture();
  t.after(plain.close);
  const speaker = await plain.connect();t.after(() => speaker.close());
  speaker.send(JSON.stringify({type:'call.start'}));
  await plain.until(() => speaker.events.some(e => e.type === 'call.ready'), 'ready');
  plain.peers[0].emit('message', Buffer.from(JSON.stringify({type:'conversation.item.input_audio_transcription.completed', transcript:'哈哈'})), false);
  await delay(30);
  assert(!speaker.events.some(e => e.type === 'reaction'));
});

test('a xiaozhi-firmware robot talks to the same Voice session through the wire adapter', async t => {
  const f = await fixture({record:{robot:true}, robotEvaluate: async () => ({answers:{reaction:{type:'choice', choice:'laugh'}}})});
  t.after(f.close);
  const url = f.url.replace('/device/voice', '/device/xiaozhi');
  const client = new ws.WebSocket(url, {headers:{authorization:`Bearer ${TOKEN}`}});
  client.events = [];client.audio = [];
  client.on('message', (data, binary) => binary ? client.audio.push(Buffer.from(data)) : client.events.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {client.once('open', resolve);client.once('error', reject);});
  t.after(() => client.close());
  client.send(JSON.stringify({type:'hello', version:1, transport:'websocket', audio_params:{format:'opus', sample_rate:16000, channels:1, frame_duration:60}}));
  await f.until(() => client.events.some(e => e.type === 'hello'), 'xiaozhi hello');
  const hello = client.events.find(e => e.type === 'hello');
  assert.equal(hello.transport, 'websocket');
  assert.deepEqual(hello.audio_params, {format:'opus', sample_rate:24000, channels:1, frame_duration:60});
  assert(!client.events.some(e => e.type === 'call.ready'), 'native frames never reach xiaozhi firmware');
  await f.until(() => f.peers[0]?.sent.some(e => e.type === 'session.create'), 'provider session');
  const setup = f.peers[0].sent.find(e => e.type === 'session.create');
  assert.match(setup.session.instructions, /当前终端没有内容展示屏幕/);

  // Uplink: 60 ms Opus frames at 16 kHz arrive at the provider as PCM.
  const enc = new OpusScript(16000, 1, OpusScript.Application.VOIP);t.after(() => enc.delete());
  const pcm = Buffer.alloc(1920);for (let i = 0; i < 960; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i / 7)), i * 2);
  client.send(JSON.stringify({type:'listen', state:'start', mode:'auto'}));
  client.send(enc.encode(pcm, 960), {binary:true});
  await f.until(() => f.peers[0].sent.some(e => e.type === 'input_audio_buffer.append'), 'uplink reached provider');

  // A user turn yields an llm emotion carrying the robot reaction id.
  const provider = f.peers[0];
  provider.emit('message', Buffer.from(JSON.stringify({type:'conversation.item.input_audio_transcription.completed', transcript:'哈哈哈'})), false);
  await f.until(() => client.events.some(e => e.type === 'llm'), 'reaction');
  assert.equal(client.events.find(e => e.type === 'llm').emotion, 'laugh');

  // Downlink: tts start precedes Opus audio; audio.done yields tts stop.
  const samples = new Float32Array(24000 * 0.3).map((_, i) => 0.3 * Math.sin(i / 9));
  const floats = Buffer.alloc(samples.length * 4);samples.forEach((v, i) => floats.writeFloatLE(v, i * 4));
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.created', response_id:'r1'})), false);
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.delta', response_id:'r1', delta:floats.toString('base64')})), false);
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.done', response_id:'r1'})), false);
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.done', response_id:'r1', response:{status:'completed'}})), false);
  await f.until(() => client.events.some(e => e.type === 'tts' && e.state === 'stop'), 'tts stop');
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.done', response_id:'r1', response:{status:'completed'}})), false);
  await delay(20);
  const order = client.events.filter(e => e.type === 'tts').map(e => e.state);
  assert.deepEqual(order, ['start', 'stop'], 'a repeated audio.done stops only once');
  assert(client.audio.length >= 5, 'audio arrives as 60 ms Opus frames');
  const dec = new OpusScript(24000, 1);t.after(() => dec.delete());
  assert.equal(dec.decode(client.audio[0]).length, 2880);
});

test('a xiaozhi device with the wrong audio format is refused', async t => {
  const f = await fixture();t.after(f.close);
  const client = new ws.WebSocket(f.url.replace('/device/voice', '/device/xiaozhi'), {headers:{authorization:`Bearer ${TOKEN}`}});
  await new Promise((resolve, reject) => {client.once('open', resolve);client.once('error', reject);});
  const closed = new Promise(resolve => client.once('close', code => resolve(code)));
  client.send(JSON.stringify({type:'hello', transport:'websocket', audio_params:{format:'pcm', sample_rate:16000}}));
  assert.equal(await closed, 1008);
  assert.equal(f.peers.length, 0);
});

test('xiaozhi OTA hands only a registered MAC its WebSocket and never an upgrade', async () => {
  const devices = parseDeviceEntries([record({mac:'02:00:00:5C:4A:01', robot:true})]);
  const endpoint = createDeviceEndpoint({directVoice:{}, wsModule:ws, devices, otaPath:'/xiaozhi/ota/', xiaozhiPublicUrl:'wss://voice.example/device/xiaozhi'});
  const call = async (mac, body) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    req.method = 'POST';req.headers = mac ? {'device-id':mac} : {};
    const res = {status:0, body:'', writeHead(s) {this.status = s;}, end(b) {this.body = b;}};
    await endpoint.handleOta(req, res);
    return {status:res.status, body:JSON.parse(res.body)};
  };
  const ok = await call('02:00:00:5c:4a:01', {application:{version:'1.4.2'}});
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.websocket, {url:'wss://voice.example/device/xiaozhi', token:TOKEN, version:1});
  assert.equal(ok.body.firmware.version, '1.4.2', 'echo the running version: no self-upgrade');
  assert(!('activation' in ok.body) && !('mqtt' in ok.body));
  assert.equal((await call('aa:bb:cc:dd:ee:ff', {})).status, 403);
  assert.equal((await call(null, {})).status, 403);
  assert.throws(() => parseDeviceEntries([record({mac:'not-a-mac'})]), /MAC/);
});

test('a xiaozhi robot changes its volume by voice and keeps it for the next call', async t => {
  const f = await fixture({record:{robot:true, volume:85}});
  t.after(f.close);
  const open = async () => {
    const client = new ws.WebSocket(f.url.replace('/device/voice', '/device/xiaozhi'), {headers:{authorization:`Bearer ${TOKEN}`}});
    client.events = [];
    client.on('message', (data, binary) => {if (!binary) client.events.push(JSON.parse(data.toString()));});
    await new Promise((resolve, reject) => {client.once('open', resolve);client.once('error', reject);});
    client.send(JSON.stringify({type:'hello', version:1, transport:'websocket', audio_params:{format:'opus', sample_rate:16000, channels:1, frame_duration:60}}));
    await f.until(() => client.events.some(e => e.type === 'mcp'), 'hello volume');
    return client;
  };
  const volumeCalls = client => client.events.filter(e => e.type === 'mcp').map(e => e.payload);
  const first = await open();
  assert.equal(volumeCalls(first)[0].params.arguments.volume, 85, 'the operator volume applies at hello');
  await f.until(() => f.peers[0]?.sent.some(e => e.type === 'session.create'), 'provider session');
  const tools = f.peers[0].sent.find(e => e.type === 'session.create').session.tools.map(tool => tool.name);
  assert(tools.includes('set_speaker_volume'));

  // "小声点": the provider calls the tool, the firmware confirms, the model hears the new level.
  f.peers[0].emit('message', Buffer.from(JSON.stringify({type:'response.function_call_arguments.done', items:[{call_id:'quieter', name:'set_speaker_volume', arguments:JSON.stringify({change:'down'})}]})), false);
  await f.until(() => volumeCalls(first).length === 2, 'mid-call volume');
  const request = volumeCalls(first)[1];
  assert.equal(request.params.arguments.volume, 70);
  first.send(JSON.stringify({session_id:'voice', type:'mcp', payload:{jsonrpc:'2.0', id:request.id, result:{content:[{type:'text', text:'true'}], isError:false}}}));
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'quieter'), 'tool result');
  assert.deepEqual(f.audit.find(e => e.type === 'tool.delivered' && e.callId === 'quieter').result, {volume:70, previous:85, confirmed:true});
  assert(f.audit.some(e => e.type === 'device.volume' && e.deviceId === 'speaker-test' && e.volume === 70));

  first.close();
  await f.until(() => f.endpoint.activeCalls() === 0 && f.directVoice.activity(f.audit.find(e => e.type === 'call.created').voiceSessionId) === null, 'first call closed');
  const second = await open();t.after(() => second.close());
  assert.equal(volumeCalls(second)[0].params.arguments.volume, 70, 'the next call starts at the spoken level');
});

test('a native speaker without a volume control never sees the volume tool', async t => {
  const f = await fixture();
  t.after(f.close);
  const client = await f.connect();t.after(() => client.close());
  client.send(JSON.stringify({type:'call.start'}));
  await f.until(() => f.peers[0]?.sent.some(e => e.type === 'session.create'), 'provider session');
  const tools = f.peers[0].sent.find(e => e.type === 'session.create').session.tools.map(tool => tool.name);
  assert(!tools.includes('set_speaker_volume'));
  assert(tools.includes('end_call'));
});

// The firmware's Explain(): chunked multipart with a question field and camera.jpg.
const BOUNDARY = '----ESP32_CAMERA_BOUNDARY';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const photoBody = (question, jpeg = JPEG) => Buffer.concat([
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="question"\r\n\r\n${question}\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="camera.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
  jpeg, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]);
const uploadPhoto = (url, token, body) => new Promise((resolve, reject) => {
  const req = httpRequest(url, {method:'POST', headers:{authorization:`Bearer ${token}`, 'content-type':`multipart/form-data; boundary=${BOUNDARY}`, 'transfer-encoding':'chunked'}}, res => {
    const chunks = [];res.on('data', c => chunks.push(c));res.on('end', () => resolve({status:res.statusCode, text:Buffer.concat(chunks).toString()}));
  });
  req.on('error', reject);
  req.write(body.subarray(0, 40));req.end(body.subarray(40));
});
const openXiaozhi = async f => {
  const client = new ws.WebSocket(f.url.replace('/device/voice', '/device/xiaozhi'), {headers:{authorization:`Bearer ${TOKEN}`}});
  client.events = [];
  client.on('message', (data, binary) => {if (!binary) client.events.push(JSON.parse(data.toString()));});
  await new Promise((resolve, reject) => {client.once('open', resolve);client.once('error', reject);});
  client.send(JSON.stringify({type:'hello', version:1, transport:'websocket', audio_params:{format:'opus', sample_rate:16000, channels:1, frame_duration:60}}));
  await f.until(() => f.peers[0]?.sent.some(e => e.type === 'session.create'), 'provider session');
  return client;
};
const mcpOut = client => client.events.filter(e => e.type === 'mcp').map(e => e.payload);

test('a camera robot looks: V asks for a photo, the firmware uploads it, the description comes back', async t => {
  const seen = [];
  const f = await fixture({record:{robot:true, camera:true}, visionPath:'/device/vision',
    describeImage:async ({question, image}) => {seen.push({question, image});return '用户手里拿着一个红苹果。';}});
  t.after(f.close);
  const client = await openXiaozhi(f);t.after(() => client.close());
  await f.until(() => mcpOut(client).some(p => p.method === 'initialize'), 'camera MCP initialized');
  const init = mcpOut(client).find(p => p.method === 'initialize');
  assert(init, 'MCP initialize after hello');
  const {url, token} = init.params.capabilities.vision;
  assert.equal(url, `http://${new URL(f.url).host}/device/vision`, 'same origin as the device WebSocket');
  assert.match(token, /^[A-Za-z0-9_-]{32}$/u);
  const tools = f.peers[0].sent.find(e => e.type === 'session.create').session.tools;
  assert(tools.some(tool => tool.name === 'look'));

  // The token alone is not enough: V must be waiting for this device's photo.
  assert.equal((await uploadPhoto(url, token, photoBody('偷拍'))).status, 401);
  assert.equal(seen.length, 0);

  f.peers[0].emit('message', Buffer.from(JSON.stringify({type:'response.function_call_arguments.done', items:[{call_id:'look-1', name:'look', arguments:JSON.stringify({question:'我手里拿的是什么'})}]})), false);
  await f.until(() => mcpOut(client).some(p => p.params?.name === 'self.camera.take_photo'), 'take_photo');
  const shot = mcpOut(client).find(p => p.params?.name === 'self.camera.take_photo');
  assert.deepEqual(shot.params.arguments, {question:'我手里拿的是什么'});
  assert.equal((await uploadPhoto(url, 'x'.repeat(32), photoBody('?'))).status, 401, 'another token is refused');
  assert.equal((await uploadPhoto(url, token, photoBody('?', Buffer.from('not a jpeg')))).status, 400);
  const upload = await uploadPhoto(url, token, photoBody('我手里拿的是什么'));
  assert.equal(upload.status, 200);
  assert.deepEqual(JSON.parse(upload.text), {success:true, result:'用户手里拿着一个红苹果。'});
  assert.equal(seen[0].question, '我手里拿的是什么');
  assert.deepEqual(seen[0].image, JPEG);
  // The firmware relays the endpoint's body as the MCP tool result text.
  client.send(JSON.stringify({session_id:'voice', type:'mcp', payload:{jsonrpc:'2.0', id:shot.id, result:{content:[{type:'text', text:upload.text}], isError:false}}}));
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'look-1'), 'tool result');
  assert.equal(f.audit.find(e => e.type === 'tool.delivered' && e.callId === 'look-1').result.description, '用户手里拿着一个红苹果。');
  assert(f.audit.some(e => e.type === 'device.vision' && e.ok && e.photoBytes === JPEG.length));
  assert(f.audit.some(e => e.type === 'device.look' && e.ok));
  assert(!JSON.stringify(f.audit).includes(JPEG.toString('base64')), 'photos are never audited');
  assert.equal((await uploadPhoto(url, token, photoBody('再拍'))).status, 401, 'the look is over');
});

test('an oversized photo is refused and a failed look reaches the model as a tool error', async t => {
  const f = await fixture({record:{robot:true, camera:true}, visionPath:'/device/vision', describeImage:async () => {throw Error('model down');}});
  t.after(f.close);
  const client = await openXiaozhi(f);t.after(() => client.close());
  await f.until(() => mcpOut(client).some(p => p.method === 'initialize'), 'camera MCP initialized');
  const {url, token} = mcpOut(client).find(p => p.method === 'initialize').params.capabilities.vision;
  f.peers[0].emit('message', Buffer.from(JSON.stringify({type:'response.function_call_arguments.done', items:[{call_id:'look-2', name:'look', arguments:JSON.stringify({question:'这是什么'})}]})), false);
  await f.until(() => mcpOut(client).some(p => p.params?.name === 'self.camera.take_photo'), 'take_photo');
  const shot = mcpOut(client).find(p => p.params?.name === 'self.camera.take_photo');
  assert.equal((await uploadPhoto(url, token, photoBody('这是什么', Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)])))).status, 413);
  const upload = await uploadPhoto(url, token, photoBody('这是什么'));
  assert.deepEqual(JSON.parse(upload.text), {success:false, message:'看图服务暂时没有结果'});
  client.send(JSON.stringify({session_id:'voice', type:'mcp', payload:{jsonrpc:'2.0', id:shot.id, result:{content:[{type:'text', text:upload.text}], isError:false}}}));
  await f.until(() => f.audit.some(e => e.type === 'device.look' && !e.ok), 'look failure');
  assert.match(f.audit.find(e => e.type === 'device.look' && !e.ok).error, /看图服务暂时没有结果/);
  await f.until(() => f.audit.some(e => e.type === 'tool.delivered' && e.callId === 'look-2'), 'tool error');
  assert.match(f.audit.find(e => e.type === 'tool.delivered' && e.callId === 'look-2').result.error, /看图服务暂时没有结果/, 'the model hears it did not see, never a guess');
});

test('a xiaozhi device without a camera gets no vision capability and no look tool', async t => {
  const f = await fixture({record:{robot:true}, visionPath:'/device/vision', describeImage:async () => 'never'});
  t.after(f.close);
  const client = await openXiaozhi(f);t.after(() => client.close());
  assert(!mcpOut(client).some(p => p.method === 'initialize'));
  assert(!f.peers[0].sent.find(e => e.type === 'session.create').session.tools.some(tool => tool.name === 'look'));
  assert.equal(parseDeviceEntries([record()])[0].camera, false, 'camera is off unless the record says so');
});

const routingAnswers = (questions, action = 'respond') => ({answers:Object.fromEntries(Object.keys(questions).map(id => [id,{type:'choice',choice:id === 'action' ? action : id.startsWith('role_') ? 'unknown' : 'keep'}]))});
function routingFixture(action = () => 'respond') {
  const asr = {appended:0,options:null,peaks:[]};
  const service = createStreamingSpeakerRoutingService({env:{},embedding:{ready:Promise.resolve(),compute:async () => ({embedding:[1,0],inferenceMs:1})},
    evaluate:async (state, questions) => routingAnswers(questions, action(state)),
    createAsr:options => {asr.options = options;return {connect:async () => {},append:pcm => {asr.appended += pcm.length;let peak = 0;for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));asr.peaks.push(peak);},close() {}};}});
  return {service,asr};
}
const loud = ms => {const pcm = Buffer.alloc(ms * 32);for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(6000, i);return pcm;};

test('multiSpeaker is an opt-in boolean on the device record', () => {
  assert.equal(parseDeviceEntries([record()])[0].multiSpeaker, false);
  assert.equal(parseDeviceEntries([record({multiSpeaker:true})])[0].multiSpeaker, true);
  for (const multiSpeaker of ['true',1,null]) assert.throws(() => parseDeviceEntries([record({multiSpeaker})]), /multiSpeaker/);
});

test('a multiSpeaker device streams 16 kHz audio through Speaker routing and counts only admitted turns', async t => {
  const routing = routingFixture();t.after(() => routing.service.dispose());
  const f = await fixture({record:{multiSpeaker:true},speakerRouting:routing.service});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'call.ready');
  assert(f.audit.some(e => e.type === 'device.call' && e.stage === 'start' && e.multiSpeaker === true), 'routing confirmed in audit');
  // Native connection waits for a tracked voice (lazy), then gets the host persona.
  assert.equal(f.peers.length, 0);
  for (let i = 0; i < 3; i++) device.send(loud(400), {binary:true});
  await f.until(() => f.peers.some(p => p.sent.some(e => e.type === 'session.create')), 'persona prepared');
  const provider = f.peers.at(-1), setup = provider.sent.find(e => e.type === 'session.create');
  assert.match(setup.session.instructions, /主机当前指定的人物/);
  assert(!setup.session.tools.some(tool => tool.name === 'end_call'), 'the host owns the ending');
  await f.until(() => provider.sent.some(e => e.type === 'input_audio_buffer.append' && Buffer.from(e.audio, 'base64').some(b => b !== 0)), 'voice forwarded');
  assert(provider.sent.filter(e => e.type === 'input_audio_buffer.append').every(e => Buffer.from(e.audio, 'base64').length === 640), '16 kHz frames, not resampled');
  routing.asr.options.onResult({body:{result:{utterances:[{definite:true,start_time:0,end_time:1100,text:'V，天空为什么是蓝色的？'}]}}});
  await f.until(() => f.audit.some(e => e.type === 'transcript' && e.source === 'speaker-asr'), 'admitted turn');
  // The device stops its uplink while V talks; routing still gets a continuous stream.
  const before = routing.asr.appended;
  await delay(450);
  assert(routing.asr.appended - before >= 3200, 'silence fills the uplink gap');
  device.send(JSON.stringify({type:'call.end'}));
  await f.until(() => f.audit.some(e => e.type === 'device.call' && e.stage === 'closed'), 'closed');
  assert.equal(f.audit.find(e => e.type === 'device.call' && e.stage === 'closed').userTurns, 1);
});

test('a multiSpeaker device falls back to the native path when the server has no Speaker routing', async t => {
  const f = await fixture({record:{multiSpeaker:true}});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'call.ready');
  assert(f.audit.some(e => e.type === 'device.call' && e.stage === 'start' && e.multiSpeaker === false));
  assert(f.peers[0].sent.find(e => e.type === 'session.create').session.tools.some(tool => tool.name === 'end_call'));
});

test('under Speaker routing, room speech that never addresses V still ends with the spoken parting line', async t => {
  const routing = routingFixture(state => state.turn.text.startsWith('V') ? 'respond' : 'quiet');t.after(() => routing.service.dispose());
  const f = await fixture({record:{multiSpeaker:true},speakerRouting:routing.service,followUpMs:2000,chatterMs:150});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'call.ready');
  for (let i = 0; i < 3; i++) device.send(loud(400), {binary:true});
  await f.until(() => f.peers.some(p => p.sent.some(e => e.type === 'session.create')), 'persona prepared');
  routing.asr.options.onResult({body:{result:{utterances:[{definite:true,start_time:0,end_time:1100,text:'V，讲个笑话'}]}}});
  await f.until(() => f.audit.some(e => e.type === 'transcript' && e.source === 'speaker-asr'), 'admitted turn');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  // A TV keeps talking: tracked and transcribed, but Decision never admits it.
  let at = 1300;
  const tv = setInterval(() => {routing.asr.options.onResult({body:{result:{utterances:[{definite:true,start_time:at,end_time:at + 500,text:'接下来是天气预报'}]}}});at += 600;}, 40);
  t.after(() => clearInterval(tv));
  await f.until(() => f.peers.some(p => p.sent.some(e => e.type === 'speech_text_buffer.commit' && e.text === BACKGROUND_LEAVE_LINE)), 'parting line through host speech');
  clearInterval(tv);
  const speaker = f.peers.find(p => p.sent.some(e => e.type === 'speech_text_buffer.commit' && e.text === BACKGROUND_LEAVE_LINE)), heard = device.audio.length;
  speaker.emit('message', Buffer.from(JSON.stringify({type:'response.created',response_id:'leave'})), false);
  speaker.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.delta',response_id:'leave',delta:floatAudio([0.25,-0.25])})), false);
  await f.until(() => device.audio.length > heard, 'parting audio passes the output gate');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'closed');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'background-speech');
  assert.equal(f.audit.find(e => e.type === 'device.call' && e.stage === 'closed').userTurns, 1);
});

test('nearFieldGateDb defaults on with multiSpeaker, can be tuned or disabled, and is validated', () => {
  assert.equal(parseDeviceEntries([record()])[0].nearFieldGateDb, 0);
  assert.equal(parseDeviceEntries([record({multiSpeaker:true})])[0].nearFieldGateDb, 10);
  assert.equal(parseDeviceEntries([record({multiSpeaker:true,nearFieldGateDb:0})])[0].nearFieldGateDb, 0);
  assert.equal(parseDeviceEntries([record({nearFieldGateDb:8})])[0].nearFieldGateDb, 8);
  for (const nearFieldGateDb of [-1,31,'10',NaN]) assert.throws(() => parseDeviceEntries([record({nearFieldGateDb})]), /nearFieldGateDb/);
});

test('the near-field gate silences a quieter continuous background before the voice session', async t => {
  const f = await fixture({record:{nearFieldGateDb:10}});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'call.ready');
  const tone = (amplitude, ms = 60) => {const pcm = Buffer.alloc(ms * 32);for (let i = 0; i < pcm.length; i += 4) {pcm.writeInt16LE(amplitude, i);pcm.writeInt16LE(-amplitude, i + 2);}return pcm;};
  for (let i = 0; i < 40; i++) device.send(tone(180), {binary:true});        // far background, ~2.4 s
  for (let i = 0; i < 10; i++) device.send(tone(1800), {binary:true});       // near speech, 20 dB louder
  // The bridge re-cuts input into 20 ms appends; read back one sample per 60 ms device frame.
  const forwarded = () => Buffer.concat(f.peers[0].sent.filter(e => e.type === 'input_audio_buffer.append').map(e => Buffer.from(e.audio, 'base64')));
  for (let i = 0; i < 160 && forwarded().length < 50 * 1920; i++) await delay(50);  // the bridge paces input in real time
  const pcm = forwarded(), levels = Array.from({length:50}, (_, i) => pcm.readInt16LE(i * 1920));
  assert(levels.slice(25, 40).every(v => v === 0), 'background after warm-up is silence');
  assert(levels.slice(40).every(v => v === 1800), 'near speech passes unchanged');
  device.send(JSON.stringify({type:'call.end'}));
  await f.until(() => f.audit.some(e => e.type === 'device.call' && e.stage === 'closed'), 'closed');
  const {nearField} = f.audit.find(e => e.type === 'device.call' && e.stage === 'closed');
  assert(nearField.gatedMs >= 900 && nearField.levelDb.p90 > nearField.levelDb.p10, JSON.stringify(nearField));
});

test('nearFieldGateDb 0 turns the server gate off even with multiSpeaker (firmware-gated StackChan)', async t => {
  const routing = routingFixture();t.after(() => routing.service.dispose());
  const f = await fixture({record:{multiSpeaker:true,nearFieldGateDb:0},speakerRouting:routing.service});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'call.ready');
  assert(f.audit.some(e => e.type === 'device.call' && e.stage === 'start' && e.multiSpeaker === true), 'routing is on');
  const quiet = Buffer.alloc(1920);for (let i = 0; i < quiet.length; i += 2) quiet.writeInt16LE(180, i);
  const before = routing.asr.peaks.length;
  for (let i = 0; i < 60; i++) device.send(quiet, {binary:true});  // 3.6 s of steady quiet background
  await f.until(() => routing.asr.peaks.slice(before).filter(p => p === 180).length >= 60, 'every quiet frame reaches ASR unchanged');
  device.send(JSON.stringify({type:'call.end'}));
  await f.until(() => f.audit.some(e => e.type === 'device.call' && e.stage === 'closed'), 'closed');
  const closed = f.audit.find(e => e.type === 'device.call' && e.stage === 'closed');
  assert.equal(closed.nearField, undefined);assert.equal(closed.gatedInputBytes, 0);
});


test('release admission blocks call.start on an already connected device without disconnecting it',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const client=await f.connect();
  f.endpoint.setAdmissionGate(()=>true);
  client.send(JSON.stringify({type:'call.start'}));
  await f.until(()=>client.events.some(e=>e.reason==='updating'),'update rejection');
  assert.equal(client.readyState,1);assert.equal(f.peers.length,0);assert.equal(f.endpoint.activeCalls(),0);
  f.endpoint.setAdmissionGate(()=>false);
  client.send(JSON.stringify({type:'call.start'}));
  await f.until(()=>f.endpoint.activeCalls()===1,'new call admitted after resume');
  client.close();
});


test('a device disconnected during reservation remains pending until its late session is retired',async t=>{
  const f=await fixture();t.after(()=>f.close());let complete,retired=0;
  f.directVoice.reserve=()=>new Promise(resolve=>{complete=resolve;});
  f.directVoice.close=async()=>{retired++;};
  const client=await f.connect();client.send(JSON.stringify({type:'call.start'}));
  await f.until(()=>Boolean(complete),'reservation started');
  client.close();await f.until(()=>f.endpoint.connected().length===0,'device disconnected');
  assert.equal(f.endpoint.activeCalls(),0);assert.equal(f.endpoint.pendingOperations(),1);
  complete({voiceSessionId:'late'});
  await f.until(()=>f.endpoint.pendingOperations()===0,'late creation drained');assert.equal(retired,1);
});
