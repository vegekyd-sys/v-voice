// Self-contained speech chunks: a queued response can be discarded immediately
// on interrupt, without making the following chunk depend on its decoder state.
import OpusScript from 'opusscript';
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
