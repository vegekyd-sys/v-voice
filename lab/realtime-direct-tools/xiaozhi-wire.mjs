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

// Small robot speakers top out quietly even at firmware volume 100. A per-device
// gain lifts the reply PCM; peaks above the knee are rounded off instead of clipped.
const GAIN_KNEE = 24000;
export function applyOutputGain(pcm, gain) {
  if (gain === 1) return pcm;
  const out = Buffer.from(pcm);  // a trailing odd byte, if any, passes through
  const room = 32767 - GAIN_KNEE;
  for (let i = 0; i + 1 < out.length; i += 2) {
    const y = pcm.readInt16LE(i) * gain, a = Math.abs(y);
    const v = a <= GAIN_KNEE ? y : Math.sign(y) * (GAIN_KNEE + room * Math.tanh((a - GAIN_KNEE) / room));
    out.writeInt16LE(Math.round(v), i);
  }
  return out;
}
const DOWN_FRAME_BYTES = XIAOZHI_DOWNLINK_RATE * XIAOZHI_FRAME_MS / 1000 * 2;  // 2880
const PLAYBACK_MARGIN_MS = 400;

export function createXiaozhiWire(ws, {now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, sessionId = 'voice', volume = null, outputGain = 1, vision = null} = {}) {
  const wire = new EventEmitter();
  const decoder = new OpusScript(XIAOZHI_UPLINK_RATE, 1, OpusScript.Application.VOIP);
  let encoder = new OpusScript(XIAOZHI_DOWNLINK_RATE, 1, OpusScript.Application.AUDIO);
  let pending = Buffer.alloc(0), speaking = false, stopping = false, playEnd = 0, drainTimer = null, closed = false, helloSeen = false;
  let afterStop = [];
  // Firmware MCP calls made during the call, answered by JSON-RPC id. id 1 is the hello volume.
  let mcpId = 1;const mcpWaiters = new Map();
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
    if (speaking) {
      // The reply resumed (e.g. the answer after a tool notice) before the
      // held stop went out: keep playing in the same tts segment.
      if (stopping) {clearTimer(drainTimer);drainTimer = null;stopping = false;}
      return;
    }
    clearTimer(drainTimer);drainTimer = null;
    speaking = true;stopping = false;playEnd = now();
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
    if (then) afterStop.push(then);
    flush();
    // xiaozhi discards audio that arrives after tts stop until it has handled a
    // new tts start, so hold the stop until the device has played what it got.
    // Repeated audio.done reports only move this one pending stop.
    stopping = true;
    afterPlayback(() => {
      sendJson({type:'tts', state:'stop'});
      speaking = false;stopping = false;
      deviceSays({type:'playback.state', speaking:false});
      const callbacks = afterStop;afterStop = [];
      for (const fn of callbacks) fn();
    });
  }
  function interrupt() {
    clearTimer(drainTimer);drainTimer = null;pending = Buffer.alloc(0);afterStop = [];
    if (speaking) {sendJson({type:'tts', state:'stop'});speaking = false;stopping = false;deviceSays({type:'playback.state', speaking:false});}
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
      // An operator volume from the device record, applied through the firmware's own MCP tool.
      if (volume !== null) sendJson({type:'mcp', payload:{jsonrpc:'2.0', id:1, method:'tools/call', params:{name:'self.audio_speaker.set_volume', arguments:{volume}}}});
      // A camera device learns where to upload photos (and this call's own token)
      // from the MCP initialize capabilities; its take_photo tool posts there.
      if (vision) sendJson({type:'mcp', payload:{jsonrpc:'2.0', id:++mcpId, method:'initialize', params:{protocolVersion:'2024-11-05', capabilities:{vision:{url:vision.url, token:vision.token}}, clientInfo:{name:'v-voice', version:'1'}}}});
      // One xiaozhi channel is one call.
      deviceSays({type:'call.start'});
      return;
    }
    if (event.type === 'abort') {deviceSays({type:'barge-in'});interrupt();return;}
    if (event.type === 'mcp') {
      const reply = event.payload, waiter = mcpWaiters.get(reply?.id);
      if (!waiter) return;
      mcpWaiters.delete(reply.id);clearTimer(waiter.timer);waiter.cleanup?.();
      if (reply.error || reply.result?.isError) return waiter.reject(Error(String(reply.error?.message ?? reply.result?.content?.[0]?.text ?? '音箱拒绝了这个操作').slice(0, 200)));
      return waiter.resolve(reply.result);
    }
    // listen start/stop/detect: the shared Voice session owns turn-taking.
  });
  ws.on('close', (...args) => {
    closed = true;
    for (const waiter of mcpWaiters.values()) {clearTimer(waiter.timer);waiter.cleanup?.();waiter.reject(Error('音箱已断开'));}
    mcpWaiters.clear();clearTimer(drainTimer);decoder.delete();encoder.delete();wire.emit('close', ...args);});
  ws.on('error', error => wire.emit('error', error));
  ws.on('pong', (...args) => wire.emit('pong', ...args));

  // The endpoint writes native frames here.
  wire.send = (data, options = {}) => {
    if (closed) return;
    if (options.binary) {
      startSpeaking();
      data = applyOutputGain(Buffer.from(data), outputGain);
      pending = pending.length ? Buffer.concat([pending, data]) : Buffer.from(data);
      while (pending.length >= DOWN_FRAME_BYTES) {encodeFrame(pending.subarray(0, DOWN_FRAME_BYTES));pending = pending.subarray(DOWN_FRAME_BYTES);}
      return;
    }
    let event;try {event = JSON.parse(data);} catch {return;}
    switch (event.type) {
      case 'reaction': return sendJson({type:'llm', emotion:event.id});
      // Task status badge on V robot firmware (status:memory|web|calendar|background|done|none).
      case 'status': return sendJson({type:'llm', emotion:`status:${event.id}`});
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
  /** Set the speaker volume mid-call. Resolves whether the firmware confirmed it;
   * older firmware may apply the call without replying. */
  wire.setVolume = (level, {timeoutMs = 3000} = {}) => new Promise((resolve, reject) => {
    if (closed || !helloSeen || ws.readyState !== 1) return reject(Error('音箱尚未连接'));
    const id = ++mcpId;
    const timer = setTimer(() => {mcpWaiters.delete(id);resolve({volume:level, confirmed:false});}, timeoutMs);
    mcpWaiters.set(id, {timer, reject, resolve:() => resolve({volume:level, confirmed:true})});
    sendJson({type:'mcp', payload:{jsonrpc:'2.0', id, method:'tools/call', params:{name:'self.audio_speaker.set_volume', arguments:{volume:level}}}});
  });
  // Internal transport only. Callers must use the robot adapter's allowlist;
  // arbitrary tool names are never exposed to either model.
  wire.callTool = (name, args, {timeoutMs = 3000, signal} = {}) => new Promise((resolve, reject) => {
    if (closed || !helloSeen || ws.readyState !== 1 || signal?.aborted) return reject(Error('device_unavailable'));
    if (mcpWaiters.size >= 8) return reject(Error('device_busy'));
    const id = ++mcpId;
    const fail = reason => {mcpWaiters.delete(id);clearTimer(timer);cleanup();reject(Error(reason));};
    const abort = () => fail('request_cancelled');
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimer(() => fail('device_timeout'), Math.max(1, Math.min(15000, timeoutMs)));
    mcpWaiters.set(id, {timer, cleanup, reject, resolve});
    signal?.addEventListener('abort', abort, {once:true});
    sendJson({type:'mcp', payload:{jsonrpc:'2.0', id, method:'tools/call', params:{name, arguments:args}}});
  });
  if (vision) wire.takePhoto = async (question, options) => {
    const result = await wire.callTool('self.camera.take_photo', {question}, {timeoutMs:15000, ...options}).catch(error => {
      if(error.message==='device_unavailable')throw Error('机器人尚未连接');
      if(error.message==='device_timeout')throw Error('机器人拍照超时');
      throw error;
    });
    return (result?.content ?? []).filter(b => b?.type === 'text').map(b => String(b.text ?? '')).join('\n');
  };
  wire.close = (code, reason) => {if (ws.readyState === 1) ws.close(code, reason);};
  wire.terminate = () => ws.terminate();
  wire.ping = () => ws.ping();
  Object.defineProperty(wire, 'readyState', {get: () => ws.readyState});
  Object.defineProperty(wire, 'bufferedAmount', {get: () => ws.bufferedAmount});
  return wire;
}
