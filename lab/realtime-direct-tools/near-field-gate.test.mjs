import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNearFieldGate} from './near-field-gate.mjs';

const FRAME = 960; // one 60 ms xiaozhi frame at 16 kHz
const rms = db => 32768 * 10 ** (db / 20);
const random = (seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)(7);
// A TV across the room: continuous speech around -45 dBFS with syllable dips and peaks.
const tv = () => random() < .12 ? -58 : -45 + (random() * 14 - 8);
const run = (gate, frames) => frames.map(db => gate.pass(rms(db), FRAME));

test('continuous TV is gated while the person at the device passes', () => {
  const gate = createNearFieldGate();
  run(gate, Array.from({length:200}, tv));  // 12 s of TV alone
  const tvPassed = [], userPassed = [];
  for (let round = 0; round < 6; round++) {
    // 3 s of TV, then a 2 s request about 15 dB louder, mixed over the TV.
    tvPassed.push(...run(gate, Array.from({length:50}, tv)).slice(8));  // after the previous request's hold
    userPassed.push(...run(gate, Array.from({length:33}, () => -30 + (random() * 6 - 3))));
  }
  assert(tvPassed.filter(Boolean).length / tvPassed.length < .1, `TV leak ${tvPassed.filter(Boolean).length}/${tvPassed.length}`);
  assert(userPassed.every(Boolean), 'every frame of the near request passes');
  const summary = gate.summary();
  assert(summary.gatedMs > 10000 && summary.thresholdDb > -42 && summary.thresholdDb < -30, JSON.stringify(summary));
});

test('in a quiet room ordinary speech passes and soft endings survive the hold', () => {
  const gate = createNearFieldGate();
  run(gate, Array.from({length:40}, () => -65));
  assert(run(gate, Array.from({length:20}, () => -40)).every(Boolean), 'normal speech');
  assert(run(gate, [-60, -62, -61, -63, -60, -62]).every(Boolean), '400 ms tail held');
  assert.equal(run(gate, Array.from({length:6}, () => -64)).every(Boolean), false, 'silence beyond the hold is gated');
});

test('a TV turned up opens the gate only until the background catches up', () => {
  const gate = createNearFieldGate();
  run(gate, Array.from({length:200}, () => -55 + random() * 4));
  const louder = run(gate, Array.from({length:400}, () => -38 + random() * 4));  // 24 s, now 17 dB louder
  assert(louder.slice(0, 10).every(Boolean), 'a sudden loud voice first passes');
  assert(louder.slice(-100).filter(Boolean).length < 10, 'then it is learned as background');
});

test('digital silence from a muted uplink neither passes as speech nor moves the background', () => {
  const gate = createNearFieldGate();
  run(gate, Array.from({length:40}, () => -60));
  for (let i = 0; i < 300; i++) gate.pass(0, FRAME);
  assert(run(gate, Array.from({length:5}, () => -45)).every(Boolean));
  assert.equal(gate.summary().inputMs, 2700);
});
