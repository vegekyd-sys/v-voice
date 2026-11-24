import {createImprovPlayer} from "./improv-player.mjs";
import {phoneModelOptions} from "./model-options.mjs";
import {installTvHost,tvDefaultModel} from "./tv-host.mjs";
import {captureTvArray,hasTvArrayCapture,warmTvAudio,tvArraySupportsModel} from "./tv-array-capture.mjs";
import {createFeishuConfirmation} from "./feishu-confirmation-client.mjs";
import {browserDeviceActions,createBrowserDeviceAdapter} from "./device-location.mjs";
import { createCallerContext } from "./caller-context.mjs";
import { entryStartup, startVoiceEntry, markVoiceTiming } from "./entry-startup.mjs";
import { createAvatarTasks } from "./avatar-state.mjs";
import { createAvatarReactions } from "./avatar-reactions.mjs";
import { createAvatarTelemetry } from "./avatar-telemetry.mjs";
import { createBoardClient, createLessonGate, createSpokenCursor, readEventStream, spokenRate } from "./board-client.mjs";
import { createAssetsClient } from "./board-assets-client.mjs";
import { speaksOf, spokenProgress, unspoken, withCuesToCome } from "./board-scene.mjs";
import { mountAvatar } from "./avatar.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { createContentView } from "./content-view.mjs";
import { createCallView, VOICE_SLOTS } from "./call-view.mjs";
import { mountCallUi } from "./ui-bundle.mjs";
import { createTranscriptPresentation } from "./transcript-presentation.mjs";
import { createPageMicrophoneSession } from "./microphone-session.mjs";
import { createCallSounds } from "./call-sounds.mjs";
import { createH5DuplexPlaybackGate } from "./duplex-playback.mjs";
import { createRelayAudio } from "./relay-audio.mjs";
import { createDialConnection } from "./dial-connection.mjs";
import { createScreenWakeLock } from "./screen-wake-lock.mjs";
import { mountChangelog } from "./changelog.mjs";
import { createSpeakerGate, createSpeakerFixture } from "./speaker-routing.mjs";

const $ = (id) => document.getElementById(id);
// app.js is the call engine; everything the page shows is written to this view
// and rendered by the React UI. Audio elements and the reader stay in the HTML.
const view = createCallView();
const tvHost=installTvHost({view,window,actions:{dial:()=>startCall(),end:()=>stopCall(),mute:()=>setMuted(!view.get().muted),speaker:()=>setOutputMuted(!view.get().outputMuted)},onError:error=>setStatus(error.message,{tone:'error'})});
if(tvHost)warmTvAudio();
const contentView = document.querySelector ? createContentView(document, window, { onReading: reading => view.set({ reading }) }) : null;
const renderAssistant = (target, item) => {
  // With the call board on, a delivered document stays a card in the
  // conversation: the reader would cover the picture V is talking over.
  if (contentView) contentView.render(target, item, { auto: item.document === true && !call?.board && (!tvHost || view.get().tvLayout==='full'), inline: !tvHost || view.get().tvLayout === 'full' });
  else renderMarkdown(target, item.text, document);
};
if (document.querySelector) mountCallUi(document, view, {
  renderAssistant, onDocumentShown: callId => documentShown(callId),
  loadBoardPhoto: Object.assign(query => loadBoardPhoto(query), {missing: query => loadBoardPhoto.missing(query)}),
  // The call's shelf of made things: the caller's tap on one, and a picture reported as on screen.
  boardWorks: {visible: ids=>call?.boardAssets?.visible(ids), pick: (id, hold) => call?.boardAssets?.pick(id, hold), shown: (id, ratio) => call?.boardAssets?.shown(id, ratio), save: item => saveBoardPicture(item)},
  actions: {
    uploadReference: async file => {
      const active=call;
      if (!active?.voiceSessionId || !file) return;
      if (file.size>8*1024*1024) return setStatus('请选择小于 8 MB 的图片',{tone:'problem'});
      setStatus('正在添加参考图');
      try {
        const url=new URL(apiUrl('reference-image'),document.baseURI);
        url.searchParams.set('call',active.voiceSessionId);
        const response=await fetch(url,{method:'POST',body:file,headers:{'content-type':file.type}});
        if (!response.ok) throw Error((await response.json()).error);
        if(call===active){active.boardAssets?.poke?.();setStatus('参考图已放到画布上',{tone:'success'});}
      } catch(error){if(call===active)setStatus(error.message||'添加参考图失败',{tone:'problem'});}
    },
    toggleImprovSound: () => call?.improv?.toggleSound(),
    endImprov: () => call?.improv?.finish(),
    openBinding: () => void openIosBinding(),
    connectIdentity: () => { guestDialAllowed=false;void confirmation.start(); },
    skipConfirmation: () => void skipConfirmation(),
    createBinding: () => void createIosBinding(),
    copyBinding: () => void copyIosBinding(),
    revokeBinding: id => void revokeIosBinding(id),
    closeSessionSheet: () => { view.set({ sessionSheet:null }); const url=new URL(window.location.href);url.searchParams.delete('call');window.history.replaceState(null,'',url); },
    dial: () => { redials = 0; void startCall(); }, hangup: () => void stopCall(),
    redial: () => void stopCall().then(() => startCall()),
    resume: () => void recoverPlaybackGesture(),
    steer: text => sendSteer(text), cancelTasks: () => cancelTasks(),
    // Toggle from the store, not the last render, so quick taps alternate.
    mute: () => setMuted(!view.get().muted),
    speaker: () => setOutputMuted(!view.get().outputMuted),
    compose: open => view.set(state => ({ composer: { ...state.composer, open } })),
    composerOpen: () => view.get().composer.open,
    chooseModel: id => { if (view.get().models.some(model => model.id === id && model.available)) view.set({ model: id }); },
    chooseGrokVoice: id => view.set(state => ({ grok: { ...state.grok, voice: id } })),
    // The caller's voice for a model (Settings): kept in this browser, sent with the next dial.
    chooseVoice: (model, id) => { const slot = VOICE_SLOTS[model]; if (!slot || !view.get()[slot.state].voices.some(voice => voice.id === id)) return; try { localStorage.setItem(slot.storage, id); } catch {} view.set(state => ({ [slot.state]: { ...state[slot.state], voice: id } })); },
  },
});
if (document.querySelector) mountChangelog(document, window);
let microphoneSession = createPageMicrophoneSession();
let call = null;
let starting = null;
let avatarDiagnosticOwner = null;
let liveReady = false;
let boardAvailable = false, improvAvailable = false;
let entryError = null;
let callerEntry = "tianyi";
let preferredPhoneInputPolicy = null;
let webDialVersion = null, dialGreeting = false;
const speakerCandidate=()=>document.body?.dataset?.speakerRouting==='true';
function speakerEvent(value){
  if(!speakerCandidate())return;
  if(value.type==='turn.done'&&value.turn?.role==='assistant'||value.type==='audio.done')document.body.dataset.speakerAnswerDone='true';
  const {audio,delta,...safe}=value;
  let events;try{events=JSON.parse(document.body.dataset.speakerEvents??'[]');}catch{events=[];}
  events.push({...safe,at:performance.now(),...audio?{audioBytes:Math.floor(audio.length*.75)}:{}});document.body.dataset.speakerEvents=JSON.stringify(events.slice(-300));
  if(value.type?.startsWith('speaker.'))view.speakerEvent(value);
  if(value.type==='speaker.decision')document.body.dataset.speakerState=JSON.stringify({participants:value.participants,targetId:value.targetId,mode:value.mode,shouldRespond:value.shouldRespond,addresseeIds:value.addresseeIds,timings:value.timings});
  if(['speaker.utterance','speaker.decision'].includes(value.type))renderTranscript(presentation.consume(value));
}
const phoneEntry = new URLSearchParams(window.location.search).get("phone");
let guestDialAllowed=new URLSearchParams(window.location.search).get('guest')==='1';
const apiUrl = route => `./api/${route}?${phoneEntry ? `phone=${encodeURIComponent(phoneEntry)}` : `entry=${callerEntry}`}`;
const duplexRecoveryMessage = "上一段语音还没确认结束。若仍无声音，请结束通话后重新开始。";
const playbackRecoveryMessage = "声音播放被暂停了，点一下页面恢复声音。";
const greetingGraceMs = 15000;
const presentation = createTranscriptPresentation();
const tasks = createAvatarTasks();
const avatar = typeof window.Image === "function" ? mountAvatar(document, window, {owner:()=>call?.voiceSessionId,onDisplayed:event=>call?.avatarTelemetry?.display(event)}) : null;
const screenWakeLock = createScreenWakeLock({ navigator, document, onState: state => { document.body.dataset.screenWakeLock = state; } });
function setCallState(state) {
  if(state==='connected'&&call?.fixture&&!call.fixtureStarted){call.fixtureStarted=true;const owner=call;setTimeout(()=>{if(call===owner)owner.fixture.start();},1500);}
  if (state === "connected" && document.body.dataset.callState === "dialing") markVoiceTiming("voice.connection.ready");
  screenWakeLock.setActive(state !== 'idle');
  const live = ["connected", "ending"].includes(state);
  view.set(current => ({ call: state, callStartedAt: live ? current.callStartedAt ?? Date.now() : null,
    ...(live ? {} : { composer: { ...current.composer, open: false }, muted: false, outputMuted: false }) }));
  if (!live) document.body.dataset.microphoneMuted = "false";
  if (document.body.dataset.callState === state) return;
  document.body.dataset.callState = state;
}
function setVoiceState(state) {
  document.body.dataset.voiceState = state;
  view.voice(state);
}
function setMuted(muted) {
  if (!call?.stream) return;
  for (const track of call.stream.getAudioTracks()) track.enabled = !muted;
  document.body.dataset.microphoneMuted = String(muted);
  view.set({ muted });
}
function setOutputMuted(outputMuted) {
  if (!call) return;
  call.relay?.setOutputMuted(outputMuted);
  call.improv?.setOutputMuted(outputMuted);
  $("remoteAudio").muted = outputMuted || Boolean(call.duplex?.snapshot().localPlaybackMuted);
  view.set({outputMuted});
}
// The last full sentence, for the few places that compare it; the view keeps
// its short display form for the one status line.
let statusText = "拨号后，直接说话。";
const setStatus = (text, { tone = "info" } = {}) => {
  statusText = text;
  view.message(text, tone);
};
function duplexDiagnostic(active, entry) {
  if (call !== active) return;
  const counts = active.duplexDiagnostics.counts;
  counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  if (entry.type === "activity-window") {
    if (entry.remoteActive) counts.remoteActiveFrames = (counts.remoteActiveFrames ?? 0) + 1;
    if (entry.appliedMuted) counts.appliedMutedFrames = (counts.appliedMutedFrames ?? 0) + 1;
    if (entry.remoteActive && entry.appliedMuted) counts.remoteActiveWhileMutedFrames = (counts.remoteActiveWhileMutedFrames ?? 0) + 1;
    active.duplexDiagnostics.latestActivity = entry;
  } else {
    active.duplexDiagnostics.transitions.push(entry);
    if (active.duplexDiagnostics.transitions.length > 128) active.duplexDiagnostics.transitions.shift();
  }
  active.duplexDiagnostics.events.push(entry);
  if (active.duplexDiagnostics.events.length > 1200) active.duplexDiagnostics.events.shift();
}
function playbackState(active) {
  const audio = $("remoteAudio");
  return { requestedMuted: active.duplex.snapshot().localPlaybackMuted,
    appliedMuted: audio.muted, paused: audio.paused, volume: audio.volume,
    readyState: audio.readyState, audioContextState: active.context?.state ?? "absent",
    mode: active.duplex.snapshot().mode, interruptionOwner: active.duplex.snapshot().interruptionOwner };
}
function connectedStatus(active) {
  if (active.playbackNeedsGesture) setStatus(playbackRecoveryMessage);
  else if (active.duplexRecoveryNotice) setStatus(duplexRecoveryMessage);
  else if (active.ending) setStatus("正在结束通话…");
  else setStatus("V 正在听，直接说话就好");
}
async function greetWhenReady(active) {
  if(active.fixture||active.speakerGate||active.callerContext?.pending)return;
  if (call !== active || active.greetingPending || active.greetingRequested || active.greetingSuppressed
    || active.greetingExpired || active.ending
    || active.pc?.connectionState !== "connected" || active.context?.state !== "running"
    || $("remoteAudio").paused || active.playbackNeedsGesture) return;
  // WebRTC may be connected before the backend's native sideband sees
  // session.started. Bound elapsed readiness time, not a handful of retries.
  const now = performance.now();
  if (active.greetingDeadlineAt === undefined) {
    active.greetingDeadlineAt = now + greetingGraceMs;
    active.greetingDeadlineTimer = setTimeout(() => {
      if (call !== active || active.greetingRequested || active.greetingSuppressed) return;
      active.greetingExpired = true;
      clearTimeout(active.greetingRetryTimer);
      active.greetingAbort?.abort();
      duplexDiagnostic(active, { type: "greeting-ready-expired", at: performance.now(), attempts: active.greetingAttempts ?? 0 });
    }, greetingGraceMs);
  }
  if (now >= active.greetingDeadlineAt) return;
  clearTimeout(active.greetingRetryTimer);
  active.greetingRetryTimer = null;
  active.greetingPending = true; active.greetingAttempts = (active.greetingAttempts ?? 0) + 1;
  const controller = new AbortController(); active.greetingAbort = controller;
  duplexDiagnostic(active, { type: "greeting-ready-attempt", at: now, attempt: active.greetingAttempts });
  try {
    const result = await api("ready", { voiceSessionId: active.voiceSessionId }, { signal: controller.signal });
    if (call === active && !active.greetingSuppressed && !active.greetingExpired && !active.ending
      && performance.now() < active.greetingDeadlineAt && result.ok === true) {
      active.greetingRequested = true;
      clearTimeout(active.greetingDeadlineTimer);
      duplexDiagnostic(active, { type: "greeting-ready-accepted", at: performance.now(), attempt: active.greetingAttempts });
    }
  } catch {
    // A rejected readiness request cannot manufacture a greeting or close a
    // working call. The user can still speak; the host operation is idempotent.
  } finally {
    active.greetingPending = false;
    if (active.greetingAbort === controller) active.greetingAbort = null;
    if (call === active && !active.greetingRequested && !active.greetingSuppressed && !active.greetingExpired && !active.ending) {
      const remaining = active.greetingDeadlineAt - performance.now();
      if (remaining > 0) active.greetingRetryTimer = setTimeout(() => void greetWhenReady(active), Math.min(1000, 250 * active.greetingAttempts, remaining));
    }
  }
}
function suppressGreetingForCaller(active) {
  if (active.greetingRequested || active.greetingSuppressed) return;
  active.greetingSuppressed = true;
  clearTimeout(active.greetingRetryTimer); clearTimeout(active.greetingDeadlineTimer);
  active.greetingAbort?.abort();
  duplexDiagnostic(active, { type: "greeting-suppressed-caller-start", at: performance.now() });
}
function cancelAutomaticEnd(active) {
  if (!active.ending) return;
  clearTimeout(active.ending.timeout); active.ending = null;
  setCallState("connected");
  view.set({ badge: "通话中" });
  connectedStatus(active);
}
function endCallRequest(active, requestId, originUserTurnId) {
  if (typeof requestId !== "string" || !requestId || typeof originUserTurnId !== "string"
    || !originUserTurnId || active.latestNativeUserTurnId !== originUserTurnId) return null;
  active.endRequests ??= new Map();
  let request = active.endRequests.get(requestId);
  if (request && (request.invalidated || request.originUserTurnId !== originUserTurnId)) return null;
  if (!request) {
    request = { requestId, originUserTurnId, at: performance.now(), providerObserved: false,
      accepted: false, invalidated: false, turnId: null, terminalAt: null,
      audioObserved: false, quietSince: null, lastSampleAt: null };
    active.endRequests.set(requestId, request);
    if (active.endRequests.size > 32) active.endRequests.delete(active.endRequests.keys().next().value);
  }
  return request;
}
function armAutomaticEnd(active, request) {
  if (call !== active || request.invalidated || !request.accepted || !request.providerObserved
    || active.latestNativeUserTurnId !== request.originUserTurnId || active.ending) return;
  active.ending = request;
  setCallState("ending");
  view.set({ badge: "正在结束" }); connectedStatus(active);
  // Silence or a timer alone is not proof of a delivered farewell. Keep the
  // manual button available if transport/playback evidence never arrives.
  request.timeout = setTimeout(() => {
    if (call !== active || active.ending !== request) return;
    setStatus("语音尚未确认播完，可以点按钮结束通话。");
  }, 15000);
}
function requestVoiceHostEnd(active,value){
  if(call!==active||value.source!=='voice_host_control'||value.closeAfterPlayback!==true||typeof value.userText!=='string'||typeof value.requestId!=='string')return;
  active.pendingVoiceEnd=value;applyVoiceHostEnd(active);
}
function applyVoiceHostEnd(active){
 const value=active.pendingVoiceEnd;
 if(!value||value.userText!==active.nativeUserText||!active.latestNativeUserTurnId||active.microphoneQuietSince==null||performance.now()-active.microphoneQuietSince<600||performance.now()-(active.nativeUserTextAt??performance.now())<1200)return;
 if(value.type==='voice.end.proposed'){
  if(active.confirmingVoiceEnd===value.requestId)return;
  active.confirmingVoiceEnd=value.requestId;
  void api('call-control-confirm',{voiceSessionId:active.voiceSessionId,control:value}).then(accepted=>{
   if(call!==active||active.pendingVoiceEnd!==value||active.nativeUserText!==value.userText||active.microphoneQuietSince==null)return;
   active.pendingVoiceEnd=accepted;applyVoiceHostEnd(active);
  }).catch(()=>{if(active.pendingVoiceEnd===value)active.pendingVoiceEnd=null;}).finally(()=>{if(active.confirmingVoiceEnd===value.requestId)active.confirmingVoiceEnd=null;});
  return;
 }
 active.pendingVoiceEnd=null;
 const request=endCallRequest(active,value.requestId,active.latestNativeUserTurnId);if(!request)return;
 request.accepted=true;request.providerObserved=true;request.voiceHostPath=true;request.expectedFarewell='再见下次聊';
 // GPT Live may append the requested farewell inside its already-open turn.
 const current=active.nativeAssistantPlayback?.get(active.currentNativeAssistantTurnId);
 if(current&&current.terminalAt===null)request.turnId=active.currentNativeAssistantTurnId;
 request.userText=value.userText;active.endNativeRequestId=request.requestId;armAutomaticEnd(active,request);
 if(active.channel?.readyState==='open')active.channel.send(JSON.stringify({type:'session.context.append',event_id:'voice-farewell-'+value.requestId,content:[{type:'input_text',text:'当前用户已经明确结束这次电话。停止旧结果播报，只说一句：再见，下次聊。然后安静等待主机关闭。'}],channel:'speakable'}));
}
function requestAutomaticEnd(active, value) {
  if (call !== active || value.name !== "openclaw_end_call" || value.closeAfterPlayback !== true) return;
  const backendPath = value.source === "backend_model_client_tool";
  if (backendPath) {
    if (value.status !== "accepted" || value.nativeDelegationId !== value.requestId ||
      value.backendToolCallId !== value.callId || !/^call_[a-zA-Z0-9_.:-]{1,155}$/.test(value.callId ?? "") ||
      !/^[a-zA-Z0-9_.:-]{1,256}$/.test(value.backendRunId ?? "") ||
      !Number.isSafeInteger(value.delegationGeneration) || value.delegationGeneration < 1 ||
      !active.completedNativeUserTurns?.has(value.originUserTurnId)) return;
    if (value.nativeAssistantTurnIdAtAcceptance !== undefined &&
      !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value.nativeAssistantTurnIdAtAcceptance)) return;
  } else if (value.callId !== value.requestId) return;
  const request = endCallRequest(active, value.requestId, value.originUserTurnId);
  if (!request) return;
  if (request.accepted && request.backendPath &&
    (request.backendToolCallId !== value.backendToolCallId || request.backendRunId !== value.backendRunId)) return;
  if (backendPath && !request.accepted) {
    request.backendPath = true; request.source = value.source;
    request.backendToolCallId = value.backendToolCallId; request.backendRunId = value.backendRunId;
    request.delegationGeneration = value.delegationGeneration;
    // An ordinary consult acknowledgment before host acceptance is not farewell.
    request.turnId = null; request.terminalAt = null; request.audioObserved = false; request.quietSince = null;
    const observed = active.nativeCallControlDelegations?.get(value.nativeDelegationId);
    request.providerObserved = observed?.originUserTurnId === value.originUserTurnId;
    if (request.providerObserved) active.endNativeRequestId = request.requestId;
    // The provider can append goodbye to an already open assistant turn.
    // Only the authenticated host may identify that turn at tool acceptance.
    const played = active.nativeAssistantPlayback?.get(value.nativeAssistantTurnIdAtAcceptance);
    if (played?.originUserTurnId === request.originUserTurnId) {
      request.turnId = value.nativeAssistantTurnIdAtAcceptance;
      for (const field of ["terminalAt", "audioObserved", "quietSince", "lastSampleAt"]) request[field] = played[field];
    }
  }
  request.accepted = true;
  armAutomaticEnd(active, request);
}
function observeNativeEndDelegation(active, item) {
  if (item?.type !== "delegation" || item.target !== "client" || !Array.isArray(item.content)
    || item.content.length !== 1 || item.content[0].type !== "input_text" ||
    typeof item.content[0].text !== "string" || typeof item.id !== "string" ||
    typeof item.user_bidi_turn_id !== "string") return;
  active.nativeCallControlDelegations ??= new Map();
  active.nativeCallControlDelegations.set(item.id, { originUserTurnId: item.user_bidi_turn_id });
  if (active.nativeCallControlDelegations.size > 256) active.nativeCallControlDelegations.delete(active.nativeCallControlDelegations.keys().next().value);
  const backendRequest = active.endRequests?.get(item.id);
  if (backendRequest?.backendPath && backendRequest.accepted && !backendRequest.invalidated &&
    backendRequest.originUserTurnId === item.user_bidi_turn_id && active.latestNativeUserTurnId === item.user_bidi_turn_id) {
    backendRequest.providerObserved = true; active.endNativeRequestId = backendRequest.requestId;
    armAutomaticEnd(active, backendRequest);
    return;
  }
  let input;
  try { input = JSON.parse(item.content[0].text); } catch { return; }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2
    || input.name !== "openclaw_end_call" || !input.arguments || typeof input.arguments !== "object"
    || Array.isArray(input.arguments) || Object.keys(input.arguments).length !== 0) return;
  const request = endCallRequest(active, item.id, item.user_bidi_turn_id);
  if (!request) return;
  request.providerObserved = true;
  active.endNativeRequestId = request.requestId;
  armAutomaticEnd(active, request);
}
function observeAutomaticEnd(active, at, energy) {
  const audio = $("remoteAudio");
  const played = active.nativeAssistantPlayback?.get(active.currentNativeAssistantTurnId);
  if (played) {
    if (played.lastSampleAt !== null && at - played.lastSampleAt > 125) played.quietSince = null;
    played.lastSampleAt = at;
    if (active.context?.state !== "running" || audio.paused || audio.muted || active.playbackNeedsGesture) played.quietSince = null;
    else if (energy > .003) { played.audioObserved = true; played.quietSince = null; }
    else if (played.terminalAt !== null && played.audioObserved) played.quietSince ??= at;
  }
  // Keep the genuine native farewell observation even if the host SSE travels
  // slower than WebRTC. It authorizes closing only when both proofs join.
  const ending = active.endRequests?.get(active.endNativeRequestId);
  if (!ending || ending.invalidated || !ending.providerObserved || !ending.turnId || call !== active) return;
  if (ending.lastSampleAt !== null && at - ending.lastSampleAt > 125) ending.quietSince = null;
  ending.lastSampleAt = at;
  if (active.context?.state !== "running" || audio.paused || audio.muted || active.playbackNeedsGesture) {
    ending.quietSince = null; return;
  }
  if (energy > .003) { ending.audioObserved = true; ending.quietSince = null; return; }
  if (ending.terminalAt === null || !ending.audioObserved) return;
  ending.quietSince ??= at;
  if (at - ending.quietSince < 750 || !ending.accepted || active.ending !== ending) return;
  duplexDiagnostic(active, { type: "model-end-call-playback-drained", at,
    requestId: ending.requestId, originUserTurnId: ending.originUserTurnId, turnId: ending.turnId,
    ...(ending.backendPath ? { source: ending.source, backendToolCallId: ending.backendToolCallId,
      backendRunId: ending.backendRunId, nativeDelegationId: ending.requestId } : {}) });
  void stopCall();
}
async function startRemotePlayback(active, source) {
  if (call !== active) return false;
  const audio = $("remoteAudio");
  // Invoke play in the gesture's synchronous stack; awaiting context.resume
  // first can lose browser user activation. This does not unmute a local gate.
  try {
    const playing = audio.play();
    await playing;
    if (call !== active) return false;
    active.playbackAudioBlocked = false;
    active.playbackNeedsGesture = Boolean(active.playbackContextBlocked);
    duplexDiagnostic(active, { type: "playback-started", at: performance.now(), source, ...playbackState(active) });
    if (source === "gesture" || statusText === playbackRecoveryMessage) connectedStatus(active);
    void greetWhenReady(active);
    return true;
  } catch (error) {
    if (call !== active) return false;
    active.playbackAudioBlocked = true;
    active.playbackNeedsGesture = true;
    duplexDiagnostic(active, { type: "playback-rejected", at: performance.now(), source,
      errorName: error?.name ?? "Error", ...playbackState(active) });
    setStatus(playbackRecoveryMessage);
    return false;
  }
}
async function recoverPlaybackGesture() {
  const active = call;
  if (!active) return;
  if (active.relay) {
    try { await active.context.resume(); if (call === active && active.context.state === "running") setStatus("V 正在听，直接说话就好"); }
    catch { if (call === active) setStatus("轻点页面恢复声音播放。"); }
    return;
  }
  if (!$("remoteAudio").srcObject || !active.playbackNeedsGesture) return;
  const playing = startRemotePlayback(active, "gesture");
  try {
    await active.context?.resume();
    if (call !== active) return;
    active.playbackContextBlocked = active.context?.state === "suspended";
    active.playbackNeedsGesture = Boolean(active.playbackAudioBlocked || active.playbackContextBlocked);
    duplexDiagnostic(active, { type: "context-resumed", at: performance.now(), source: "gesture", ...playbackState(active) });
    if (!active.playbackNeedsGesture) connectedStatus(active);
    void greetWhenReady(active);
  } catch (error) {
    if (call !== active) return;
    active.playbackContextBlocked = true;
    active.playbackNeedsGesture = true;
    duplexDiagnostic(active, { type: "context-resume-rejected", at: performance.now(), source: "gesture", errorName: error?.name ?? "Error", ...playbackState(active) });
    setStatus(playbackRecoveryMessage);
  }
  await playing;
}
async function api(route, payload, { signal, keepalive = false } = {}) {
  const response = await fetch(apiUrl(route), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}), signal, keepalive,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "连接暂时不可用");
  return result;
}
document.addEventListener?.('visibilitychange',()=>{call?.avatarReactions?.resume();if(document.hidden)void call?.avatarTelemetry?.flush();});
window.addEventListener?.('pagehide',()=>call?.avatarTelemetry?.close());
function avatarContext(snapshot = presentation.snapshot()) {
  call?.avatarReactions?.update({snapshot,activity:tasks.pose,
    taskOutcome:tasks.size ? 'pending' : tasks.completion ? tasks.completion.ok ? 'success' : 'error' : 'none'});
}
function taskState() {
  view.set({ tasks: tasks.list(), cancelEnabled: tasks.size > 0 });
  void avatar?.show(tasks.pose, tasks.completion);
  document.body.dataset.avatarState = tasks.size > 1 ? "very-busy" : tasks.size ? "busy" : "idle";
  avatarContext();
}
function receiveDocument(active,value){
  if(call!==active||value.voiceSessionId!==active.voiceSessionId)return;
  renderTranscript(presentation.consume(value));
}
// Saving what is being looked at on the board (ui/board-viewer.jsx): a made thing from its own link, a
// found photograph from the copy the page already holds. Where the browser will not hand the file over,
// the original is opened instead, as for a picture in the conversation.
async function saveBoardPicture(item) {
  const title = String(item.name || '作品').replace(/[\\/:*?"<>|]/gu, '-').slice(0, 80) || '作品';
  let url = item.src, made = null, type = '';
  try {
    const response = await fetch(item.src, /^https:/u.test(item.src) ? { credentials: 'omit', referrerPolicy: 'no-referrer' } : undefined);
    if (!response.ok) throw new Error('download failed');
    const blob = await response.blob();
    type = blob.type; made = url = URL.createObjectURL(blob);
  } catch {
    if (!/^https:/u.test(item.src)) return '没存成';
    window.open(item.src, '_blank', 'noopener,noreferrer');
    return '已打开原文件';
  }
  const kind = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' })[type.split(';')[0]] ?? (item.kind === 'video' ? 'mp4' : 'jpg');
  const link = document.createElement('a');
  link.href = url; link.download = `${title}.${kind}`; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(made), 60000);
  return '已保存';
}
// A photograph on the board: fetched once per call through the Voice service
// and handed to the page as a local object URL (null when there is none).
// "There is none" (404) is kept for the call. A lookup that could not be made
// (503: the image search refused or timed out; or the network) is tried once
// more after a pause, and if it still fails it is not kept, so the next time
// the page asks for it (a gallery drawn again) it is looked for again.
const BOARD_PHOTO_RETRY_MS = 2500;
function loadBoardPhoto(query) {
  const active = call;
  if (!active?.board || typeof query !== 'string') return Promise.resolve(null);
  active.boardPhotos ??= new Map();
  active.boardPhotosMissing ??= new Set();
  if (!active.boardPhotos.has(query)) {
    const ask = () => fetch(apiUrl('board-image'), { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceSessionId: active.voiceSessionId, query }) })
      .then(async response => response.ok ? {url: URL.createObjectURL(await response.blob())} : {none: response.status === 404})
      .catch(() => ({none: false}));
    const pending = ask()
      .then(result => result.url || result.none || call !== active ? result : new Promise(resolve => setTimeout(resolve, BOARD_PHOTO_RETRY_MS)).then(() => call === active ? ask() : result))
      .then(result => {
        // (A photograph the page now has is on the call's shelf: the shelf is asked again so it can be picked and saved.)
        if (result.url) { active.boardAssets?.poke(); return result.url; }
        if (result.none) active.boardPhotosMissing.add(query);
        else if (active.boardPhotos.get(query) === pending) active.boardPhotos.delete(query);
        return null;
      });
    active.boardPhotos.set(query, pending);
  }
  return active.boardPhotos.get(query);
}
// Whether the service has said there is no picture for this query in this call.
loadBoardPhoto.missing = query => Boolean(call?.boardPhotosMissing?.has(query));
// The UI reports a document row once it is actually on screen.
function documentShown(callId){
  const active=call;
  if(!active?.voiceSessionId||typeof callId!=='string')return;
  active.shownDocuments??=new Set();
  if(active.shownDocuments.has(callId))return;
  active.shownDocuments.add(callId);
  void api('content-shown',{voiceSessionId:active.voiceSessionId,callId}).catch(()=>{});
}
function startPresentationRecovery(active,applyNativeControl=()=>{}){
    // Authenticated recovery is shared by native and relay transports.
    const refreshPresentation = async () => {
      if (call !== active || active.presentationFetching) return;
      active.presentationFetching = true;
      active.presentationAbort ??= new AbortController();
      try {
        const response = await fetch(apiUrl('presentation') + `&after=${active.documentRevision ?? 0}&controlsAfter=${active.controlRevision ?? 0}`, { signal: active.presentationAbort.signal });
        if (!response.ok) return;
        const value = await response.json();
        if (call !== active || value.voiceSessionId !== active.voiceSessionId ||
          !Number.isSafeInteger(value.revision) || value.revision < (active.presentationRevision ?? 0)) return;
        for(const item of value.controls ?? []) {
          if(item.voiceSessionId !== active.voiceSessionId || !Number.isSafeInteger(item.revision) || item.revision <= (active.controlRevision ?? 0))continue;
          applyNativeControl(item); active.controlRevision = item.revision;
        }
        tasks.clear();
        for (const item of value.pending ?? []) tasks.consume(item);
        for (const item of value.documents ?? []) receiveDocument(active,item);
        active.presentationRevision = value.revision;
        active.documentRevision = value.revision;
        taskState();
      } catch { /* A transient presentation failure never closes the audio call. */ }
      finally { active.presentationFetching = false; }
    };
    active.presentationPoll = setInterval(() => void refreshPresentation(), 1500);
    void refreshPresentation();
 }
function renderTranscript(snapshot) {
  const all = [...snapshot.history, ...snapshot.current];
  document.body.dataset.conversation = all.some(item => item.text?.trim()) ? "started" : "empty";
  view.set({ transcript: snapshot });
  avatarContext(snapshot);
  call?.board?.update({ snapshot });
}
function resetTranscript() {
  contentView?.reset(); presentation.reset();
  if(speakerCandidate())delete document.body.dataset.speakerState;
  view.set({ speaker: { multi: false, people: [], lastSpeakerId: null, listenOnly: false, status: null }, thinkingAt: null });
  renderTranscript(presentation.snapshot());
}
function reportNativeCaller(active,final=false){
 if(call!==active||!active.nativeUserText||!active.latestNativeUserTurnId)return;
 const revision=active.callControlCaptionRevision=(active.callControlCaptionRevision??0)+1;
 void api('call-control-input',{voiceSessionId:active.voiceSessionId,revision,turnId:active.latestNativeUserTurnId,text:active.nativeUserText.slice(-2400),final}).catch(()=>{});
}
function updateNativeUserText(active,text){
 const next=text.trim();if(next===active.nativeUserText)return;
 active.nativeUserText=next;active.nativeUserTextAt=performance.now();reportNativeCaller(active);
 if(active.pendingVoiceEnd&&active.pendingVoiceEnd.userText!==next)active.pendingVoiceEnd=null;
 const request=active.endRequests?.get(active.endNativeRequestId);
 if(request?.voiceHostPath&&request.userText!==next){request.invalidated=true;active.endNativeRequestId=null;cancelAutomaticEnd(active);}
}
function providerMessage(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  const active = call;
  active?.callerContext?.observe(data);
  active?.speakerGate?.observe(data);
  if(speakerCandidate()&&['session.started','session.context.appended','turn.created','turn.done','error'].includes(data.type))speakerEvent(data);
  if (active && data.type === "session.started") void greetWhenReady(active);
  if (active && ((["turn.created", "turn.done"].includes(data.type) && data.turn?.role === "user")
    || (data.type === "input_transcript.added" && typeof data.item?.text === "string" && data.item.text.trim()))) suppressGreetingForCaller(active);
  if (active && data.type === "delegation.created") observeNativeEndDelegation(active, data.item);
  if (active && data.type === "turn.done" && data.turn?.role === "user" &&
    data.turn.id === active.latestNativeUserTurnId && typeof data.turn.transcript === "string" && data.turn.transcript.trim()) {
    active.completedNativeUserTurns ??= new Set(); active.completedNativeUserTurns.add(data.turn.id);
    active.completedNativeUserText=data.turn.transcript.trim();updateNativeUserText(active,data.turn.transcript);reportNativeCaller(active,true);applyVoiceHostEnd(active);
    view.thinking();
    if (active.completedNativeUserTurns.size > 256) active.completedNativeUserTurns.delete(active.completedNativeUserTurns.values().next().value);
  }
  if (active && data.type === "turn.created" && ["user", "assistant"].includes(data.turn?.role)) {
    const at = performance.now();
    duplexDiagnostic(active, { type: "native-turn-created", at, role: data.turn.role });
    if (data.turn.role === "user") {
      const old=active.nativeAssistantPlayback?.get(active.currentNativeAssistantTurnId);
      if(active.backendFinalReady&&old?.audioObserved&&(old.terminalAt===null||at-old.terminalAt<250)&&active.channel?.readyState==='open'){
        active.channel.send(JSON.stringify({type:'session.context.append',channel:'developer',content:[{type:'input_text',text:'The caller has interrupted the previous spoken reply. Its remaining speech plan is permanently retired, including any backend result reading. Never resume or append that old answer after the caller finishes. Respond only to the latest caller turn. This is silent host state, not a request to speak or cancel backend work.'}]}));
        duplexDiagnostic(active,{type:'native-speech-plan-retired',at,turnId:active.currentNativeAssistantTurnId});
      }
      active.backendFinalReady=false;
      active.nativeAssistantPlayback?.clear(); active.currentNativeAssistantTurnId = null;
      active.completedNativeUserText=null;active.pendingVoiceEnd=null;active.nativeUserText='';active.microphoneQuietSince=null;
      active.latestNativeUserTurnId = typeof data.turn.id === "string" ? data.turn.id : null;
      updateNativeUserText(active,data.turn.transcript??'');
      for (const request of active.endRequests?.values() ?? []) request.invalidated = true;
      active.endNativeRequestId = null;
      active.duplex.notifyUserTurnStarted(at);
      // A caller who starts a new turn during the farewell keeps the line.
      // This is a native turn event, not a phrase/keyword match on captions.
      cancelAutomaticEnd(active);
    } else if (typeof data.turn.id === "string" && data.turn.id.trim()) {
      active.nativeAssistantPlayback ??= new Map();
      active.currentNativeAssistantTurnId = data.turn.id;
      active.nativeAssistantPlayback.set(data.turn.id, { originUserTurnId: active.latestNativeUserTurnId,
        terminalAt: null, audioObserved: false, quietSince: null, lastSampleAt: null });
      if (active.nativeAssistantPlayback.size > 32) active.nativeAssistantPlayback.delete(active.nativeAssistantPlayback.keys().next().value);
      active.duplex.notifyAssistantTurnCreated(data.turn.id, at);
      const request = active.endRequests?.get(active.endNativeRequestId);
      if (request && !request.invalidated && (!request.backendPath || request.accepted && request.providerObserved)) {
        request.turnId = data.turn.id; request.terminalAt = null;
        request.audioObserved = false; request.quietSince = null;
      }
    }
  }
  if(active&&data.type==='turn.delta'&&data.turn_id===active.latestNativeUserTurnId&&typeof data.delta==='string')updateNativeUserText(active,(active.nativeUserText??'')+data.delta);
  if (active && data.type === "turn.done" && data.turn?.role === "assistant") {
    const at = performance.now();
    const played = active.nativeAssistantPlayback?.get(data.turn.id);
    if (played) played.terminalAt = at;
    duplexDiagnostic(active, { type: "native-turn-done", at, role: "assistant" });
    if (typeof data.turn.id === "string" && data.turn.id.trim())
      active.duplex.notifyAssistantTurnDone(data.turn.id, at);
    const request = active.endRequests?.get(active.endNativeRequestId);
    if (request && !request.invalidated && request.turnId === data.turn?.id){
      if(request.voiceHostPath){
       const spoken=typeof data.turn.transcript==='string'?data.turn.transcript.replace(/[\s，,。.!！?？、]/gu,''):'';
       // The provider may say “下次再聊” for the requested “下次聊”. Both
       // preserve the farewell; host authority and actual audio drain are
       // still required. An ordinary acknowledgment must not close the call.
       if(!spoken.includes(request.expectedFarewell)&&!spoken.includes('再见下次再聊')){request.turnId=null;request.terminalAt=null;request.audioObserved=false;request.quietSince=null;return;}
      }
      request.terminalAt=at;
    }
  }
  if (active && data.type === "output_audio_buffer.cleared") {
    const at = performance.now();
    duplexDiagnostic(active, { type: "native-output-audio-cleared", at });
    active.duplex.notifyOutputAudioCleared(at);
  }
  const routedUserCaption=active?.speakerGate&&(data.turn?.role==='user'||/^(session\.)?input_transcript\./u.test(data.type??'')||data.type==='turn.delta'&&data.turn_id===active.latestNativeUserTurnId);
  if(!routedUserCaption)renderTranscript(presentation.consume(data, Date.now()));
  if (data.type === "error") setStatus("语音服务报告错误，请结束通话后重试。", { tone: "error" });
}
async function stopCall({failure}={}) {
  const active = call; call = null;
  if (active && !failure && tvHost) {tvHost.landPortrait?.();warmTvAudio();}
  if (starting === active) starting = null;
  if (active) {
    active.improv?.finish('call');
    view.set({improv:null,recordings:[]});
    for(const clip of active.recordings?.values()??[])if(clip.recording)URL.revokeObjectURL(clip.recording);
    active.avatarTelemetry?.close();
    active.avatarReactions?.dispose();
    active.board?.dispose(); active.boardAssets?.dispose(); clearInterval(active.boardFocusTimer); view.set({ board: null, boardCanvas: null, boardSpoken: null, boardAssets: null });
    for (const pending of active.boardPhotos?.values() ?? []) void pending.then(url => { if (url) URL.revokeObjectURL(url); });
    active.relay?.dispose();
    active.dialConnection?.dispose();
    active.callerContext?.close();active.deviceAdapter?.close();
    active.speakerGate?.dispose();
    clearInterval(active.levelTimer); clearInterval(active.heartbeat); clearInterval(active.presentationPoll);
    active.presentationAbort?.abort();
    clearTimeout(active.ending?.timeout); clearTimeout(active.greetingRetryTimer);
    clearTimeout(active.greetingDeadlineTimer); active.greetingAbort?.abort();
    active.captureAbort?.abort(); active.capture?.dispose();
    void active.sounds?.dispose();
    active.duplex?.dispose(); active.duplexDiagnostics.closed = true;
    active.events?.close(); active.channel?.close(); active.pc?.close();
    if (!active.capture) active.stream?.getTracks().forEach((track) => track.stop());
  }
  $("remoteAudio").srcObject = null;
  $("remoteAudio").muted = false;
  tasks.reset(); taskState(); setVoiceState("idle");
  resetTranscript();
  if ($("steerText")) $("steerText").value = "";
  setCallState("idle");
  view.set(state => ({ dial: { ...state.dial, disabled: false }, stopLabel: "结束通话", badge: liveReady ? "可以拨号" : "暂未连接",
    composer: { enabled: false, open: false }, modelDisabled: false }));
  view.set({failureCode:failure?.code??null});
  setStatus(failure?.message??"拨号后，直接说话。",{tone:failure&&failure.code!=='RELAY_REDIALING'?"error":"info"});
  if (active) {
    await active.context?.close().catch(() => {});
    if (active.voiceSessionId) await api("close", { voiceSessionId: active.voiceSessionId }).catch(() => {});
  }
}
// A stalled permission query must never hold a dial: treat it as not granted.
async function microphoneGranted() {
  try {
    const query=navigator.permissions?.query({name:"microphone"});
    if(!query)return false;
    return (await Promise.race([query,new Promise(resolve=>setTimeout(resolve,150))]))?.state==="granted";
  } catch { return false; }
}
// A call whose connection is cut (neither side hung up) is dialled again by itself: the service keeps
// its board for the next call, and V is told to take up where it stopped. Twice in a row at most;
// a call that held for half a minute starts the count again. What the page saw goes with the dial.
let redials = 0;
async function redialLostCall(active, failure, closed = {}) {
  const heldMs = active.readyAt == null ? 0 : Math.round(performance.now() - active.readyAt);
  if (active.provider !== 'gpt-live-11' || heldMs < 3000 || view.get().confirmation) return stopCall({failure});
  if (heldMs > 30000) redials = 0;
  if (redials >= 2) return stopCall({failure});
  redials++;
  const lost = {code: closed.code ?? null, clean: closed.clean === true, quietMs: closed.quietMs ?? null, silentMs: closed.silentMs ?? null, heldMs, online: navigator.onLine !== false, hidden: document.hidden === true, net: String(navigator.connection?.effectiveType ?? '').slice(0, 12)};
  // The audio context is kept: one made without a tap may never start on a phone.
  const context = active.context; active.context = null;
  // The lost call is not closed from here: the service saw its socket go, and an explicit close is a hang-up
  // there (it lets the call's board go, which the call that follows is to carry on).
  active.voiceSessionId = null;
  await stopCall({failure: Object.assign(Error('连接断了一下，正在接回…'), {code: 'RELAY_REDIALING'})});
  if (call || starting) { await context?.close().catch(() => {}); return; }
  await startCall({context, resumed: lost});
}
async function startCall(options = {}) {
  if (starting || call || view.get().confirmation) return;
  if (view.get().confirmOnDial) { await confirmation.start(); return; }
  if(tvHost&&hasTvArrayCapture()&&!tvArraySupportsModel(view.get().model)){setStatus("当前电视阵列输入支持豆包和 Grok，请选择豆包。",{tone:"error"});return;}
  if (!liveReady) { setStatus(entryError ?? "当前页面仅作预览，真实通话还未连接 VLab 候选服务。"); return; }
  for (const name of ["voice.dial.requested", "voice.microphone.ready", "voice.reservation.ready", "voice.connection.ready", "voice.output.received", "voice.output.rendered"])
    performance.clearMarks?.(name);
  markVoiceTiming("voice.dial.requested");
  view.set(state => ({ dial: { ...state.dial, disabled: true }, stopLabel: "取消拨号", badge: "连接中", modelDisabled: true }));
  setCallState("dialing"); setStatus(options.resumed ? "连接断了一下，正在接回…" : "正在连接 V…");
  resetTranscript();view.set({failureCode:null});
  const chosenModel = view.get().model;
  const active = { pc:tvHost&&tvArraySupportsModel(chosenModel)?null:new RTCPeerConnection(), captureAbort: new AbortController(), dialStartedAt:performance.now() }; call = active; starting = active;
  if (speakerCandidate()||['seeduplex','grok','gpt-live-11'].includes(chosenModel)) {
    // Create/resume in the dial gesture, before microphone and network awaits.
    active.context = options.context ?? new AudioContext({latencyHint:"interactive"});
    active.contextResume = active.context.resume();
  }
  // Each call owns its sound element; a late play() from an older call cannot
  // pause or replace the next call's pickup. The page element configures assets.
  active.soundElement = document.createElement("audio"); active.soundElement.playsInline = true;
  for (const key of ["ringSrc", "pickupSrc"]) if ($("callSound").dataset[key]) active.soundElement.dataset[key] = $("callSound").dataset[key];
  // The TV Home gesture owns only the bounded cold-start cue. Hand it off
  // before this shared call starts its normal ring; no native call policy.
  try { window.VTVStartupCue?.finish?.(); } catch {}
  active.sounds = createCallSounds({ audioElement: active.soundElement, sharedContext: active.context });
  if (!options.resumed) void active.sounds.dial();
  // Activity metadata stays in this page's memory only. It contains no audio,
  // transcript, session identifiers or claim that the model was interrupted.
  active.duplexDiagnostics = { kind: "duplex-playback", schemaVersion: 2, closed: false,
    counts: {}, transitions: [], events: [] };
  globalThis.__gptLiveDuplexDiagnostics = active.duplexDiagnostics;
  active.duplex = createH5DuplexPlaybackGate({ mode: "native", onGateChange: (entry) => {
    if (call !== active) return;
    $("remoteAudio").muted = entry.localPlaybackMuted || view.get().outputMuted;
    duplexDiagnostic(active, { type: "local-playback-gate", at: entry.at,
      muted: entry.localPlaybackMuted, reason: entry.reason,
      oldTurnTerminal: entry.oldTurnTerminal, outputDrained: entry.outputDrained, ...playbackState(active) });
  } });
  active.duplexDiagnostics.playbackMode = active.duplex.snapshot().mode;
  active.duplexDiagnostics.interruptionOwner = active.duplex.snapshot().interruptionOwner;
  try {
    const fixtureId=speakerCandidate()?new URLSearchParams(location.search).get('fixture'):null;
    if(speakerCandidate()){document.body.dataset.speakerEvents='[]';document.body.dataset.speakerAnswerDone='false';}
    const parallelTvCapture=Boolean(tvHost&&hasTvArrayCapture());
    const capturePreparation = fixtureId? createSpeakerFixture(active.context,fixtureId,{onEvent:speakerEvent}):parallelTvCapture?captureTvArray({directPcm:true,context:active.context,signal:active.captureAbort.signal,isCurrent:()=>call===active,
      onDiagnostics:metadata=>{if(call===active)active.duplexDiagnostics.microphone=metadata;},
      onError:error=>{if(call===active)void stopCall({failure:error});},
    }):microphoneSession.acquire({
      mediaDevices: navigator.mediaDevices, signal: active.captureAbort.signal,
      isCurrent: () => call === active,
      onDiagnostics: (metadata) => { if (call === active) active.duplexDiagnostics.microphone = metadata; },
    });
    const acceptCapture=capture=>{
      if(call!==active){capture.dispose();throw new DOMException('Call ended','AbortError');}
      active.capture=capture;active.stream=capture.stream;markVoiceTiming("voice.microphone.ready");
      if(fixtureId)active.fixture=capture;return capture;
    };
    // The TV already has a native microphone grant. Prepare its local DSP and
    // the remote model concurrently, but begin capture only when both are ready.
    if(parallelTvCapture){active.capturePreparation=Promise.resolve(capturePreparation).then(acceptCapture);void active.capturePreparation.catch(error=>{if(call===active)void stopCall({failure:error});});}
    // With the grant already given there is no prompt to wait for, so the
    // microphone opens while the call is being admitted. A page that may still
    // prompt keeps the old order: no call exists until the caller allows it.
    let captureReady=null,captureError=null;
    if(!parallelTvCapture){
      const opening=Promise.resolve(capturePreparation).then(acceptCapture);
      if(!fixtureId&&await microphoneGranted())captureReady=opening.catch(error=>{captureError=error;});
      else await opening;
    }
    if(call!==active)return;
    const withCapture=async pending=>captureReady?(await Promise.all([pending,captureReady]))[0]:pending;
    const selectedModel = ['seeduplex','grok','gpt-live-11'].includes(chosenModel)?chosenModel:'gpt-live';
    const inputPolicy = speakerCandidate() ? (new URLSearchParams(location.search).get('inputPolicy') ?? preferredPhoneInputPolicy) : null;
    const nativeDeviceActions=await browserDeviceActions();
    const improvLive = improvAvailable && selectedModel !== 'gpt-live';
    const params={model:selectedModel,...(improvLive?{improvLive:true}:{}),nativeDeviceActions,...selectedModel==='seeduplex'&&speakerCandidate()&&['native','speaker'].includes(inputPolicy)?{inputPolicy}:{},...(selectedModel==='grok'?{voice:view.get().grok.voice || undefined}:selectedModel==='gpt-live-11'&&view.get().live11.voice?{voice:view.get().live11.voice}:selectedModel==='seeduplex'&&view.get().doubao.voice?{voice:view.get().doubao.voice}:{})};
    let reservation;
    if(webDialVersion===2&&(phoneEntry||tvHost&&location.protocol==='https:')&&['seeduplex','grok','gpt-live-11'].includes(selectedModel)){
      const endpoint=new URL('./api/dial',document.baseURI);endpoint.protocol=location.protocol==='https:'?'wss:':'ws:';
      endpoint.search=new URLSearchParams({...(phoneEntry?{phone:phoneEntry}:{}),model:selectedModel,dialVersion:'2',...(tvHost&&dialGreeting&&!fixtureId?{greeting:'1'}:{}),...(improvLive?{improvLive:'1'}:{}),...(options.resumed?{resumed:JSON.stringify(options.resumed)}:{}),...(nativeDeviceActions?{nativeDeviceActions:JSON.stringify(nativeDeviceActions)}:{}),...(params.inputPolicy?{inputPolicy:params.inputPolicy}:{}),...(params.voice?{voice:params.voice}:{})});
      active.dialConnection=createDialConnection({url:endpoint,signal:active.captureAbort.signal});
      reservation=await withCapture(active.dialConnection.reservation);
    }else reservation=await withCapture(api('session',options.resumed?{...params,resumed:options.resumed}:params));
    active.provider=reservation.provider;
    active.voiceSessionId = reservation.voiceSessionId; markVoiceTiming("voice.reservation.ready");
    if (call !== active) { await api("close", { voiceSessionId: active.voiceSessionId }); return; }
    if(captureError)throw captureError;
    if (improvLive) active.improv = createImprovPlayer({context:active.context,
      update: improv => { if (call === active) view.set({improv}); },
      archive: clip => {
        if(call!==active){if(clip.recording)URL.revokeObjectURL(clip.recording);return;}
        active.recordings??=new Map();active.recordings.set(clip.id,clip);
        view.set({recordings:[...active.recordings.values()]});
      },
      ended: (id,reason) => { void api('improv-end',{voiceSessionId:active.voiceSessionId,id,reason}).catch(()=>{}); },
      stage: ({stage,ms,reason,status}) => { if (call === active) void api('improv-stage',{voiceSessionId:active.voiceSessionId,stage,ms,reason,status}).catch(()=>{}); },
      notice: (text,failed) => { if (call === active) setStatus(text,{tone:failed?'problem':'success'}); }
    });
    const diagnosticOwner=avatarDiagnosticOwner=Symbol('avatar-call');
    document.body.dataset.avatarReactionRequests='0';
    document.body.dataset.avatarReactionApplied='0';
    document.body.dataset.avatarReactionResult='waiting';
    document.body.dataset.avatarReactionTimeline='[]';
    active.avatarTelemetry = createAvatarTelemetry({snapshot:()=>presentation.snapshot(),
      send:payload=>api('avatar-events',{voiceSessionId:active.voiceSessionId,...payload},{keepalive:true,signal:AbortSignal.timeout(5000)}),
    });
    document.body.dataset.avatarImageTimeline='[]';
    // The picture beside the conversation. Like the avatar it only follows the
    // call; nothing in the call waits for it.
    if (boardAvailable) active.board = createBoardClient({
      isCurrent: () => call === active,
      // A new picture goes up together with where the voice is on it: set a
      // moment apart, a lesson showed whole for one frame before hiding.
      onScene: (scene, canvas) => { if (call === active) { view.set({ board: scene, boardCanvas: canvas ?? null, boardSpoken: active.boardFollow?.(scene) ?? view.get().boardSpoken }); active.boardAssets?.scene(scene); } },
      observe: event => {
        const trace = JSON.parse(document.body.dataset.boardTimeline ?? '[]');
        trace.push({ ...event, at: Math.round(performance.now()) });
        document.body.dataset.boardTimeline = JSON.stringify(trace.slice(-80));
      },
      request: async (payload, { signal, onEvent }) => {
        const response = await fetch(apiUrl('board'), { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voiceSessionId: active.voiceSessionId, ...payload }), signal });
        if (!response.ok || !response.body) throw new Error('board unavailable');
        await readEventStream(response, onEvent);
      },
    });
    // The shelf of made things beside it (board-assets.mjs): asked for when a tool starts or ends
    // and while anything is still being made. A service without one refuses, and the page stops asking.
    if (active.board) active.boardAssets = createAssetsClient({
      isCurrent: () => call === active, rev: () => active.board.scene.rev,
      onChange: shelf => { if (call === active) view.set({ boardAssets: shelf }); },
      onSync: value => active.board.sync(value),
      request: async body => {
        const response = await fetch(apiUrl('board-assets'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceSessionId: active.voiceSessionId, ...body }) });
        if (!response.ok) throw new Error('board assets unavailable');
        return response.json();
      },
    });
    if (active.board) {
      // Move the focus mark with V's voice. Relay calls know how much of the
      // reply's audio has played; elsewhere the caption itself is the clock.
      const cursor = createSpokenCursor(), lessonGate = createLessonGate();
      active.boardFollow = (scene = active.board.scene) => {
        const snapshot = presentation.snapshot();
        // Only the reply V is giving now: after the caller has spoken again,
        // audio such as a progress cue is not the earlier reply being re-read.
        const last = [...snapshot.history, ...snapshot.current].filter(item => !item.document && item.text?.trim()).sort((a, b) => a.at - b.at).at(-1);
        const row = last?.role === 'assistant' ? last : null;
        const spoken = lessonGate.view({ scene, text: row?.text ?? '', speaking: Boolean(row) && view.get().voice === 'speaking', speaksOf, unspoken,
          progress: () => {
            const stats = active.relay?.stats, textLength = Array.from(row.text).length;
            const index = stats ? cursor.index({ key: row.key, textLength, outputBytes: stats.outputBytes, queuedBytes: stats.queuedOutputBytes, charsPerSecond: spokenRate(row.text) }) : textLength;
            // (`said`: how far into this reply the voice is, for the line under a phone's page.)
            return { ...spokenProgress(scene, scene.lesson && !row.complete ? withCuesToCome(scene, row.text) : row.text, index), said: index, reply: row.key };
          } });
        return spoken;
      };
      active.boardFocusTimer = setInterval(() => {
        if (call !== active) return;
        const spoken = active.boardFollow();
        if (JSON.stringify(view.get().boardSpoken) !== JSON.stringify(spoken)) view.set({ boardSpoken: spoken });
      }, 400);
    }
    if (avatar) active.avatarReactions = createAvatarReactions({
      observe:event=>{
        if(event.type==='applied')active.avatarTelemetry?.decision(event);
        const {type,picture}=event;
        // Retain the old call's terminal reason, but never write into a newer call.
        if(avatarDiagnosticOwner!==diagnosticOwner)return;
        const trace=JSON.parse(document.body.dataset.avatarReactionTimeline??'[]');
        trace.push(event);document.body.dataset.avatarReactionTimeline=JSON.stringify(trace.slice(-120));
        document.body.dataset.avatarReactionResult=type;
        document.body.dataset.avatarReactionReason=event.reason??type;
        if(type==='requested')document.body.dataset.avatarReactionRequests=String(Number(document.body.dataset.avatarReactionRequests)+1);
        if(type==='applied'){document.body.dataset.avatarReactionApplied=String(Number(document.body.dataset.avatarReactionApplied)+1);document.body.dataset.avatarDecisionPicture=picture;}
      },
      request:(context,options)=>api('avatar',{voiceSessionId:active.voiceSessionId,...context},options),
      apply:reaction=>avatar.select(reaction),attend:()=>avatar.attend(),current:()=>avatar.context(),
      isCurrent:()=>call===active,isVisible:()=>!document.hidden,
    });
    if(reservation.nativeDeviceActions)active.deviceAdapter=createBrowserDeviceAdapter({voiceSessionId:active.voiceSessionId,isCurrent:()=>call===active,send:frame=>{if(call!==active)return;if(active.relay)active.relay.sendDeviceResult(frame);else void api('device-result',{voiceSessionId:active.voiceSessionId,frame}).catch(()=>{});}});
    if (reservation.transport === 'gateway-relay') {
      await active.contextResume;
      if(call!==active)return;
      active.relay=createRelayAudio({context:active.context,stream:active.stream,reservation,connection:active.dialConnection,dialStartedAt:active.dialStartedAt,onTiming:name=>{if(call===active)markVoiceTiming(name);},greeting:!active.fixture,inputGated:Boolean(reservation.speakerRouting),
        prepareCapture:active.capturePreparation?()=>active.capturePreparation:undefined,
        renderReference:active.capture?.renderReference,
        startCapture:active.capture?.startCapture,
        subscribePcm:active.capture?.subscribePcm,bufferedOutput:Boolean(tvHost&&hasTvArrayCapture()),
        onAudioLevel:tvHost?value=>{if(call===active)tvHost.observeAudio(value);}:undefined,
        onError:error=>{if(call===active)void stopCall({failure:error});},
        onClosed:closed=>{if(call!==active)return;if(active.remoteEnding)void stopCall();else void redialLostCall(active,Object.assign(Error("连接已中断，请重新呼叫"),{code:"RELAY_CLOSED"}),closed);},
        onPlaybackActivity:speaking=>{if(call===active){active.improv?.setHostSpeaking(speaking);setVoiceState(speaking?'speaking':'listening');if(speakerCandidate())speakerEvent({type:'playback.activity',speaking});}},
        onEvent:value=>{
          if(call!==active)return;
          if(active.deviceAdapter?.handle(value))return;
          if(value.type==='end.after-playback')active.remoteEnding=true;
          if(value.type==='end.cancelled')active.remoteEnding=false;
          // An interrupted native reply may never send its final transcript.
          // Its caption row must not be reused for the answer to the next turn.
          if(value.type==='improv.notice'){setStatus(value.text,{tone:'problem'});return;}
          if(value.type==='improv.live'){void active.improv?.receive(value);return;}
          if(value.type==='input.speech.started')active.improv?.setCallerSpeaking(true);
          if(value.type==='input.speech.stopped' || value.type==='input.speech.ignored' || (value.type==='transcript' && value.role==='user' && value.final))active.improv?.setCallerSpeaking(false);
          if(value.type==='input.speech.started'&&active.relayTurns?.assistant){
            // Close only the display row, preserving its received text in
            // history. This is not provider completion or playback proof.
            renderTranscript(presentation.consume({type:'turn.done',turn:{role:'assistant',id:active.relayTurns.assistant}}));
            delete active.relayTurns.assistant;
          }
          if(speakerCandidate()&&(value.type.startsWith('speaker.')||value.type.startsWith('end.')||value.type==='transcript'&&value.final||['audio.done','audio.clear','error','upload.backpressure'].includes(value.type)))speakerEvent(value);
          if (value.type === 'avatar.expression') { avatar?.expression(value.expression); return; }
      tasks.consume(value);
          if(value.type==='backend.result')receiveDocument(active,value);
          if(value.type.startsWith('tool.'))taskState();
          if(value.type==='tool.result')active.board?.evidence();
          if(value.type.startsWith('tool.')||value.type==='backend.result')active.boardAssets?.poke();
          if(value.type==='playback.blocked')setStatus('声音播放已暂停，轻点页面继续。');
          if(value.type==='playback.resumed')setStatus('V 正在听，直接说话就好');
          if(value.type==='reply.sync'&&value.status==='failed')setStatus(value.message,{tone:'problem'});
          // (Before V has said anything this is still connecting: a refused conversation record, retried without it.)
          if(value.type==='provider.reconnecting')setStatus(active.vSpoke?'正在恢复语音连接…':'正在连接 V…');
          if(value.type==='provider.recovered')setStatus('V 正在听，直接说话就好');
          if(value.type==='transcript'&&value.role==='assistant')active.vSpoke=true;
          if(value.type==='transcript'&&!(reservation.speakerRouting&&value.role==='user')) {
            active.relayTurns??={};
            const id=active.relayTurns[value.role]??=crypto.randomUUID();
            renderTranscript(presentation.consume(value.final?{type:'turn.done',turn:{id,role:value.role,transcript:value.text}}:
              {type:'output_transcript.delta',turn_id:id,delta:value.text}));
            if(value.final)delete active.relayTurns[value.role];
            if(value.final&&value.role==='user')view.thinking();
          }
        }});
      await active.relay.start();if(call!==active)return;
      startPresentationRecovery(active);
      active.readyAt=performance.now();setCallState('connected');view.set({badge:'通话中',stopLabel:'结束通话',composer:{enabled:true,open:false}});
      setStatus('V 正在听，直接说话就好');
      void active.sounds.connected();
      active.heartbeat=setInterval(()=>void api('heartbeat',{voiceSessionId:active.voiceSessionId}).catch(()=>{}),15000);
      return;
    }
    if(reservation.speakerRouting){active.speakerGate=await createSpeakerGate({context:active.context,stream:active.stream,reservation:reservation.speakerRouting,channel:()=>active.channel,isCurrent:()=>call===active,onEvent:speakerEvent});}
    const outgoing=active.speakerGate?.stream??active.stream;
    active.pc??=new RTCPeerConnection();
    for (const track of outgoing.getAudioTracks()) active.pc.addTrack(track, outgoing);
    active.channel = active.pc.createDataChannel("oai-events"); active.channel.onmessage = (event) => { if (call === active) providerMessage(event); };
    active.callerContext=createCallerContext({context:reservation.callerContext,voiceSessionId:active.voiceSessionId,channel:active.channel,tracks:outgoing.getAudioTracks(),isCurrent:()=>call===active,
      onReady:()=>void greetWhenReady(active),onError:error=>{if(call===active)void stopCall().then(()=>{if(!call)setStatus(error.message,{tone:"error"});});}});
    active.channel.onopen=()=>active.callerContext.open();
    active.events = new EventSource(apiUrl("events"));
    const applyNativeControl = value => {
      if(value.type==='reply.sync'&&value.status==='failed')setStatus(value.message,{tone:'problem'});
      if(value.type==='tool.call')active.backendFinalReady=false;
      if(value.type==='tool.result'&&value.backendFinal===true)active.backendFinalReady=true;
      if(['voice.end.proposed','voice.end.accepted'].includes(value.type))requestVoiceHostEnd(active,value);
      if (value.type === "tool.result") requestAutomaticEnd(active, value);
      if (value.type === "tool.error" && value.name === "openclaw_end_call" &&
        (value.callId === value.requestId || value.source === "backend_model_client_tool" &&
          value.callId === value.backendToolCallId && value.nativeDelegationId === value.requestId)) {
        const request = endCallRequest(active, value.requestId, value.originUserTurnId);
        if (request && (!request.backendPath || request.backendToolCallId === value.backendToolCallId &&
          request.backendRunId === value.backendRunId)) {
          request.invalidated = true;
          if (active.ending?.requestId === value.requestId) cancelAutomaticEnd(active);
        }
      }
    };
    active.events.onmessage = (event) => {
      if (call !== active) return;
      const value = JSON.parse(event.data);
      if (value.voiceSessionId !== active.voiceSessionId) return;
      if(active.deviceAdapter?.handle(value))return;
      if(value.type==='device.context'){active.callerContext?.update(value);return;}
      if (Number.isSafeInteger(value.revision)) active.presentationRevision = Math.max(active.presentationRevision ?? 0, value.revision);
      if (value.type === 'avatar.expression') { avatar?.expression(value.expression); return; }
      tasks.consume(value);
      if(value.type==='backend.result')receiveDocument(active,value);
      applyNativeControl(value);
      taskState();
    };
    startPresentationRecovery(active,applyNativeControl);
    active.pc.ontrack = async (event) => {
      if (call !== active) return;
      const stream = new MediaStream([event.track]); $("remoteAudio").srcObject = stream;
      await startRemotePlayback(active, "track");
      if (call !== active) return;
      active.context ??= new AudioContext();
      try { await active.context.resume(); }
      catch (error) {
        if (call !== active) return;
        active.playbackContextBlocked = true;
        active.playbackNeedsGesture = true;
        duplexDiagnostic(active, { type: "context-resume-rejected", at: performance.now(), source: "track", errorName: error?.name ?? "Error", ...playbackState(active) });
        setStatus(playbackRecoveryMessage);
      }
      if (call !== active) { await active.context.close().catch(() => {}); return; }
      if (active.context.state !== "running") {
        active.playbackContextBlocked = true;
        active.playbackNeedsGesture = true;
        setStatus(playbackRecoveryMessage);
      }
      const analyser = active.context.createAnalyser(); analyser.fftSize = 1024;
      active.context.createMediaStreamSource(stream).connect(analyser);
      const microphoneAnalyser = active.context.createAnalyser(); microphoneAnalyser.fftSize = 1024;
      active.context.createMediaStreamSource(active.speakerGate?.stream??active.stream).connect(microphoneAnalyser);
      const samples = new Float32Array(analyser.fftSize);
      const microphoneSamples = new Float32Array(microphoneAnalyser.fftSize);
      active.levelTimer = setInterval(() => {
        if (call !== active) return;
        analyser.getFloatTimeDomainData(samples);
        microphoneAnalyser.getFloatTimeDomainData(microphoneSamples);
        const energy = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const microphoneEnergy = Math.sqrt(microphoneSamples.reduce((sum, value) => sum + value * value, 0) / microphoneSamples.length);
        const at = performance.now();
        if(speakerCandidate()&&energy>.008&&!active.speakerAudioActive)speakerEvent({type:'playback.activity',speaking:true});
        if(speakerCandidate()&&energy<=.008&&active.speakerAudioActive)speakerEvent({type:'playback.activity',speaking:false});
        active.speakerAudioActive=energy>.008;
        // This analyser reads the inbound stream before HTML playback muting,
        // so a local gate cannot manufacture evidence of a provider audio gap.
        const duplex = active.duplex.observe({ at, microphoneRms: microphoneEnergy, remoteRms: energy });
        tvHost?.observeAudio({input:microphoneEnergy,output:view.get().outputMuted||duplex.localPlaybackMuted||active.playbackNeedsGesture||$("remoteAudio").paused||active.context.state!=="running"?0:energy});
        duplexDiagnostic(active, { type: "activity-window", at, microphoneRms: microphoneEnergy, remoteRms: energy,
          microphoneAboveAttack: microphoneEnergy >= .02, microphoneAboveRelease: microphoneEnergy > .01,
          microphoneVoiced: duplex.localUserSpeaking,
          remoteActive: energy > .008, muted: duplex.localPlaybackMuted,
          oldTurnTerminal: duplex.oldTurnTerminal, outputDrained: duplex.outputDrained, ...playbackState(active) });
        if (energy > .008 && ($("remoteAudio").paused || active.context.state !== "running") && !active.playbackNeedsGesture) {
          active.playbackNeedsGesture = true;
          active.playbackAudioBlocked = $("remoteAudio").paused;
          active.playbackContextBlocked = active.context.state !== "running";
          duplexDiagnostic(active, { type: "playback-not-running", at, ...playbackState(active) });
          setStatus(playbackRecoveryMessage);
        }
        if (duplex.recoverySuggested && !active.duplexRecoveryNotice) {
          active.duplexRecoveryNotice = true;
          setStatus(duplexRecoveryMessage);
        } else if (!duplex.localPlaybackMuted && active.duplexRecoveryNotice) {
          active.duplexRecoveryNotice = false;
          if (statusText === duplexRecoveryMessage) connectedStatus(active);
        }
        setVoiceState(energy > .008 && !duplex.localPlaybackMuted && !active.playbackNeedsGesture ? "speaking" : "listening");
        if(duplex.localUserSpeaking||microphoneEnergy>.01)active.microphoneQuietSince=null;else active.microphoneQuietSince??=at;
        applyVoiceHostEnd(active);
        observeAutomaticEnd(active, at, energy);
      }, 50);
      void greetWhenReady(active);
    };
    active.pc.onconnectionstatechange = () => {
      if (call !== active) return;
      if (active.pc.connectionState === "connected") {
        setCallState("connected");
        void active.sounds.connected();
        view.set({ badge: "通话中", stopLabel: "结束通话", composer: { enabled: true, open: false } });
        connectedStatus(active);
        void greetWhenReady(active);
      } else if (["failed", "disconnected"].includes(active.pc.connectionState)) {
        void stopCall().then(() => { if (!call) setStatus("连接已中断，可以重新开始通话。", { tone: "error" }); });
      }
    };
    await active.pc.setLocalDescription(await active.pc.createOffer());
    await new Promise((resolve) => {
      if (active.pc.iceGatheringState === "complete") return resolve();
      const timer = setTimeout(resolve, 5000);
      active.pc.addEventListener("icegatheringstatechange", () => {
        if (active.pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
      });
    });
    if (call !== active) return;
    const result = await api("offer", { voiceSessionId: active.voiceSessionId, sdp: active.pc.localDescription.sdp });
    if (call !== active) return;
    await active.pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
    if (call !== active) return;
    active.heartbeat = setInterval(() => { if (call === active) void api("heartbeat", { voiceSessionId: active.voiceSessionId }).catch(() => {}); }, 15000);
  } catch (error) { if (call === active) { await stopCall({failure:Object.assign(Error(error.name === "NotAllowedError" ? "请允许麦克风访问后重试。" : error.message),{code:error.code??"CALL_START_FAILED"})}); } }
  finally { if (starting === active) starting = null; if (!call) view.set(state => ({ dial: { ...state.dial, disabled: false } })); }
}
// A tap anywhere can restore browser playback. Never gate/stop the microphone
// or cancel accepted work while requesting this user gesture.
window.addEventListener("pointerdown", () => { screenWakeLock.ensure(); void recoverPlaybackGesture(); });
window.addEventListener("keydown", () => void recoverPlaybackGesture());
async function sendSteer(value) {
  const text = String(value ?? "").trim(); if (!text || !call) return false;
  const active = call;
  try {
    const receipt = await api("steer", { voiceSessionId: active.voiceSessionId, text, mode: "steer" });
    if (call !== active) return false;
    view.set(state => ({ composer: { ...state.composer, open: false } }));
    setStatus(receipt.queued === true ? "条件已交给原任务，等待后台应用。" : "补充内容已发送。", { tone: "success" });
    return true;
  } catch (error) { if (call === active) setStatus(error.message, { tone: "problem" }); }
  return false;
}
async function cancelTasks() {
  if (!call) return;
  const active = call;
  const foregroundOnly=view.get().tasks.length>0&&view.get().tasks.every(task=>task.execution==='foreground');
  try { await api("steer", { voiceSessionId: active.voiceSessionId, text: foregroundOnly?"停止等待当前创作，不重新生成。":"取消当前后台任务，不要继续执行。", mode: "cancel" }); if (call === active) setStatus(foregroundOnly?"已停止等待；已提交的生成可能仍在继续。":"已请求取消后台任务。", { tone: "success" }); }
  catch (error) { if (call === active) setStatus(error.message, { tone: "problem" }); }
}
window.addEventListener("pagehide", () => {
  void confirmation.cancel();
  screenWakeLock.setActive(false);
  microphoneSession.close();
  const active = call;
  if (!active) return;
  // Beacon survives navigation; stopCall synchronously releases every local
  // resource and dial owner before its best-effort asynchronous API cleanup.
  if (active.voiceSessionId) navigator.sendBeacon(apiUrl("close"), new Blob([JSON.stringify({ voiceSessionId: active.voiceSessionId })], { type: "application/json" }));
  void stopCall();
});
window.addEventListener("pageshow",event=>{if(event.persisted)microphoneSession=createPageMicrophoneSession();});
function showEntryNotice(message, { reconnecting = false, publicHref = null } = {}) {
  const needsLink = /本人入口|完整.*入口/u.test(message);
  const invalidLink = /分享链接.*(?:无效|失效)|入口.*(?:不存在|已关闭)/u.test(message);
  const crowded = /尝试次数过多|访问的人有点多/u.test(message);
  view.set({ entry: {
    kind: needsLink || invalidLink ? "link" : "connection",
    title: needsLink ? "请从专属链接进入" : invalidLink ? "通话链接暂不可用" : reconnecting ? "V 正在重新连接" : crowded ? "稍等一下，再来找 V" : "暂时没连上 V",
    description: needsLink ? "重新打开完整的个人通话链接，就能和 V 聊天。" : invalidLink ? "请使用最新的完整个人链接重新打开。" : reconnecting ? "稍等片刻，再试着连接。" : crowded ? "当前连接较多，请稍后重试。" : "请检查网络，或稍后重新连接。",
    retry: !needsLink && !invalidLink, publicHref,
  } });
  document.body.dataset.entryState = "unavailable";
  // Initial entry failures belong to the home scene, not the call status line.
  setStatus("拨号后，直接说话。");
}
// Until the server catalog arrives, expose no experimental model.
view.set({ models: [], model: "seeduplex" });
async function initializeEntry() {
  try {
    const result = await (entryStartup ?? startVoiceEntry({
      location: window.location, fetch: (...args) => fetch(...args),
      replaceState: url => window.history.replaceState(null, "", url),
      mark: markVoiceTiming,
    }));
    if (result.error) throw Object.assign(new Error(result.error),{publicHref:result.publicHref});
    const { status } = result;
    applyEntryStatus(status);
    const query=new URLSearchParams(window.location.search);
    const reportId=query.get('call');if(reportId)void openCallReport(reportId);
  } catch (error) {
    liveReady = false;
    entryError = error.message ?? "暂时无法连接 V，请稍后重试。";
    view.set(state => ({ badge: "暂未连接", dial: { ...state.dial, disabled: true } }));
    showEntryNotice(entryError,{publicHref:error.publicHref});
  }
}
function applyEntryStatus(status) {
    view.set({returnToAccountHref:status.returnToAccountHref??null});
    preferredPhoneInputPolicy = status.phoneInputPolicy;
    webDialVersion = status.webDialVersion;
    dialGreeting = status.dialGreeting===true;
    liveReady = status.ready === true;
    improvAvailable = status.improvLive === true && !tvHost && typeof RTCPeerConnection === 'function';
    view.set({referenceUpload:status.referenceUpload === true && !tvHost});
    boardAvailable = status.board === true;
    const phoneOptions = phoneModelOptions(status, view.get().model);
    const models = phoneOptions.models.map(choice => ({...choice, available:choice.available&&(!tvHost||!hasTvArrayCapture()||tvArraySupportsModel(choice.id))}));
    const model = tvHost ? tvDefaultModel(models).model : phoneOptions.model;
    if(tvHost&&!tvDefaultModel(models).available){liveReady=false;entryError='豆包暂不可用，请稍后重试。';}
    const grok = status.models?.find(item => item.id === "grok");
    const grokVoices = grok?.voices ?? [];
    const live11 = status.models?.find(item => item.id === "gpt-live-11"), liveVoices = live11?.voices ?? [];
    let liveVoice = null; try { liveVoice = localStorage.getItem('v.gptLive11.voice'); } catch {}
    const doubao = status.models?.find(item => item.id === "seeduplex"), doubaoVoices = doubao?.voices ?? [];
    let doubaoVoice = null; try { doubaoVoice = localStorage.getItem(VOICE_SLOTS.seeduplex.storage); } catch {}
    view.set({ models, model, confirmOnDial:status.confirmationAvailable===true&&status.unidentified===true&&!guestDialAllowed, confirmationAvailable:status.confirmationAvailable===true, accessContext:status.accessContext??null, publicHref:status.publicHref??null, accountLoginHref: status.accountLoginHref??null, accountLabel: status.accountLabel??null, conversation: status.conversation ?? null, iosBindingAvailable: status.iosBindingAvailable === true, unidentified:status.unidentified===true, grok: {
      voices: grokVoices.map(voice => ({ id: voice.id, label: voice.label })),
      voice: grokVoices.some(voice => voice.id === "iris") ? "iris" : grokVoices[0]?.id ?? null,
      hint: [grok?.speed && grok.speed !== 1 ? `${grok.speed}× 语速` : "", grok?.expressiveTags ? "自主表达试用" : ""].filter(Boolean).join(" · "),
      listenHref: `./compare${window.location.search}`, listenAvailable: status.comparisonAvailable === true,
    }, live11: {
      voices: liveVoices.map(voice => ({ id: voice.id, label: voice.label })),
      voice: liveVoices.some(voice => voice.id === liveVoice) ? liveVoice : liveVoices.some(voice => voice.id === live11?.voice) ? live11.voice : liveVoices[0]?.id ?? null,
    }, doubao: {
      // (A service that lists no voices for Doubao gets none sent: the dial is the one it always was.)
      voices: doubaoVoices.map(voice => ({ id: voice.id, label: voice.label })),
      voice: doubaoVoices.some(voice => voice.id === doubaoVoice) ? doubaoVoice : doubaoVoices.some(voice => voice.id === doubao?.voice) ? doubao.voice : doubaoVoices[0]?.id ?? null,
    } });
    view.set(state => ({ badge: liveReady ? "可以拨号" : status.preview === false ? "后端重连中" : "页面预览", dial: { ...state.dial, disabled: !liveReady || Boolean(state.confirmation) } }));
    if (liveReady) {
      view.set({ entry: null });
      delete document.body.dataset.entryState;
      markVoiceTiming("voice.dial.ready");
    } else if (status.preview === false) showEntryNotice("V 后端正在重新连接", { reconnecting: true });
    else setStatus("这是页面预览，真实通话需连接候选服务。");
}
const confirmation=createFeishuConfirmation({
  request:async(action,body)=>{
    const response=await fetch(`./feishu/confirm/${action}?phone=${encodeURIComponent(phoneEntry??'')}`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Error(data.error??'暂时无法连接，请重试。');return data;
  },
  onState:value=>{if(skippingConfirmation&&!value)return;avatar?.entryReaction?.(value?'reaction-1':null);view.set(state=>({confirmation:value,dial:{...state.dial,disabled:!liveReady||Boolean(value)}}));},
  onEntry:status=>{
    applyEntryStatus(status);
    if(!status.unidentified){
      const url=new URL(window.location.href);for(const key of ['guest','connect','identified','client','state'])url.searchParams.delete(key);
      window.history.replaceState(null,'',url);
    }
  },
});
let skippingConfirmation=false;
async function skipConfirmation(){
  if(skippingConfirmation)return;skippingConfirmation=true;
  view.set(state=>({confirmation:{...state.confirmation,phase:'cancelling'}}));
  try{
    await confirmation.cancel();
    // A poll may already have redeemed the verified identity before cancel.
    // Re-read cookies so the displayed identity and the next call always agree.
    const status=await sessionRequest('status');guestDialAllowed=true;applyEntryStatus(status);
    const url=new URL(window.location.href);url.searchParams.set('guest','1');url.searchParams.delete('connect');window.history.replaceState(null,'',url);
  }catch(error){liveReady=false;view.set(state=>({dial:{...state.dial,disabled:true}}));showEntryNotice(error.message);}
  finally{skippingConfirmation=false;avatar?.entryReaction?.(null);view.set(state=>({confirmation:null,dial:{...state.dial,disabled:!liveReady}}));}
}
void initializeEntry();

async function sessionRequest(route,body){
 const response=await fetch(apiUrl(route),{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const data=await response.json();if(!response.ok)throw Error(data.error??'暂时无法完成，请稍后重试。');return data;
}
function updateSessionSheet(patch,key){view.set(state=>state.sessionSheet?.key===key?{sessionSheet:{...state.sessionSheet,...patch}}:{});}
let sessionSheetRevision=0;
async function openIosBinding(){
 if(view.get().confirmation||!view.get().iosBindingAvailable)return;
 const key=++sessionSheetRevision;view.set({sessionSheet:{kind:'binding',key,busy:true,devices:[],unidentified:view.get().unidentified}});
 try{const data=await sessionRequest('ios-binding');updateSessionSheet({busy:false,devices:data.devices,appDownload:data.appDownload,unidentified:view.get().unidentified},key);if(view.get().sessionSheet?.key===key)await createIosBinding();}catch(e){updateSessionSheet({busy:false,error:e.message},key);}
}
async function createIosBinding(){
 const key=view.get().sessionSheet?.key;
 updateSessionSheet({busy:true,error:null,copied:false,bindingUrl:null,appUrl:null},key);
 try{const data=await sessionRequest('ios-binding',{});updateSessionSheet({...data,busy:false},key);}catch(e){updateSessionSheet({busy:false,error:e.message},key);}
}
async function copyIosBinding(){
 const key=view.get().sessionSheet?.key;
 try{await navigator.clipboard.writeText(view.get().sessionSheet.bindingUrl);updateSessionSheet({copied:true,error:null},key);}catch{updateSessionSheet({error:'请长按下方链接并复制。'},key);}
}
async function revokeIosBinding(id){
 const key=view.get().sessionSheet?.key;
 updateSessionSheet({busy:true,error:null},key);
 try{await sessionRequest('ios-binding/revoke',{deviceId:id});const data=await sessionRequest('ios-binding');updateSessionSheet({busy:false,devices:data.devices},key);}catch(e){updateSessionSheet({busy:false,error:e.message},key);}
}
async function openCallReport(id){
 const key=++sessionSheetRevision;view.set({sessionSheet:{kind:'report',key,busy:true}});
 try{const report=await sessionRequest('calls/'+encodeURIComponent(id));updateSessionSheet({busy:false,report},key);}catch(e){updateSessionSheet({busy:false,error:e.message},key);}
}
