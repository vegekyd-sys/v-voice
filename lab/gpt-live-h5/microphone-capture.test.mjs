import test from "node:test";
import assert from "node:assert/strict";
import { captureDuplexMicrophone, duplexMicrophoneConstraints, microphoneProcessingDiagnostics } from "./microphone-capture.mjs";

function fixture(settings = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }) {
  const calls = [];
  const track = { kind: "audio", enabled: true, readyState: "live", getSettings: () => settings,
    stop() { this.readyState = "ended"; calls.push("stop"); } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const mediaDevices = { getSupportedConstraints: () => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
    async getUserMedia(constraints) { calls.push(constraints); return stream; } };
  return { track, stream, calls, mediaDevices };
}
test("supported AEC is mandatory; noise suppression and gain are explicit portable preferences", () => {
  assert.deepEqual(duplexMicrophoneConstraints({ echoCancellation: true }), {
    audio: { echoCancellation: { exact: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } }, video: false,
  });
  assert.equal(duplexMicrophoneConstraints({}).audio.echoCancellation, true);
});
test("returns original processed capture track, keeps barge-in input live, and disposes only on close", async () => {
  const f = fixture(), reports = [];
  const capture = await captureDuplexMicrophone({ mediaDevices: f.mediaDevices, onDiagnostics: value => reports.push(value) });
  assert.equal(capture.stream, f.stream); assert.equal(capture.track, f.track);
  assert.equal(capture.track.enabled, true); assert.equal(capture.track.readyState, "live");
  assert.equal(reports[0].processing.echoCancellation, "enabled");
  assert.equal(reports[0].acousticEchoTestPassed, false);
  capture.dispose(); capture.dispose(); assert.equal(f.calls.filter(v => v === "stop").length, 1);
});
test("actual settings can contradict support; reported AEC disabled stops capture rather than silently shipping echo", async () => {
  const f = fixture({ echoCancellation: false, noiseSuppression: true, autoGainControl: true }), reports = [];
  await assert.rejects(captureDuplexMicrophone({ mediaDevices: f.mediaDevices, onDiagnostics: value => reports.push(value) }), { name: "EchoCancellationUnavailableError" });
  assert.equal(reports[0].supported.echoCancellation, true);
  assert.equal(reports[0].processing.echoCancellation, "disabled");
  assert.equal(f.track.readyState, "ended");
});
test("missing settings are unverified and never mislabeled enabled; unrelated device metadata cannot escape", async () => {
  const f = fixture({ deviceId: "private-id", groupId: "private-group", label: "private-device", sampleRate: 48000, channelCount: 1, latency: .02 });
  const capture = await captureDuplexMicrophone({ mediaDevices: f.mediaDevices });
  assert.equal(capture.diagnostics.processing.echoCancellation, "unverified");
  assert.equal(capture.diagnostics.settings.echoCancellation, null);
  assert.equal(capture.diagnostics.settings.sampleRate, 48000);
  const json = JSON.stringify(capture.diagnostics);
  for (const marker of ["deviceId", "groupId", "label", "private-"]) assert(!json.includes(marker));
  capture.dispose();
});
test("new standard echo modes are recognized only if actually reported, with no speculative mode request", () => {
  for (const mode of ["all", "remote-only"]) {
    const f = fixture({ echoCancellation: mode });
    assert.equal(microphoneProcessingDiagnostics(f.track).processing.echoCancellation, "enabled");
    assert.equal(microphoneProcessingDiagnostics(f.track).settings.echoCancellation, mode);
  }
  const f = fixture({ echoCancellation: "invented-mode", sampleRate: Infinity });
  assert.equal(microphoneProcessingDiagnostics(f.track).processing.echoCancellation, "unverified");
  assert.equal(microphoneProcessingDiagnostics(f.track).settings.sampleRate, null);
});
test("abort while permission is pending settles promptly and stops any subsequently granted track", async () => {
  const f = fixture(); let resolve;
  f.mediaDevices.getUserMedia = () => new Promise(r => { resolve = r; });
  const controller = new AbortController();
  const pending = captureDuplexMicrophone({ mediaDevices: f.mediaDevices, signal: controller.signal });
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  resolve(f.stream); await new Promise(r => setImmediate(r));
  assert.equal(f.track.readyState, "ended");
});
test("closed owner and post-capture abort cannot leave a live microphone or change another call", async () => {
  const f = fixture(); let current = true;
  f.mediaDevices.getUserMedia = async () => { current = false; return f.stream; };
  await assert.rejects(captureDuplexMicrophone({ mediaDevices: f.mediaDevices, isCurrent: () => current }), { name: "AbortError" });
  assert.equal(f.track.readyState, "ended");
  const other = fixture(), controller = new AbortController();
  const capture = await captureDuplexMicrophone({ mediaDevices: other.mediaDevices, signal: controller.signal });
  controller.abort(); assert.equal(capture.track.readyState, "ended");
  assert.equal(capture.track.enabled, true); capture.dispose();
});
test("constraint refusal propagates without an audio:true retry or relaxing AEC", async () => {
  const f = fixture(); let count = 0;
  f.mediaDevices.getUserMedia = async () => { count++; const error = new Error("Unavailable"); error.name = "OverconstrainedError"; throw error; };
  await assert.rejects(captureDuplexMicrophone({ mediaDevices: f.mediaDevices }), { name: "OverconstrainedError" });
  assert.equal(count, 1);
});
test("unavailable settings API and diagnostic callback failure do not invent processing or disrupt the track", async () => {
  const f = fixture(); f.mediaDevices.getSupportedConstraints = () => { throw new Error("Unavailable"); };
  f.track.getSettings = () => { throw new Error("Unavailable"); };
  const capture = await captureDuplexMicrophone({ mediaDevices: f.mediaDevices, onDiagnostics: () => { throw new Error("Observer"); } });
  assert.equal(capture.diagnostics.supported.echoCancellation, null);
  assert.equal(capture.diagnostics.processing.echoCancellation, "unverified");
  assert.equal(capture.track.readyState, "live"); capture.dispose();
});
test("observer-triggered abort cannot return an ended capture as ready", async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(captureDuplexMicrophone({ mediaDevices: f.mediaDevices, signal: controller.signal,
    onDiagnostics: () => controller.abort() }), { name: "AbortError" });
  assert.equal(f.track.readyState, "ended");
});
test("owner invalidation between permission settlement and await resumption stops the mic", async () => {
  const f = fixture(); let current = true, checks = 0;
  const isCurrent = () => {
    checks++;
    if (checks === 3) queueMicrotask(() => { current = false; });
    return current;
  };
  await assert.rejects(captureDuplexMicrophone({ mediaDevices: f.mediaDevices, isCurrent }), { name: "AbortError" });
  assert.equal(f.track.readyState, "ended");
});
