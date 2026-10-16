import {EventEmitter} from 'node:events';
import OpusScript from 'opusscript';

// Adapts a device running the open-source xiaozhi-esp32 firmware (for example
// M5Stack StackChan) to the native Voice device protocol. The device endpoint
// sees an ordinary speaker connection; this layer only converts Opus <-> PCM,
// orders xiaozhi's tts start/stop states, and reports playback progress the
// firmware does not send itself. No session, tool or turn logic lives here.
export const XIAOZHI_UPLINK_RATE = 16000;
export const XIAOZHI_DOWNLINK_RATE = 24000;
export const XIAOZHI_FRAME_MS = 60;
const DOWN_FRAME_BYTES = XIAOZHI_DOWNLINK_RATE * XIAOZHI_FRAME_MS / 1000 * 2;  // 2880
const PLAYBACK_MARGIN_MS = 400;

export function createXiaozhiWire(ws, {now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, sessionId = 'voice'} = {}) {
  const wire = new EventEmitter();
  const decoder = new OpusScript(XIAOZHI_UPLINK_RATE, 1, OpusScript.Application.VOIP);
  let encoder = new OpusScript(XIAOZHI_DOWNLINK_RATE, 1, OpusScript.Application.AUDIO);
  let pending = Buffer.alloc(0), speaking = false, playEnd = 0, drainTimer = null, closed = false, helloSeen = false;
  const sendJson = value => {if (ws.readyState === 1) ws.send(JSON.stringify({session_id:sessionId, ...value}));};
  // Native events emitted *to* the endpoint as if the device had sent them.
  const deviceSays = value => wire.emit('message', Buffer.from(JSON.stringify(value)), false);

  // The device plays each frame in real time from its arrival, so its play
  // pointer advances by one frame per frame sent, never earlier than now.
  const playbackEndsAt = () => playEnd + PLAYBACK_MARGIN_MS;
  const afterPlayback = fn => {clearTimer(drainTimer);drainTimer = setTimer(() => {drainTimer = null;fn();}, Math.max(0, playbackEndsAt() - now()));};
  function encodeFrame(frame) {
    if (ws.readyState !== 1) return;
    ws.send(encoder.encode(frame, DOWN_FRAME_BYTES / 2), {binary:true});
    playEnd = Math.max(playEnd, now()) + XIAOZHI_FRAME_MS;
  }
  function startSpeaking() {
    if (speaking) return;
    clearTimer(drainTimer);drainTimer = null;
    speaking = true;playEnd = now();
    sendJson({type:'tts', state:'start'});
    deviceSays({type:'playback.state', speaking:true});
  }
  function flush() {
    if (!pending.length) return;
    const frame = Buffer.alloc(DOWN_FRAME_BYTES);pending.copy(frame);pending = Buffer.alloc(0);
    encodeFrame(frame);
  }
  function stopSpeaking(then) {
    if (!speaking) {then?.();return;}
    flush();
    // xiaozhi drains its own playback queue after tts stop before listening again.
    sendJson({type:'tts', state:'stop'});
    afterPlayback(() => {speaking = false;deviceSays({type:'playback.state', speaking:false});then?.();});
  }
  function interrupt() {
    clearTimer(drainTimer);drainTimer = null;pending = Buffer.alloc(0);
    if (speaking) {sendJson({type:'tts', state:'stop'});speaking = false;deviceSays({type:'playback.state', speaking:false});}
    // Fresh encoder so the next response starts without the old prediction state.
    encoder.delete();encoder = new OpusScript(XIAOZHI_DOWNLINK_RATE, 1, OpusScript.Application.AUDIO);
  }

  ws.on('message', (data, binary) => {
    if (closed) return;
    if (binary) {
      if (!helloSeen) return;
      let pcm;try {pcm = decoder.decode(Buffer.from(data));} catch {return;}
      if (pcm?.length) wire.emit('message', Buffer.from(pcm), true);
      return;
    }
    let event;try {event = JSON.parse(data.toString());} catch {return ws.close(1008, 'invalid event');}
    if (event.type === 'hello') {
      if (event.audio_params && (event.audio_params.format !== 'opus' || event.audio_params.sample_rate !== XIAOZHI_UPLINK_RATE)) return ws.close(1008, 'unsupported audio');
      helloSeen = true;
      sendJson({type:'hello', transport:'websocket', audio_params:{format:'opus', sample_rate:XIAOZHI_DOWNLINK_RATE, channels:1, frame_duration:XIAOZHI_FRAME_MS}});
      // One xiaozhi channel is one call.
      deviceSays({type:'call.start'});
      return;
    }
    if (event.type === 'abort') {deviceSays({type:'barge-in'});interrupt();return;}
    // listen start/stop/detect: the shared Voice session owns turn-taking.
  });
  ws.on('close', (...args) => {closed = true;clearTimer(drainTimer);decoder.delete();encoder.delete();wire.emit('close', ...args);});
  ws.on('error', error => wire.emit('error', error));
  ws.on('pong', (...args) => wire.emit('pong', ...args));

  // The endpoint writes native frames here.
  wire.send = (data, options = {}) => {
    if (closed) return;
    if (options.binary) {
      startSpeaking();
      pending = pending.length ? Buffer.concat([pending, data]) : Buffer.from(data);
      while (pending.length >= DOWN_FRAME_BYTES) {encodeFrame(pending.subarray(0, DOWN_FRAME_BYTES));pending = pending.subarray(DOWN_FRAME_BYTES);}
      return;
    }
    let event;try {event = JSON.parse(data);} catch {return;}
    switch (event.type) {
      case 'reaction': return sendJson({type:'llm', emotion:event.id});
      case 'audio.done': return stopSpeaking();
      case 'audio.clear': return interrupt();
      case 'end.after-playback': return stopSpeaking(() => deviceSays({type:'playback.drained', callId:event.callId}));
      case 'call.error': return sendJson({type:'alert', status:'V 暂时没接上', message:String(event.message ?? '').slice(0, 120), emotion:'sorry'});
      case 'call.closed': {
        // Let the farewell finish on the device, then end the channel.
        const close = () => {if (ws.readyState === 1) ws.close(1000, 'call closed');};
        return speaking ? stopSpeaking(close) : close();
      }
      default: return;  // hello, call.started, call.ready, busy, pong, audio.source
    }
  };
  wire.close = (code, reason) => {if (ws.readyState === 1) ws.close(code, reason);};
  wire.terminate = () => ws.terminate();
  wire.ping = () => ws.ping();
  Object.defineProperty(wire, 'readyState', {get: () => ws.readyState});
  Object.defineProperty(wire, 'bufferedAmount', {get: () => ws.bufferedAmount});
  return wire;
}
