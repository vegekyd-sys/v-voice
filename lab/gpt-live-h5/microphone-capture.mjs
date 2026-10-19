/**
 * Browser AEC processes the real capture track before it reaches WebRTC/VAD.
 * This helper never mutes input during playback or filters user transcripts.
 * A reported enabled setting is configuration evidence, not an acoustic test.
 * https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
 * https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings
 */
const PROCESSING_KEYS = ["echoCancellation", "noiseSuppression", "autoGainControl"];
const ECHO_MODES = new Set(["all", "remote-only"]);

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}
function abortError() {
  const error = new Error("麦克风采集已结束。"); error.name = "AbortError"; return error;
}
function supportedProcessing(mediaDevices) {
  let values;
  try { values = mediaDevices.getSupportedConstraints?.(); } catch { values = null; }
  return Object.fromEntries(PROCESSING_KEYS.map(key => [key,
    values && typeof values === "object" ? values[key] === true : null]));
}
export function duplexMicrophoneConstraints(supported = {}) {
  return {
    audio: {
      // Supported browsers must not silently choose capture with AEC disabled.
      // Unknown APIs retain the portable preference; settings remain unverified.
      echoCancellation: supported.echoCancellation === true ? { exact: true } : true,
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
    },
    video: false,
  };
}
function processingValue(key, value) {
  if (typeof value === "boolean") return value;
  if (key === "echoCancellation" && ECHO_MODES.has(value)) return value;
  return null;
}
function status(value) {
  return value === false ? "disabled" : value === null ? "unverified" : "enabled";
}
export function microphoneProcessingDiagnostics(track, supported = {}) {
  let values;
  try { values = track?.getSettings?.(); } catch { values = null; }
  const actual = Object.fromEntries(PROCESSING_KEYS.map(key => [key,
    processingValue(key, values?.[key])]));
  const settings = { ...actual };
  for (const key of ["sampleRate", "channelCount", "latency"])
    settings[key] = typeof values?.[key] === "number" && Number.isFinite(values[key]) && values[key] >= 0 ? values[key] : null;
  return {
    kind: "browser-microphone-processing",
    supported: Object.fromEntries(PROCESSING_KEYS.map(key => [key,
      typeof supported[key] === "boolean" ? supported[key] : null])),
    requested: { echoCancellation: true, echoCancellationRequired: supported.echoCancellation === true,
      noiseSuppression: true, autoGainControl: true },
    settings,
    processing: Object.fromEntries(PROCESSING_KEYS.map(key => [key, status(actual[key])])),
    trackLive: track?.readyState === "live",
    trackEnabled: track?.enabled === true,
    trackMuted: track?.muted === true,
    acousticEchoTestPassed: false,
    // No device IDs, labels, audio, transcript or permission/session identifiers.
  };
}

export async function captureDuplexMicrophone({
  mediaDevices = globalThis.navigator?.mediaDevices,
  signal,
  isCurrent = () => true,
  onDiagnostics = () => {},
} = {}) {
  if (typeof mediaDevices?.getUserMedia !== "function") throw new TypeError("浏览器无法采集麦克风，请使用 HTTPS 或本机页面。");
  if (typeof isCurrent !== "function" || typeof onDiagnostics !== "function") throw new TypeError("Microphone lifecycle callbacks must be functions");
  if (signal?.aborted || !isCurrent()) throw abortError();
  const supported = supportedProcessing(mediaDevices), constraints = duplexMicrophoneConstraints(supported);
  let stream, disposed = false, removeAbort = () => {};
  const pending = Promise.resolve().then(() => {
    if (disposed || signal?.aborted || !isCurrent()) throw abortError();
    return mediaDevices.getUserMedia(constraints);
  }).then(value => {
    stream = value;
    if (disposed || signal?.aborted || !isCurrent()) { stopStream(value); throw abortError(); }
    return value;
  });
  // Permission prompts are not cancelable. The late-resolution branch above
  // stops their eventual tracks, while an abort can release the page now.
  let abortPending;
  if (signal) abortPending = new Promise((_, reject) => {
    const aborted = () => { disposed = true; stopStream(stream); reject(abortError()); };
    signal.addEventListener("abort", aborted, { once: true });
    removeAbort = () => signal.removeEventListener("abort", aborted);
    if (signal.aborted) aborted();
  });
  try {
    await (abortPending ? Promise.race([pending, abortPending]) : pending);
    if (disposed || signal?.aborted || !isCurrent()) throw abortError();
    const track = stream?.getAudioTracks?.()[0];
    if (!track || track.readyState !== "live" || track.enabled !== true) throw new Error("麦克风轨道尚未就绪。");
    const snapshot = () => microphoneProcessingDiagnostics(track, supported);
    const diagnostics = snapshot();
    // Observability cannot alter the audio path or break capture cleanup.
    try { onDiagnostics(diagnostics); } catch {}
    // The observer may synchronously close the call. A current owner at the
    // permission resolution is also insufficient across await continuations.
    if (disposed || signal?.aborted || !isCurrent()) throw abortError();
    if (track.readyState !== "live" || track.enabled !== true) throw new Error("麦克风轨道尚未就绪。");
    if (diagnostics.processing.echoCancellation === "disabled") {
      const error = new Error("浏览器未启用回声消除，请更换支持的浏览器或检查麦克风设置。");
      error.name = "EchoCancellationUnavailableError"; throw error;
    }
    // Return the original processed capture stream: both the app's microphone
    // analyser and the RTC sender must read this same continuous track.
    return {
      stream, track, diagnostics, snapshot,
      dispose() { if (!disposed) { disposed = true; stopStream(stream); } removeAbort(); },
    };
  } catch (error) {
    disposed = true; stopStream(stream); removeAbort(); throw error;
  }
}
