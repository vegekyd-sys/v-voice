import { createAvatarTasks, ACTIVITY_LABELS } from "./avatar-state.mjs";
import { createAvatarReactions } from "./avatar-reactions.mjs";
import { createAvatarTelemetry } from "./avatar-telemetry.mjs";
import { mountAvatar } from "./avatar.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { createContentView } from "./content-view.mjs";
import { mountProductControls } from "./product-controls.mjs";
import { createTranscriptPresentation } from "./transcript-presentation.mjs";
import { createPageMicrophoneSession } from "./microphone-session.mjs";
import { createCallSounds } from "./call-sounds.mjs";
import { createH5DuplexPlaybackGate } from "./duplex-playback.mjs";
import { createRelayAudio } from "./relay-audio.mjs";
import { createScreenWakeLock } from "./screen-wake-lock.mjs";

const $ = (id) => document.getElementById(id);
let microphoneSession = createPageMicrophoneSession();
let call = null;
let starting = null;
let avatarDiagnosticOwner = null;
let liveReady = false;
let entryError = null;
let callerEntry = "tianyi";
const phoneEntry = new URLSearchParams(window.location.search).get("phone");
const apiUrl = route => `./api/${route}?${phoneEntry ? `phone=${encodeURIComponent(phoneEntry)}` : `entry=${callerEntry}`}`;
const duplexRecoveryMessage = "上一段语音还没确认结束。若仍无声音，请结束通话后重新开始。";
const playbackRecoveryMessage = "声音播放被暂停了，点一下页面恢复声音。";
const greetingGraceMs = 15000;
const presentation = createTranscriptPresentation();
const renderedTurns = new Map();
const contentView = document.querySelector ? createContentView(document, window) : null;
const productControls = document.querySelector ? mountProductControls(document, window, {
  onMute: muted => { if (!call?.stream) return false; for (const track of call.stream.getAudioTracks()) track.enabled = !muted; return true; },
}) : null;
const tasks = createAvatarTasks();
const avatar = typeof window.Image === "function" ? mountAvatar(document, window, {owner:()=>call?.voiceSessionId,onDisplayed:event=>call?.avatarTelemetry?.display(event)}) : null;
const sceneAnimations = new Map();
const screenWakeLock = createScreenWakeLock({ navigator, document, onState: state => { document.body.dataset.screenWakeLock = state; } });
function setCallState(state) {
  screenWakeLock.setActive(state !== 'idle');
  if (document.body.dataset.callState === state) return;
  const animate = typeof window.matchMedia === "function"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const elements = animate ? [document.querySelector?.(".portrait-wrap"), document.querySelector?.(".call-actions")].filter(Boolean) : [];
  const before = elements.map(element => element.getBoundingClientRect());
  for (const animation of sceneAnimations.values()) animation.cancel();
  sceneAnimations.clear();
  document.body.dataset.callState = state;
  productControls?.callState(state);
  elements.forEach((element, index) => {
    const from = before[index], to = element.getBoundingClientRect();
    if (!from.width || !to.width || typeof element.animate !== "function") return;
    const dx = from.x + from.width / 2 - to.x - to.width / 2;
    const dy = from.y + from.height / 2 - to.y - to.height / 2;
    const animation = element.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, transformOrigin: "center" },
      { transform: "none", transformOrigin: "center" },
    ], { duration: 620, easing: "cubic-bezier(.22, 1, .36, 1)" });
    sceneAnimations.set(element, animation);
    animation.onfinish = () => { if (sceneAnimations.get(element) === animation) sceneAnimations.delete(element); };
  });
}
const setStatus = (text, { tone = "info" } = {}) => {
  $("status").textContent = text;
  $("status").dataset.tone = tone;
  $("status").dataset.notice = ["拨号后，直接说话。", "V 正在听，直接说话就好"].includes(text) ? "normal"
    : ["正在连接 V…", "正在结束通话…"].includes(text) ? "progress" : "message";
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
  if (call !== active || active.greetingPending || active.greetingRequested || active.greetingSuppressed
    || active.greetingExpired || active.ending
    || active.pc.connectionState !== "connected" || active.context?.state !== "running"
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
  $("badge").textContent = "通话中";
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
  $("badge").textContent = "正在结束"; connectedStatus(active);
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
    if (source === "gesture" || $("status").textContent === playbackRecoveryMessage) connectedStatus(active);
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
  $("taskStatus").textContent = ACTIVITY_LABELS[tasks.pose] ?? "";
  $("cancel").disabled = tasks.size === 0;
  $("cancel").hidden = tasks.size === 0;
  void avatar?.show(tasks.pose, tasks.completion);
  document.body.dataset.avatarState = tasks.size > 1 ? "very-busy" : tasks.size ? "busy" : "idle";
  avatarContext();
}
function renderTranscript(snapshot) {
  const log = $("conversation");
  const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 64;
  const all = [...snapshot.history, ...snapshot.current];
  document.body.dataset.conversation = all.some(item => item.text?.trim()) ? "started" : "empty";
  const visibleKeys = new Set(all.map(item => item.key));
  for (const [key, row] of renderedTurns) if (!visibleKeys.has(key)) { row.remove(); renderedTurns.delete(key); }
  $("currentLabel").textContent = call ? "正在说" : "最后的片段";
  $("conversationEmpty").hidden = all.length > 0;
  $("transcriptCurrent").hidden = snapshot.current.length === 0;
  for (const [items, parent] of [[snapshot.history, $("transcriptHistory")], [snapshot.current, $("transcriptCurrentRows")]]) {
    for (const [index, item] of items.entries()) {
      let row = renderedTurns.get(item.key);
      if (!row) {
        row = document.createElement("article");
        row.className = `transcript-turn ${item.role}`;
        const meta = document.createElement("div"); meta.className = "transcript-meta";
        const speaker = document.createElement("span"); speaker.className = "transcript-speaker";
        const time = document.createElement("time"); time.className = "transcript-time";
        const text = document.createElement("div"); text.className = "transcript-text";
        meta.append(speaker, time); row.append(meta, text);
        row.parts = { speaker, time, text };
        renderedTurns.set(item.key, row);
      }
      const streaming = String(Boolean(call) && !item.complete);
      if (row.dataset.streaming !== streaming) row.dataset.streaming = streaming;
      if (row.parts.speaker.textContent !== item.speaker) row.parts.speaker.textContent = item.speaker;
      if (row.parts.time.textContent !== item.time) row.parts.time.textContent = item.time;
      const dateTime = new Date(item.at).toISOString();
      if (row.parts.time.dateTime !== dateTime) row.parts.time.dateTime = dateTime;
      if (row.rawText !== item.text || row.complete !== item.complete) {
        if (item.role === "assistant" && contentView) contentView.render(row.parts.text, item, {auto:item.document === true});
        else if (item.role === "assistant") renderMarkdown(row.parts.text, item.text, document);
        else row.parts.text.textContent = item.text;
        row.rawText = item.text; row.complete = item.complete;
      }
      if (parent.children[index] !== row) parent.insertBefore(row, parent.children[index] ?? null);
    }
  }
  if (follow) log.scrollTop = log.scrollHeight;
  avatarContext(snapshot);
}
function resetTranscript() {
  contentView?.reset(); presentation.reset(); renderedTurns.clear();
  $("transcriptHistory").replaceChildren(); $("transcriptCurrentRows").replaceChildren();
  renderTranscript(presentation.snapshot());
}
function updateNativeUserText(active,text){
 const next=text.trim();if(next===active.nativeUserText)return;
 active.nativeUserText=next;active.nativeUserTextAt=performance.now();
 if(active.pendingVoiceEnd&&active.pendingVoiceEnd.userText!==next)active.pendingVoiceEnd=null;
 const request=active.endRequests?.get(active.endNativeRequestId);
 if(request?.voiceHostPath&&request.userText!==next){request.invalidated=true;active.endNativeRequestId=null;cancelAutomaticEnd(active);}
}
function providerMessage(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  const active = call;
  if (active && data.type === "session.started") void greetWhenReady(active);
  if (active && ((["turn.created", "turn.done"].includes(data.type) && data.turn?.role === "user")
    || (data.type === "input_transcript.added" && typeof data.item?.text === "string" && data.item.text.trim()))) suppressGreetingForCaller(active);
  if (active && data.type === "delegation.created") observeNativeEndDelegation(active, data.item);
  if (active && data.type === "turn.done" && data.turn?.role === "user" &&
    data.turn.id === active.latestNativeUserTurnId && typeof data.turn.transcript === "string" && data.turn.transcript.trim()) {
    active.completedNativeUserTurns ??= new Set(); active.completedNativeUserTurns.add(data.turn.id);
    active.completedNativeUserText=data.turn.transcript.trim();updateNativeUserText(active,data.turn.transcript);applyVoiceHostEnd(active);
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
       if(!spoken.includes(request.expectedFarewell)){request.turnId=null;request.terminalAt=null;request.audioObserved=false;request.quietSince=null;return;}
      }
      request.terminalAt=at;
    }
  }
  if (active && data.type === "output_audio_buffer.cleared") {
    const at = performance.now();
    duplexDiagnostic(active, { type: "native-output-audio-cleared", at });
    active.duplex.notifyOutputAudioCleared(at);
  }
  renderTranscript(presentation.consume(data, Date.now()));
  if (data.type === "error") setStatus("语音服务报告错误，请结束通话后重试。", { tone: "error" });
}
async function stopCall() {
  const active = call; call = null;
  if (starting === active) starting = null;
  if (active) {
    active.avatarTelemetry?.close();
    active.avatarReactions?.dispose();
    active.relay?.dispose();
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
  tasks.clear(); taskState(); document.body.dataset.voiceState = "idle";
  resetTranscript();
  $("conversation").scrollTop = 0;
  $("steerText").value = "";
  setCallState("idle");
  $("start").hidden = false; $("start").disabled = false; $("stop").hidden = true;
  $("steerText").disabled = true; $("steer").disabled = true;
  $("badge").textContent = liveReady ? "可以拨号" : "页面预览";
  $("startLabel").textContent = "拨号"; $("stopLabel").textContent = "结束通话";
  if ($("voiceModel")) $("voiceModel").disabled = false;
  setStatus("拨号后，直接说话。");
  if (active) {
    await active.context?.close().catch(() => {});
    if (active.voiceSessionId) await api("close", { voiceSessionId: active.voiceSessionId }).catch(() => {});
  }
}
async function startCall() {
  if (starting || call) return;
  if (!liveReady) { setStatus(entryError ?? "当前页面仅作预览，真实通话还未连接 VLab 候选服务。"); return; }
  $("start").disabled = true; $("start").hidden = true; $("stop").hidden = false;
  $("stopLabel").textContent = "取消拨号"; $("badge").textContent = "连接中";
  setCallState("dialing"); setStatus("正在连接 V…");
  resetTranscript();
  const active = { pc: new RTCPeerConnection(), captureAbort: new AbortController() }; call = active; starting = active;
  if ($("voiceModel")) $("voiceModel").disabled = true;
  if (['seeduplex','grok'].includes($("voiceModel")?.value)) {
    // Create/resume in the dial gesture, before microphone and network awaits.
    active.context = new AudioContext({latencyHint:"interactive"});
    active.contextResume = active.context.resume();
  }
  // Each call owns its sound element; a late play() from an older call cannot
  // pause or replace the next call's pickup. The page element configures assets.
  active.soundElement = document.createElement("audio"); active.soundElement.playsInline = true;
  for (const key of ["ringSrc", "pickupSrc"]) if ($("callSound").dataset[key]) active.soundElement.dataset[key] = $("callSound").dataset[key];
  active.sounds = createCallSounds({ audioElement: active.soundElement, sharedContext: active.context });
  void active.sounds.dial();
  // Activity metadata stays in this page's memory only. It contains no audio,
  // transcript, session identifiers or claim that the model was interrupted.
  active.duplexDiagnostics = { kind: "duplex-playback", schemaVersion: 2, closed: false,
    counts: {}, transitions: [], events: [] };
  globalThis.__gptLiveDuplexDiagnostics = active.duplexDiagnostics;
  active.duplex = createH5DuplexPlaybackGate({ mode: "native", onGateChange: (entry) => {
    if (call !== active) return;
    $("remoteAudio").muted = entry.localPlaybackMuted;
    duplexDiagnostic(active, { type: "local-playback-gate", at: entry.at,
      muted: entry.localPlaybackMuted, reason: entry.reason,
      oldTurnTerminal: entry.oldTurnTerminal, outputDrained: entry.outputDrained, ...playbackState(active) });
  } });
  active.duplexDiagnostics.playbackMode = active.duplex.snapshot().mode;
  active.duplexDiagnostics.interruptionOwner = active.duplex.snapshot().interruptionOwner;
  try {
    active.capture = await microphoneSession.acquire({
      mediaDevices: navigator.mediaDevices, signal: active.captureAbort.signal,
      isCurrent: () => call === active,
      onDiagnostics: (metadata) => { if (call === active) active.duplexDiagnostics.microphone = metadata; },
    });
    active.stream = active.capture.stream;
    if (call !== active) { active.stream.getTracks().forEach((track) => track.stop()); return; }
    const reservation = await api("session", {model:['seeduplex','grok'].includes($("voiceModel")?.value)?$("voiceModel").value:'gpt-live'}); active.voiceSessionId = reservation.voiceSessionId;
    if (call !== active) { await api("close", { voiceSessionId: active.voiceSessionId }); return; }
    const diagnosticOwner=avatarDiagnosticOwner=Symbol('avatar-call');
    document.body.dataset.avatarReactionRequests='0';
    document.body.dataset.avatarReactionApplied='0';
    document.body.dataset.avatarReactionResult='waiting';
    document.body.dataset.avatarReactionTimeline='[]';
    active.avatarTelemetry = createAvatarTelemetry({snapshot:()=>presentation.snapshot(),
      send:payload=>api('avatar-events',{voiceSessionId:active.voiceSessionId,...payload},{keepalive:true,signal:AbortSignal.timeout(5000)}),
    });
    document.body.dataset.avatarImageTimeline='[]';
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
    if (reservation.transport === 'gateway-relay') {
      await active.contextResume;
      if(call!==active)return;
      active.relay=createRelayAudio({context:active.context,stream:active.stream,reservation,
        onError:error=>{if(call===active)void stopCall().then(()=>setStatus(error.message, { tone: "error" }));},
        onClosed:()=>{if(call===active)void stopCall();},
        onPlaybackActivity:speaking=>{if(call===active)document.body.dataset.voiceState=speaking?'speaking':'listening';},
        onEvent:value=>{
          if(call!==active)return;
          if (value.type === 'avatar.expression') { avatar?.expression(value.expression); return; }
      tasks.consume(value);
          if(value.type==='backend.result')renderTranscript(presentation.consume(value));
          if(value.type.startsWith('tool.'))taskState();
          if(value.type==='playback.blocked')setStatus('声音播放已暂停，轻点页面继续。');
          if(value.type==='playback.resumed')setStatus('V 正在听，直接说话就好');
          if(value.type==='provider.reconnecting')setStatus('正在恢复语音连接…');
          if(value.type==='provider.recovered')setStatus('V 正在听，直接说话就好');
          if(value.type==='transcript') {
            active.relayTurns??={};
            const id=active.relayTurns[value.role]??=crypto.randomUUID();
            renderTranscript(presentation.consume(value.final?{type:'turn.done',turn:{id,role:value.role,transcript:value.text}}:
              {type:'output_transcript.delta',turn_id:id,delta:value.text}));
            if(value.final)delete active.relayTurns[value.role];
          }
        }});
      await active.relay.start();if(call!==active)return;
      setCallState('connected');$("badge").textContent='通话中';$("stopLabel").textContent='结束通话';
      $("steerText").disabled=false;$("steer").disabled=false;setStatus('V 正在听，直接说话就好');
      void active.sounds.connected();
      active.heartbeat=setInterval(()=>void api('heartbeat',{voiceSessionId:active.voiceSessionId}).catch(()=>{}),15000);
      return;
    }
    for (const track of active.stream.getAudioTracks()) active.pc.addTrack(track, active.stream);
    active.channel = active.pc.createDataChannel("oai-events"); active.channel.onmessage = (event) => { if (call === active) providerMessage(event); };
    active.events = new EventSource(apiUrl("events"));
    const applyNativeControl = value => {
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
      if (Number.isSafeInteger(value.revision)) active.presentationRevision = Math.max(active.presentationRevision ?? 0, value.revision);
      if (value.type === 'avatar.expression') { avatar?.expression(value.expression); return; }
      tasks.consume(value);
      if(value.type==='backend.result')renderTranscript(presentation.consume(value));
      applyNativeControl(value);
      taskState();
    };
    // Native voice audio remains on WebRTC. This authenticated snapshot only
    // recovers task/document presentation when an HTTPS proxy buffers SSE.
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
        for (const item of value.documents ?? []) renderTranscript(presentation.consume(item));
        active.presentationRevision = value.revision;
        active.documentRevision = value.revision;
        taskState();
      } catch { /* A transient presentation failure never closes the audio call. */ }
      finally { active.presentationFetching = false; }
    };
    active.presentationPoll = setInterval(() => void refreshPresentation(), 1500);
    void refreshPresentation();
    active.pc.ontrack = async (event) => {
      if (call !== active) return;
      const stream = new MediaStream([event.track]); $("remoteAudio").srcObject = stream;
      await startRemotePlayback(active, "track");
      if (call !== active) return;
      active.context = new AudioContext();
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
      active.context.createMediaStreamSource(active.stream).connect(microphoneAnalyser);
      const samples = new Float32Array(analyser.fftSize);
      const microphoneSamples = new Float32Array(microphoneAnalyser.fftSize);
      active.levelTimer = setInterval(() => {
        if (call !== active) return;
        analyser.getFloatTimeDomainData(samples);
        microphoneAnalyser.getFloatTimeDomainData(microphoneSamples);
        const energy = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const microphoneEnergy = Math.sqrt(microphoneSamples.reduce((sum, value) => sum + value * value, 0) / microphoneSamples.length);
        const at = performance.now();
        // This analyser reads the inbound stream before HTML playback muting,
        // so a local gate cannot manufacture evidence of a provider audio gap.
        const duplex = active.duplex.observe({ at, microphoneRms: microphoneEnergy, remoteRms: energy });
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
          if ($("status").textContent === duplexRecoveryMessage) connectedStatus(active);
        }
        document.body.dataset.voiceState = energy > .008 && !duplex.localPlaybackMuted && !active.playbackNeedsGesture ? "speaking" : "listening";
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
        $("stopLabel").textContent = "结束通话";
        $("badge").textContent = "通话中"; connectedStatus(active);
        $("start").hidden = true; $("stop").hidden = false;
        $("steerText").disabled = false; $("steer").disabled = false;
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
  } catch (error) { if (call === active) { await stopCall(); if (!call) setStatus(error.name === "NotAllowedError" ? "请允许麦克风访问后重试。" : error.message, { tone: "error" }); } }
  finally { if (starting === active) starting = null; if (!call) $("start").disabled = false; }
}
$("start").addEventListener("click", startCall);
$("stop").addEventListener("click", () => void stopCall());
// A tap anywhere can restore browser playback. Never gate/stop the microphone
// or cancel accepted work while requesting this user gesture.
window.addEventListener("pointerdown", () => { screenWakeLock.ensure(); void recoverPlaybackGesture(); });
window.addEventListener("keydown", () => void recoverPlaybackGesture());
$("steerForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const text = $("steerText").value.trim(); if (!text || !call) return;
  const active = call;
  try { await api("steer", { voiceSessionId: active.voiceSessionId, text, mode: "steer" }); if (call === active) { $("steerText").value = ""; productControls?.sent(); setStatus("补充条件已交给 V 的后台任务。", { tone: "success" }); } }
  catch (error) { if (call === active) setStatus(error.message, { tone: "error" }); }
});
$("cancel").addEventListener("click", async () => {
  if (!call) return;
  const active = call;
  try { await api("steer", { voiceSessionId: active.voiceSessionId, text: "取消当前后台任务，不要继续执行。", mode: "cancel" }); if (call === active) setStatus("已请求取消后台任务。", { tone: "success" }); }
  catch (error) { if (call === active) setStatus(error.message, { tone: "error" }); }
});
window.addEventListener("pagehide", () => {
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
async function initializeEntry() {
  try {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const access = fragment.get("access");
    if (access) {
      callerEntry = "tianyi";
      // The share credential stays in the URL fragment until exchanged for the
      // existing HttpOnly voice cookie; never send it as a query or log field.
      await api("access", { access });
      const search = new URLSearchParams(window.location.search);
      if (!phoneEntry) search.set("entry", "tianyi");
      window.history.replaceState(null, "", `${window.location.pathname}?${search}`);
    }
    const response = await fetch(apiUrl("status"));
    const status = await response.json();
    if (!response.ok) throw new Error(status.error ?? "暂时无法连接 V，请稍后重试。");
    liveReady = status.ready === true;
    if ($("voiceModel")) for(const model of status.models??[]) {
      const option=[...$("voiceModel").options].find(o=>o.value===model.id);
      if(option)option.disabled=!model.available;
    }
    const select = $("voiceModel");
    if (select?.options && [...select.options].find(option => option.value === select.value)?.disabled) {
      select.value = ['seeduplex', 'gpt-live', 'grok'].find(id => [...select.options].some(option => option.value === id && !option.disabled)) ?? select.value;
    }
    productControls?.refreshModels();
    $("badge").textContent = liveReady ? "可以拨号" : "页面预览";
    if (!liveReady) setStatus("这是页面预览，真实通话需连接候选服务。");
  } catch (error) {
    liveReady = false;
    entryError = error.message ?? "暂时无法连接 V，请稍后重试。";
    $("badge").textContent = "暂未连接";
    setStatus(entryError, { tone: "error" });
  }
}
void initializeEntry();
