import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import * as ws from 'ws';
import {createDirectVoiceService} from './session.mjs';
import {createDeviceEndpoint,parseDeviceEntries} from './device-endpoint.mjs';

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
  const gateway = {request:async method => method === 'tools.catalog' ? {groups:[{tools:[{id:'web_search'}]}]} : {ok:true}};
  const directVoice = createDirectVoiceService({gateway,wsModule:{WebSocket:ProviderSocket,WebSocketServer:class {close() {}}},apiKeys:{seeduplex:'k',grok:'k'},audit:v => audit.push(v)});
  let busy = false;
  const endpoint = createDeviceEndpoint({directVoice,wsModule:ws,devices:parseDeviceEntries([record(options.record),...(options.extraDevices ?? [])]),audit:v => audit.push(v),
    maxBufferedBytes:options.maxBufferedBytes,isSessionBusy:() => busy,tickMs:10,idleMs:options.idleMs ?? 5000,initialIdleMs:options.initialIdleMs ?? 5000,followUpMs:options.followUpMs ?? 5000,chatterMs:options.chatterMs ?? 5000,toolHoldMs:5000});
  const server = createServer((req, res) => {res.writeHead(404);res.end();});
  server.on('upgrade', (req, socket, head) => endpoint.handleUpgrade(req, socket, head));
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
  assert.throws(() => parseDeviceEntries([record(), record({id:'speaker-two'})]), /private token/);
  assert.equal(parseDeviceEntries([record({models:['seeduplex','grok'],model:'grok'})])[0].model, 'grok');
});

test('an unknown device token is rejected before any voice session exists', async t => {
  const f = await fixture();t.after(f.close);
  await assert.rejects(f.connect('x'.repeat(40)), /401/);
  assert.equal(f.peers.length, 0);
});

test('a speaker call uses the shared Voice session with 16 kHz input and no screen', async t => {
  const f = await fixture();t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  await f.until(() => device.events.some(e => e.type === 'hello'), 'hello');
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'call.ready');
  const ready = device.events.find(e => e.type === 'call.ready');
  assert.equal(ready.inputSampleRate, 16000);assert.equal(ready.outputSampleRate, 24000);assert.equal(ready.model, 'seeduplex');
  const setup = f.peers[0].sent.find(e => e.type === 'session.create');
  assert.match(setup.session.instructions, /智能音箱/);
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

test('room conversation that never becomes a request does not hold the session', async t => {
  const f = await fixture({followUpMs:1000,chatterMs:120});t.after(f.close);
  const device = await f.connect();t.after(() => device.close());
  device.send(JSON.stringify({type:'call.start'}));
  await f.until(() => device.events.some(e => e.type === 'call.ready'), 'ready');
  device.send(JSON.stringify({type:'playback.state',speaking:true}));
  await delay(20);
  device.send(JSON.stringify({type:'playback.state',speaking:false}));
  await delay(20);
  const chatter = setInterval(() => f.peers[0].emit('message', Buffer.from(JSON.stringify({type:'conversation.item.input_audio_transcription.started'})), false), 15);
  t.after(() => clearInterval(chatter));
  await f.until(() => device.events.some(e => e.type === 'call.closed'), 'chatter close');
  assert.equal(device.events.find(e => e.type === 'call.closed').reason, 'background-speech');
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
