import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createAvatarTasks, ACTIVITY_LABELS } from "./avatar-state.mjs";
import { createTranscriptPresentation } from "./transcript-presentation.mjs";
import { createPageMicrophoneSession } from "./microphone-session.mjs";
import { createScreenWakeLock } from "./screen-wake-lock.mjs";
import { entryStartup, startVoiceEntry } from "./entry-startup.mjs";
import { mountChangelog } from "./changelog.mjs";
import { createH5DuplexPlaybackGate } from "./duplex-playback.mjs";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8")
  .replace(/^import \{[^\n]+\} from "[^"]+";\n/gmu, "");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const track = (kind = "audio") => ({ kind, readyState: "live", enabled: true, getSettings: () => ({echoCancellation: true, noiseSuppression: true, autoGainControl: true}), stopped: 0, stop() { this.stopped++; this.readyState = "ended"; } });
const stream = (tracks) => ({ getTracks: () => tracks, getAudioTracks: () => tracks.filter((item) => item.kind === "audio") });

async function fixture(t, options = {}) {
  class Element {
    dataset = {};
    children = [];
    listeners = new Map();
    textContent = "";
    value = "";
    hidden = false;
    disabled = false;
    srcObject = null;
    muted = false;
    paused = true;
    volume = 1;
    readyState = 4;
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    scrollTop = 0;
    clientHeight = 100;
    append(...children) {
      for (const child of children) {
        if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child);
        this.children.push(child); child.parent = this;
      }
    }
    insertBefore(child, before) {
      if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child);
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, child); child.parent = this;
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(value => value !== this); this.parent = null; }
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
    querySelector() { return null; }
    get scrollHeight() { return this.children.length; }
    async play() {
      try { await (options.play?.() ?? Promise.resolve()); this.paused = false; }
      catch (error) { this.paused = true; throw error; }
    }
  }
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const body = { dataset: {} };
  const requests = [];
  const peers = [];
  const eventSources = [];
  const contexts = [];
  const sounds = [];
  const pageEvents = new Map(), beacons = [];
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  let sessionId = 0;
  let relayTurnId = 0;
  let now = 0;
  const levels = { microphone: 0, remote: 0 };
  class Peer {
    iceGatheringState = "complete";
    connectionState = "new";
    tracks = [];
    closed = false;
    constructor() { peers.push(this); }
    addTrack(value) { this.tracks.push(value); }
    createDataChannel() { return this.channel = { closed: false, close() { this.closed = true; } }; }
    async createOffer() { return { type: "offer", sdp: "v=0\r\noffer" }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; return await options.remoteDescription?.(value); }
    addEventListener() {}
    close() { this.closed = true; }
  }
  class AudioContext {
    state = "running";
    closeCount = 0;
    constructor() { contexts.push(this); }
    analyserCount = 0;
    resume() { return options.resume?.() ?? Promise.resolve(); }
    async close() { this.state = "closed"; this.closeCount++; }
    createAnalyser() {
      const kind = this.analyserCount++ === 0 ? "remote" : "microphone";
      return { fftSize: 1024, getFloatTimeDomainData: (values) => values.fill(levels[kind]) };
    }
    createMediaStreamSource() { return { connect() {} }; }
  }
  class EventSource {
    closed = false;
    constructor() { eventSources.push(this); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({
    renderMarkdown: (target,text) => { target.textContent = text; }, createTranscriptPresentation, createPageMicrophoneSession, createScreenWakeLock, createAvatarTasks, ACTIVITY_LABELS,
    createContentView: () => options.contentView,
    mountProductControls: () => ({ callState() {}, refreshModels() {} }),
    entryStartup, startVoiceEntry, markVoiceTiming: () => {}, mountChangelog,
    createRelayAudio: values => options.relayFactory(values),
    mountAvatar: () => options.avatar,
    createAvatarReactions: () => options.reactions,
    crypto: { randomUUID: () => `relay-turn-${++relayTurnId}` },
    createAvatarTelemetry: values=>options.telemetry?.(values)??{close(){},decision(){},display(){}},
    AbortSignal,
    AbortController,
    createCallSounds: () => {
      const value = { dialing: 0, pickups: 0, disposed: 0, dial() { this.dialing++; }, connected() { this.pickups++; }, dispose() { this.disposed++; } };
      sounds.push(value); return value;
    },
    createH5DuplexPlaybackGate: values => createH5DuplexPlaybackGate({...values, mode: options.playbackMode ?? values.mode}),
    performance: { now: () => now },
    document: { body, getElementById: element, createElement: () => new Element(),
      ...(options.contentView ? { querySelector: () => null } : {}) },
    URLSearchParams,
    window: {
      ...(options.avatar ? { Image: function Image() {} } : {}),
      location: { hash: options.hash ?? "", pathname: "/voice/", search: options.search ?? "" },
      history: { replaceState: (...args) => options.replaceState?.(...args) },
      addEventListener: (type, listener) => pageEvents.set(type, listener),
    },
    navigator: { mediaDevices: { getUserMedia: () => options.getUserMedia?.() ?? Promise.resolve(stream([track()])) }, sendBeacon: (url, body) => { beacons.push({url,body}); return true; } },
    RTCPeerConnection: Peer,
    AudioContext,
    EventSource,
    MediaStream: class { constructor(tracks) { Object.assign(this, stream(tracks)); } },
    Blob,
    fetch: async (url, init) => {
      const route = url.split("?")[0].split("/").at(-1);
      const payload = init?.body ? JSON.parse(init.body) : undefined;
      requests.push({ route, payload, url });
      const defaultResult = route === "status" ? { ready: true }
        : route === "session" ? { voiceSessionId: `voice-${++sessionId}` }
        : route === "offer" ? { sdp: "v=0\r\nanswer" } : { ok: true };
      const result = await (options.api?.(route, payload, defaultResult, init) ?? defaultResult);
      return { ok: true, json: async () => result };
    },
    setInterval: (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (callback, delay) => { const id = ++timerId; timeouts.set(id, { callback, delay, at: now }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
  });
  vm.runInContext(appSource, context, { filename: "gpt-live-h5/app.js" });
  await tick();
  t.after(() => context.stopCall());
  const meter = (at, microphone, remote) => {
    now = at; levels.microphone = microphone; levels.remote = remote;
    for (const value of intervals.values()) if (value.delay === 50) value.callback();
  };
  return { context, element, body, requests, peers, contexts, sounds, pageEvents, beacons, eventSources, intervals, timeouts, meter, setNow: value => {now = value;} };
}

test("dial stays unavailable until the real entry check finishes; no session starts while waiting", async t => {
  const status = deferred();
  const f = await fixture(t, { api: (route, payload, fallback) => route === "status" ? status.promise : fallback });
  // Match the initial HTML's disabled button in this minimal DOM fixture.
  f.element("start").disabled = true;
  await f.context.startCall();
  assert.equal(f.requests.some(row => row.route === "session"), false);
  status.resolve({ ready: true });
  await tick();
  assert.equal(f.element("start").disabled, false);
  assert.equal(f.element("badge").textContent, "可以拨号");
});

test("shared voice link exchanges fragment access before status and removes the credential", async t => {
  const replaced = [];
  const f = await fixture(t, { hash: "#access=private-test-access", replaceState: (...args) => replaced.push(args) });
  assert.deepEqual(f.requests.slice(0, 2).map(row => row.route), ["access", "status"]);
  assert.equal(f.requests[0].payload.access, "private-test-access");
  assert.equal(replaced[0][2], "/voice/?entry=tianyi");
  assert.equal(f.requests[1].url, "./api/status?entry=tianyi");
  assert.equal(f.requests.some(row => row.route === "session"), false);
});

test("bare personal page and retained owner link use the owner API on every operation", async t => {
  const personal = await fixture(t);
  assert.equal(personal.requests[0].url, "./api/status?entry=tianyi");
  const owner = await fixture(t, { search: "?entry=tianyi" });
  await owner.context.startCall();
  await owner.context.stopCall();
  assert.ok(owner.requests.some(row => row.route === "session"));
  assert.ok(owner.requests.every(row => new URL(row.url, 'https://voice.test/voice/').searchParams.get('entry') === 'tianyi'));
});

test("stopping before microphone permission returns releases every late track without creating a session", async (t) => {
  const permission = deferred();
  const f = await fixture(t, { getUserMedia: () => permission.promise });
  const starting = f.context.startCall();
  await tick();
  await f.context.stopCall();
  const tracks = [track(), track(), track("video")];
  permission.resolve(stream(tracks));
  await starting; await tick();
  assert(tracks.every((item) => item.stopped === 1));
  assert.equal(f.requests.filter(({ route }) => route === "session" || route === "offer").length, 0);
  assert.equal(f.peers[0].closed, true);
  assert.equal(f.contexts.length, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.element("start").disabled, false);
  assert.equal(f.body.dataset.voiceState, "idle");
});

test("a remote audio play that resolves after stop cannot create an AudioContext or meter timer", async (t) => {
  const playback = deferred();
  const f = await fixture(t, { play: () => playback.promise });
  await f.context.startCall();
  const playing = f.peers[0].ontrack({ track: track() });
  await tick();
  assert(f.element("remoteAudio").srcObject);
  await f.context.stopCall();
  playback.resolve();
  await playing;
  assert.equal(f.contexts.length, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.element("remoteAudio").srcObject, null);
  assert.equal(f.body.dataset.voiceState, "idle");
});

test("an AudioContext resume that resolves after stop closes the context and never installs a meter", async (t) => {
  const resuming = deferred();
  const f = await fixture(t, { resume: () => resuming.promise });
  await f.context.startCall();
  const playing = f.peers[0].ontrack({ track: track() });
  await tick();
  assert.equal(f.contexts.length, 1);
  await f.context.stopCall();
  resuming.resolve();
  await playing;
  assert.equal(f.contexts[0].state, "closed");
  assert(f.contexts[0].closeCount >= 1);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.element("remoteAudio").srcObject, null);
});

test("a rejected old playback cannot overwrite the stopped call status", async (t) => {
  const playback = deferred();
  const f = await fixture(t, { play: () => playback.promise });
  await f.context.startCall();
  const playing = f.peers[0].ontrack({ track: track() });
  await tick();
  await f.context.stopCall();
  const status = f.element("status").textContent;
  playback.reject(new Error("late autoplay failure"));
  await playing;
  assert.equal(f.element("status").textContent, status);
  assert.equal(f.contexts.length, 0);
  assert.equal(f.intervals.size, 0);
});

test("a remote description that finishes after stop cannot leak a heartbeat timer", async (t) => {
  const remote = deferred();
  const f = await fixture(t, { remoteDescription: () => remote.promise });
  const starting = f.context.startCall();
  await tick();
  assert(f.peers[0].remoteDescription);
  await f.context.stopCall();
  remote.resolve();
  await starting;
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.peers[0].closed, true);
});

test("native transcript added and turn.done update a single row and repeated final does not duplicate it", async (t) => {
  const f = await fixture(t);
  await f.context.startCall();
  const send = (payload) => f.peers[0].channel.onmessage({ data: JSON.stringify(payload) });
  send({ type: "input_transcript.added", item: { id: "fragment-1", text: "请查" } });
  send({ type: "input_transcript.added", item: { id: "fragment-2", text: "周四" } });
  const current = f.element("transcriptCurrentRows"), history = f.element("transcriptHistory");
  const row = current.children[0];
  assert.equal(current.children.length, 1);
  assert.equal(row.parts.text.textContent, "请查周四");
  send({ type: "turn.done", turn: { id: "turn-user-1", role: "user", transcript: "请查周四的日程" } });
  send({ type: "turn.done", turn: { id: "turn-user-1", role: "user", transcript: "请查周四的日程" } });
  assert.equal(history.children.length, 1);
  assert.equal(current.children.length, 0);
  assert.equal(history.children[0], row, "The same row moves from live content to completed history");
  assert.equal(row.parts.text.textContent, "请查周四的日程");
  send({ type: "output_transcript.added", item: { id: "assistant-fragment", text: "正在查询" } });
  send({ type: "turn.done", turn: { id: "turn-assistant-1", role: "assistant", transcript: "正在查询你的日程" } });
  assert.deepEqual(history.children.map((row) => [row.parts.speaker.textContent, row.parts.text.textContent]), [["你", "请查周四的日程"], ["V", "正在查询你的日程"]]);
});

test("data channel and event stream callbacks from an old call cannot alter the new call UI", async (t) => {
  const f = await fixture(t);
  await f.context.startCall();
  const oldPeer = f.peers[0];
  const oldEvents = f.eventSources[0];
  await f.context.stopCall();
  await f.context.startCall();
  const currentPeer = f.peers[1];
  currentPeer.connectionState = "connected";
  currentPeer.onconnectionstatechange();
  const before = { status: f.element("status").textContent, badge: f.element("badge").textContent, taskStatus: f.element("taskStatus").textContent };
  oldPeer.channel.onmessage({ data: JSON.stringify({ type: "input_transcript.added", item: { text: "旧通话字幕" } }) });
  oldPeer.channel.onmessage({ data: JSON.stringify({ type: "error" }) });
  oldEvents.onmessage({ data: JSON.stringify({ voiceSessionId: "voice-1", type: "tool.call", callId: "old-task" }) });
  oldPeer.connectionState = "disconnected";
  oldPeer.onconnectionstatechange();
  await tick();
  assert.deepEqual({ status: f.element("status").textContent, badge: f.element("badge").textContent, taskStatus: f.element("taskStatus").textContent }, before);
  assert.equal(f.element("transcriptHistory").children.length + f.element("transcriptCurrentRows").children.length, 0);
  assert.equal(currentPeer.closed, false);
  currentPeer.channel.onmessage({ data: JSON.stringify({ type: "output_transcript.added", item: { text: "新通话字幕" } }) });
  assert.equal(f.element("transcriptCurrentRows").children[0].parts.text.textContent, "新通话字幕");
});

test("an old close response cannot reset a new connected call UI or its remote audio", async (t) => {
  const closing = deferred();
  const f = await fixture(t, { api: (route, payload, result) => route === "close" && payload.voiceSessionId === "voice-1" ? closing.promise : result });
  await f.context.startCall();
  const stopping = f.context.stopCall();
  await tick();
  await f.context.startCall();
  const peer = f.peers[1];
  peer.connectionState = "connected";
  peer.onconnectionstatechange();
  await peer.ontrack({ track: track() });
  const audio = f.element("remoteAudio").srcObject;
  const state = () => ({
    status: f.element("status").textContent,
    badge: f.element("badge").textContent,
    startHidden: f.element("start").hidden,
    stopHidden: f.element("stop").hidden,
    steerDisabled: f.element("steer").disabled,
    voiceState: f.body.dataset.voiceState,
  });
  const before = state();
  closing.resolve({ ok: true });
  await stopping;
  assert.deepEqual(state(), before);
  assert.equal(f.element("remoteAudio").srcObject, audio);
  assert.equal(peer.closed, false);
});

for (const mode of ["steer", "cancel"]) for (const outcome of ["success", "failure"]) {
  test(`a ${mode} ${outcome} from an ended call cannot change the new call status or input`, async (t) => {
    const reply = deferred();
    const f = await fixture(t, { api: (route, payload, result) => route === "steer" && payload.voiceSessionId === "voice-1" ? reply.promise : result });
    await f.context.startCall();
    f.element("steerText").value = "旧通话条件";
    const request = mode === "steer"
      ? f.element("steerForm").listeners.get("submit")({ preventDefault() {} })
      : f.element("cancel").listeners.get("click")();
    await tick();
    assert.equal(f.requests.at(-1).route, "steer");
    assert.equal(f.requests.at(-1).payload.mode, mode);
    await f.context.stopCall();
    await f.context.startCall();
    const peer = f.peers[1];
    peer.connectionState = "connected";
    peer.onconnectionstatechange();
    f.element("steerText").value = "新通话尚未提交的条件";
    const status = f.element("status").textContent;
    if (outcome === "success") reply.resolve({ ok: true });
    else reply.reject(new Error("old call request failed"));
    await request;
    assert.equal(f.element("status").textContent, status);
    assert.equal(f.element("steerText").value, "新通话尚未提交的条件");
    assert.equal(peer.closed, false);
  });
}

test("old disconnected-call cleanup cannot replace a new connected call status", async (t) => {
  const closing = deferred();
  const f = await fixture(t, { api: (route, payload, result) => route === "close" && payload.voiceSessionId === "voice-1" ? closing.promise : result });
  await f.context.startCall();
  const oldPeer = f.peers[0];
  oldPeer.connectionState = "disconnected";
  oldPeer.onconnectionstatechange();
  await tick();
  assert.equal(f.requests.at(-1).route, "close");
  await f.context.startCall();
  const peer = f.peers[1];
  peer.connectionState = "connected";
  peer.onconnectionstatechange();
  const status = f.element("status").textContent;
  closing.resolve({ ok: true });
  await tick();
  assert.equal(f.element("status").textContent, status);
  assert.equal(f.element("badge").textContent, "通话中");
  assert.equal(peer.closed, false);
});

test("real app microphone gate mutes playback while leaving the call and backend active", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall();
  const peer = f.peers[0]; await peer.ontrack({track: track()});
  const incoming = f.element("remoteAudio").srcObject;
  f.eventSources[0].onmessage({data: JSON.stringify({voiceSessionId: "voice-1", type: "tool.call", callId: "backend-work"})});
  const before = f.requests.length;
  f.meter(0, .04, .2); f.meter(50, .04, .2); f.meter(100, .04, .2);
  assert.equal(f.element("remoteAudio").muted, true);
  assert.equal(f.element("remoteAudio").srcObject, incoming);
  assert.equal(peer.closed, false);
  assert(peer.tracks.every(value => value.stopped === 0));
  assert.equal(f.element("cancel").disabled, false, "Accepted backend request remains pending");
  assert.equal(f.requests.length, before, "Local speech does not send a cancel/steer/close API call");
  assert.equal(f.body.dataset.voiceState, "listening");
  assert.equal(f.context.__gptLiveDuplexDiagnostics.events.at(-1).remoteActive, true,
    "The upstream signal remains observable while local playback is muted");
});

test("real app resumes only after the frozen assistant ends and queued inbound audio drains", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall(); await f.peers[0].ontrack({track: track()});
  f.peers[0].channel.onmessage({data: JSON.stringify({type: "turn.created", turn: {role: "assistant", id: "old"}})});
  f.meter(0, .04, .2); f.meter(50, .04, .2); f.meter(100, .04, .2);
  for (let at = 150; at <= 600; at += 50) f.meter(at, 0, .2);
  assert.equal(f.element("remoteAudio").muted, true);
  f.setNow(625);
  f.peers[0].channel.onmessage({data: JSON.stringify({type: "turn.done", turn: {role: "assistant", id: "old"}})});
  assert.equal(f.element("remoteAudio").muted, true, "turn.done alone is not audio clear");
  for (let at = 650; at <= 900; at += 50) f.meter(at, 0, 0);
  assert.equal(f.element("remoteAudio").muted, false);
  f.meter(950, 0, .2);
  assert.equal(f.body.dataset.voiceState, "speaking");
});

test("native user turn provides a local fallback without claiming or sending model interruption", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall(); await f.peers[0].ontrack({track: track()});
  f.meter(0, .005, .2);
  f.setNow(20);
  f.peers[0].channel.onmessage({data: JSON.stringify({type: "turn.created", turn: {role: "user", id: "private-turn"}})});
  assert.equal(f.element("remoteAudio").muted, true);
  const diagnostics = f.context.__gptLiveDuplexDiagnostics;
  assert(diagnostics.events.some(value => value.type === "native-turn-created" && value.role === "user"));
  assert(diagnostics.events.some(value => value.type === "local-playback-gate" && value.reason === "provider-user-turn-start"));
  f.peers[0].channel.onmessage({data: JSON.stringify({type: "output_audio_buffer.cleared"})});
  assert(diagnostics.events.some(value => value.type === "native-output-audio-cleared"));
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-turn|transcript|model.?interrupted/u);
  assert(!f.requests.some(({route}) => route === "steer" || route === "close"));
});

test("first caller speech without old output leaves the first answer audible", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall(); await f.peers[0].ontrack({track: track()});
  for (let at = 0; at <= 100; at += 50) f.meter(at, .04, 0);
  for (let at = 150; at <= 600; at += 50) f.meter(at, 0, 0);
  f.setNow(625);
  f.peers[0].channel.onmessage({data: JSON.stringify({type: "turn.created", turn: {role: "assistant", id: "first"}})});
  f.meter(650, 0, .2);
  assert.equal(f.element("remoteAudio").muted, false);
  assert.equal(f.body.dataset.voiceState, "speaking");
  assert(!f.context.__gptLiveDuplexDiagnostics.events.some(value => value.type === "local-playback-gate"));
});

test("a long old-answer pause, context ack, captions and new created event do not unlock playback", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall(); await f.peers[0].ontrack({track: track()});
  const send = payload => f.peers[0].channel.onmessage({data: JSON.stringify(payload)});
  send({type: "turn.created", turn: {role: "assistant", id: "private-old"}});
  f.meter(0, .04, .2); f.meter(50, .04, .2); f.meter(100, .04, .2);
  for (let at = 150; at <= 600; at += 50) f.meter(at, 0, 0);
  f.setNow(625);
  send({type: "session.context.appended"});
  send({type: "output_transcript.added", item: {id: "private-caption", text: "旧回答后续"}});
  send({type: "turn.created", turn: {role: "assistant", id: "private-new"}});
  send({type: "turn.done", turn: {role: "assistant", id: "private-new"}});
  for (let at = 650; at <= 1100; at += 50) f.meter(at, 0, 0);
  assert.equal(f.element("remoteAudio").muted, true);
  const sample = f.context.__gptLiveDuplexDiagnostics.events.at(-1);
  assert.equal(sample.oldTurnTerminal, false);
  assert.equal(sample.outputDrained, false);
  f.meter(1150, 0, .2);
  assert.equal(f.element("remoteAudio").muted, true, "The resumed old tail stays muted");
  f.setNow(1175); send({type: "turn.done", turn: {role: "assistant", id: "private-old"}});
  for (let at = 1200; at <= 1450; at += 50) f.meter(at, 0, 0);
  assert.equal(f.element("remoteAudio").muted, false);
  assert.doesNotMatch(JSON.stringify(f.context.__gptLiveDuplexDiagnostics), /private-|旧回答后续/u);
});

test("late assistant metadata needs a real terminal and fresh drain before unknown output can recover", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall(); await f.peers[0].ontrack({track: track()});
  const send = payload => f.peers[0].channel.onmessage({data: JSON.stringify(payload)});
  f.meter(0, .04, .2); f.meter(50, .04, .2); f.meter(100, .04, .2);
  for (let at = 150; at <= 600; at += 50) f.meter(at, 0, 0);
  f.setNow(625); send({type: "turn.created", turn: {role: "assistant", id: "delayed"}});
  for (let at = 650; at <= 1000; at += 50) f.meter(at, 0, 0);
  assert.equal(f.element("remoteAudio").muted, true);
  f.setNow(1025); send({type: "turn.done", turn: {role: "assistant", id: "delayed"}});
  f.meter(1050, 0, 0);
  assert.equal(f.context.__gptLiveDuplexDiagnostics.events.at(-1).oldTurnTerminal, true);
  assert.equal(f.context.__gptLiveDuplexDiagnostics.events.at(-1).outputDrained, false);
  for (let at = 1100; at <= 1300; at += 50) f.meter(at, 0, 0);
  assert.equal(f.element("remoteAudio").muted, false);
});

test("app preserves a drain proved during caller speech and releases the fresh reply when the caller finishes", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall(); await f.peers[0].ontrack({track: track()});
  const send = payload => f.peers[0].channel.onmessage({data: JSON.stringify(payload)});
  send({type: "turn.created", turn: {role: "assistant", id: "old"}});
  f.meter(0, .04, .2); f.meter(50, .04, .2); f.meter(100, .04, .2);
  f.setNow(125); send({type: "turn.done", turn: {role: "assistant", id: "old"}});
  for (let at = 150; at <= 400; at += 50) f.meter(at, .04, 0);
  assert.equal(f.context.__gptLiveDuplexDiagnostics.events.at(-1).outputDrained, true);
  assert.equal(f.element("remoteAudio").muted, true);
  f.setNow(425); send({type: "turn.created", turn: {role: "assistant", id: "fresh"}});
  for (let at = 450; at <= 1000; at += 50) f.meter(at, .04, .2);
  for (let at = 1050; at <= 1500; at += 50) f.meter(at, 0, .2);
  assert.equal(f.element("remoteAudio").muted, false);
  const finalGate = [...f.context.__gptLiveDuplexDiagnostics.events].reverse().find(value => value.type === "local-playback-gate");
  assert.equal(finalGate.oldTurnTerminal, true);
  assert.equal(finalGate.outputDrained, true);
  assert(!f.context.__gptLiveDuplexDiagnostics.events.some(value => value.type === "native-output-audio-cleared"),
    "The app distinguishes an assistant terminal from a native clear");
});

test("missing terminal proof offers a restart without timing out into old playback", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall(); await f.peers[0].ontrack({track: track()});
  f.meter(0, .04, .2); f.meter(50, .04, .2); f.meter(100, .04, .2);
  for (let at = 150; at <= 4600; at += 50) f.meter(at, 0, 0);
  assert.equal(f.element("remoteAudio").muted, true);
  assert.match(f.element("status").textContent, /结束通话后重新开始/u);
  assert(!f.requests.some(({route}) => route === "steer" || route === "close"));
  f.setNow(4625);
  f.peers[0].channel.onmessage({data: JSON.stringify({type: "turn.done", turn: {role: "assistant", id: "delayed"}})});
  for (let at = 4650; at <= 4900; at += 50) f.meter(at, 0, 0);
  assert.equal(f.element("remoteAudio").muted, false);
  assert.equal(f.element("status").textContent, "V 正在听，直接说话就好");
});

test("stopping a muted call clears its meter and gate without muting the replacement call", async (t) => {
  const f = await fixture(t, {playbackMode: "strict-local"}); await f.context.startCall();
  const old = f.peers[0]; await old.ontrack({track: track()});
  const oldMeter = [...f.intervals.values()].find(value => value.delay === 50).callback;
  f.meter(0, .04, .2); f.meter(50, .04, .2); f.meter(100, .04, .2);
  const diagnostics = f.context.__gptLiveDuplexDiagnostics;
  await f.context.stopCall();
  assert.equal(diagnostics.closed, true);
  assert.equal(f.element("remoteAudio").muted, false);
  assert.equal(f.intervals.size, 0);
  await f.context.startCall(); await f.peers[1].ontrack({track: track()});
  oldMeter();
  old.channel.onmessage({data: JSON.stringify({type: "turn.created", turn: {role: "user"}})});
  assert.equal(f.element("remoteAudio").muted, false);
  assert.equal(f.peers[1].closed, false);
});


test("dialing can be canceled and pickup is triggered by a real connected state only", async t => {
  const permission = deferred();
  let requests = 0;
  const f = await fixture(t, {getUserMedia: () => requests++ === 0 ? permission.promise : stream([track()])});
  const pending = f.context.startCall(); await tick();
  assert.equal(f.body.dataset.callState, "dialing");
  assert.equal(f.element("stopLabel").textContent, "取消拨号");
  assert.equal(f.sounds[0].dialing, 1); assert.equal(f.sounds[0].pickups, 0);
  await f.context.stopCall(); await pending;
  assert.equal(f.body.dataset.callState, "idle"); assert.equal(f.sounds[0].disposed, 1);
  const mic = track(); permission.resolve(stream([mic])); await tick();
  assert.equal(mic.stopped, 1); assert.equal(f.sounds[0].pickups, 0);
  await f.context.startCall();
  const next = f.peers[1]; assert.equal(f.sounds[1].pickups, 0, "A completed SDP handshake does not mean pickup");
  next.connectionState = "connected"; next.onconnectionstatechange();
  assert.equal(f.body.dataset.callState, "connected");
  assert.equal(f.element("stopLabel").textContent, "结束通话");
  assert.equal(f.sounds[1].pickups, 1);
  await f.context.stopCall();
  next.onconnectionstatechange(); assert.equal(f.sounds[1].pickups, 1, "Late connection callbacks cannot sound after hangup");
});

test("a reported disabled AEC track rejects before a paid reservation; metadata excludes device identity", async t => {
  const mic = track(); mic.getSettings = () => ({echoCancellation: false, deviceId: "private-device", groupId: "private-group"});
  const f = await fixture(t, {getUserMedia: () => stream([mic])}); await f.context.startCall();
  assert.equal(f.requests.filter(value => value.route === "session").length, 0);
  assert(mic.stopped >= 1); assert.equal(f.peers[0].closed, true);
  assert.match(f.element("status").textContent, /回声消除/u);
  assert.equal(f.context.__gptLiveDuplexDiagnostics.microphone.processing.echoCancellation, "disabled");
  assert.doesNotMatch(JSON.stringify(f.context.__gptLiveDuplexDiagnostics), /private-device|private-group/u);
});

test("transcript renders real text safely and reading history prevents auto scroll", async t => {
  const f = await fixture(t); await f.context.startCall();
  const log = f.element("conversation"); Object.defineProperty(log, "scrollHeight", {get: () => 1000}); log.scrollTop = 100;
  f.peers[0].channel.onmessage({data: JSON.stringify({type:"output_transcript.added", item:{id:"s",text:"<img src=x onerror=alert(1)>"}})});
  const row = f.element("transcriptCurrentRows").children[0];
  assert.equal(row.parts.text.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(row.parts.text.children.length, 0); assert.equal(log.scrollTop, 100);
  log.scrollTop = 880;
  f.peers[0].channel.onmessage({data: JSON.stringify({type:"turn.done",turn:{role:"assistant",id:"a",transcript:"安全正文"}})});
  assert.equal(log.scrollTop, 1000);
});


test("hangup releases the dial owner while an old reservation is still pending", async t => {
  const old = deferred(), replacement = deferred(); let reservations = 0;
  const f = await fixture(t, {api: (route, payload, result) => route === "session" ? ++reservations === 1 ? old.promise : replacement.promise : result});
  const first = f.context.startCall(); await tick();
  await f.context.stopCall();
  const second = f.context.startCall(); await tick();
  assert.equal(f.peers.length, 2, "The visible dial button really starts a replacement without waiting for the old request");
  old.resolve({voiceSessionId: "voice-1"}); await first;
  assert.equal(f.peers[1].closed, false); assert.equal(f.body.dataset.callState, "dialing");
  assert.equal(f.sounds[1].disposed, 0);
  assert(f.requests.some(value => value.route === "close" && value.payload.voiceSessionId === "voice-1"));
  await f.context.startCall(); assert.equal(f.peers.length, 2, "The old finally must not unlock the active replacement dial owner");
  replacement.resolve({voiceSessionId: "voice-2"}); await second;
  f.peers[1].connectionState = "connected"; f.peers[1].onconnectionstatechange();
  assert.equal(f.element("badge").textContent, "通话中");
});

test("unrelated wire activity does not rewrite or move unchanged history text", async t => {
  const f = await fixture(t); await f.context.startCall();
  const send = data => f.peers[0].channel.onmessage({data: JSON.stringify(data)});
  send({type:"turn.done",turn:{role:"assistant",id:"a",transcript:"完成的正文"}});
  const parent = f.element("transcriptHistory"), row = parent.children[0]; let writes=0, moves=0;
  const value = row.parts.text.textContent;
  Object.defineProperty(row.parts.text,"textContent",{get:()=>value,set:()=>{writes++;}});
  parent.insertBefore = () => {moves++;};
  send({type:"session.context.appended"});
  assert.equal(writes,0); assert.equal(moves,0);
});


test("page navigation closes the active call, meter, event stream, mic, sound and heartbeat", async t => {
  const f = await fixture(t); await f.context.startCall();
  const peer=f.peers[0]; peer.connectionState="connected"; peer.onconnectionstatechange();
  await peer.ontrack({track:track()}); assert(f.intervals.size>0);
  f.pageEvents.get("pagehide")(); await tick();
  assert.equal(f.beacons.length,1); assert.equal(f.beacons[0].url,"./api/close?entry=tianyi");
  assert.deepEqual(JSON.parse(await f.beacons[0].body.text()),{voiceSessionId:"voice-1"});
  assert.equal(f.intervals.size,0); assert.equal(f.timeouts.size,0);
  assert.equal(peer.closed,true); assert.equal(peer.channel.closed,true);
  assert(peer.tracks.every(value=>value.readyState==="ended"));
  assert(f.contexts.every(value=>value.state==="closed"));
  assert.equal(f.sounds[0].disposed,1); assert.equal(f.eventSources[0].closed,true);
  assert.equal(f.element("remoteAudio").srcObject,null);
  assert.equal(f.context.__gptLiveDuplexDiagnostics.closed,true);
});

test("default native playback leaves a continuous new reply audible after caller speech and residual room noise", async t => {
  const f = await fixture(t); await f.context.startCall();
  const peer = f.peers[0]; await peer.ontrack({track:track()});
  const send = payload => peer.channel.onmessage({data:JSON.stringify(payload)});
  f.eventSources[0].onmessage({data:JSON.stringify({voiceSessionId:"voice-1",type:"tool.call",callId:"accepted-task"})});
  const before = f.requests.length;
  send({type:"turn.created",turn:{role:"assistant",id:"old"}});
  f.meter(0,.04,.2); f.meter(50,.04,.2); f.meter(100,.04,.2);
  f.setNow(125); send({type:"turn.done",turn:{role:"assistant",id:"old"}});
  f.setNow(130); send({type:"turn.created",turn:{role:"assistant",id:"new"}});
  f.setNow(135); send({type:"turn.created",turn:{role:"user",id:"late-user"}});
  for(let at=150;at<=6000;at+=50) f.meter(at,.015,.2);
  assert.equal(f.element("remoteAudio").muted,false);
  assert.equal(f.element("remoteAudio").paused,false);
  assert.equal(f.body.dataset.voiceState,"speaking");
  assert(peer.tracks.every(value=>value.stopped===0&&value.enabled));
  assert.equal(f.requests.length,before,"The client has not cancelled backend work or sent undocumented controls");
  assert.equal(f.element("cancel").disabled,false);
  const diagnostics=f.context.__gptLiveDuplexDiagnostics;
  assert.equal(diagnostics.playbackMode,"native"); assert.equal(diagnostics.interruptionOwner,"provider");
  assert(!diagnostics.events.some(value=>value.type==="local-playback-gate"));
  const sample=diagnostics.events.at(-1);
  assert(Math.abs(sample.microphoneRms-.015)<1e-8); assert(Math.abs(sample.remoteRms-.2)<1e-8);
  assert.equal(sample.microphoneAboveAttack,false); assert.equal(sample.microphoneAboveRelease,true);
  assert.equal(sample.microphoneVoiced,false); assert.equal(sample.requestedMuted,false); assert.equal(sample.appliedMuted,false);
  assert.equal(sample.audioContextState,"running");
  assert.equal(sample.oldTurnTerminal,false); assert.equal(sample.outputDrained,false,"Native ownership does not fabricate old RTP drain proof");
});

test("autoplay rejection stays visible after connect and a fresh gesture actually restarts playback", async t => {
  let attempts=0;
  const f=await fixture(t,{play:()=>++attempts===1?Promise.reject(Object.assign(new Error("blocked"),{name:"NotAllowedError"})):Promise.resolve()});
  await f.context.startCall(); const peer=f.peers[0]; await peer.ontrack({track:track()});
  assert.equal(f.element("remoteAudio").paused,true);
  peer.connectionState="connected"; peer.onconnectionstatechange();
  assert.match(f.element("status").textContent,/恢复声音/u);
  const before=f.requests.length;
  f.pageEvents.get("pointerdown")(); await tick();
  assert.equal(attempts,2); assert.equal(f.element("remoteAudio").paused,false);
  assert.equal(f.element("status").textContent,"V 正在听，直接说话就好");
  assert.deepEqual(f.requests.slice(before).map(value=>value.route), ['ready']);
  const events=f.context.__gptLiveDuplexDiagnostics.events;
  assert(events.some(value=>value.type==="playback-rejected"&&value.errorName==="NotAllowedError"&&value.source==="track"));
  assert(events.some(value=>value.type==="playback-started"&&value.source==="gesture"&&value.paused===false));
  assert(peer.tracks.every(value=>value.stopped===0));
});

test("an AudioContext rejection has its own visible recovery and does not leave the incoming track setup unhandled", async t => {
  let resumes=0;
  const f=await fixture(t,{resume:()=>++resumes===1?Promise.reject(Object.assign(new Error("blocked"),{name:"NotAllowedError"})):Promise.resolve()});
  await f.context.startCall(); const peer=f.peers[0]; await peer.ontrack({track:track()});
  peer.connectionState="connected"; peer.onconnectionstatechange();
  assert.match(f.element("status").textContent,/恢复声音/u);
  assert(f.context.__gptLiveDuplexDiagnostics.events.some(value=>value.type==="context-resume-rejected"));
  f.pageEvents.get("keydown")(); await tick();
  assert.equal(resumes,2); assert.equal(f.element("status").textContent,"V 正在听，直接说话就好");
});

test("an unexpected playback pause is diagnosed while a gesture recovery from an ended call cannot touch its replacement", async t => {
  const pending=deferred(); let attempts=0;
  const f=await fixture(t,{play:()=>++attempts===2?pending.promise:Promise.resolve()});
  await f.context.startCall(); const old=f.peers[0]; await old.ontrack({track:track()});
  f.element("remoteAudio").paused=true; f.meter(0,0,.2);
  assert.match(f.element("status").textContent,/恢复声音/u);
  f.pageEvents.get("pointerdown")(); await tick();
  const diagnostics=f.context.__gptLiveDuplexDiagnostics;
  await f.context.stopCall(); await f.context.startCall();
  const replacement=f.peers[1]; replacement.connectionState="connected"; replacement.onconnectionstatechange();
  await replacement.ontrack({track:track()});
  const status=f.element("status").textContent;
  pending.reject(Object.assign(new Error("late blocked"),{name:"NotAllowedError"})); await tick();
  assert.equal(f.element("status").textContent,status); assert.equal(replacement.closed,false);
  assert.equal(diagnostics.closed,true);
  assert(diagnostics.events.some(value=>value.type==="playback-not-running"&&value.paused));
  assert(!diagnostics.events.some(value=>value.type==="playback-rejected"&&value.source==="gesture"));
});

test('pickup requests the native greeting only after connection and audible playback are ready, once per call', async t => {
  const f = await fixture(t);
  await f.context.startCall();
  const peer = f.peers[0];
  peer.connectionState = 'connected'; peer.onconnectionstatechange();
  await tick();
  assert.equal(f.requests.filter(r => r.route === 'ready').length, 0);
  await peer.ontrack({track:track()}); await tick();
  assert.equal(f.requests.filter(r => r.route === 'ready').length, 1);
  peer.onconnectionstatechange(); await tick();
  assert.equal(f.requests.filter(r => r.route === 'ready').length, 1);
  assert.equal(f.requests.find(r => r.route === 'ready').payload.voiceSessionId, 'voice-1');
});

test('a user farewell transcript alone never hangs up the call', async t => {
  const f = await fixture(t); await f.context.startCall();
  const peer = f.peers[0]; await peer.ontrack({track:track()});
  peer.channel.onmessage({data:JSON.stringify({type:'turn.done',turn:{role:'user',id:'u',transcript:'就聊到这，谢谢'}})});
  for (let at=0;at<2000;at+=50) f.meter(at,0,0);
  assert.equal(peer.closed,false);
  assert.equal(f.requests.filter(r=>r.route==='close').length,0);
});

async function endCallFixture(t, options = {}) {
  const f = await fixture(t, options); await f.context.startCall();
  const peer = f.peers[0]; peer.connectionState='connected'; peer.onconnectionstatechange();
  await peer.ontrack({track:track()}); await tick();
  const send = value => peer.channel.onmessage({data:JSON.stringify(value)});
  const tool = value => f.eventSources[0].onmessage({data:JSON.stringify({voiceSessionId:'voice-1',type:'tool.result',name:'openclaw_end_call',callId:'end',requestId:'end',originUserTurnId:'u',closeAfterPlayback:true,...value})});
  const native = (requestId='end', userId='u') => send({type:'delegation.created',item:{type:'delegation',target:'client',id:requestId,user_bidi_turn_id:userId,content:[{type:'input_text',text:'{"name":"openclaw_end_call","arguments":{}}'}]}});
  send({type:'turn.created',turn:{role:'user',id:'u'}}); native();
  return {...f,peer,send,tool,native};
}

test('model end-call requires the exact current voice, a new native terminal and played audio before tail drain', async t => {
  const f=await endCallFixture(t);
  f.tool({voiceSessionId:'other'});
  assert.equal(f.body.dataset.callState,'connected');
  f.tool({}); assert.equal(f.body.dataset.callState,'ending');
  for(let at=0;at<=1000;at+=50) f.meter(at,0,0);
  assert.equal(f.peer.closed,false,'silence after tool acceptance alone is not a delivered farewell');
  f.setNow(1050); f.send({type:'turn.created',turn:{role:'assistant',id:'bye'}});
  for(let at=1100;at<=1300;at+=50) f.meter(at,0,.12);
  f.setNow(1320); f.send({type:'turn.done',turn:{role:'assistant',id:'bye'}});
  for(let at=1350;at<=1600;at+=50) f.meter(at,0,.12);
  for(let at=1650;at<=2350;at+=50) f.meter(at,0,0);
  assert.equal(f.peer.closed,false,'terminal event alone cannot cut a queued tail');
  f.meter(2400,0,0); await tick();
  assert.equal(f.peer.closed,true);
  assert.equal(f.requests.filter(r=>r.route==='close').length,1);
  assert.equal(f.body.dataset.callState,'idle');
  assert.equal(f.intervals.size,0); assert.equal(f.timeouts.size,0);
});

test('sampling gaps and blocked playback never stand in for end-call audio drain', async t => {
  const f=await endCallFixture(t); f.tool({});
  f.send({type:'turn.created',turn:{role:'assistant',id:'bye'}});
  f.meter(50,0,.12); f.setNow(75); f.send({type:'turn.done',turn:{role:'assistant',id:'bye'}});
  f.meter(100,0,0); f.meter(1000,0,0);
  assert.equal(f.peer.closed,false,'a timer gap resets the continuous observation');
  f.element('remoteAudio').paused=true;
  for(let at=1050;at<=2000;at+=50) f.meter(at,0,0);
  assert.equal(f.peer.closed,false,'paused output is not silence proof');
});

test('native caller speech or exact failed hangup tool keeps the line open during farewell', async t => {
  const f=await endCallFixture(t); f.tool({});
  f.send({type:'turn.created',turn:{role:'user',id:'wait'}});
  assert.equal(f.body.dataset.callState,'connected');
  f.native('again','wait'); f.tool({requestId:'again',callId:'again',originUserTurnId:'wait'});
  f.tool({type:'tool.error',requestId:'old'}); assert.equal(f.body.dataset.callState,'ending');
  f.tool({type:'tool.error',requestId:'again',callId:'again',originUserTurnId:'wait'}); assert.equal(f.body.dataset.callState,'connected');
  assert.equal(f.peer.closed,false); assert.equal(f.timeouts.size,0);
});


test('late end acceptance cannot hang up a newer native USER turn, even after a new answer', async t => {
  const f=await endCallFixture(t);
  f.send({type:'turn.created',turn:{role:'user',id:'wait'}});
  f.tool({}); assert.equal(f.body.dataset.callState,'connected');
  f.send({type:'turn.created',turn:{role:'assistant',id:'new-topic'}});
  f.meter(50,0,.12); f.setNow(75);
  f.send({type:'turn.done',turn:{role:'assistant',id:'new-topic'}});
  for(let at=100;at<=1200;at+=50) f.meter(at,0,0);
  assert.equal(f.peer.closed,false); assert.equal(f.requests.filter(r=>r.route==='close').length,0);
});

test('farewell arriving ahead of host acceptance retains actual audio proof and closes after joining both channels', async t => {
  const f=await endCallFixture(t);
  f.send({type:'turn.created',turn:{role:'assistant',id:'bye'}});
  f.meter(50,0,.12); f.meter(100,0,.12); f.setNow(125);
  f.send({type:'turn.done',turn:{role:'assistant',id:'bye'}});
  for(let at=150;at<=950;at+=50) f.meter(at,0,0);
  assert.equal(f.peer.closed,false,'native delegation/audio cannot close without the host tool result');
  f.tool({}); f.meter(1000,0,0); await tick();
  assert.equal(f.peer.closed,true); assert.equal(f.requests.filter(r=>r.route==='close').length,1);
});

test('host acceptance arriving ahead of the real delegation waits for the exact native tool witness', async t => {
  const f=await endCallFixture(t);
  f.tool({requestId:'other',callId:'other'}); assert.equal(f.body.dataset.callState,'connected');
  f.native('other'); assert.equal(f.body.dataset.callState,'ending');
  f.send({type:'turn.created',turn:{role:'user',id:'continue'}});
  f.native('other','u'); f.tool({requestId:'other',callId:'other'});
  assert.equal(f.body.dataset.callState,'connected'); assert.equal(f.peer.closed,false);
});


test('native readiness racing session start retries within a bound and ends with its original call', async t => {
  let ready=0;
  const f=await fixture(t,{api:(route,payload,value)=>{if(route==='ready'&&++ready===1)throw Error('Native session not ready');return value;}});
  await f.context.startCall(); const peer=f.peers[0]; peer.connectionState='connected'; peer.onconnectionstatechange();
  await peer.ontrack({track:track()}); await tick();
  assert.equal(ready,1); assert.equal(f.timeouts.size,2);
  const timer=[...f.timeouts.entries()].find(([,value])=>value.delay<15000); f.timeouts.delete(timer[0]); timer[1].callback(); await tick();
  assert.equal(ready,2); assert.equal(f.timeouts.size,0);
  peer.onconnectionstatechange(); await tick(); assert.equal(ready,2);
  await f.context.stopCall(); assert.equal(f.timeouts.size,0);
});

async function fireNextTimeout(f) {
  const entry=[...f.timeouts.entries()].sort((a,b)=>(a[1].at+a[1].delay)-(b[1].at+b[1].delay))[0];
  assert(entry,'Expected an owned timer');
  f.timeouts.delete(entry[0]); f.setNow(entry[1].at+entry[1].delay); entry[1].callback(); await tick();
}

test('greeting retries past four early backend failures and still accepts exactly once inside the readiness grace', async t => {
  let ready=0;
  const f=await fixture(t,{api:(route,payload,value)=>{if(route==='ready'&&++ready<=4)throw Error('Sideband session has not started');return value;}});
  await f.context.startCall(); const peer=f.peers[0]; peer.connectionState='connected'; peer.onconnectionstatechange();
  await peer.ontrack({track:track()}); await tick();
  for(let index=0;index<4;index++) await fireNextTimeout(f);
  assert.equal(ready,5); assert.equal(f.timeouts.size,0);
  peer.onconnectionstatechange(); peer.channel.onmessage({data:JSON.stringify({type:'session.started'})}); await tick();
  assert.equal(ready,5);
  assert.equal(f.context.__gptLiveDuplexDiagnostics.counts['greeting-ready-accepted'],1);
  assert.equal(f.element('transcriptHistory').children.length+f.element('transcriptCurrentRows').children.length,0,'Acceptance never creates synthetic greeting text');
  assert.equal(peer.closed,false);
});

test('native session.started nudges the idempotent readiness retry but a slower backend still gets the original bounded grace', async t => {
  let ready=0;
  const f=await fixture(t,{api:(route,payload,value)=>{if(route==='ready'&&++ready<6)throw Error('Backend sideband is still pending');return value;}});
  await f.context.startCall(); const peer=f.peers[0]; peer.connectionState='connected'; peer.onconnectionstatechange();
  await peer.ontrack({track:track()}); await tick();
  f.setNow(100); peer.channel.onmessage({data:JSON.stringify({type:'session.started'})}); await tick();
  assert.equal(ready,2);
  assert.equal([...f.timeouts.values()].find(value=>value.delay===15000).at,0,'A started notification never extends the grace');
  for(let index=0;index<4;index++) await fireNextTimeout(f);
  assert.equal(ready,6); assert.equal(f.timeouts.size,0); assert.equal(peer.closed,false);
});

test('readiness grace expires after fifteen seconds without closing the working call or allowing later greeting retries', async t => {
  let ready=0;
  const f=await fixture(t,{api:(route,payload,value)=>{if(route==='ready'){ready++;throw Error('Still not started');}return value;}});
  await f.context.startCall(); const peer=f.peers[0]; peer.connectionState='connected'; peer.onconnectionstatechange();
  await peer.ontrack({track:track()}); await tick();
  while(f.timeouts.size) await fireNextTimeout(f);
  assert(ready>4); const attempts=ready;
  peer.channel.onmessage({data:JSON.stringify({type:'session.started'})}); peer.onconnectionstatechange(); await tick();
  assert.equal(ready,attempts); assert.equal(f.timeouts.size,0); assert.equal(peer.closed,false);
  assert(peer.tracks.every(value=>value.enabled&&value.stopped===0));
  assert.equal(f.context.__gptLiveDuplexDiagnostics.counts['greeting-ready-expired'],1);
  assert.equal(f.context.__gptLiveDuplexDiagnostics.counts['greeting-ready-accepted'],undefined);
});

for(const input of [{type:'turn.created',turn:{role:'user',id:'u'}},{type:'turn.done',turn:{role:'user',id:'u'}},
  {type:'input_transcript.added',item:{id:'input',text:'我先说一下'}}]) {
  test(`actual caller ${input.type} prevents a late readiness retry from inserting a pickup greeting`,async t=>{
    let ready=0;
    const f=await fixture(t,{api:(route,payload,value)=>{if(route==='ready'){ready++;throw Error('Not started yet');}return value;}});
    await f.context.startCall(); const peer=f.peers[0]; peer.connectionState='connected'; peer.onconnectionstatechange();
    await peer.ontrack({track:track()}); await tick();
    const queued=[...f.timeouts.values()];
    f.setNow(200); peer.channel.onmessage({data:JSON.stringify(input)}); await tick();
    assert.equal(f.timeouts.size,0);
    for(const timer of queued) timer.callback();
    peer.channel.onmessage({data:JSON.stringify({type:'session.started'})}); await tick();
    assert.equal(ready,1); assert.equal(peer.closed,false);
    assert.equal(f.context.__gptLiveDuplexDiagnostics.counts['greeting-suppressed-caller-start'],1);
  });
}

test('a stopped call clears readiness timers and cannot retry against the replacement voice session',async t=>{
  const f=await fixture(t,{api:(route,payload,value)=>{if(route==='ready'&&payload.voiceSessionId==='voice-1')throw Error('Not ready');return value;}});
  await f.context.startCall(); const old=f.peers[0]; old.connectionState='connected'; old.onconnectionstatechange();
  await old.ontrack({track:track()}); await tick(); const queued=[...f.timeouts.values()];
  await f.context.stopCall(); assert.equal(f.timeouts.size,0); await f.context.startCall();
  const replacement=f.peers[1]; replacement.connectionState='connected'; replacement.onconnectionstatechange();
  await replacement.ontrack({track:track()}); await tick(); const before=f.requests.length;
  for(const timer of queued) timer.callback(); old.channel.onmessage({data:JSON.stringify({type:'session.started'})}); await tick();
  assert.equal(f.requests.length,before); assert.equal(f.requests.filter(value=>value.route==='ready'&&value.payload.voiceSessionId==='voice-2').length,1);
});

test('the readiness deadline aborts a hung ready fetch and prevents a late success from claiming greeting acceptance',async t=>{
  const reply=deferred(); let signal;
  const f=await fixture(t,{api:(route,payload,value,init)=>{
    if(route!=='ready')return value;
    signal=init.signal;
    return new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});
      reply.promise.then(resolve,reject);
    });
  }});
  await f.context.startCall(); const peer=f.peers[0]; peer.connectionState='connected'; peer.onconnectionstatechange();
  await peer.ontrack({track:track()}); await tick();
  assert.equal(f.requests.filter(value=>value.route==='ready').length,1); assert.equal(f.timeouts.size,1);
  await fireNextTimeout(f); assert.equal(signal.aborted,true); assert.equal(f.timeouts.size,0);
  reply.resolve({ok:true}); await tick();
  assert.equal(f.context.__gptLiveDuplexDiagnostics.counts['greeting-ready-accepted'],undefined);
  assert.equal(peer.closed,false);
});

async function backendEndCallFixture(t) {
  const f = await fixture(t); await f.context.startCall();
  const peer = f.peers[0]; peer.connectionState = 'connected'; peer.onconnectionstatechange();
  await peer.ontrack({ track: track() }); await tick();
  const send = value => peer.channel.onmessage({ data: JSON.stringify(value) });
  const tool = value => f.eventSources[0].onmessage({ data: JSON.stringify({ voiceSessionId: 'voice-1', type: 'tool.result',
    name: 'openclaw_end_call', source: 'backend_model_client_tool', status: 'accepted', callId: 'call_end_real',
    backendToolCallId: 'call_end_real', backendRunId: 'talk-realtime-consult:actual:parent',
    requestId: 'item_end_real', nativeDelegationId: 'item_end_real', delegationGeneration: 1,
    originUserTurnId: 'turn_end_real', closeAfterPlayback: true, ...value }) });
  const native = () => send({ type: 'delegation.created', item: { type: 'delegation', target: 'client',
    id: 'item_end_real', user_bidi_turn_id: 'turn_end_real', content: [{ type: 'input_text', text: '今天就先这样，谢谢你，拜拜' }] } });
  send({ type: 'turn.created', turn: { role: 'user', id: 'turn_end_real' } });
  send({ type: 'turn.done', turn: { role: 'user', id: 'turn_end_real', transcript: '今天就先这样，谢谢你，拜拜' } });
  return { ...f, peer, send, tool, native };
}

test('plain native farewell never ends until host accepts the genuine backend model tool and a fresh farewell actually plays', async t => {
  const f = await backendEndCallFixture(t); f.native();
  f.send({ type: 'turn.created', turn: { role: 'assistant', id: 'ordinary-consult-ack' } });
  f.meter(50, 0, .12); f.setNow(75);
  f.send({ type: 'turn.done', turn: { role: 'assistant', id: 'ordinary-consult-ack' } });
  for (let at = 100; at <= 900; at += 50) f.meter(at, 0, 0);
  assert.equal(f.peer.closed, false); assert.equal(f.body.dataset.callState, 'connected');
  f.tool({}); assert.equal(f.body.dataset.callState, 'ending');
  for (let at = 950; at <= 1800; at += 50) f.meter(at, 0, 0);
  assert.equal(f.peer.closed, false, 'earlier ordinary acknowledgment PCM is not farewell');
  f.setNow(1825); f.send({ type: 'turn.created', turn: { role: 'assistant', id: 'accepted-farewell' } });
  f.meter(1850, 0, .12); f.meter(1900, 0, .12); f.setNow(1925);
  f.send({ type: 'turn.done', turn: { role: 'assistant', id: 'accepted-farewell' } });
  for (let at = 1950; at <= 2700; at += 50) f.meter(at, 0, 0);
  await tick(); assert.equal(f.peer.closed, true);
  const drain = f.context.__gptLiveDuplexDiagnostics.events.find(row => row.type === 'model-end-call-playback-drained');
  assert.equal(drain.source, 'backend_model_client_tool'); assert.equal(drain.backendToolCallId, 'call_end_real');
  assert.equal(drain.nativeDelegationId, 'item_end_real');
});

test('backend model acceptance joins the actual native item and rejects incomplete or mismatched receipts', async t => {
  const f = await backendEndCallFixture(t);
  for (const bad of [{ voiceSessionId: 'other' }, { backendToolCallId: 'call_other' }, { nativeDelegationId: 'item_other' },
    { status: 'pending' }, { backendRunId: '' }, { delegationGeneration: 0 }, { originUserTurnId: 'turn_other' }]) {
    f.tool(bad); assert.equal(f.body.dataset.callState, 'connected');
  }
  f.tool({}); assert.equal(f.body.dataset.callState, 'connected', 'host result alone is not the original native item');
  f.native(); assert.equal(f.body.dataset.callState, 'ending');
  f.send({ type: 'turn.created', turn: { role: 'assistant', id: 'bye' } });
  f.meter(50, 0, .12); f.setNow(75); f.send({ type: 'turn.done', turn: { role: 'assistant', id: 'bye' } });
  for (let at = 100; at <= 900; at += 50) f.meter(at, 0, 0);
  await tick(); assert.equal(f.peer.closed, true);
});

test('new USER and failed actual backend end tool revoke an accepted farewell without ending the line', async t => {
  const f = await backendEndCallFixture(t); f.native(); f.tool({});
  f.tool({ type: 'tool.error', backendRunId: 'talk-realtime-consult:wrong:parent' });
  assert.equal(f.body.dataset.callState, 'ending', 'a wrong backend run cannot revoke this receipt');
  f.tool({ type: 'tool.error' }); assert.equal(f.body.dataset.callState, 'connected');
  f.send({ type: 'turn.created', turn: { role: 'user', id: 'turn_keep_open' } });
  f.tool({}); assert.equal(f.body.dataset.callState, 'connected');
  f.send({ type: 'turn.created', turn: { role: 'assistant', id: 'new-topic' } });
  f.meter(50, 0, .12); f.setNow(75); f.send({ type: 'turn.done', turn: { role: 'assistant', id: 'new-topic' } });
  for (let at = 100; at <= 1500; at += 50) f.meter(at, 0, 0);
  assert.equal(f.peer.closed, false); assert.equal(f.requests.filter(row => row.route === 'close').length, 0);
});

test('backend end host acceptance does not use an unfinished USER prefix', async t => {
  const f = await fixture(t); await f.context.startCall(); const peer = f.peers[0];
  peer.connectionState = 'connected'; peer.onconnectionstatechange(); await peer.ontrack({ track: track() });
  peer.channel.onmessage({ data: JSON.stringify({ type: 'turn.created', turn: { role: 'user', id: 'turn_pending' } }) });
  peer.channel.onmessage({ data: JSON.stringify({ type: 'delegation.created', item: { type: 'delegation', target: 'client',
    id: 'item_pending', user_bidi_turn_id: 'turn_pending', content: [{ type: 'input_text', text: '先这样' }] } }) });
  f.eventSources[0].onmessage({ data: JSON.stringify({ voiceSessionId: 'voice-1', type: 'tool.result', name: 'openclaw_end_call',
    source: 'backend_model_client_tool', status: 'accepted', callId: 'call_pending', backendToolCallId: 'call_pending',
    backendRunId: 'talk-realtime-consult:actual:parent', requestId: 'item_pending', nativeDelegationId: 'item_pending',
    delegationGeneration: 1, originUserTurnId: 'turn_pending', closeAfterPlayback: true }) });
  assert.equal(f.body.dataset.callState, 'connected'); assert.equal(peer.closed, false);
});
test('same-page redial reuses one grant, keeps the idle microphone disabled and releases on navigation',async t=>{
 let grants=0;const mic=track();const f=await fixture(t,{getUserMedia:()=>{grants++;return stream([mic]);}});
 await f.context.startCall();assert.equal(grants,1);await f.context.stopCall();assert.equal(mic.enabled,false);assert.equal(mic.stopped,0);
 await f.context.startCall();assert.equal(grants,1);assert.equal(mic.enabled,true);await f.context.stopCall();assert.equal(mic.enabled,false);
 f.pageEvents.get('pagehide')();assert.equal(mic.stopped,1);
});

test('full backend document renders separately from spoken caption and retired call cannot insert late documents',async t=>{
 const f=await fixture(t);await f.context.startCall();
 const body='## 完整方案\n| 日期 | 状态 |\n| --- | --- |\n| 2028-09 | 尚未核实 |';
 const e={voiceSessionId:'voice-1',type:'backend.result',callId:'doc',text:body};
 const old=f.eventSources[0];old.onmessage({data:JSON.stringify({...e,voiceSessionId:'foreign'})});assert.equal(f.element('transcriptHistory').children.length,0);
 old.onmessage({data:JSON.stringify(e)});old.onmessage({data:JSON.stringify(e)});
 const history=f.element('transcriptHistory');assert.equal(history.children.length,1);assert.equal(history.children[0].parts.speaker.textContent,'V · 完整方案');assert.equal(history.children[0].parts.text.textContent,body);
 f.peers[0].channel.onmessage({data:JSON.stringify({type:'output_transcript.added',item:{id:'spoken',text:'结果在屏幕上。'}})});
 assert.equal(f.element('transcriptCurrentRows').children[0].parts.text.textContent,'结果在屏幕上。');
 await f.context.stopCall();await f.context.startCall();old.onmessage({data:JSON.stringify(e)});assert.equal(history.children.length,0);
});

test('relay greeting text appears in chat and reaches avatar context, with retired-call captions rejected', async t => {
 let relay;const snapshots=[];
 const f=await fixture(t,{
  api:(route,payload,result)=>route==='session'?{...result,transport:'gateway-relay',provider:'seeduplex'}:result,
  relayFactory:values=>{relay=values;return {start:async()=>{},dispose(){}};},
  avatar:{show(){},select(){},attend(){},context(){return {}; }},
  reactions:{update:values=>snapshots.push(values.snapshot),dispose(){}},
 });
 await f.context.startCall();
 const text='天懿，你好，我是 V，在呢。';
 relay.onEvent({type:'transcript',role:'assistant',text,final:true,source:'greeting'});
 assert.equal(f.element('transcriptHistory').children.length,1);
 assert.equal(f.element('transcriptHistory').children[0].parts.text.textContent,text);
 assert.equal(f.body.dataset.conversation,'started');
 assert.equal(snapshots.at(-1).history[0].text,text);
 await f.context.stopCall();
 relay.onEvent({type:'transcript',role:'assistant',text,final:true,source:'greeting'});
 assert.equal(f.body.dataset.conversation,'empty');
 assert.equal(f.element('transcriptHistory').children.length,0);
});

test('hangup returns to the initial empty entry and late call events cannot restore chat or reports', async t => {
 let resets = 0;
 const f = await fixture(t, { contentView: {
   reset() { resets++; },
   render(target, item) { target.textContent = item.text; },
 } });
 await f.context.startCall();
 const old = f.eventSources[0], channel = f.peers[0].channel;
 channel.onmessage({data: JSON.stringify({type:'output_transcript.added',item:{id:'spoken',text:'我查到了。'}})});
 const result = {voiceSessionId:'voice-1',type:'backend.result',callId:'doc',text:'## 完整方案\n实际查询结果'};
 old.onmessage({data: JSON.stringify(result)});
 assert.equal(f.body.dataset.conversation, 'started');
 assert.equal(f.element('transcriptHistory').children.length, 1);
 assert.equal(f.element('transcriptCurrentRows').children.length, 1);
 f.element('steerText').value = '未发送的补充';
 f.element('conversation').scrollTop = 200;
 const before = resets;
 await f.context.stopCall();
 assert.equal(resets, before + 1, 'Hangup closes and clears the current content reader');
 assert.equal(f.body.dataset.callState, 'idle');
 assert.equal(f.body.dataset.conversation, 'empty');
 assert.equal(f.element('transcriptHistory').children.length, 0);
 assert.equal(f.element('transcriptCurrentRows').children.length, 0);
 assert.equal(f.element('transcriptCurrent').hidden, true);
 assert.equal(f.element('conversation').scrollTop, 0);
 assert.equal(f.element('steerText').value, '');
 assert.equal(f.element('start').hidden, false);
 assert.equal(f.element('start').disabled, false);
 assert.equal(f.element('stop').hidden, true);
 old.onmessage({data: JSON.stringify(result)});
 channel.onmessage({data: JSON.stringify({type:'output_transcript.added',item:{id:'late',text:'旧通话迟到的回复'}})});
 assert.equal(f.body.dataset.conversation, 'empty');
 assert.equal(f.element('transcriptHistory').children.length, 0);
 assert.equal(f.element('transcriptCurrentRows').children.length, 0);
 await f.context.startCall();
 assert.equal(f.body.dataset.conversation, 'empty');
 assert.equal(f.peers.length, 2);
});


test('native snapshot recovers actual task and full Markdown without SSE, but an old voice cannot change a redial',async t=>{
 let response={voiceSessionId:'voice-1',revision:1,pending:[{type:'tool.call',callId:'pending',name:'openclaw_agent_consult'}],documents:[]};
 const f=await fixture(t,{api:route=>route==='presentation'?response:undefined});await f.context.startCall();await tick();
 assert.equal(f.body.dataset.avatarState,'busy');
 const poll=[...f.intervals.values()].find(v=>v.delay===1500).callback;
 response={voiceSessionId:'voice-1',revision:3,pending:[],documents:[{revision:3,type:'backend.result',voiceSessionId:'voice-1',callId:'doc',text:'## 完整方案\n实际条件和来源'}]};
 poll();await tick();assert.equal(f.body.dataset.avatarState,'idle');assert.equal(f.element('transcriptHistory').children.length,1);
 assert.equal(f.element('transcriptHistory').children[0].parts.text.textContent,response.documents[0].text);
 const late=deferred();response=late.promise;const fetching=poll();await tick();await f.context.stopCall();await f.context.startCall();
 late.resolve({voiceSessionId:'voice-1',revision:4,pending:[],documents:[{type:'backend.result',voiceSessionId:'voice-1',callId:'late',text:'旧报告'}]});await tick();
 assert.equal(f.element('transcriptHistory').children.length,0);
});


test('snapshot carries only current real end-tool acceptance and rejection through the same ownership gate as SSE',async t=>{
 let response={voiceSessionId:'voice-1',revision:0,pending:[],documents:[],controls:[]};
 const f=await endCallFixture(t,{api:route=>route==='presentation'?response:undefined});await tick();
 const poll=[...f.intervals.values()].find(v=>v.delay===1500).callback;
 const actual={revision:1,voiceSessionId:'voice-1',type:'tool.result',name:'openclaw_end_call',callId:'end',requestId:'end',originUserTurnId:'u',closeAfterPlayback:true};
 response={...response,revision:1,controls:[{...actual,voiceSessionId:'foreign'}]};poll();await tick();assert.equal(f.body.dataset.callState,'connected');
 response={...response,controls:[actual]};poll();await tick();assert.equal(f.body.dataset.callState,'ending');assert(!f.peer.closed,'tool acceptance does not prove farewell audio drained');
 response={...response,revision:2,controls:[actual,{...actual,revision:2,type:'tool.error'}]};poll();await tick();assert.equal(f.body.dataset.callState,'connected');
});

test('avatar recorder uses exact voice owner and public snapshot, sends keepalive batches, and does not delay stop',async t=>{
 let values,closed=0;const pending=deferred();const f=await fixture(t,{telemetry:v=>{values=v;return {close(){closed++;},display(){},decision(){}};},api:(route,payload,result,init)=>{if(route==='avatar-events'){assert.equal(payload.voiceSessionId,'voice-1');assert.equal(init.keepalive,true);return pending.promise;}return result;}});
 await f.context.startCall();assert(values);const sending=values.send({captureId:'11111111-1111-4111-8111-111111111111',events:[]});await f.context.stopCall();assert.equal(closed,1);assert(f.requests.some(r=>r.route==='close'));pending.resolve({accepted:0});await sending;
});


test("connection progress lives in the pill while a busy rejection remains an actionable notice", async t => {
  const session = deferred();
  const f = await fixture(t, { api: (route, payload, result) => route === "session" ? session.promise : result });
  const starting = f.context.startCall();
  await tick();
  assert.equal(f.body.dataset.callState, "dialing");
  assert.equal(f.element("badge").textContent, "连接中");
  assert.equal(f.element("status").dataset.notice, "progress");
  session.reject(new Error("正在连接 V，请稍等。"));
  await starting;
  assert.equal(f.body.dataset.callState, "idle");
  assert.equal(f.element("status").dataset.notice, "message");
  assert.equal(f.element("status").textContent, "正在连接 V，请稍等。");
});

test('host-selected in-flight assistant turn can contain both acknowledgment and goodbye',async t=>{
 const f=await backendEndCallFixture(t);f.native();
 f.send({type:'turn.created',turn:{role:'assistant',id:'combined'}});
 f.meter(50,0,.12);f.meter(100,0,.12);
 f.tool({nativeAssistantTurnIdAtAcceptance:'combined'});
 assert.equal(f.body.dataset.callState,'ending');
 f.meter(150,0,.12);f.setNow(175);f.send({type:'turn.done',turn:{role:'assistant',id:'combined'}});
 for(let at=200;at<=950;at+=50)f.meter(at,0,0);
 await tick();assert.equal(f.peer.closed,true);
});
test('late presentation receipt joins host-selected played turn without borrowing another user audio',async t=>{
 const f=await backendEndCallFixture(t);f.native();
 f.send({type:'turn.created',turn:{role:'assistant',id:'combined'}});
 f.meter(50,0,.12);f.setNow(75);f.send({type:'turn.done',turn:{role:'assistant',id:'combined'}});
 for(let at=100;at<=900;at+=50)f.meter(at,0,0);
 assert.equal(f.peer.closed,false);
 f.tool({nativeAssistantTurnIdAtAcceptance:'foreign'});f.meter(950,0,0);
 assert.equal(f.peer.closed,false,'an unknown host turn cannot reuse unrelated audio');
 f.send({type:'turn.created',turn:{role:'user',id:'new-user'}});
 f.tool({nativeAssistantTurnIdAtAcceptance:'combined'});f.meter(1000,0,0);
 assert.equal(f.peer.closed,false,'a new caller turn revokes the old receipt');
});
test('farewell completed before delayed host receipt closes only after matching host/native/audio proofs',async t=>{
 const f=await backendEndCallFixture(t);f.native();
 f.send({type:'turn.created',turn:{role:'assistant',id:'combined'}});
 f.meter(50,0,.12);f.setNow(75);f.send({type:'turn.done',turn:{role:'assistant',id:'combined'}});
 for(let at=100;at<=900;at+=50)f.meter(at,0,0);
 assert.equal(f.peer.closed,false);
 f.tool({nativeAssistantTurnIdAtAcceptance:'combined'});f.meter(950,0,0);
 await tick();assert.equal(f.peer.closed,true);
});

test('Voice host hangup binds the complete current user turn and waits for actual farewell playback',async t=>{
 const f=await fixture(t);await f.context.startCall();const peer=f.peers[0];peer.connectionState='connected';peer.onconnectionstatechange();const send=x=>peer.channel.onmessage({data:JSON.stringify(x)});
 const sent=[];peer.channel.readyState='open';peer.channel.send=x=>sent.push(JSON.parse(x));
 send({type:'turn.created',turn:{role:'user',id:'u-host'}});
 const accepted={voiceSessionId:'voice-1',type:'voice.end.accepted',source:'voice_host_control',requestId:'host-1',userText:'今天就这样，拜拜',closeAfterPlayback:true};
 f.eventSources[0].onmessage({data:JSON.stringify(accepted)});assert.equal(f.body.dataset.callState,'connected','an incomplete turn is not end authority');
 send({type:'turn.done',turn:{role:'user',id:'u-host',transcript:'今天就这样，拜拜'}});
 await peer.ontrack({track:track()});for(let at=50;at<=1250;at+=50)f.meter(at,0,0);
 assert.equal(f.body.dataset.callState,'ending');assert.equal(sent.length,1);assert.equal(sent[0].content[0].type,'input_text');assert.match(sent[0].content[0].text,/再见，下次聊/);assert.equal(peer.closed,false);
 send({type:'turn.created',turn:{role:'assistant',id:'bye-host'}});f.meter(1300,0,.1);
 send({type:'turn.done',turn:{role:'assistant',id:'bye-host',transcript:'再见，下次聊。'}});
 for(let at=1350;at<=2150;at+=50)f.meter(at,0,0);
 await tick();assert.equal(peer.closed,true);
});
test('a delivered natural farewell variant closes after host acceptance, but an acknowledgment does not',async t=>{
 for(const [transcript,closes] of [['好的，这就为你结束通话。嗯，再见，下次再聊。',true],['好的，我查一下。',false]]){
  await t.test(transcript,async t=>{
   const f=await fixture(t);await f.context.startCall();const peer=f.peers[0];peer.connectionState='connected';peer.onconnectionstatechange();const send=x=>peer.channel.onmessage({data:JSON.stringify(x)});peer.channel.readyState='open';peer.channel.send=()=>{};
   send({type:'turn.created',turn:{role:'user',id:'farewell-user'}});send({type:'turn.done',turn:{role:'user',id:'farewell-user',transcript:'今天就聊这里，谢谢，拜拜，请结束通话'}});
   await peer.ontrack({track:track()});for(let at=50;at<=1250;at+=50)f.meter(at,0,0);
   f.eventSources[0].onmessage({data:JSON.stringify({voiceSessionId:'voice-1',type:'voice.end.accepted',source:'voice_host_control',requestId:'farewell-variant',userText:'今天就聊这里，谢谢，拜拜，请结束通话',closeAfterPlayback:true})});
   send({type:'turn.created',turn:{role:'assistant',id:'farewell-assistant'}});f.meter(1300,0,.1);send({type:'turn.done',turn:{role:'assistant',id:'farewell-assistant',transcript}});
   for(let at=1350;at<=1950;at+=50)f.meter(at,0,0);await tick();assert.equal(peer.closed,false,'no close before actual audio tail drains');
   for(let at=2000;at<=2200;at+=50)f.meter(at,0,0);await tick();assert.equal(peer.closed,closes);
  });
 }
});
test('Voice host acceptance cannot close a foreign call or a different current utterance',async t=>{
 const f=await fixture(t);await f.context.startCall();f.peers[0].connectionState='connected';f.peers[0].onconnectionstatechange();const send=x=>f.peers[0].channel.onmessage({data:JSON.stringify(x)});
 send({type:'turn.created',turn:{role:'user',id:'continue'}});send({type:'turn.done',turn:{role:'user',id:'continue',transcript:'不要挂断，继续'}});
 for(const voiceSessionId of ['foreign','voice-1'])f.eventSources[0].onmessage({data:JSON.stringify({voiceSessionId,type:'voice.end.accepted',source:'voice_host_control',requestId:'old',userText:'拜拜',closeAfterPlayback:true})});
 assert.equal(f.body.dataset.callState,'connected');assert.equal(f.peers[0].closed,false);
});

test('host farewell can finish the existing assistant turn without borrowing earlier audio',async t=>{
 const f=await fixture(t);await f.context.startCall();const peer=f.peers[0];peer.connectionState='connected';peer.onconnectionstatechange();const send=x=>peer.channel.onmessage({data:JSON.stringify(x)});peer.channel.readyState='open';peer.channel.send=()=>{};
 send({type:'turn.created',turn:{role:'user',id:'u-host-open'}});send({type:'turn.done',turn:{role:'user',id:'u-host-open',transcript:'请挂断电话'}});
 await peer.ontrack({track:track()});for(let at=50;at<=1250;at+=50)f.meter(at,0,0);send({type:'turn.created',turn:{role:'assistant',id:'open'}});f.meter(1300,0,.1);
 f.eventSources[0].onmessage({data:JSON.stringify({voiceSessionId:'voice-1',type:'voice.end.accepted',source:'voice_host_control',requestId:'host-open',userText:'请挂断电话',closeAfterPlayback:true})});
 f.meter(1350,0,.1);send({type:'turn.done',turn:{role:'assistant',id:'open',transcript:'好的，再见。再见，下次聊。'}});
 for(let at=1400;at<=2250;at+=50)f.meter(at,0,0);await tick();assert.equal(peer.closed,true);
});

test('native caller barge-in retires a played reply plan without muting or cancelling work',async t=>{
 const f=await fixture(t);await f.context.startCall();const peer=f.peers[0];peer.connectionState='connected';peer.onconnectionstatechange();const send=x=>peer.channel.onmessage({data:JSON.stringify(x)}),sent=[];peer.channel.readyState='open';peer.channel.send=x=>sent.push(JSON.parse(x));await peer.ontrack({track:track()});
 f.eventSources[0].onmessage({data:JSON.stringify({voiceSessionId:'voice-1',type:'tool.result',callId:'actual-backend',backendFinal:true})});send({type:'turn.created',turn:{role:'assistant',id:'actual-final'}});f.meter(50,0,.1);send({type:'turn.created',turn:{role:'user',id:'interrupt'}});
 assert.equal(sent.length,1);assert.equal(sent[0].type,'session.context.append');assert.equal(sent[0].channel,'developer');assert.match(sent[0].content[0].text,/permanently retired/);assert.equal(peer.closed,false);
});

test('ordinary spoken acknowledgment does not receive final-result retirement instruction',async t=>{
 const f=await fixture(t);await f.context.startCall();const peer=f.peers[0];peer.connectionState='connected';peer.onconnectionstatechange();const send=x=>peer.channel.onmessage({data:JSON.stringify(x)}),sent=[];peer.channel.readyState='open';peer.channel.send=x=>sent.push(JSON.parse(x));await peer.ontrack({track:track()});
 send({type:'turn.created',turn:{role:'assistant',id:'ordinary-ack'}});f.meter(50,0,.1);send({type:'turn.created',turn:{role:'user',id:'end-now'}});assert.equal(sent.length,0);assert.equal(peer.closed,false);
});
test('streamed hangup confirms only current stable native text plus microphone silence, without USER done',async t=>{
 const f=await fixture(t,{api:(route,payload,result)=>route==='call-control-confirm'?{...payload.control,type:'voice.end.accepted'}:result});await f.context.startCall();const peer=f.peers[0];peer.connectionState='connected';peer.onconnectionstatechange();await peer.ontrack({track:track()});peer.channel.readyState='open';const sent=[];peer.channel.send=x=>sent.push(JSON.parse(x));const send=x=>peer.channel.onmessage({data:JSON.stringify(x)});
 send({type:'turn.created',turn:{role:'user',id:'stream',transcript:'请'}});send({type:'turn.delta',turn_id:'stream',delta:'挂断电话'});
 const value={voiceSessionId:'voice-1',type:'voice.end.proposed',source:'voice_host_control',requestId:'stream-end',decisionRevision:1,userText:'请挂断电话',closeAfterPlayback:true};f.eventSources[0].onmessage({data:JSON.stringify(value)});
 for(let at=50;at<=1250;at+=50)f.meter(at,.1,0);await tick();assert.equal(f.requests.filter(x=>x.route==='call-control-confirm').length,0,'live caller speech blocks confirmation');
 for(let at=1300;at<=3000;at+=50)f.meter(at,0,0);await tick();assert.equal(f.body.dataset.callState,'ending');assert.equal(sent.length,1);assert.equal(peer.closed,false,'decision alone is not farewell playback');
 send({type:'turn.created',turn:{role:'assistant',id:'stream-bye'}});f.meter(3050,0,.1);send({type:'turn.done',turn:{role:'assistant',id:'stream-bye',transcript:'再见，下次聊。'}});
 for(let at=3100;at<=3900;at+=50)f.meter(at,0,0);await tick();assert.equal(peer.closed,true);
});
test('a same native turn continuation invalidates an in-flight hangup confirmation',async t=>{
 const result=deferred();const f=await fixture(t,{api:(route,payload,value)=>route==='call-control-confirm'?result.promise:value});await f.context.startCall();const peer=f.peers[0];peer.connectionState='connected';peer.onconnectionstatechange();await peer.ontrack({track:track()});peer.channel.readyState='open';let sends=0;peer.channel.send=()=>sends++;const send=x=>peer.channel.onmessage({data:JSON.stringify(x)});
 send({type:'turn.created',turn:{role:'user',id:'continue-stream',transcript:'请挂断电话'}});
 const value={voiceSessionId:'voice-1',type:'voice.end.proposed',source:'voice_host_control',requestId:'old-stream',decisionRevision:1,userText:'请挂断电话',closeAfterPlayback:true};f.eventSources[0].onmessage({data:JSON.stringify(value)});
 for(let at=50;at<=1300;at+=50)f.meter(at,0,0);await tick();assert.equal(f.requests.filter(x=>x.route==='call-control-confirm').length,1);
 send({type:'turn.delta',turn_id:'continue-stream',delta:'之前先查一下明天日程'});result.resolve({...value,type:'voice.end.accepted'});await tick();assert.equal(f.body.dataset.callState,'connected');assert.equal(sends,0);assert.equal(peer.closed,false);
});
