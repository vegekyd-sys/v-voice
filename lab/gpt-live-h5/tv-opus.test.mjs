import test from 'node:test';
import assert from 'node:assert/strict';
import instantiate from 'opusscript/build/opusscript_native_wasm.js';
import {createOpusDownlink} from '../realtime-direct-tools/opus-downlink.mjs';
import {createTvOpusDecoder} from './tv-opus.mjs';

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
