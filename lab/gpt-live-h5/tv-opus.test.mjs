import test from 'node:test';
import assert from 'node:assert/strict';
import instantiate from 'opusscript/build/opusscript_native_wasm.js';
import {createMicDecoder, createOpusDownlink} from '../realtime-direct-tools/opus-downlink.mjs';
import {createTvMicEncoder, createTvOpusDecoder} from './tv-opus.mjs';

test('TV Opus chunks preserve PCM timing across arbitrary boundaries and independent interrupts', t => {
  const encoder = createOpusDownlink(), decoder = createTvOpusDecoder(instantiate());
  t.after(() => { encoder.close(); decoder.close(); });
  assert.equal(encoder.encode(Buffer.alloc(10)), null);
  for (const samples of [480, 8192, 12345]) {
    const signal = Int16Array.from({length:samples}, (_, i) => 9000 * Math.sin(i * .089) + 5000 * Math.cos(i * .16));
    const encoded = encoder.encode(Buffer.from(signal.buffer));
    const received = new Int16Array(decoder.decode(encoded).buffer);
    assert.equal(received.length, samples);
    let agree = 0, total = 0, power = 0;
    for (let i = 0; i < samples; i++) { agree += signal[i] * received[i]; total += signal[i] ** 2; power += received[i] ** 2; }
    assert.ok(agree / Math.sqrt(total * power) > .92, 'speech-band signal is aligned after trimming the codec delay');
    if (samples > 1000) assert.ok(JSON.stringify(encoded).length < signal.byteLength / 3);
    assert.deepEqual(decoder.decode(encoded), new Uint8Array(received.buffer));
  }
  assert.throws(() => decoder.decode({samples:1000, packets:[]}));
});

test('TV microphone delivers continuous 20, 40 and 60 ms frames through the relay', t => {
  const encoder = createTvMicEncoder(instantiate()), decoder = createMicDecoder();
  t.after(() => { encoder.close(); decoder.close(); });
  let position = 0;
  for (const length of [480, 960, 1440, 1440]) {
    const signal = Int16Array.from({length}, (_, i) => 12000 * Math.sin((position + i) * .075));
    const packet = encoder.encode(new Uint8Array(signal.buffer));
    const received = decoder.decode(packet);
    assert.equal(received.length, signal.byteLength);
    assert.ok(packet.length < signal.byteLength / 3);
    let correlation = 0, power = 0, reference = 0;
    for (let i = 180; i < length; i++) {
      const decoded = received.readInt16LE(i * 2), input = signal[i - 156];
      correlation += decoded * input; power += decoded ** 2; reference += input ** 2;
    }
    assert.ok(correlation / Math.sqrt(power * reference) > .90);
    position += length;
  }
  assert.throws(() => decoder.decode(''));
});
