/** Optional call-state sounds. Supply a dedicated audio element, never remoteAudio. */
export function createCallSounds({
  audioElement,
  sharedContext,
  AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  location = globalThis.location,
  setInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
} = {}) {
  if (audioElement?.id === "remoteAudio" || audioElement?.srcObject)
    throw new TypeError("Call sounds require a dedicated audio element");
  let phase = "idle", generation = 0, context = sharedContext, resumePromise;
  let ringTimer, pickupTimer, connectedOnce = false, disposed = false, customOwned = false;
  const nodes = new Set();
  const current = (token, expected) => !disposed && generation === token && phase === expected;
  const safeSource = key => {
    const value = audioElement?.dataset?.[key];
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const base = new URL(typeof location === "string" ? location : location.href);
      const source = new URL(value, base);
      return ["http:", "https:"].includes(base.protocol) && ["http:", "https:"].includes(source.protocol) &&
        source.origin === base.origin && !source.username && !source.password ? source.href : null;
    } catch { return null; }
  };
  const stopCustom = () => {
    if (!customOwned) return;
    customOwned = false;
    // Never take over a MediaStream even if a caller misuses the dedicated element.
    if (audioElement?.srcObject) return;
    try { audioElement.pause(); } catch {}
    try { audioElement.loop = false; audioElement.removeAttribute("src"); audioElement.load(); } catch {}
  };
  const stopNodes = () => {
    for (const row of [...nodes]) {
      try { row.gain.gain.cancelScheduledValues(context.currentTime); row.gain.gain.value = 0; } catch {}
      try { row.oscillator.stop(); } catch {}
      try { row.oscillator.disconnect(); row.gain.disconnect(); } catch {}
      nodes.delete(row);
    }
  };
  const clearTimers = () => {
    if (ringTimer !== undefined) { clearInterval(ringTimer); ringTimer = undefined; }
    if (pickupTimer !== undefined) { clearTimeout(pickupTimer); pickupTimer = undefined; }
  };
  const ensureContext = () => {
    // This function is called synchronously by dial(), inside the user gesture.
    if (!context && typeof AudioContext === "function") {
      try { context = new AudioContext(); } catch { return Promise.resolve(false); }
    }
    if (!context) return Promise.resolve(false);
    if (!resumePromise) {
      try { resumePromise = Promise.resolve(context.resume()).then(() => true, () => false); }
      catch { resumePromise = Promise.resolve(false); }
    }
    return resumePromise;
  };
  const tone = (frequency, offset, duration, volume) => {
    if (disposed || !context || context.state === "closed") return;
    let row;
    try {
      const oscillator = context.createOscillator(), gain = context.createGain();
      row = { oscillator, gain }; nodes.add(row);
      oscillator.type = "sine"; oscillator.frequency.value = frequency;
      oscillator.connect(gain); gain.connect(context.destination);
      const at = context.currentTime + offset;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + .015);
      gain.gain.setValueAtTime(volume, at + Math.max(.015, duration - .035));
      gain.gain.linearRampToValueAtTime(0, at + duration);
      oscillator.onended = () => {
        try { oscillator.disconnect(); gain.disconnect(); } catch {}
        nodes.delete(row);
      };
      oscillator.start(at); oscillator.stop(at + duration + .02);
    } catch {
      if (row) { try { row.oscillator.disconnect(); row.gain.disconnect(); } catch {} nodes.delete(row); }
    }
  };
  const ringPulse = token => {
    if (!current(token, "dialing")) return;
    tone(440, 0, .35, .012); tone(480, 0, .35, .012);
  };
  const defaultRing = async token => {
    if (!await ensureContext() || !current(token, "dialing")) return;
    ringPulse(token);
    if (current(token, "dialing")) ringTimer = setInterval(() => ringPulse(token), 2400);
  };
  const defaultPickup = async token => {
    // connected() reuses the gesture-created context; it never creates a new one.
    if (!context || !await resumePromise || !current(token, "connected")) return;
    tone(660, 0, .075, .018); tone(880, .10, .085, .018);
  };
  const playCustom = async (source, loop, token, expected) => {
    if (!source || !audioElement || audioElement.srcObject || !current(token, expected)) return false;
    customOwned = true;
    try {
      audioElement.src = source; audioElement.loop = loop;
      // play() runs before awaiting so dial's user activation is preserved.
      await audioElement.play();
      if (!current(token, expected)) {
        if (disposed) stopCustom();
        return false;
      }
      return true;
    } catch {
      if (current(token, expected)) stopCustom();
      return false;
    }
  };
  return {
    dial() {
      if (disposed || phase !== "idle") return Promise.resolve();
      phase = "dialing"; const token = ++generation;
      void ensureContext();
      const source = safeSource("ringSrc");
      return source ? playCustom(source, true, token, "dialing").then(played => {
        if (!played && current(token, "dialing")) return defaultRing(token);
      }) : defaultRing(token);
    },
    connected() {
      if (disposed || connectedOnce) return Promise.resolve();
      connectedOnce = true;
      const wasDialing = phase === "dialing";
      phase = "connected"; const token = ++generation;
      clearTimers(); stopNodes(); stopCustom();
      if (!wasDialing) return Promise.resolve();
      const source = safeSource("pickupSrc");
      return source ? playCustom(source, false, token, "connected").then(played => {
        if (!current(token, "connected")) return;
        if (!played) return defaultPickup(token);
        // Custom pickup clips cannot leave an unbounded player behind.
        pickupTimer = setTimeout(() => { if (current(token, "connected")) stopCustom(); }, 1500);
      }) : defaultPickup(token);
    },
    dispose() {
      if (disposed) return Promise.resolve();
      disposed = true; phase = "disposed"; ++generation;
      clearTimers(); stopNodes(); stopCustom();
      try { return Promise.resolve(sharedContext ? undefined : context?.close()).catch(() => {}); }
      catch { return Promise.resolve(); }
    },
  };
}
