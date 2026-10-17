import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createXiaozhiWire, applyOutputGain} from './xiaozhi-wire.mjs';

// A fake xiaozhi socket and a manual clock: frames and tts states are recorded.
function harness(options = {}) {
  let clock = 0;const timers = new Set();
  const ws = new EventEmitter();
  ws.readyState = 1;ws.out = [];
  ws.send = (data, options = {}) => ws.out.push(options.binary ? {audio:true} : JSON.parse(data));
  ws.close = () => {ws.readyState = 3;};
  const wire = createXiaozhiWire(ws, {
    now: () => clock,
    setTimer: (fn, ms) => {const t = {at:clock + ms, fn};timers.add(t);return t;},
    clearTimer: t => timers.delete(t),
    ...options,
  });
  const device = [];
  wire.on('message', (data, binary) => {if (!binary) device.push(JSON.parse(data.toString()));});
  const advance = ms => {
    clock += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) if (t.at <= clock) {timers.delete(t);t.fn();}
  };
  const tts = () => ws.out.filter(e => e.type === 'tts').map(e => e.state);
  const audio = frames => wire.send(Buffer.alloc(2880 * frames), {binary:true});
  return {ws, wire, device, advance, tts, audio};
}

test('a reply that resumes before playback ends stays in one tts segment', () => {
  const h = harness();
  h.audio(10);  // 600 ms of a tool notice
  h.wire.send(JSON.stringify({type:'audio.done'}));
  assert.deepEqual(h.tts(), ['start'], 'stop is held while the device still plays');
  h.advance(500);
  h.audio(10);  // the answer arrives before the notice finished playing
  h.advance(2000);
  assert.deepEqual(h.tts(), ['start'], 'no stop while the answer is still streaming');
  h.wire.send(JSON.stringify({type:'audio.done'}));
  h.wire.send(JSON.stringify({type:'audio.done'}));
  h.advance(2000);
  assert.deepEqual(h.tts(), ['start', 'stop'], 'one stop after everything played');
  assert.deepEqual(h.device.filter(e => e.type === 'playback.state').map(e => e.speaking), [true, false]);
});

test('audio after the stop went out opens a new tts segment first', () => {
  const h = harness();
  h.audio(5);
  h.wire.send(JSON.stringify({type:'audio.done'}));
  h.advance(1000);
  h.audio(5);
  const out = h.ws.out;
  const firstAudioAfterStop = out.findIndex((e, i) => i > out.findIndex(x => x.state === 'stop') && e.audio);
  assert.equal(out[firstAudioAfterStop - 1].state, 'start', 'tts start precedes the new audio');
  assert.deepEqual(h.tts(), ['start', 'stop', 'start']);
});

test('end.after-playback reports drained only after the held stop', () => {
  const h = harness();
  h.audio(5);
  h.wire.send(JSON.stringify({type:'end.after-playback', callId:'c1'}));
  assert(!h.device.some(e => e.type === 'playback.drained'));
  h.advance(1000);
  assert.deepEqual(h.tts(), ['start', 'stop']);
  assert.deepEqual(h.device.at(-1), {type:'playback.drained', callId:'c1'});
});

test('barge-in stops at once and forgets pending callbacks', () => {
  const h = harness();
  h.audio(5);
  h.wire.send(JSON.stringify({type:'end.after-playback', callId:'c1'}));
  h.wire.send(JSON.stringify({type:'audio.clear'}));
  assert.deepEqual(h.tts(), ['start', 'stop']);
  h.advance(2000);
  assert.deepEqual(h.tts(), ['start', 'stop']);
  assert(!h.device.some(e => e.type === 'playback.drained'));
});

test('an operator volume is applied through the firmware MCP tool on hello', () => {
  const h = harness({volume:35});
  h.ws.emit('message', Buffer.from(JSON.stringify({type:'hello', audio_params:{format:'opus', sample_rate:16000}})), false);
  const mcp = h.ws.out.find(e => e.type === 'mcp');
  assert.deepEqual(mcp.payload.params, {name:'self.audio_speaker.set_volume', arguments:{volume:35}});
  assert.equal(harness().ws.out.length, 0);
});

test('a mid-call volume change waits for the firmware MCP reply', async () => {
  const h = harness({volume:35});
  await assert.rejects(h.wire.setVolume(50), /尚未连接/, 'no MCP before the device said hello');
  h.ws.emit('message', Buffer.from(JSON.stringify({type:'hello', audio_params:{format:'opus', sample_rate:16000}})), false);
  const reply = payload => h.ws.emit('message', Buffer.from(JSON.stringify({session_id:'voice', type:'mcp', payload:{jsonrpc:'2.0', ...payload}})), false);
  const lastMcp = () => h.ws.out.filter(e => e.type === 'mcp').at(-1).payload;

  const confirmed = h.wire.setVolume(50);
  const first = lastMcp();
  assert.notEqual(first.id, 1, 'the hello volume keeps its own id');
  assert.deepEqual(first.params, {name:'self.audio_speaker.set_volume', arguments:{volume:50}});
  reply({id:1, result:{content:[{type:'text', text:'true'}], isError:false}});  // the hello call's late reply
  reply({id:first.id, result:{content:[{type:'text', text:'true'}], isError:false}});
  assert.deepEqual(await confirmed, {volume:50, confirmed:true});

  const refused = h.wire.setVolume(60);
  reply({id:lastMcp().id, error:{message:'Unknown tool'}});
  await assert.rejects(refused, /Unknown tool/);

  const silent = h.wire.setVolume(70);
  h.advance(3000);
  assert.deepEqual(await silent, {volume:70, confirmed:false}, 'older firmware may not answer');

  const pending = h.wire.setVolume(80);
  h.ws.emit('close', 1000);
  await assert.rejects(pending, /断开/);
});

test('output gain lifts quiet speech and rounds off peaks without clipping', () => {
  const pcm = Buffer.alloc(8);
  [1000, -1000, 20000, -32000].forEach((v, i) => pcm.writeInt16LE(v, i * 2));
  const out = applyOutputGain(pcm, 2);
  const s = i => out.readInt16LE(i * 2);
  assert.equal(s(0), 2000);
  assert.equal(s(1), -2000);
  assert(s(2) > 24000 && s(2) < 32767, 'a loud sample is compressed above the knee');
  assert(s(3) < -24000 && s(3) >= -32767);
  assert.equal(applyOutputGain(pcm, 1), pcm, 'unity gain is a no-op');
});
