import {appendFileSync} from 'node:fs';
import {createDevicePlayout,DEVICE_PLAYOUT_MAX_BYTES} from './device-playout.mjs';
import {EventEmitter} from 'node:events';
import {createRobotDevice,probeRobot} from '../robot/robot-device.mjs';
import {createRobotReactionDriver} from '../robot/robot-reactions.mjs';
import {createXiaozhiWire} from './xiaozhi-wire.mjs';
import {createVolumeStore,targetVolume} from './device-volume.mjs';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {photoUpload,readLimitedBody,MAX_PHOTO_BYTES} from './device-vision.mjs';
import {createNearFieldGate,NEAR_FIELD_DEFAULT_DB} from './near-field-gate.mjs';

// A hardware speaker is one more Voice client. It owns only audio I/O, wake and
// local playback; model sessions, tools, tasks and endings stay in Voice.
export const DEVICE_MODELS = ['seeduplex','grok'];
export const DEVICE_INPUT_SAMPLE_RATE = 16000;
export const DEVICE_OUTPUT_SAMPLE_RATE = 24000;
// Said before a household speaker leaves a call that only heard room conversation.
export const BACKGROUND_LEAVE_LINE = '你们先聊，需要我再叫我';
// Said when the provider opened a user turn, the microphone has gone quiet, and
// the turn still has no text: ask again instead of waiting to be hung up.
export const UNHEARD_TURN_LINE = '刚才没听清，能再说一遍吗？';
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
    // How long V waits after a reply for the next request. A robot people chat
    // with needs longer than a household speaker answering one-off questions.
    const followUpMs = record.followUpMs ?? null;
    if (followUpMs !== null && (!Number.isInteger(followUpMs) || followUpMs < 5000 || followUpMs > 60000)) throw Error('Device follow-up window must be 5000-60000 ms');
    // Firmware with its own echo cancellation sends abort only once someone has
    // really started talking over V, so that abort may cancel the reply at once.
    if (record.deviceBargeIn !== undefined && typeof record.deviceBargeIn !== 'boolean') throw Error('deviceBargeIn must be true or false');
    // Streaming multi-speaker routing (anonymous in-call voices, Decision before
    // V answers). Off unless the record opts in; needs VOICE_STREAM_SPEAKER=1.
    if (record.multiSpeaker !== undefined && typeof record.multiSpeaker !== 'boolean') throw Error('multiSpeaker must be true or false');
    // Adaptive near-field gate: pass only speech this many dB above the learned
    // room background (TV, far voices). On by default with multiSpeaker; 0 = off.
    const nearFieldGateDb = record.nearFieldGateDb ?? (record.multiSpeaker === true ? NEAR_FIELD_DEFAULT_DB : 0);
    if (typeof nearFieldGateDb !== 'number' || !Number.isFinite(nearFieldGateDb) || nearFieldGateDb < 0 || nearFieldGateDb > 30) throw Error('nearFieldGateDb must be 0-30');
    devices.push(Object.freeze({deviceBargeIn:record.deviceBargeIn === true,followUpMs,multiSpeaker:record.multiSpeaker === true,nearFieldGateDb,inputGain,noiseGateRms,noiseGateHoldMs,playoutLeadMs,volume,outputGain,robot:record.robot === true,robotStatus:record.robotStatus === true,camera:record.camera === true,mac,otaToken:mac ? record.token : null,id:record.id,sessionKey:record.sessionKey,model,models:Object.freeze([...models]),voice:typeof record.voice === 'string' ? record.voice : undefined,tokenDigest:digest(record.token),disabled:record.disabled === true}));
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
  now = Date.now,idleMs = 15000,initialIdleMs = 12000,followUpMs = 10000,chatterMs = 30000,chatterSpeechGraceMs = 15000,toolHoldMs = 180000,
  staleSpeechMs = 6000,
  unheardTurnMs = 5000,inputSilentMs = 3000,inputLoudRms = 300,maxCallMs = 1800000,tickMs = 1000,pingMs = 20000,maxBufferedBytes = DEVICE_PLAYOUT_MAX_BYTES,stallMs = 20000,uplinkGapMs = 300,uplinkFillMs = 100,robotEvaluate = null,volumeStore = createVolumeStore(),visionPath = null,describeImage = null,backendDeviceURL = null}) {
  if (!/^\/[a-zA-Z0-9/_-]+$/u.test(path) || visionPath !== null && !/^\/[a-zA-Z0-9/_-]+$/u.test(visionPath)) throw Error('Invalid device path');
  const server = new wsModule.WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false});
  const connections = new Map(), firmwareReports = new Map(), creatingCalls = new Set(), closingCalls = new Set();
  let visionOperations = 0;
  let admissionBlocked = () => false;
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
  // Same origin the device reached for its WebSocket: the configured public URL
  // when there is one (a device may omit the port from Host), else the Host header.
  const visionUrl = req => {
    if (xiaozhiPublicUrl) {const url = new URL(xiaozhiPublicUrl);return `${url.protocol === 'ws:' ? 'http:' : 'https:'}//${url.host}${visionPath}`;}
    const host = String(req.headers.host ?? '');
    return `${/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host) ? 'http' : 'https'}://${host}${visionPath}`;
  };

  function startCall(connection, request = {}) {
    const {device, ws} = connection;
    if (admissionBlocked()) return sendJson(ws, {type:'call.error',reason:'updating',message:'V 正在更新，请稍后再试'});
    if (connection.call) return sendJson(ws, {type:'call.error',reason:'busy',message:'上一次对话还没有结束'});
    if (isSessionBusy(device.sessionKey) || [...connections.values()].some(c => c !== connection && c.call && c.device.sessionKey === device.sessionKey)) return sendJson(ws, {type:'call.error',reason:'session-busy',message:'这个会话正在另一台设备上通话'});
    const model = request.model === undefined ? device.model : request.model;
    if (!device.models.includes(model)) return sendJson(ws, {type:'call.error',reason:'model',message:'这个音箱没有开放该语音模型'});
    const call = {connection,model,startedAt:now(),readyAt:0,lastActivityAt:now(),replyEndedAt:0,userTurns:0,outputBytes:0,inputBytes:0,playing:false,ended:false,client:null,id:null,timer:null,
      tools:new Map(),lastAudioAt:0,speechSince:0,lastLoudInputAt:0,askedAgainFor:0,
      // V's own side of the exchange: what a tool hold is measured from, so
      // room speech alone cannot keep a hold open.
      lastExchangeAt:now()};
    const touch = () => {call.lastActivityAt = call.lastExchangeAt = now();};
    connection.call = call;
    if (device.nearFieldGateDb) call.nearField = createNearFieldGate({gateDb:device.nearFieldGateDb,sampleRate:DEVICE_INPUT_SAMPLE_RATE});
    call.playout = createDevicePlayout({now,maxBytes:maxBufferedBytes,maxLeadMs:device.playoutLeadMs,bufferedBytes:()=>ws.bufferedAmount,
      sendAudio:pcm=>{if(ws.readyState===1){call.outputBytes+=pcm.length;call.lastActivityAt=now();ws.send(pcm,{binary:true});}},
      sendEvent:event=>sendJson(ws,event)});
    // A robot face reacts to the same shared session events. Reactions to V's
    // own speech follow the queued audio; reactions to the user go at once.
    call.robot = device.robot ? createRobotReactionDriver({evaluate:robotEvaluate,status:device.robotStatus,
      send:event=>event.beat?.startsWith('assistant')?call.playout.event(event):sendJson(ws,event),
      audit:event=>audit({...event,voiceSessionId:call.id,deviceId:device.id})}) : null;
    call.fromSession = raw => {
      if (call.ended) return;
      let event;try {event = JSON.parse(raw);} catch {return;}
      if (call.robot && (event.type === 'transcript' || event.type?.startsWith('tool.'))) call.robot.observe(event.failed ? {...event,type:'tool.error'} : event);
      // Multi-speaker routing: an admitted turn is the user's finished request;
      // any tracked voice (TV, room talk) only counts as room speech.
      if (event.type === 'speaker.admitted' && typeof event.turn?.text === 'string') {
        call.lastActivityAt = now();call.userTurns++;call.turnSinceReply = true;
        call.robot?.observe({type:'transcript',role:'user',text:event.turn.text,final:true});
        return;
      }
      if (event.type === 'speaker.identity' || event.type === 'speaker.utterance') {call.roomSpeechAt = now();return;}
      if (event.type === 'audio') {
        const pcm = Buffer.from(String(event.audio ?? ''), 'base64');
        if (!pcm.length || ws.readyState !== 1) return;
        // The parting line is played as ordinary speech: speakers must not barge
        // on it, since it is only said while the room is full of chatter.
        if (!call.playout.push(pcm,{backendSpeech:event.source==='injected-speech' && !call.leaving})) return call.end('slow-playback');
        touch();call.lastAudioAt = call.lastExchangeAt;
        return;
      }
      if (event.type === 'ready') {
        call.readyAt = now();call.lastActivityAt = call.lastExchangeAt = call.readyAt;
        audit({type:'device.call',voiceSessionId:call.id,stage:'ready',deviceId:device.id,latencyMs:call.readyAt - call.startedAt});
        return sendJson(ws, {type:'call.ready',voiceSessionId:call.id,model,inputSampleRate:DEVICE_INPUT_SAMPLE_RATE,outputSampleRate:DEVICE_OUTPUT_SAMPLE_RATE});
      }
      if (event.type === 'transcript') {
        // Transcript text stays in Voice's private audit; the speaker needs none.
        if (event.role === 'user') call.lastActivityAt = now();else touch();
        // Someone answering a failed lookup has taken the turn; V replies to that.
        if (event.role === 'user' && event.final) {call.userTurns++;call.turnSinceReply = true;}
        return;
      }
      if (event.type === 'tool.call' || event.type === 'tool.progress') {
        touch();
        if (event.type === 'tool.call') {
          if (event.name !== 'delegate_to_v' && typeof event.callId === 'string') {
            call.tools.set(event.callId, event.name);
          }
        }
        return sendJson(ws, {type:'busy',active:true});
      }
      if (event.type === 'tool.result' || event.type === 'tool.error') {
        touch();call.tools.delete(event.callId);
        // The wait is not the room's turn: follow-up and chatter windows start
        // again when the last result is back, not from the "我查一下" clip.
        if (!call.tools.size) {
          call.replyEndedAt = call.lastExchangeAt;call.turnSinceReply = false;
        }
        return sendJson(ws, {type:'busy',active:false});
      }
      if (event.type === 'error') return sendJson(ws, {type:'call.error',reason:'voice',message:String(event.message ?? '').slice(0,200)});
      if (FORWARDED.has(event.type)) {
        touch();
        if(event.type==='audio.clear')call.playout.clear();
        if(event.type==='audio.done'||event.type==='end.after-playback') {
          call.playout.event({type:event.type,...(typeof event.callId==='string'?{callId:event.callId}:{})});return;
        }
        return sendJson(ws, {type:event.type,...(typeof event.callId === 'string' ? {callId:event.callId} : {})});
      }
    };
    call.closed = reason => {
      if (call.ended) return;
      call.ended = true;call.capture?.controller.abort();call.robotDevice?.close();clearInterval(call.timer);clearInterval(call.fillTimer);call.playout.dispose();call.robot?.dispose();
      if (connection.call === call) connection.call = null;
      if (call.id) audit({type:'device.call',voiceSessionId:call.id,stage:'closed',deviceId:device.id,reason:call.reason ?? reason,
        durationMs:now() - call.startedAt,inputBytes:call.inputBytes,outputBytes:call.outputBytes,userTurns:call.userTurns,gatedInputBytes:call.gatedInputBytes ?? 0,maxInputGapMs:call.maxInputGapMs ?? 0,...(call.nearField ? {nearField:call.nearField.summary()} : {})});
      sendJson(ws, {type:'call.closed',reason:call.reason ?? reason});
    };
    call.end = reason => {
      if (call.ended) return;
      call.reason ??= reason;
      if (call.client) {call.client.close();closingCalls.add(call);void directVoice.close(call.id).catch(() => {}).finally(()=>closingCalls.delete(call));}
      else call.closed(reason);
    };
    call.tick = () => {
      if (call.ended) return;
      const state = directVoice.activity(call.id);
      if (!state) return call.end('session-ended');
      const at = now();
      // A speaker that stopped reading its socket would hold the session forever.
      if (call.playout.stalledMs() > stallMs) return call.end('slow-playback');
      // Leaving: the parting line plays first; never wait on it for long.
      if (call.leaving) {if (at - call.leaving.at > 10000) call.end(call.leaving.reason);return;}
      if (call.playout.pendingBytes() || state.userSpeaking || state.responseActive || state.playing || call.playing) call.lastActivityAt = at;
      if (state.lastUserAt > call.lastActivityAt) call.lastActivityAt = state.lastUserAt;
      // When the utterance now in progress began (repeated onsets do not move it).
      call.speechSince = state.userSpeaking ? call.speechSince || at : 0;
      if (at - call.startedAt > maxCallMs) return call.end('max-duration');
      if (!call.readyAt) {if (at - call.startedAt > 45000) call.end('connect-timeout');return;}
      // V may speak a host line only into a gap: nothing playing or being
      // generated, and nobody just started talking. An utterance that has run
      // for seconds with no new onset, or whose microphone has gone quiet, is a
      // stuck ASR turn or the TV, not someone addressing V.
      const micQuiet = at - call.lastLoudInputAt >= inputSilentMs;
      const gap = !call.playing && !state.playing && !state.responseActive && !call.playout.pendingBytes()
        && (state.userSpeaking ? at - state.lastUserAt > staleSpeechMs || micQuiet : at - state.lastUserAt > 1200);
      // Tool calls and delegated work are quiet but real activity. Hold every
      // ending rule while they run, bounded by V's own last sign of life.
      if (state.pendingTools || state.backgroundTask) {
        if (at - call.lastExchangeAt > toolHoldMs) call.end('idle');
        return;
      }
      // Shared result recovery owns the answer window, including failed lookups.
      if (state.awaitingToolAnswer) return;
      // The provider opened a user turn that never produced text although the
      // microphone has been quiet for seconds: ask once, rather than wait.
      // Under multi-speaker routing the provider only hears speculative input,
      // and the routing layer owns re-asking (silent for unattributed room talk).
      if (!call.multiSpeaker && state.userSpeaking && call.speechSince && call.askedAgainFor !== call.speechSince && at - call.speechSince >= unheardTurnMs && micQuiet && gap) {
        call.askedAgainFor = call.speechSince;
        const spoken = Boolean(directVoice.say?.(call.id, UNHEARD_TURN_LINE));
        audit({type:'device.unheard-turn',voiceSessionId:call.id,deviceId:device.id,openMs:at - call.speechSince,spoken});
        return;
      }
      // A turn still being spoken or transcribed is never ended under the
      // speaker: let it finish (bounded from its onset) before any window applies.
      if (state.userSpeaking && call.speechSince && at - call.speechSince < chatterSpeechGraceMs) return;
      // A household speaker has a follow-up window: after V finishes speaking,
      // someone must start talking soon. Room conversation that never becomes a
      // finished request must not keep the model session open indefinitely.
      if (call.replyEndedAt && !call.playing && !state.responseActive) {
        const spokeSince = Math.max(state.lastUserAt, call.roomSpeechAt ?? 0) > call.replyEndedAt;
        if (!spokeSince && at - call.replyEndedAt > (device.followUpMs ?? followUpMs)) return call.end('idle');
        if (spokeSince && !call.turnSinceReply && at - call.replyEndedAt > chatterMs) {
          // Say why before leaving, so the household is not left with a silent exit.
          if (directVoice.say?.(call.id, BACKGROUND_LEAVE_LINE)) call.leaving = {reason:'background-speech', at, spoke:false};
          else call.end('background-speech');
          return;
        }
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
    // Only a camera device given this call's vision token can look. The photo
    // goes from the firmware to handleVision; its answer comes back as the MCP result.
    const look = typeof ws.takePhoto === 'function' ? async ({question}, options = {}) => {
      if (connection.looking) throw Error('正在拍照，请稍等');
      if (call.ended || connection.call !== call || options.signal?.aborted) throw Error('call_retired');
      const requestId = options.requestId ?? randomUUID(), started = now();
      const capture = {call, requestId, controller:new AbortController(), claimed:false,
        deadline:Math.min(options.deadline ?? started + 15000, started + 15000), description:null,
        question:String(question ?? '画面里有什么？').trim().slice(0,350)};
      capture.wireQuestion = `v-robot-request:${requestId}\n${capture.question}`;
      const abort = () => capture.controller.abort();
      options.signal?.addEventListener('abort', abort, {once:true});
      const timer = setTimeout(abort, Math.max(1,capture.deadline-now()));timer.unref?.();
      connection.looking = call.capture = capture;
      try {
        await ws.takePhoto(capture.wireQuestion, {signal:capture.controller.signal, timeoutMs:capture.deadline-now()});
        if (capture.controller.signal.aborted || now() >= capture.deadline || call.ended || connection.call !== call || !capture.description) throw Error('photo_receipt_missing_or_expired');
        audit({type:'device.look',voiceSessionId:call.id,deviceId:device.id,ok:true,latencyMs:now() - started});
        return {description:capture.description,source:'robot-camera',requestId,capturedAt:capture.receivedAt,
          note:'描述来自本次机器人照片，由看图模型生成。看不清时说明限制，不补充照片外的事实。'};
      } catch (error) {
        audit({type:'device.look',voiceSessionId:call.id,deviceId:device.id,ok:false,latencyMs:now() - started});
        throw error;
      } finally {
        clearTimeout(timer);abort();options.signal?.removeEventListener('abort', abort);
        if (connection.looking === capture) connection.looking = null;
        if (call.capture === capture) call.capture = null;
      }
    } : null;
    const deviceTools = speaker || look ? {...speaker,...(look ? {look:(args,_callId,signal)=>look(args,{signal})} : {})} : null;
    creatingCalls.add(call);
    void (async () => {
      try {
        const probe = device.robot && typeof ws.callTool==='function' ? await probeRobot({wire:ws,camera:Boolean(look)}) : null;
        if (call.ended || connection.call !== call || ws.readyState!==1) return;
        const terminalAdapter = probe ? {kind:'robot',capabilities:()=>probe.capabilities,
          execute:(operation,args,options)=>call.robotDevice?.execute(operation,args,options)??Promise.resolve({status:'failed',reason:'device_unbound'})} : null;
        const reservation = await directVoice.reserve({...(terminalAdapter?{terminalAdapter,backendDeviceURL:typeof backendDeviceURL==='function'?backendDeviceURL():backendDeviceURL}:{}),model,sessionKey:device.sessionKey,voice:device.voice,surface:'speaker',inputSampleRate:DEVICE_INPUT_SAMPLE_RATE,speaker:deviceTools,inputPolicy:device.multiSpeaker?'speaker':'native'});
        call.id = reservation.voiceSessionId;
        if (probe) {
          call.robotDevice = createRobotDevice({wire:ws,voiceSessionId:call.id,probe,look,now,
            isCurrent:()=>!call.ended&&connection.call===call&&connections.get(device.id)===connection&&ws.readyState===1});
          const motionAvailable = probe.capabilities['robot.move'].status==='available';
          if (!await call.robotDevice.bind() && motionAvailable) throw Error('robot_binding_failed');
        }
        // Routing is real only when the server has it and the model supports it.
        call.multiSpeaker = Boolean(reservation.speakerRouting);
        audit({type:'device.call',voiceSessionId:call.id,stage:'start',deviceId:device.id,latencyMs:now() - call.startedAt,...(device.multiSpeaker ? {multiSpeaker:call.multiSpeaker} : {})});
        if (call.ended || ws.readyState !== 1) {await directVoice.close(call.id).catch(() => {});return;}
        call.client = new DeviceCallClient(call);
        if (!directVoice.attach(call.id, reservation.relayTicket, call.client)) throw Error('attach failed');
        sendJson(ws, {type:'call.started',voiceSessionId:call.id,model});
        call.timer = setInterval(call.tick, tickMs);call.timer.unref?.();
        // The device stops its uplink while V speaks. Routing's cloud ASR and
        // voice tracker expect one continuous stream, so fill gaps with silence.
        if (call.multiSpeaker) {call.fillTimer = setInterval(() => {
          if (call.ended || !call.readyAt || !call.client || now() - (call.lastInputAt ?? call.readyAt) < uplinkGapMs) return;
          call.client.emit('message', Buffer.alloc(uplinkFillMs * DEVICE_INPUT_SAMPLE_RATE / 500), true);
        }, uplinkFillMs);call.fillTimer.unref?.();}
      } catch (error) {
        sendJson(ws, {type:'call.error',reason:'start',message:String(error?.message ?? '对话没有建立').slice(0,200)});
        call.reason = 'start-failed';
        if (call.id) await directVoice.close(call.id).catch(() => {});
        call.closed('start-failed');
      } finally {creatingCalls.delete(call);}
    })();
  }

  function onMessage(connection, data, binary) {
    const call = connection.call;
    if (binary) {
      // 16 kHz mono PCM16, at most 0.5 s per frame. Drop audio outside a call.
      if (!call?.client || call.ended || !data.length) return;
      // Routing accepts audio only once it is bound (the session's ready event).
      if (call.multiSpeaker && !call.readyAt) return;
      if (data.length % 2 !== 0 || data.length > 16000) return connection.ws.close(1008, 'invalid audio frame');
      const at = now();
      if (call.lastInputAt) call.maxInputGapMs = Math.max(call.maxInputGapMs ?? 0, at - call.lastInputAt);
      call.lastInputAt = at;call.inputBytes += data.length;
      let sum = 0;for (let i = 0; i < data.length; i += 2) {const v = data.readInt16LE(i);sum += v * v;}
      const level = Math.sqrt(sum / (data.length / 2));
      if (level >= Math.max(inputLoudRms, connection.device.noiseGateRms)) call.lastLoudInputAt = at;
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
      // Far, continuous voices (a TV across the room) become silence before ASR,
      // the voice tracker and the model; the person at the device passes.
      if (pcm === data && call.nearField && !call.nearField.pass(level, data.length / 2)) {pcm = Buffer.alloc(data.length);call.gatedInputBytes = (call.gatedInputBytes ?? 0) + data.length;}
      if (pcm === data && connection.device.inputGain !== 1) {
        pcm = Buffer.allocUnsafe(data.length);
        for (let i = 0; i < data.length; i += 2) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data.readInt16LE(i) * connection.device.inputGain))), i);
      }
      // Debug only (off unless VOICE_DEVICE_DUMP_DIR is set): raw uplink per call
      // for diagnosing device audio processing. Never enable in normal use.
      if (process.env.VOICE_DEVICE_DUMP_DIR) {
        try {appendFileSync(`${process.env.VOICE_DEVICE_DUMP_DIR}/${call.id}.pcm`, pcm);} catch {}
      }
      call.client.emit('message', pcm, true);
      return;
    }
    let event;try {event = JSON.parse(data.toString());} catch {return connection.ws.close(1008, 'invalid event');}
    if (event.type === 'ping') return sendJson(connection.ws, {type:'pong',at:now()});
    if (event.type === 'hello') {connection.firmware = String(event.firmware ?? '').replace(/[^a-zA-Z0-9._+-]/g,'').slice(0,80) || null;if(connection.firmware)firmwareReports.set(connection.device.id,{version:connection.firmware,reportedAt:now()});return sendJson(connection.ws, {type:'hello',deviceId:connection.device.id,model:connection.device.model,models:connection.device.models});}
    if (event.type === 'call.start') return startCall(connection, event);
    if (!call) return;
    if (event.type === 'call.end') return call.end('device');
    if (event.type === 'playback.state' && typeof event.speaking === 'boolean') {
      if (call.playing && !event.speaking) {call.replyEndedAt = now();call.turnSinceReply = false;}
      call.playing = event.speaking;call.lastActivityAt = call.lastExchangeAt = now();
      if (call.leaving) {if (event.speaking) call.leaving.spoke = true;else if (call.leaving.spoke) call.end(call.leaving.reason);}
    }
    if (event.type === 'input.activity') call.lastActivityAt = now();
    // The shared session validates these exactly as it does for browser relay.
    if (event.type === 'barge-in' && call.leaving) return;  // never cut the parting line
    // Whether a barge-in is confirmed speech is the device record's call, never the frame's.
    if (event.type === 'barge-in') event = {type:'barge-in',deviceId:connection.device.id,...(connection.device.deviceBargeIn ? {confirmed:true} : {})};
    if (['playback.state','playback.drained','barge-in','playback.stats'].includes(event.type) && call.client) call.client.emit('message', Buffer.from(JSON.stringify(event)), false);
  }

  return {
    path,
    xiaozhiPath,
    otaPath,
    visionPath:describeImage ? visionPath : null,
    /** Photo upload from a camera device's take_photo, during that device's look. */
    async handleVision(req, res) {
      const reply = (status, body) => {if (!res.headersSent) {res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'});res.end(JSON.stringify(body));}req.resume();};
      if (!describeImage || req.method !== 'POST') return reply(404, {success:false, message:'not found'});
      const match = /^Bearer ([A-Za-z0-9._~+/=-]{32,256})$/u.exec(String(req.headers.authorization ?? ''));
      let connection = null;
      if (match) {
        const presented = digest(match[1]);
        for (const c of connections.values()) if (c.visionDigest && timingSafeEqual(c.visionDigest, presented)) connection = c;
      }
      // The token is per channel, and only valid while V is waiting for this photo.
      const capture = connection?.looking, call = capture?.call;
      const current = () => capture && !capture.controller.signal.aborted && now() < capture.deadline && !call.ended && connection.call === call && connection.looking === capture;
      if (!current()) return reply(401, {success:false, message:'unauthorized'});
      visionOperations++;
      try {
      let upload;
      try {upload = photoUpload(await readLimitedBody(req,MAX_PHOTO_BYTES,capture.controller.signal), req.headers['content-type']);}
      catch (error) {return reply(error?.status ?? 400, {success:false, message:error?.status === 413 ? '照片太大' : '照片格式不对'});}
      if (!current() || capture.claimed || upload.question !== capture.wireQuestion) return reply(409, {success:false, message:'stale_or_duplicate_photo'});
      capture.claimed = true;capture.receivedAt = now();
      const started = now();
      try {
        const result = String(await describeImage({...upload,question:capture.question,signal:capture.controller.signal})).trim().slice(0,600);
        if (!current() || !result) return reply(409, {success:false,message:'photo_expired'});
        capture.description = result;
        audit({type:'device.vision',voiceSessionId:call.id,deviceId:connection.device.id,ok:true,photoBytes:upload.image.length,latencyMs:now() - started});
        reply(200, {success:true, result});
      } catch (error) {
        audit({type:'device.vision',voiceSessionId:call.id,deviceId:connection.device.id,ok:false,photoBytes:upload.image.length,latencyMs:now() - started,error:String(error?.message ?? error).slice(0,200)});
        reply(200, {success:false, message:'看图服务暂时没有结果'});
      }
      } finally {visionOperations--;}
    },
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
      let version = '0.0.0', reported = null;
      try {const body = raw ? JSON.parse(raw) : {};if (typeof body?.application?.version === 'string') {version = body.application.version.slice(0, 40);reported=version.replace(/[^a-zA-Z0-9._+-]/g,'');}} catch {}
      if(reported)firmwareReports.set(device.id,{version:reported,reportedAt:now()});
      // Echo the running version so the firmware never self-upgrades from here,
      // and omit activation/mqtt so it goes straight to this WebSocket.
      reply(200, {server_time:{timestamp:now(), timezone_offset:480}, firmware:{version, url:''},
        websocket:{url:xiaozhiPublicUrl, token:device.otaToken, version:1}});
    },
    setBackendDeviceURL: value => {backendDeviceURL=value;},
    setAdmissionGate: gate => {admissionBlocked = gate;},
    pendingOperations: () => creatingCalls.size + closingCalls.size + visionOperations + [...connections.values()].filter(c => c.looking).length,
    inventory: () => devices.filter(d=>!d.disabled).map(d => ({id:d.id,kind:d.robot?'robot':'speaker',
      connected:connections.has(d.id),inCall:Boolean(connections.get(d.id)?.call),
      model:d.model,inputPolicy:d.multiSpeaker?'speaker':'native',
      firmware:firmwareReports.get(d.id) ?? null})),
    activeCalls: () => [...connections.values()].filter(c => c.call).length,
    busy: sessionKey => [...connections.values()].some(c => c.call && c.device.sessionKey === sessionKey),
    connected: () => [...connections.values()].map(c => ({deviceId:c.device.id,inCall:Boolean(c.call),connectedAt:c.connectedAt})),
    handleUpgrade(req, socket, head, {dialect = 'native'} = {}) {
      if (admissionBlocked()) {socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
      const device = authenticate(req);
      if (!device) {socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
      server.handleUpgrade(req, socket, head, raw => {
        // xiaozhi-esp32 firmware (e.g. StackChan) speaks its own protocol; the
        // wire adapter makes it an ordinary device connection for everything below.
        // A camera device gets a fresh vision token per channel (one channel is one call).
        const vision = dialect === 'xiaozhi' && device.camera && describeImage && visionPath ? {url:visionUrl(req),token:randomBytes(24).toString('base64url')} : null;
        const ws = dialect === 'xiaozhi' ? createXiaozhiWire(raw, {volume:volumeStore.get(device.id, device.volume), outputGain:device.outputGain, vision}) : raw;
        const old = connections.get(device.id);
        if (old) {old.call?.end('replaced');old.ws.close(4000, 'replaced');}
        const connection = {device,ws,call:null,connectedAt:now(),missed:0,looking:null,visionDigest:vision ? digest(vision.token) : null};
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
