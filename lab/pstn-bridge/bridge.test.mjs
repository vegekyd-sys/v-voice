import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import * as ws from 'ws';
import {createDirectVoiceService} from '../realtime-direct-tools/session.mjs';
import {createDeviceEndpoint,parseDeviceEntries} from '../realtime-direct-tools/device-endpoint.mjs';
import {alawDecode,alawEncode,createDownsampler24to8,createUpsampler8to16,decodeG711,encodeG711,ulawDecode,ulawEncode} from './audio.mjs';
import {createAudioSocketServer,createFrameParser,encodeFrame,KIND} from './audiosocket.mjs';
import {createCallPolicy,parsePolicy} from './call-policy.mjs';
import {createPstnBridge} from './bridge.mjs';
import {createMockCarrier,tone} from './mock-carrier.mjs';
import {createAmiDialer,originateAction} from './asterisk-ami.mjs';

// Everything here is local: a scripted carrier, a real AudioSocket TCP leg, the
// real Voice device endpoint and shared session, and a scripted model socket.
// None of it proves a real carrier, number, handset or audio quality.
const TOKEN = 'pstn-bridge-fixture-token-0123456789abcdef';
const SESSION = 'agent:makaron:feishu:group:oc_pstn_fixture';
const ME = 'ou_designated0001', CALLEE = '+8613800000000';
const NOON = Date.parse('2026-11-25T04:00:00Z');  // 12:00 Asia/Shanghai
const policyConfig = (extra = {}) => ({initiators:[ME], callees:[{number:CALLEE, label:'本人测试机', consent:{by:'本人', at:'2026-11-25T02:00:00Z'}}], ...extra});
const floatAudio = (n, v = 0.3) => {const b = Buffer.alloc(n * 4);for (let i = 0; i < n; i++) b.writeFloatLE(v * Math.sin(i / 6), i * 4);return b.toString('base64');};
const until = async (predicate, label, ms = 5000) => {for (let i = 0; i < ms / 10 && !predicate(); i++) await delay(10);assert(predicate(), label);};

async function voiceFixture(record = {}) {
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
  const endpoint = createDeviceEndpoint({directVoice,wsModule:ws,devices:parseDeviceEntries([{id:'pstn-line',token:TOKEN,sessionKey:SESSION,agentId:'makaron',callerId:'tianyi',permissionProfile:'personal-tianyi',model:'seeduplex',deviceBargeIn:true,...record}]),
    audit:v => audit.push(v),tickMs:10,idleMs:20000,initialIdleMs:20000,followUpMs:20000,chatterMs:20000});
  const server = createServer((_req, res) => {res.writeHead(404);res.end();});
  server.on('upgrade', (req, socket, head) => endpoint.handleUpgrade(req, socket, head, {dialect:'native'}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {peers, audit, directVoice, endpoint, url:`ws://127.0.0.1:${server.address().port}/device/voice`,
    close:async () => {await endpoint.dispose();await directVoice.dispose();await new Promise(resolve => server.close(resolve));}};
}

async function lineFixture({outcome = 'answer', voice, token = TOKEN, url, fallbackPcm8k, ringTimeoutMs = 2000} = {}) {
  const media = createAudioSocketServer();const address = await media.listen();
  const carrier = createMockCarrier({audioSocket:address, outcome});
  const policy = createCallPolicy(parsePolicy(policyConfig()), {now:() => NOON});
  const audit = [];
  const bridge = createPstnBridge({policy, dialer:carrier, media, voice:{url:url ?? voice.url, token, wsModule:ws, readyTimeoutMs:1500},
    fallbackPcm8k, ringTimeoutMs, audit:v => audit.push(v)});
  return {media, carrier, policy, bridge, audit, close:() => media.close()};
}

test('G.711 A-law and mu-law round trips stay within companding error', () => {
  for (const v of [0, 1, -1, 100, -100, 1000, -1000, 12345, -12345, 32767, -32768]) {
    assert(Math.abs(alawDecode(alawEncode(v)) - v) <= Math.max(16, Math.abs(v) / 16), `alaw ${v}`);
    assert(Math.abs(ulawDecode(ulawEncode(v)) - v) <= Math.max(8, Math.abs(v) / 16), `ulaw ${v}`);
  }
  const pcm = tone(20);
  assert.equal(decodeG711(encodeG711(pcm)).length, pcm.length);
});

test('resamplers keep duration: 8k->16k doubles, 24k->8k thirds, across frame splits', () => {
  const up = createUpsampler8to16(), down = createDownsampler24to8();
  assert.equal(up(Buffer.alloc(320)).length, 640);
  assert.equal(down(Buffer.alloc(962)).length + down(Buffer.alloc(958)).length, 640);
});

test('AudioSocket frames parse when TCP splits and merges them', () => {
  const got = [];const feed = createFrameParser((kind, payload) => got.push([kind, payload.length]));
  const bytes = Buffer.concat([encodeFrame(KIND.slin8, Buffer.alloc(320)), encodeFrame(KIND.dtmf, Buffer.from('5')), encodeFrame(KIND.hangup)]);
  for (let i = 0; i < bytes.length; i += 7) feed(bytes.subarray(i, i + 7));
  assert.deepEqual(got, [[KIND.slin8, 320], [KIND.dtmf, 1], [KIND.hangup, 0]]);
});

test('policy: only designated people, consenting mainland mobiles, one line, bounded attempts, daytime', () => {
  assert.throws(() => parsePolicy(policyConfig({callees:[{number:'+14155550100', consent:{by:'x', at:'2026-11-25'}}]})), /mainland/);
  assert.throws(() => parsePolicy(policyConfig({callees:[{number:CALLEE}]})), /consent/);
  assert.throws(() => parsePolicy(policyConfig({hours:[7, 22]})), /08-21/);
  let at = NOON;const p = createCallPolicy(parsePolicy(policyConfig()), {now:() => at});
  assert.equal(p.admit({initiator:'ou_someoneelse', to:CALLEE}).reason, 'initiator-not-designated');
  assert.equal(p.admit({initiator:ME, to:'+8613900000000'}).reason, 'callee-not-consented');
  assert.equal(p.admit({initiator:ME, to:'13800000000'}).reason, 'number-format');
  assert.equal(p.admit({initiator:ME, to:CALLEE, callerId:'+8610086'}).reason, 'caller-id-not-selectable');
  const first = p.admit({initiator:ME, to:CALLEE});assert(first.ok);
  assert.equal(p.admit({initiator:ME, to:CALLEE}).reason, 'line-busy');
  p.release(first.attempt);
  for (let i = 0; i < 2; i++) {const a = p.admit({initiator:ME, to:CALLEE});assert(a.ok);p.release(a.attempt);}
  assert.equal(p.admit({initiator:ME, to:CALLEE}).reason, 'daily-limit');
  at = Date.parse('2026-11-25T14:30:00Z');  // 22:30 Shanghai
  assert.equal(p.admit({initiator:ME, to:CALLEE}).reason, 'outside-hours');
});

test('answered call: the callee is heard by V, V is heard by the callee, and a callee hang-up ends Voice', async t => {
  const v = await voiceFixture();t.after(v.close);
  const line = await lineFixture({voice:v});t.after(line.close);
  const result = line.bridge.call({initiator:ME, to:CALLEE});
  await until(() => line.carrier.callees.length === 1, 'answered');
  const callee = line.carrier.callees[0];
  await until(() => line.audit.some(e => e.type === 'pstn.voice-ready'), 'voice ready');
  assert(v.audit.some(e => e.type === 'call.created' && e.sessionKey === SESSION), 'bound to the device record session');

  // Listen: 300 ms of callee speech reaches the model as 16 kHz PCM.
  await callee.say(tone(300));
  await until(() => v.peers[0].sent.filter(e => e.type === 'input_audio_buffer.append').length > 0, 'model hears the callee');
  const appended = v.peers[0].sent.filter(e => e.type === 'input_audio_buffer.append').reduce((n, e) => n + Buffer.from(e.audio, 'base64').length, 0);
  assert(appended >= 0.25 * 32000, `upsampled audio reached the model (${appended} bytes)`);

  // Speak: model audio at 24 kHz is played to the callee at 8 kHz in real time.
  v.peers[0].emit('message', Buffer.from(JSON.stringify({type:'response.created',response_id:'r1'})), false);
  v.peers[0].emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.delta',response_id:'r1',delta:floatAudio(24000 * 0.4)})), false);
  await until(() => callee.heardBytes() >= 0.3 * 16000, 'callee hears V');
  assert(callee.heardLoud(), 'what the callee hears is not silence');

  callee.hangup();
  const outcome = await result;
  assert.equal(outcome.status, 'completed');assert.equal(outcome.endedBy, 'callee');
  assert.equal(outcome.dials, 1);assert.equal(outcome.redial, false);
  await until(() => v.endpoint.activeCalls() === 0, 'Voice call closed');
  assert.equal(line.policy.active(), null, 'line released');
});

test('talking over V sends one barge-in; Voice cancels the reply and the bridge drops unheard audio', async t => {
  const v = await voiceFixture();t.after(v.close);
  const line = await lineFixture({voice:v});t.after(line.close);
  const result = line.bridge.call({initiator:ME, to:CALLEE});
  await until(() => line.audit.some(e => e.type === 'pstn.voice-ready'), 'voice ready');
  const callee = line.carrier.callees[0], provider = v.peers[0];
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.created',response_id:'long'})), false);
  provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.started',response_id:'long'})), false);
  // Four seconds of answer arrive; the callee interrupts after hearing a little.
  for (let i = 0; i < 10; i++) provider.emit('message', Buffer.from(JSON.stringify({type:'response.output_audio.delta',response_id:'long',delta:floatAudio(24000 * 0.4)})), false);
  await until(() => callee.heardBytes() > 0, 'V started speaking');
  await callee.say(tone(400, {amplitude:9000}));
  await until(() => line.audit.filter(e => e.type === 'pstn.barge-in').length === 1, 'one barge-in');
  await until(() => provider.sent.some(e => e.type === 'response.cancel'), 'Voice cancelled the reply');
  assert(v.audit.some(e => e.type === 'client.barge-in' && e.deviceId === 'pstn-line' && e.confirmed === true));
  await until(() => v.audit.some(e => e.type === 'audio.clear'), 'Voice cleared playout');
  const heardAtClear = callee.heardBytes();
  await delay(400);
  assert(callee.heardBytes() - heardAtClear <= 640 * 2, 'remaining answer is not played after the clear');
  assert(callee.heardBytes() < 4 * 16000 * 0.6, 'the callee did not hear the whole answer');
  callee.hangup();await result;
});

test('V ending the call hangs up the phone line', async t => {
  const v = await voiceFixture();t.after(v.close);
  const line = await lineFixture({voice:v});t.after(line.close);
  const result = line.bridge.call({initiator:ME, to:CALLEE});
  await until(() => line.audit.some(e => e.type === 'pstn.voice-ready'), 'voice ready');
  const id = line.audit.find(e => e.type === 'pstn.voice-ready').voiceSessionId;
  await v.directVoice.close(id);
  const outcome = await result;
  assert.equal(outcome.status, 'completed');assert.equal(outcome.endedBy, 'voice');
  await until(() => line.carrier.callees[0].hungUpByBridge || line.carrier.callees[0].closed, 'phone hung up');
});

for (const outcome of ['busy', 'reject', 'congestion', 'no-answer']) {
  test(`${outcome}: the attempt ends once, nothing redials, and Voice is never opened`, async t => {
    const v = await voiceFixture();t.after(v.close);
    const line = await lineFixture({voice:v, outcome, ringTimeoutMs:300});t.after(line.close);
    const result = await line.bridge.call({initiator:ME, to:CALLEE});
    assert.equal(result.status, 'not-answered');assert.equal(result.redial, false);
    await delay(500);
    assert.equal(line.carrier.dials.length, 1, 'dialed exactly once');
    assert.equal(v.peers.length, 0, 'no model session for an unanswered call');
    assert.equal(line.policy.active(), null);
  });
}

test('Voice unavailable after answer: the callee hears the fallback line, then the call ends without redial', async t => {
  const v = await voiceFixture();t.after(v.close);
  const fallback = tone(500, {hz:660});
  const line = await lineFixture({voice:v, token:'wrong-token-0123456789abcdef0123456789', fallbackPcm8k:fallback});t.after(line.close);
  const result = await line.bridge.call({initiator:ME, to:CALLEE});
  assert.equal(result.status, 'voice-unavailable');assert.equal(result.reason, 'rejected');assert.equal(result.fallbackPlayed, true);
  const callee = line.carrier.callees[0];
  assert(callee.heardBytes() >= fallback.length - 640, 'fallback line played in full');
  await until(() => callee.hungUpByBridge || callee.closed, 'line hung up after the fallback');
  assert.equal(line.carrier.dials.length, 1);
});

test('Voice dropping mid-call is a failure, not a normal goodbye: fallback then hang up', async t => {
  const v = await voiceFixture();t.after(v.close);
  const line = await lineFixture({voice:v, fallbackPcm8k:tone(200)});t.after(line.close);
  const result = line.bridge.call({initiator:ME, to:CALLEE});
  await until(() => line.audit.some(e => e.type === 'pstn.voice-ready'), 'voice ready');
  await v.endpoint.dispose();  // the Voice service goes away under the call
  const outcome = await result;
  assert.equal(outcome.status, 'voice-unavailable');assert.equal(outcome.wasReady, true);
  assert.equal(line.carrier.dials.length, 1);
});

test('refused attempts never reach the carrier', async t => {
  const v = await voiceFixture();t.after(v.close);
  const line = await lineFixture({voice:v});t.after(line.close);
  assert.equal((await line.bridge.call({initiator:ME, to:CALLEE, callerId:'+8613811112222'})).reason, 'caller-id-not-selectable');
  assert.equal((await line.bridge.call({initiator:'ou_stranger', to:CALLEE})).reason, 'initiator-not-designated');
  assert.equal(line.carrier.dials.length, 0);
});

test('an AudioSocket leg the bridge did not dial is hung up unheard', async t => {
  const v = await voiceFixture();t.after(v.close);
  const line = await lineFixture({voice:v});t.after(line.close);
  const stray = createMockCarrier({audioSocket:line.media.address()});
  await stray.originate({to:CALLEE, uuid:'00000000-0000-4000-8000-000000000000'});
  await until(() => stray.callees[0].hungUpByBridge || stray.callees[0].closed, 'stray leg hung up');
  assert.equal(v.peers.length, 0);
});

test('AMI dialer: builds a validated Originate and maps busy / answered responses', async t => {
  assert.throws(() => originateAction({actionId:'a', to:'+8613800000000;evil', trunk:'cn', uuid:'u', audioSocket:'h:1'}), /callee/);
  assert.throws(() => originateAction({actionId:'a', to:CALLEE, trunk:'cn\r\nAction: Command', uuid:'u', audioSocket:'h:1'}), /Unsafe/);
  const action = originateAction({actionId:'a1', to:CALLEE, trunk:'cn-trunk', uuid:'0f0e', audioSocket:'127.0.0.1:9092'});
  assert.match(action, /Channel: PJSIP\/13800000000@cn-trunk/);assert.match(action, /Data: 0f0e,127\.0\.0\.1:9092/);
  for (const [response, reason, expected] of [['Failure', 5, {answered:false, reason:'busy'}], ['Success', 4, {answered:true}]]) {
    const seen = [];
    const ami = createTcpServer(socket => {
      socket.on('data', d => {
        const text = d.toString();seen.push(text);
        if (text.includes('Action: Login')) socket.write('Response: Success\r\nActionID: login\r\n\r\n');
        const id = /ActionID: (v-[^\r]+)/.exec(text)?.[1];
        if (id && text.includes('Action: Originate')) socket.write(`Response: Success\r\nActionID: ${id}\r\n\r\nEvent: OriginateResponse\r\nActionID: ${id}\r\nResponse: ${response}\r\nReason: ${reason}\r\n\r\n`);
      });
    });
    await new Promise(r => ami.listen(0, '127.0.0.1', r));
    const dialer = createAmiDialer({port:ami.address().port, username:'fixture', secret:'fixture-secret', trunk:'cn-trunk', audioSocket:'127.0.0.1:9092'});
    assert.deepEqual(await dialer.originate({to:CALLEE, uuid:'0f0e0d0c-0000-4000-8000-000000000000'}), expected);
    assert(!seen.join('').includes('Caller') , 'the dialer never sets a caller ID');
    await new Promise(r => ami.close(r));
  }
});
