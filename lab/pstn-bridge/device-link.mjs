import {EventEmitter} from 'node:events';

// The phone leg joins Voice as one more native device (see device-endpoint.mjs):
// Bearer device token, `call.start`, 16 kHz PCM16 up, 24 kHz PCM16 down. Model,
// tools, session binding, turn-taking and endings all stay in Voice; the device
// record decides which Feishu session and permissions the call gets.
export const VOICE_UPLINK_RATE = 16000;
export const VOICE_DOWNLINK_RATE = 24000;
// Endings Voice chose on purpose; anything else is a failure the caller hears about.
export const NORMAL_CLOSE = new Set(['device','session','session-ended','idle','max-duration','background-speech']);

export function connectVoiceDevice({url, token, wsModule, readyTimeoutMs = 8000, firmware = 'pstn-bridge-0.1'}) {
  const link = new EventEmitter();
  const ws = new wsModule.WebSocket(url, {headers:{authorization:`Bearer ${token}`}});
  let state = 'connecting', voiceSessionId = null;
  const fail = (reason, message) => {
    if (state === 'closed') return;
    const wasReady = state === 'ready';state = 'closed';clearTimeout(timer);
    try {ws.close();} catch {}
    link.emit('closed', {reason, message, normal:false, wasReady});
  };
  const timer = setTimeout(() => fail('ready-timeout', 'Voice did not become ready'), readyTimeoutMs);timer.unref?.();
  const send = value => {if (ws.readyState === 1) ws.send(JSON.stringify(value));};
  ws.on('open', () => {state = 'hello';send({type:'hello', firmware});});
  ws.on('unexpected-response', (_req, res) => fail('rejected', `Voice refused the device (${res.statusCode})`));
  ws.on('error', error => fail('unreachable', String(error?.message ?? error)));
  ws.on('close', () => {
    if (state === 'closed') return;
    const wasReady = state === 'ready';state = 'closed';clearTimeout(timer);
    link.emit('closed', {reason:'socket-closed', normal:false, wasReady});
  });
  ws.on('message', (data, binary) => {
    if (state === 'closed') return;
    if (binary) {if (state === 'ready') link.emit('audio', Buffer.from(data));return;}
    let event;try {event = JSON.parse(data.toString());} catch {return;}
    if (event.type === 'hello' && state === 'hello') {state = 'starting';send({type:'call.start'});return;}
    if (event.type === 'call.started') {voiceSessionId = event.voiceSessionId;return;}
    if (event.type === 'call.ready') {
      if (event.inputSampleRate !== VOICE_UPLINK_RATE || event.outputSampleRate !== VOICE_DOWNLINK_RATE) return fail('audio-format', 'Unexpected Voice sample rates');
      state = 'ready';clearTimeout(timer);voiceSessionId = event.voiceSessionId;link.emit('ready', {voiceSessionId, model:event.model});return;
    }
    if (event.type === 'call.error') return fail(`voice-${event.reason ?? 'error'}`, event.message);
    if (event.type === 'call.closed') {
      const wasReady = state === 'ready';state = 'closed';clearTimeout(timer);try {ws.close();} catch {}
      link.emit('closed', {reason:event.reason, normal:NORMAL_CLOSE.has(event.reason), wasReady});
      return;
    }
    if (event.type === 'audio.clear') return link.emit('clear', event);
    if (event.type === 'audio.done' || event.type === 'end.after-playback') return link.emit('reply-done', event);
  });
  // Getters are defined, not assigned: Object.assign would freeze their first value.
  Object.defineProperties(link, {voiceSessionId:{get:() => voiceSessionId}, ready:{get:() => state === 'ready'}});
  return Object.assign(link, {
    sendAudio(pcm16k) {if (state === 'ready' && ws.readyState === 1) ws.send(pcm16k, {binary:true});},
    playback(speaking) {if (state === 'ready') send({type:'playback.state', speaking});},
    bargeIn() {if (state === 'ready') send({type:'barge-in'});},
    end() {if (state === 'ready') send({type:'call.end'});else fail('cancelled');},
  });
}
