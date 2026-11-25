import {connect} from 'node:net';
import {createFrameParser,encodeFrame,KIND,uuidToBytes} from './audiosocket.mjs';
import {PHONE_FRAME_BYTES,PHONE_FRAME_MS} from './audio.mjs';

// Test double for "carrier + Asterisk". It implements the dialer contract and,
// when the scripted callee answers, opens a real AudioSocket TCP connection to
// the bridge exactly as Asterisk would. It never touches a real network.
export function createMockCarrier({audioSocket, outcome = 'answer', ringMs = 30}) {
  const dials = [], callees = [];
  return {
    dials, callees,
    async originate({to, uuid}) {
      dials.push({to, uuid});
      await new Promise(resolve => setTimeout(resolve, ringMs));
      if (outcome === 'busy') return {answered:false, reason:'busy'};
      if (outcome === 'reject') return {answered:false, reason:'rejected'};
      if (outcome === 'congestion') return {answered:false, reason:'congestion'};
      if (outcome === 'no-answer') return new Promise(() => {});  // rings until the bridge gives up
      const callee = await answer(uuid);callees.push(callee);
      return {answered:true};
    },
    async cancel() {},
  };

  function answer(uuid) {
    return new Promise((resolve, reject) => {
      const socket = connect(audioSocket.port, audioSocket.address);
      const callee = {heard:[], hungUpByBridge:false, closed:false, socket,
        heardBytes:() => callee.heard.reduce((n, b) => n + b.length, 0),
        heardLoud:(threshold = 300) => callee.heard.some(b => {let s = 0;for (let i = 0; i + 1 < b.length; i += 2) s = Math.max(s, Math.abs(b.readInt16LE(i)));return s > threshold;}),
        /** Speak PCM16 8 kHz in real time, 20 ms per frame, like a handset. */
        async say(pcm) {
          for (let i = 0; i < pcm.length && !callee.closed; i += PHONE_FRAME_BYTES) {
            socket.write(encodeFrame(KIND.slin8, pcm.subarray(i, i + PHONE_FRAME_BYTES)));
            await new Promise(r => setTimeout(r, PHONE_FRAME_MS));
          }
        },
        hangup() {if (!callee.closed) {socket.end(encodeFrame(KIND.hangup));callee.closed = true;}},
      };
      socket.on('data', createFrameParser((kind, payload) => {
        if (kind === KIND.slin8) callee.heard.push(Buffer.from(payload));
        if (kind === KIND.hangup) callee.hungUpByBridge = true;
      }));
      socket.on('close', () => {callee.closed = true;});
      socket.once('error', reject);
      socket.once('connect', () => {socket.write(encodeFrame(KIND.uuid, uuidToBytes(uuid)));resolve(callee);});
    });
  }
}

/** A tone at 8 kHz, loud enough to count as speech on the line. */
export function tone(ms, {hz = 440, amplitude = 6000} = {}) {
  const n = 8 * ms, b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * hz * i / 8000)), i * 2);
  return b;
}
