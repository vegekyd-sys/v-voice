import {EventEmitter} from 'node:events';
import {createServer} from 'node:net';

// Asterisk AudioSocket (https://docs.asterisk.org/Configuration/Channel-Drivers/AudioSocket/):
// a TCP stream of [type:1][length:2 big-endian][payload]. Asterisk answers the
// carrier leg (SIP trunk) and hands us this socket once the callee picks up, so
// the bridge never speaks SIP or RTP itself.
export const KIND = Object.freeze({hangup:0x00, uuid:0x01, dtmf:0x03, slin8:0x10, error:0xff});
const MAX_PAYLOAD = 0xffff;

export function encodeFrame(kind, payload = Buffer.alloc(0)) {
  if (payload.length > MAX_PAYLOAD) throw Error('AudioSocket payload too large');
  const header = Buffer.alloc(3);header[0] = kind;header.writeUInt16BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** Incremental parser: TCP may split or merge frames arbitrarily. */
export function createFrameParser(onFrame) {
  let pending = Buffer.alloc(0);
  return chunk => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 3) {
      const length = pending.readUInt16BE(1);
      if (pending.length < 3 + length) break;
      onFrame(pending[0], pending.subarray(3, 3 + length));
      pending = pending.subarray(3 + length);
    }
  };
}

export const uuidToBytes = uuid => Buffer.from(uuid.replace(/-/g, ''), 'hex');
export const bytesToUuid = b => {const h = b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

/** One answered phone leg as seen through AudioSocket. */
class AudioSocketLeg extends EventEmitter {
  constructor(socket) {
    super();this.socket = socket;this.uuid = null;this.ended = false;
    socket.on('data', createFrameParser((kind, payload) => this.#frame(kind, payload)));
    socket.on('close', () => this.#end('socket-closed'));
    socket.on('error', () => this.#end('socket-error'));
  }
  #frame(kind, payload) {
    if (this.ended) return;
    if (kind === KIND.uuid && payload.length === 16 && !this.uuid) {this.uuid = bytesToUuid(payload);this.emit('identified', this.uuid);return;}
    if (!this.uuid) return this.hangup('protocol');  // audio before identity is not ours
    if (kind === KIND.slin8) return this.emit('audio', Buffer.from(payload));
    if (kind === KIND.dtmf && payload.length === 1) return this.emit('dtmf', payload.toString('ascii'));
    if (kind === KIND.hangup) return this.#end('remote-hangup');
    if (kind === KIND.error) return this.#end('remote-error');
  }
  #end(reason) {
    if (this.ended) return;
    this.ended = true;this.socket.destroy();this.emit('hangup', reason);
  }
  sendAudio(pcm8k) {
    if (this.ended || this.socket.destroyed) return false;
    for (let i = 0; i < pcm8k.length; i += MAX_PAYLOAD - 1) this.socket.write(encodeFrame(KIND.slin8, pcm8k.subarray(i, i + MAX_PAYLOAD - 1)));
    return true;
  }
  /** Ending the socket makes Asterisk leave AudioSocket(), which hangs up the channel. */
  hangup(reason = 'local-hangup') {
    if (this.ended) return;
    if (!this.socket.destroyed) this.socket.end(encodeFrame(KIND.hangup));
    this.ended = true;this.emit('hangup', reason);
  }
}

/** Listens for Asterisk; legs are matched to dial attempts by the UUID we generated. */
export function createAudioSocketServer({host = '127.0.0.1', port = 0, identifyTimeoutMs = 3000} = {}) {
  const emitter = new EventEmitter();
  const server = createServer(socket => {
    const leg = new AudioSocketLeg(socket);
    const timer = setTimeout(() => {if (!leg.uuid) leg.hangup('no-uuid');}, identifyTimeoutMs);timer.unref?.();
    leg.once('identified', uuid => {clearTimeout(timer);emitter.emit('leg', leg, uuid);});
  });
  return Object.assign(emitter, {
    listen:() => new Promise(resolve => server.listen(port, host, () => resolve(server.address()))),
    address:() => server.address(),
    close:() => new Promise(resolve => server.close(() => resolve())),
  });
}
