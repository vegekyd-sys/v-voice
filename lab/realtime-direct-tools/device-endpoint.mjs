import {createDevicePlayout} from './device-playout.mjs';
import {EventEmitter} from 'node:events';
import {createRobotReactionDriver} from '../robot/robot-reactions.mjs';
import {createXiaozhiWire} from './xiaozhi-wire.mjs';
import {createVolumeStore,targetVolume} from './device-volume.mjs';
import {createHash,timingSafeEqual} from 'node:crypto';

// A hardware speaker is one more Voice client. It owns only audio I/O, wake and
// local playback; model sessions, tools, tasks and endings stay in Voice.
export const DEVICE_MODELS = ['seeduplex','grok'];
export const DEVICE_INPUT_SAMPLE_RATE = 16000;
export const DEVICE_OUTPUT_SAMPLE_RATE = 24000;
const FORWARDED = new Set(['audio.clear','audio.done','end.accepted','end.after-playback','end.cancelled','provider.reconnecting','provider.recovered']);
const digest = value => createHash('sha256').update(String(value)).digest();

/** Device records are private operator configuration, like phone entries. */
export function parseDeviceEntries(records = []) {
  if (!Array.isArray(records)) throw Error('Device entries must be an array');
  const devices = [];
  for (const record of records) {
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/u.test(record?.id ?? '') || devices.some(d => d.id === record.id)) throw Error('Invalid or duplicate device ID');
    if (record.agentId !== 'makaron' || record.callerId !== 'tianyi' || record.permissionProfile !== 'personal-tianyi') throw Error('Other caller identities require Gateway actor-scoped authorization');
    if (typeof record.sessionKey !== 'string' || !/^agent:makaron:feishu:(group|direct):[A-Za-z0-9_]+$/u.test(record.sessionKey)) throw Error('A device must bind an existing Feishu session');
    if (typeof record.token !== 'string' || !/^[A-Za-z0-9._~+/=-]{32,256}$/u.test(record.token) || devices.some(d => timingSafeEqual(d.tokenDigest, digest(record.token)))) throw Error('Each device needs its own private token');
    const models = record.models ?? [record.model ?? 'seeduplex'];
    if (!Array.isArray(models) || !models.length || models.some(m => !DEVICE_MODELS.includes(m))) throw Error('Unsupported device voice model');
    const model = record.model ?? models[0];
    if (!models.includes(model)) throw Error('The default device model must be allowed');
    const inputGain = record.inputGain ?? 1;
    if (!Number.isFinite(inputGain) || inputGain < 1 || inputGain > 4) throw Error('Device input gain must be between 1 and 4');
    const noiseGateRms = record.noiseGateRms ?? 0, noiseGateHoldMs = record.noiseGateHoldMs ?? 500;
    if (!Number.isInteger(noiseGateRms) || noiseGateRms < 0 || noiseGateRms > 2000 || !Number.isInteger(noiseGateHoldMs) || noiseGateHoldMs < 40 || noiseGateHoldMs > 2000) throw Error('Invalid device noise gate');
    // Lead is how far PCM may run ahead of real time on the wire. The speaker
    // discards its whole buffer on audio.clear, so a larger lead only absorbs
    // Wi-Fi stalls; it does not delay interruption.
    const playoutLeadMs = record.playoutLeadMs ?? 480;
    if (!Number.isInteger(playoutLeadMs) || playoutLeadMs < 200 || playoutLeadMs > 5000) throw Error('Device playout lead must be 200-5000 ms');
    // xiaozhi firmware fetches its WebSocket URL and token from an OTA endpoint at
    // boot. Only a device registered with its MAC address may receive them.
    const mac = record.mac === undefined ? null : String(record.mac).toLowerCase();
    const volume = record.volume ?? null;
    const outputGain = record.outputGain ?? 1;
    if (typeof outputGain !== 'number' || outputGain < 1 || outputGain > 4) throw Error('Device output gain must be 1-4');
    if (volume !== null && (!Number.isInteger(volume) || volume < 0 || volume > 100)) throw Error('Device volume must be 0-100');
    if (mac !== null && !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/u.test(mac)) throw Error('Invalid device MAC address');
    devices.push(Object.freeze({inputGain,noiseGateRms,noiseGateHoldMs,playoutLeadMs,volume,outputGain,robot:record.robot === true,mac,otaToken:mac ? record.token : null,id:record.id,sessionKey:record.sessionKey,model,models:Object.freeze([...models]),voice:typeof record.voice === 'string' ? record.voice : undefined,tokenDigest:digest(record.token),disabled:record.disabled === true}));
  }
  return devices;
}

/** Virtual relay client handed to the shared direct voice session. */
class DeviceCallClient extends EventEmitter {
  constructor(call) {super();this.call = call;this.readyState = 1;}
  send(raw) {this.call.fromSession(raw);}
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.call.closed('session');
    this.emit('close');
  }
}

export function createDeviceEndpoint({directVoice,devices = [],wsModule,path = '/device/voice',xiaozhiPath = null,otaPath = null,xiaozhiPublicUrl = null,audit = () => {},isSessionBusy = () => false,
  now = Date.now,idleMs = 15000,initialIdleMs = 12000,followUpMs = 10000,chatterMs = 30000,toolHoldMs = 180000,maxCallMs = 1800000,tickMs = 1000,pingMs = 20000,maxBufferedBytes = 4 * 1024 * 1024,robotEvaluate = null,volumeStore = createVolumeStore()}) {
  if (!/^\/[a-zA-Z0-9/_-]+$/u.test(path)) throw Error('Invalid device path');
  const server = new wsModule.WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false});
  const connections = new Map();
  const authenticate = req => {
    const match = /^Bearer ([A-Za-z0-9._~+/=-]{32,256})$/u.exec(String(req.headers.authorization ?? ''));
    if (!match) return null;
    const presented = digest(match[1]);
    let found = null;
    // Compare every record so timing does not reveal which device matched.
    for (const device of devices) if (timingSafeEqual(device.tokenDigest, presented)) found = device;
    return found && !found.disabled ? found : null;
  };
  const sendJson = (ws, value) => {if (ws.readyState === 1) ws.send(JSON.stringify(value));};

  function startCall(connection, request = {}) {
    const {device, ws} = connection;
    if (connection.call) return sendJson(ws, {type:'call.error',reason:'busy',message:'上一次对话还没有结束'});
    if (isSessionBusy(device.sessionKey) || [...connections.values()].some(c => c !== connection && c.call && c.device.sessionKey === device.sessionKey)) return sendJson(ws, {type:'call.error',reason:'session-busy',message:'这个会话正在另一台设备上通话'});
    const model = request.model === undefined ? device.model : request.model;
    if (!device.models.includes(model)) return sendJson(ws, {type:'call.error',reason:'model',message:'这个音箱没有开放该语音模型'});
    const call = {connection,model,startedAt:now(),readyAt:0,lastActivityAt:now(),replyEndedAt:0,userTurns:0,outputBytes:0,inputBytes:0,playing:false,ended:false,client:null,id:null,timer:null};
    connection.call = call;
    call.playout = createDevicePlayout({now,maxBytes:maxBufferedBytes,maxLeadMs:device.playoutLeadMs,bufferedBytes:()=>ws.bufferedAmount,
      sendAudio:pcm=>{if(ws.readyState===1){call.outputBytes+=pcm.length;call.lastActivityAt=now();ws.send(pcm,{binary:true});}},
      sendEvent:event=>sendJson(ws,event)});
    // A robot face reacts to the same shared session events. Reactions to V's
    // own speech follow the queued audio; reactions to the user go at once.
    call.robot = device.robot ? createRobotReactionDriver({evaluate:robotEvaluate,
      send:event=>event.beat?.startsWith('assistant')?call.playout.event(event):sendJson(ws,event),
      audit:event=>audit({...event,voiceSessionId:call.id,deviceId:device.id})}) : null;
    call.fromSession = raw => {
      if (call.ended) return;
      let event;try {event = JSON.parse(raw);} catch {return;}
      if (call.robot && (event.type === 'transcript' || event.type?.startsWith('tool.'))) call.robot.observe(event);
      if (event.type === 'audio') {
        const pcm = Buffer.from(String(event.audio ?? ''), 'base64');
        if (!pcm.length || ws.readyState !== 1) return;
        if (!call.playout.push(pcm,{backendSpeech:event.source==='injected-speech'})) return call.end('slow-playback');
        call.lastActivityAt = now();
        return;
      }
      if (event.type === 'ready') {
        call.readyAt = now();call.lastActivityAt = call.readyAt;
        audit({type:'device.call',voiceSessionId:call.id,stage:'ready',deviceId:device.id,latencyMs:call.readyAt - call.startedAt});
        return sendJson(ws, {type:'call.ready',voiceSessionId:call.id,model,inputSampleRate:DEVICE_INPUT_SAMPLE_RATE,outputSampleRate:DEVICE_OUTPUT_SAMPLE_RATE});
      }
      if (event.type === 'transcript') {
        // Transcript text stays in Voice's private audit; the speaker needs none.
        call.lastActivityAt = now();
        if (event.role === 'user' && event.final) {call.userTurns++;call.turnSinceReply = true;}
        return;
      }
      if (event.type === 'tool.call' || event.type === 'tool.progress') {call.lastActivityAt = now();return sendJson(ws, {type:'busy',active:true});}
      if (event.type === 'tool.result' || event.type === 'tool.error') {call.lastActivityAt = now();return sendJson(ws, {type:'busy',active:false});}
      if (event.type === 'error') return sendJson(ws, {type:'call.error',reason:'voice',message:String(event.message ?? '').slice(0,200)});
      if (FORWARDED.has(event.type)) {
        call.lastActivityAt = now();
        if(event.type==='audio.clear')call.playout.clear();
        if(event.type==='audio.done'||event.type==='end.after-playback') {
          call.playout.event({type:event.type,...(typeof event.callId==='string'?{callId:event.callId}:{})});return;
        }
        return sendJson(ws, {type:event.type,...(typeof event.callId === 'string' ? {callId:event.callId} : {})});
      }
    };
    call.closed = reason => {
      if (call.ended) return;
      call.ended = true;clearInterval(call.timer);call.playout.dispose();call.robot?.dispose();
      if (connection.call === call) connection.call = null;
      if (call.id) audit({type:'device.call',voiceSessionId:call.id,stage:'closed',deviceId:device.id,reason:call.reason ?? reason,
        durationMs:now() - call.startedAt,inputBytes:call.inputBytes,outputBytes:call.outputBytes,userTurns:call.userTurns,gatedInputBytes:call.gatedInputBytes ?? 0,maxInputGapMs:call.maxInputGapMs ?? 0});
      sendJson(ws, {type:'call.closed',reason:call.reason ?? reason});
    };
    call.end = reason => {
      if (call.ended) return;
      call.reason ??= reason;
      if (call.client) {call.client.close();void directVoice.close(call.id).catch(() => {});}
      else call.closed(reason);
    };
    call.tick = () => {
      if (call.ended) return;
      const state = directVoice.activity(call.id);
      if (!state) return call.end('session-ended');
      const at = now();
      if (call.playout.pendingBytes() || state.userSpeaking || state.responseActive || state.playing || call.playing) call.lastActivityAt = at;
      if (state.lastUserAt > call.lastActivityAt) call.lastActivityAt = state.lastUserAt;
      if (at - call.startedAt > maxCallMs) return call.end('max-duration');
      if (!call.readyAt) {if (at - call.startedAt > 45000) call.end('connect-timeout');return;}
      // Tool calls and delegated work are quiet but real activity. Hold them for
      // a bounded period instead of cutting the task when the room goes silent.
      if (state.pendingTools || state.backgroundTask) {if (at - call.lastActivityAt > toolHoldMs) call.end('idle');return;}
      // A household speaker has a follow-up window: after V finishes speaking,
      // someone must start talking soon. Room conversation that never becomes a
      // finished request must not keep the model session open indefinitely.
      if (call.replyEndedAt && !call.playing && !state.responseActive) {
        const spokeSince = state.lastUserAt > call.replyEndedAt;
        if (!spokeSince && at - call.replyEndedAt > followUpMs) return call.end('idle');
        if (spokeSince && !call.turnSinceReply && at - call.replyEndedAt > chatterMs) return call.end('background-speech');
      }
      const limit = call.userTurns ? idleMs : initialIdleMs;
      if (at - call.lastActivityAt > limit) call.end('idle');
    };
    // Only firmware that exposes a volume control gets the spoken volume tool.
    const speaker = typeof ws.setVolume === 'function' ? {setVolume:async request => {
      const previous = volumeStore.get(device.id, device.volume);
      const volume = targetVolume(previous, request);
      const {confirmed} = await ws.setVolume(volume);
      const persisted = volumeStore.set(device.id, volume, device.volume);
      audit({type:'device.volume',voiceSessionId:call.id,deviceId:device.id,volume,previous,confirmed,persisted});
      return {volume,previous,confirmed,...(confirmed ? {} : {note:'音量指令已发出，音箱没有回执'})};
    }} : null;
    void (async () => {
      try {
        const reservation = await directVoice.reserve({model,sessionKey:device.sessionKey,voice:device.voice,surface:'speaker',inputSampleRate:DEVICE_INPUT_SAMPLE_RATE,speaker});
        call.id = reservation.voiceSessionId;
        audit({type:'device.call',voiceSessionId:call.id,stage:'start',deviceId:device.id,latencyMs:now() - call.startedAt});
        if (call.ended || ws.readyState !== 1) {await directVoice.close(call.id).catch(() => {});return;}
        call.client = new DeviceCallClient(call);
        if (!directVoice.attach(call.id, reservation.relayTicket, call.client)) throw Error('attach failed');
        sendJson(ws, {type:'call.started',voiceSessionId:call.id,model});
        call.timer = setInterval(call.tick, tickMs);call.timer.unref?.();
      } catch (error) {
        sendJson(ws, {type:'call.error',reason:'start',message:String(error?.message ?? '对话没有建立').slice(0,200)});
        call.reason = 'start-failed';
        if (call.id) await directVoice.close(call.id).catch(() => {});
        call.closed('start-failed');
      }
    })();
  }

  function onMessage(connection, data, binary) {
    const call = connection.call;
    if (binary) {
      // 16 kHz mono PCM16, at most 0.5 s per frame. Drop audio outside a call.
      if (!call?.client || call.ended || !data.length) return;
      if (data.length % 2 !== 0 || data.length > 16000) return connection.ws.close(1008, 'invalid audio frame');
      const at = now();
      if (call.lastInputAt) call.maxInputGapMs = Math.max(call.maxInputGapMs ?? 0, at - call.lastInputAt);
      call.lastInputAt = at;call.inputBytes += data.length;
      let sum = 0;for (let i = 0; i < data.length; i += 2) {const v = data.readInt16LE(i);sum += v * v;}
      const level = Math.sqrt(sum / (data.length / 2));
      if (!call.firstVoiceAt && call.readyAt) {
        if (level >= 450) {
          call.firstVoiceAt = at;
          audit({type:'device.call',voiceSessionId:call.id,stage:'input-speech',deviceId:connection.device.id,latencyMs:at - call.startedAt});
        }
      }
      // Calibrate a quiet hardware microphone independently of the phone path.
      // Unity is byte-for-byte passthrough; never modify the received WS buffer.
      let pcm = data;
      const gate = connection.device.noiseGateRms;
      if (gate) {
        // Count captured samples, not packet arrival time: network jitter must
        // not shorten the speech tail. Preserve soft endings for the hold.
        const hold = connection.device.noiseGateHoldMs * DEVICE_INPUT_SAMPLE_RATE / 1000;
        call.quietSamples = level >= gate ? 0 : (call.quietSamples ?? hold) + data.length / 2;
        if (call.quietSamples > hold) {pcm = Buffer.alloc(data.length);call.gatedInputBytes = (call.gatedInputBytes ?? 0) + data.length;}
      }
      if (pcm === data && connection.device.inputGain !== 1) {
        pcm = Buffer.allocUnsafe(data.length);
        for (let i = 0; i < data.length; i += 2) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data.readInt16LE(i) * connection.device.inputGain))), i);
      }
      call.client.emit('message', pcm, true);
      return;
    }
    let event;try {event = JSON.parse(data.toString());} catch {return connection.ws.close(1008, 'invalid event');}
    if (event.type === 'ping') return sendJson(connection.ws, {type:'pong',at:now()});
    if (event.type === 'hello') {connection.firmware = String(event.firmware ?? '').slice(0,80);return sendJson(connection.ws, {type:'hello',deviceId:connection.device.id,model:connection.device.model,models:connection.device.models});}
    if (event.type === 'call.start') return startCall(connection, event);
    if (!call) return;
    if (event.type === 'call.end') return call.end('device');
    if (event.type === 'playback.state' && typeof event.speaking === 'boolean') {
      if (call.playing && !event.speaking) {call.replyEndedAt = now();call.turnSinceReply = false;}
      call.playing = event.speaking;call.lastActivityAt = now();
    }
    if (event.type === 'input.activity') call.lastActivityAt = now();
    // The shared session validates these exactly as it does for browser relay.
    if (['playback.state','playback.drained','barge-in','playback.stats'].includes(event.type) && call.client) call.client.emit('message', Buffer.from(JSON.stringify(event)), false);
  }

  return {
    path,
    xiaozhiPath,
    otaPath,
    /** xiaozhi OTA check: hand the registered device its V WebSocket. */
    async handleOta(req, res) {
      const reply = (status, body) => {res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'});res.end(JSON.stringify(body));};
      if (!xiaozhiPublicUrl || !['GET','POST'].includes(req.method)) return reply(404, {error:'not found'});
      let size = 0, raw = '';
      for await (const chunk of req) {size += chunk.length;if (size > 16384) return reply(413, {error:'too large'});raw += chunk;}
      const mac = String(req.headers['device-id'] ?? '').toLowerCase();
      const device = mac ? devices.find(d => d.mac === mac && !d.disabled) : null;
      audit({type:'device.ota', voiceSessionId:'ota', deviceId:device?.id ?? 'unknown', known:Boolean(device)});
      if (!device) return reply(403, {error:'device not registered'});
      let version = '0.0.0';
      try {const body = raw ? JSON.parse(raw) : {};if (typeof body?.application?.version === 'string') version = body.application.version.slice(0, 40);} catch {}
      // Echo the running version so the firmware never self-upgrades from here,
      // and omit activation/mqtt so it goes straight to this WebSocket.
      reply(200, {server_time:{timestamp:now(), timezone_offset:480}, firmware:{version, url:''},
        websocket:{url:xiaozhiPublicUrl, token:device.otaToken, version:1}});
    },
    activeCalls: () => [...connections.values()].filter(c => c.call).length,
    busy: sessionKey => [...connections.values()].some(c => c.call && c.device.sessionKey === sessionKey),
    connected: () => [...connections.values()].map(c => ({deviceId:c.device.id,inCall:Boolean(c.call),connectedAt:c.connectedAt})),
    handleUpgrade(req, socket, head, {dialect = 'native'} = {}) {
      const device = authenticate(req);
      if (!device) {socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
      server.handleUpgrade(req, socket, head, raw => {
        // xiaozhi-esp32 firmware (e.g. StackChan) speaks its own protocol; the
        // wire adapter makes it an ordinary device connection for everything below.
        const ws = dialect === 'xiaozhi' ? createXiaozhiWire(raw, {volume:volumeStore.get(device.id, device.volume), outputGain:device.outputGain}) : raw;
        const old = connections.get(device.id);
        if (old) {old.call?.end('replaced');old.ws.close(4000, 'replaced');}
        const connection = {device,ws,call:null,connectedAt:now(),missed:0};
        connections.set(device.id, connection);
        // Any frame proves the device is alive. A speaker applying TCP
        // backpressure to a long reply can delay its pong, so allow misses.
        ws.on('pong', () => {connection.missed = 0;});
        const ping = setInterval(() => {
          if (++connection.missed > 3) return ws.terminate();
          try {ws.ping();} catch {}
        }, pingMs);ping.unref?.();
        ws.on('message', (data, binary) => {connection.missed = 0;try {onMessage(connection, data, binary);} catch {ws.close(1011, 'device event failed');}});
        ws.on('close', () => {clearInterval(ping);connection.call?.end('device-disconnected');if (connections.get(device.id) === connection) connections.delete(device.id);});
        ws.on('error', () => {});
        sendJson(ws, {type:'hello',deviceId:device.id,model:device.model,models:device.models});
      });
    },
    async dispose() {
      for (const connection of connections.values()) {connection.call?.end('server-stopping');connection.ws.close(1001, 'server stopping');}
      connections.clear();server.close();
    },
  };
}
