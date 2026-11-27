// Self-contained speech chunks: a queued response can be discarded immediately
// on interrupt, without making the following chunk depend on its decoder state.
import OpusScript from 'opusscript';
import instantiate from 'opusscript/build/opusscript_native_wasm.js';
const FRAME = 480; // 20 ms at 24 kHz
const LOOKAHEAD = 156; // libopus VOIP at 24 kHz, 6.5 ms

export function createOpusDownlink() {
  const encoder = new OpusScript(24000, 1, OpusScript.Application.VOIP);
  encoder.setBitrate(24000);
  return {
    encode(pcm) {
      if (pcm.length < FRAME * 2 || pcm.length > 480000 || pcm.length % 2) return null;
      encoder.encoderCTL(4028, 0); // OPUS_RESET_STATE
      const samples = pcm.length / 2, skip = FRAME + LOOKAHEAD;
      const padded = Buffer.alloc(Math.ceil((skip + samples) / FRAME) * FRAME * 2);
      // Prime the predictor with the onset of this very chunk. Crop both the
      // primer and encoder lookahead on decode, retaining the exact PCM duration.
      pcm.copy(padded, 0, 0, FRAME * 2);
      pcm.copy(padded, FRAME * 2);
      const packets = [];
      for (let at = 0; at < padded.length; at += FRAME * 2) {
        packets.push(encoder.encode(padded.subarray(at, at + FRAME * 2), FRAME).toString('base64'));
      }
      return {codec:'opus24-v1', packets, samples};
    },
    close() { encoder.delete(); },
  };
}

// Use explicitly sized buffers for the byte-in-uint16 PCM binding. Validate
// the decoded duration before feeding the normal capture/admission pipeline.
let micModule;
export function createMicDecoder() {
  const module = micModule ??= instantiate();
  const codec = new module.OpusScriptHandler(24000, 1, 2048);
  const input = module._malloc(1275), output = module._malloc(2880 * 2 * 2);
  return {
    decode(packet) {
      if (typeof packet !== 'string' || !packet.length || packet.length > 1700) throw Error('麦克风语音包格式异常');
      const bytes = Buffer.from(packet, 'base64');
      if (!bytes.length) throw Error('麦克风语音包为空');
      module.HEAPU8.set(bytes, input);
      const samples = codec._decode(input, bytes.length, output);
      if (![480, 960, 1440].includes(samples)) throw Error('麦克风语音包时长异常');
      return Buffer.from(module.HEAPU16.subarray(output / 2, output / 2 + samples * 2));
    },
    close() { module.OpusScriptHandler.destroy_handler(codec); module._free(input); module._free(output); },
  };
}
