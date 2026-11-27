// Warm the versioned libopus decoder while Home is visible. Until a decoder
// is actually available the call uses the ordinary PCM transport.
let loading;
export function warmTvOpus() {
  if (!loading) {
    const base = new URL('./assets/opus-0.1.1/', document.baseURI);
    loading = Promise.all([
      import(new URL('decoder.mjs', base).href),
      fetch(new URL('decoder.wasm', base)).then(response => {
        if (!response.ok) throw Error('Opus decoder unavailable');
        return response.arrayBuffer();
      }),
    ]).then(([{default: instantiate}, wasmBinary]) => instantiate({wasmBinary}))
      .catch(() => { loading = null; return null; });
  }
  return loading;
}

export function createTvOpusDecoder(module) {
  const codec = new module.OpusScriptHandler(24000, 1, 2048);
  // Reserve the maximum decoded Opus packet (120 ms), even when rejecting
  // a packet whose decoded duration did not match the negotiated 20 ms.
  const input = module._malloc(1275), output = module._malloc(2880 * 2 * 2);
  return {
    decode({packets, samples}) {
      const frame = 480, skip = frame + 156;
      if (!Number.isSafeInteger(samples) || samples < frame || samples > 240000 ||
          !Array.isArray(packets) || packets.length !== Math.ceil((samples + skip) / frame)) throw Error('语音包长度异常');
      codec._decoder_ctl(4028, 0);
      const pcm = new Uint8Array(samples * 2);
      for (let i = 0; i < packets.length; i++) {
        if (typeof packets[i] !== 'string' || packets[i].length > 1700) throw Error('语音包格式异常');
        const bytes = atob(packets[i]);
        if (!bytes.length) throw Error('语音包为空');
        for (let n = 0; n < bytes.length; n++) module.HEAPU8[input + n] = bytes.charCodeAt(n);
        if (codec._decode(input, bytes.length, output) !== frame) throw Error('语音解码失败');
        // OpusScript's binding exposes each output byte in a uint16 slot.
        const start = Math.max(0, skip - i * frame), end = Math.min(frame, skip + samples - i * frame);
        if (end > start) pcm.set(module.HEAPU16.subarray(output / 2 + start * 2, output / 2 + end * 2), (i * frame + start - skip) * 2);
      }
      return pcm;
    },
    close() { module.OpusScriptHandler.destroy_handler(codec); module._free(input); module._free(output); },
  };
}

// The microphone supplies one to three 20 ms frames per callback. Keep one
// encoder for the call so syllables carry across packet boundaries.
export function createTvMicEncoder(module) {
  const codec = new module.OpusScriptHandler(24000, 1, 2048);
  codec._encoder_ctl(4002, 24000);
  const input = module._malloc(1440 * 2 * 2), output = module._malloc(3828);
  return {
    encode(bytes) {
      const samples = bytes.length / 2;
      if (![480, 960, 1440].includes(samples)) throw Error('麦克风数据长度异常');
      module.HEAPU16.set(bytes, input / 2);
      const length = codec._encode(input, bytes.length, output, samples);
      if (length < 1 || length > 1275) throw Error('麦克风编码失败');
      return btoa(String.fromCharCode(...module.HEAPU8.subarray(output, output + length)));
    },
    close() { module.OpusScriptHandler.destroy_handler(codec); module._free(input); module._free(output); },
  };
}
