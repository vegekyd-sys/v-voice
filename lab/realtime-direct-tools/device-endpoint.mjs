import {appendFileSync} from 'node:fs';
import {createDevicePlayout,DEVICE_PLAYOUT_MAX_BYTES} from './device-playout.mjs';
import {EventEmitter} from 'node:events';
import {createRobotReactionDriver} from '../robot/robot-reactions.mjs';
import {createXiaozhiWire} from './xiaozhi-wire.mjs';
import {createVolumeStore,targetVolume} from './device-volume.mjs';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {photoAnswer,photoUpload,readLimitedBody} from './device-vision.mjs';

// A hardware speaker is one more Voice client. It owns only audio I/O, wake and
// local playback; model sessions, tools, tasks and endings stay in Voice.
export const DEVICE_MODELS = ['seeduplex','grok'];
export const DEVICE_INPUT_SAMPLE_RATE = 16000;
export const DEVICE_OUTPUT_SAMPLE_RATE = 24000;
// Said before a household speaker leaves a call that only heard room conversation.
export const BACKGROUND_LEAVE_LINE = '你们先聊，需要我再叫我';
// Said when a lookup failed and V itself stayed silent, so the room is never left
// waiting for an answer that will not come. A failed tool started nothing.
export const TOOL_FAILURE_LINE = '这个刚才没查成，要不要我交给后台再试试？';
// Said when a lookup's result is back but V never started answering it (an ASR
// turn the provider opened right after the result can swallow the reply). The
// result is already in the model's context, so a "yes" gets the answer.
export const TOOL_RESULT_PROMPT_LINE = '结果查到了，要我现在说说吗？';
// Said when the provider opened a user turn, the microphone has gone quiet, and
// the turn still has no text: ask again instead of waiting to be hung up.
export const UNHEARD_TURN_LINE = '刚才没听清，能再说一遍吗？';
// Controls and delegation are not lookups; their failures are not "没查成".
const NOT_LOOKUPS = new Set(['delegate_to_v','end_call','cancel_task','openclaw_agent_control','send_task_updates','set_speaker_volume','look','show_content']);
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
    devices.push(Object.freeze({deviceBargeIn:record.deviceBargeIn === true,followUpMs,inputGain,noiseGateRms,noiseGateHoldMs,playoutLeadMs,volume,outputGain,robot:record.robot === true,robotStatus:record.robotStatus === true,camera:record.camera === true,mac,otaToken:mac ? record.token : null,id:record.id,sessionKey:record.sessionKey,model,models:Object.freeze([...models]),voice:typeof record.voice === 'string' ? record.voice : undefined,tokenDigest:digest(record.token),disabled:record.disabled === true}));
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
  toolProgressMs = 4000,toolProgressRepeatMs = 15000,toolProgressMax = 3,toolFailureMs = 4000,staleSpeechMs = 6000,
  resultSilenceMs = 8000,unheardTurnMs = 5000,inputSilentMs = 3000,inputLoudRms = 300,maxCallMs = 1800000,tickMs = 1000,pingMs = 20000,maxBufferedBytes = DEVICE_PLAYOUT_MAX_BYTES,stallMs = 20000,robotEvaluate = null,volumeStore = createVolumeStore(),visionPath = null,describeImage = null}) {
  if (!/^\/[a-zA-Z0-9/_-]+$/u.test(path) || visionPath !== null && !/^\/[a-zA-Z0-9/_-]+$/u.test(visionPath)) throw Error('Invalid device path');
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
  // Same origin the device reached for its WebSocket: the configured public URL
  // when there is one (a device may omit the port from Host), else the Host header.
  const visionUrl = req => {
    if (xiaozhiPublicUrl) {const url = new URL(xiaozhiPublicUrl);return `${url.protocol === 'ws:' ? 'http:' : 'https:'}//${url.host}${visionPath}`;}
    const host = String(req.headers.host ?? '');
    return `${/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host) ? 'http' : 'https'}://${host}${visionPath}`;
  };

  function startCall(connection, request = {}) {
    const {device, ws} = connection;
    if (connection.call) return sendJson(ws, {type:'call.error',reason:'busy',message:'上一次对话还没有结束'});
    if (isSessionBusy(device.sessionKey) || [...connections.values()].some(c => c !== connection && c.call && c.device.sessionKey === device.sessionKey)) return sendJson(ws, {type:'call.error',reason:'session-busy',message:'这个会话正在另一台设备上通话'});
    const model = request.model === undefined ? device.model : request.model;
    if (!device.models.includes(model)) return sendJson(ws, {type:'call.error',reason:'model',message:'这个音箱没有开放该语音模型'});
    const call = {connection,model,startedAt:now(),readyAt:0,lastActivityAt:now(),replyEndedAt:0,userTurns:0,outputBytes:0,inputBytes:0,playing:false,ended:false,client:null,id:null,timer:null,
      // Native lookups still running (callId -> name). Background delegation is
      // tracked by the session itself and is never narrated from here.
      tools:new Map(),waitStartedAt:0,notices:0,lastNoticeAt:0,failure:null,answerDue:null,lastAudioAt:0,speechSince:0,lastLoudInputAt:0,askedAgainFor:0,
      // V's own side of the exchange: what a tool hold is measured from, so
      // room speech alone cannot keep a hold open.
      lastExchangeAt:now()};
    const touch = () => {call.lastActivityAt = call.lastExchangeAt = now();};
    connection.call = call;
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
        if (event.role === 'user' && event.final) {call.userTurns++;call.turnSinceReply = true;call.failure = call.answerDue = null;}
        return;
      }
      if (event.type === 'tool.call' || event.type === 'tool.progress') {
        touch();
        if (event.type === 'tool.call') {
          call.failure = call.answerDue = null;
          if (event.name !== 'delegate_to_v' && typeof event.callId === 'string') {
            if (!call.tools.size) {call.waitStartedAt = now();call.notices = 0;}
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
          const lookup = !NOT_LOOKUPS.has(event.name) && !event.cancelled;
          if (lookup && (event.failed || event.type === 'tool.error')) call.failure = {at:call.lastExchangeAt,name:event.name};
          else if (lookup) call.answerDue = {at:call.lastExchangeAt,name:event.name};
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
        // A slow lookup gets a short "still looking" line, spaced and capped.
        const due = call.notices ? call.lastNoticeAt + toolProgressRepeatMs : call.waitStartedAt + toolProgressMs;
        if (call.tools.size && call.notices < toolProgressMax && at >= due && gap) {
          const played = Boolean(directVoice.progressNotice?.(call.id, call.notices));
          audit({type:'device.tool-progress',voiceSessionId:call.id,deviceId:device.id,index:call.notices,played,waitedMs:at - call.waitStartedAt});
          call.notices++;call.lastNoticeAt = at;
        }
        if (at - call.lastExchangeAt > toolHoldMs) call.end('idle');
        return;
      }
      // A lookup failed and V has not said anything since: say so, rather than
      // leaving the room in silence until the follow-up window hangs up.
      if (call.failure) {
        if (call.lastAudioAt > call.failure.at || at - call.failure.at > toolFailureMs + 20000) call.failure = null;
        else {
          if (at - call.failure.at >= toolFailureMs && gap) {
            const spoken = Boolean(directVoice.say?.(call.id, TOOL_FAILURE_LINE));
            audit({type:'device.tool-failure-notice',voiceSessionId:call.id,deviceId:device.id,tool:call.failure.name,spoken});
            call.failure = null;
          }
          return;
        }
      }
      // A result is back but V has not started answering it. Never hang up on it.
      if (call.answerDue) {
        if (call.lastAudioAt > call.answerDue.at || at - call.answerDue.at > resultSilenceMs + 20000) call.answerDue = null;
        else {
          if (at - call.answerDue.at >= resultSilenceMs && gap) {
            const spoken = Boolean(directVoice.say?.(call.id, TOOL_RESULT_PROMPT_LINE));
            audit({type:'device.tool-result-prompt',voiceSessionId:call.id,deviceId:device.id,tool:call.answerDue.name,spoken});
            call.answerDue = null;
          }
          return;
        }
      }
      // The provider opened a user turn that never produced text although the
      // microphone has been quiet for seconds: ask once, rather than wait.
      if (state.userSpeaking && call.speechSince && call.askedAgainFor !== call.speechSince && at - call.speechSince >= unheardTurnMs && micQuiet && gap) {
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
        const spokeSince = state.lastUserAt > call.replyEndedAt;
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
    const look = typeof ws.takePhoto === 'function' ? async ({question}) => {
      if (connection.looking) throw Error('正在拍照，请稍等');
      connection.looking = call;
      const started = now();
      try {
        const description = photoAnswer(await ws.takePhoto(question));
        audit({type:'device.look',voiceSessionId:call.id,deviceId:device.id,ok:true,latencyMs:now() - started});
        return {description,source:'robot-camera',note:'这是机器人摄像头刚拍到的画面，由看图模型描述。只能按这段描述回答，不要补充描述里没有的内容。'};
      } catch (error) {
        audit({type:'device.look',voiceSessionId:call.id,deviceId:device.id,ok:false,latencyMs:now() - started,error:String(error?.message ?? error).slice(0,200)});
        throw error;
      } finally {
        if (connection.looking === call) connection.looking = null;
      }
    } : null;
    const deviceTools = speaker || look ? {...speaker,...(look ? {look} : {})} : null;
    void (async () => {
      try {
        const reservation = await directVoice.reserve({model,sessionKey:device.sessionKey,voice:device.voice,surface:'speaker',inputSampleRate:DEVICE_INPUT_SAMPLE_RATE,speaker:deviceTools});
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
    if (event.type === 'hello') {connection.firmware = String(event.firmware ?? '').slice(0,80);return sendJson(connection.ws, {type:'hello',deviceId:connection.device.id,model:connection.device.model,models:connection.device.models});}
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
      const call = connection?.looking;
      if (!call || call.ended || connection.call !== call) return reply(401, {success:false, message:'unauthorized'});
      let upload;
      try {upload = photoUpload(await readLimitedBody(req), req.headers['content-type']);}
      catch (error) {return reply(error?.status ?? 400, {success:false, message:error?.status === 413 ? '照片太大' : '照片格式不对'});}
      const started = now();
      try {
        const result = await describeImage(upload);
        audit({type:'device.vision',voiceSessionId:call.id,deviceId:connection.device.id,ok:true,photoBytes:upload.image.length,latencyMs:now() - started});
        reply(200, {success:true, result});
      } catch (error) {
        audit({type:'device.vision',voiceSessionId:call.id,deviceId:connection.device.id,ok:false,photoBytes:upload.image.length,latencyMs:now() - started,error:String(error?.message ?? error).slice(0,200)});
        reply(200, {success:false, message:'看图服务暂时没有结果'});
      }
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
