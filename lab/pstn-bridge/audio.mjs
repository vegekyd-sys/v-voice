// Telephone audio is 8 kHz narrowband. The Voice device protocol takes 16 kHz
// PCM16 up and sends 24 kHz PCM16 down; this file only converts between them.
// No call, session or turn logic lives here.
export const PHONE_RATE = 8000;
export const PHONE_FRAME_MS = 20;
export const PHONE_FRAME_BYTES = PHONE_RATE * PHONE_FRAME_MS / 1000 * 2;  // 320

/** 8 kHz -> 16 kHz by linear interpolation; carries the last sample across frames. */
export function createUpsampler8to16() {
  let last = 0;
  return pcm => {
    const n = pcm.length >> 1, out = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
      const v = pcm.readInt16LE(i * 2);
      out.writeInt16LE(Math.round((last + v) / 2), i * 4);
      out.writeInt16LE(v, i * 4 + 2);
      last = v;
    }
    return out;
  };
}

/** 24 kHz -> 8 kHz: average each group of three samples (a crude low-pass)
 * before decimating, so model speech does not alias into the phone band. */
export function createDownsampler24to8() {
  let carry = [];
  return pcm => {
    const samples = carry.slice();
    for (let i = 0; i + 1 < pcm.length; i += 2) samples.push(pcm.readInt16LE(i));
    const n = Math.floor(samples.length / 3), out = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) out.writeInt16LE(Math.round((samples[i * 3] + samples[i * 3 + 1] + samples[i * 3 + 2]) / 3), i * 2);
    carry = samples.slice(n * 3);
    return out;
  };
}

export function rms(pcm) {
  const n = pcm.length >> 1;if (!n) return 0;
  let sum = 0;for (let i = 0; i < n; i++) {const v = pcm.readInt16LE(i * 2);sum += v * v;}
  return Math.sqrt(sum / n);
}

// G.711 for carriers that hand us RTP instead of linear PCM. Mainland trunks
// usually negotiate PCMA (A-law); PCMU is kept for completeness.
export function alawEncode(sample) {
  let sign = 0;
  if (sample < 0) {sample = -sample - 1;sign = 0x80;}
  if (sample > 32767) sample = 32767;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = exponent === 0 ? (sample >> 4) & 0x0f : (sample >> (exponent + 3)) & 0x0f;
  return ((sign | (exponent << 4) | mantissa) ^ 0xd5) & 0xff;
}
export function alawDecode(byte) {
  byte ^= 0x55;
  const exponent = (byte & 0x70) >> 4, mantissa = byte & 0x0f;
  let sample = exponent === 0 ? (mantissa << 4) + 8 : ((mantissa << 4) + 0x108) << (exponent - 1);
  return byte & 0x80 ? sample : -sample;
}
export function ulawEncode(sample) {
  const BIAS = 0x84, CLIP = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
export function ulawDecode(byte) {
  byte = ~byte & 0xff;
  const sign = byte & 0x80, exponent = (byte >> 4) & 0x07, mantissa = byte & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -sample : sample;
}
export const encodeG711 = (pcm, law = 'alaw') => {
  const enc = law === 'alaw' ? alawEncode : ulawEncode, out = Buffer.alloc(pcm.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = enc(pcm.readInt16LE(i * 2));
  return out;
};
export const decodeG711 = (bytes, law = 'alaw') => {
  const dec = law === 'alaw' ? alawDecode : ulawDecode, out = Buffer.alloc(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) out.writeInt16LE(dec(bytes[i]), i * 2);
  return out;
};
