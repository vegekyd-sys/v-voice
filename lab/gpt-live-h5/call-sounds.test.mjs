import test from "node:test";
import assert from "node:assert/strict";
import { createCallSounds } from "./call-sounds.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture({ resume, dataset = {}, plays = [] } = {}) {
  const intervals = new Map(), timeouts = new Map(), contexts = [], trace = []; let id = 0;
  class Context {
    constructor() { this.currentTime = 0; this.state = "suspended"; this.destination = {}; this.oscillators = []; contexts.push(this); }
    resume() { trace.push("resume"); return (resume?.promise ?? Promise.resolve()).then(() => { if (this.state !== "closed") this.state = "running"; }); }
    close() { this.state = "closed"; trace.push("close"); return Promise.resolve(); }
    createOscillator() {
      const node = { frequency: {}, connect() {}, disconnect() { trace.push("osc-disconnect"); },
        start(at) { trace.push(["start", at]); }, stop(at) { trace.push(["stop", at]); } };
      this.oscillators.push(node); return node;
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() { trace.push("gain-disconnect"); } }; }
  }
  const audio = { id: "callSounds", srcObject: null, dataset, src: "", loop: false,
    play() { trace.push(["play", this.src, this.loop]); return plays.shift()?.promise ?? Promise.resolve(); },
    pause() { trace.push("pause"); }, removeAttribute(name) { if (name === "src") this.src = ""; trace.push("remove-src"); }, load() { trace.push("load"); } };
  const options = { audioElement: audio, AudioContext: Context, location: { href: "https://voice.test/voice/" },
    setInterval(fn, ms) { const key = ++id; intervals.set(key, { fn, ms }); return key; }, clearInterval(key) { intervals.delete(key); },
    setTimeout(fn, ms) { const key = ++id; timeouts.set(key, { fn, ms }); return key; }, clearTimeout(key) { timeouts.delete(key); } };
  return { audio, options, trace, intervals, timeouts, contexts, sounds: createCallSounds(options) };
}
const starts = f => f.trace.filter(row => Array.isArray(row) && row[0] === "start").length;
const playRows = f => f.trace.filter(row => Array.isArray(row) && row[0] === "play");
test("gesture dial creates one private context, rings periodically, and pickup occurs only once", async () => {
  const f = fixture(); const dial = f.sounds.dial(); assert.equal(f.contexts.length, 1); assert.equal(f.trace[0], "resume");
  await dial; assert.equal(starts(f), 2); assert.equal(f.intervals.size, 1); assert.equal([...f.intervals.values()][0].ms, 2400);
  await f.sounds.dial(); assert.equal(f.contexts.length, 1); assert.equal(starts(f), 2);
  [...f.intervals.values()][0].fn(); assert.equal(starts(f), 4);
  await f.sounds.connected(); assert.equal(f.intervals.size, 0); assert.equal(starts(f), 6);
  await f.sounds.connected(); assert.equal(starts(f), 6);
  await f.sounds.dispose(); assert.equal(f.contexts[0].state, "closed");
});
test("dispose cancels timers and scheduled nodes; a stale ring timer cannot sound again", async () => {
  const f = fixture(); await f.sounds.dial(); const stale = [...f.intervals.values()][0].fn;
  await f.sounds.dispose(); const count = starts(f); stale(); await f.sounds.connected(); await f.sounds.dial();
  assert.equal(starts(f), count); assert.equal(f.intervals.size, 0); assert(f.trace.includes("osc-disconnect"));
  await f.sounds.dispose(); assert.equal(f.trace.filter(value => value === "close").length, 1);
});
test("late context resume after close cannot create tones or timers", async () => {
  const resume = deferred(), f = fixture({ resume }); const pending = f.sounds.dial();
  await f.sounds.dispose(); resume.resolve(); await pending;
  assert.equal(starts(f), 0); assert.equal(f.intervals.size, 0); assert.equal(f.contexts[0].state, "closed");
});
test("connection during pending resume stops dial generation and emits only the pickup", async () => {
  const resume = deferred(), f = fixture({ resume }); const dial = f.sounds.dial(), connected = f.sounds.connected();
  resume.resolve(); await Promise.all([dial, connected]);
  assert.equal(starts(f), 2); assert.equal(f.intervals.size, 0); await f.sounds.dispose();
});
test("same-origin custom clips start ring in gesture and pickup is once, short and independently cleaned", async () => {
  const f = fixture({ dataset: { ringSrc: "./sounds/ring.wav", pickupSrc: "/sounds/pickup.wav" } });
  const pending = f.sounds.dial(); assert.equal(playRows(f).length, 1); await pending;
  assert.deepEqual(playRows(f)[0], ["play", "https://voice.test/voice/sounds/ring.wav", true]); assert.equal(starts(f), 0);
  await f.sounds.connected(); await f.sounds.connected();
  assert.deepEqual(playRows(f)[1], ["play", "https://voice.test/sounds/pickup.wav", false]);
  assert.equal(f.timeouts.size, 1); assert.equal([...f.timeouts.values()][0].ms, 1500);
  await f.sounds.dispose(); assert.equal(f.audio.src, ""); assert.equal(f.timeouts.size, 0); assert(f.trace.includes("pause"));
});
test("external, non-http and credential-bearing sources are never loaded, and default tones remain", async () => {
  for (const source of ["https://outside.test/ring.wav", "//outside.test/ring.wav", "data:audio/wav;base64,eA==", "javascript:alert(1)", "https://user:secret@voice.test/ring.wav"]) {
    const f = fixture({ dataset: { ringSrc: source, pickupSrc: source } });
    await f.sounds.dial(); await f.sounds.connected(); assert.equal(playRows(f).length, 0); assert.equal(starts(f), 4); await f.sounds.dispose();
  }
});
test("failed custom media may fall back while current; stale rejected play never restarts dial", async () => {
  const rejected = deferred(), f = fixture({ dataset: { ringSrc: "/ring.wav" }, plays: [rejected] });
  const dial = f.sounds.dial(); rejected.reject(new Error("Media unavailable")); await dial;
  assert.equal(starts(f), 2); await f.sounds.dispose();
  const late = deferred(), g = fixture({ dataset: { ringSrc: "/ring.wav" }, plays: [late] });
  const old = g.sounds.dial(); await g.sounds.connected(); const afterPickup = starts(g); late.reject(new Error("Old play")); await old;
  assert.equal(starts(g), afterPickup); assert.equal(g.intervals.size, 0); await g.sounds.dispose();
});
test("late custom play after dispose cannot resume sounds or keep custom source loaded", async () => {
  const late = deferred(), f = fixture({ dataset: { ringSrc: "/ring.wav" }, plays: [late] });
  const dial = f.sounds.dial(); await f.sounds.dispose(); late.resolve(); await dial;
  assert.equal(starts(f), 0); assert.equal(f.audio.src, ""); assert.equal(f.intervals.size, 0);
});
test("old ring play completion cannot pause a newer custom pickup", async () => {
  const old = deferred(), f = fixture({ dataset: { ringSrc: "/ring.wav", pickupSrc: "/pickup.wav" }, plays: [old] });
  const dial = f.sounds.dial(); await f.sounds.connected(); const pauses = f.trace.filter(row => row === "pause").length;
  old.resolve(); await dial; assert.equal(f.trace.filter(row => row === "pause").length, pauses); assert.equal(f.audio.src, "https://voice.test/pickup.wav");
  await f.sounds.dispose();
});
test("connected before gesture cannot create a context or pretend a call was picked up", async () => {
  const f = fixture(); await f.sounds.connected(); await f.sounds.dial();
  assert.equal(f.contexts.length, 0); assert.equal(playRows(f).length, 0); await f.sounds.dispose();
});
test("remote MediaStream playback is rejected rather than touched by call sounds", () => {
  const f = fixture(); f.audio.srcObject = {};
  assert.throws(() => createCallSounds(f.options), TypeError);
  assert.equal(playRows(f).length, 0); assert(!f.trace.includes("pause"));
});

test('relay ring and pickup share the call context without closing its microphone or playback graph',async()=>{
 const f=fixture();const Context=f.options.AudioContext,shared=new Context();const sounds=createCallSounds({...f.options,sharedContext:shared});
 await sounds.dial();await sounds.connected();assert.equal(f.contexts.length,1);assert.equal(shared.state,'running');await sounds.dispose();assert.equal(shared.state,'running');assert.equal(f.trace.includes('close'),false);await shared.close();
});
