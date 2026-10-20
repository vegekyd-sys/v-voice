// Adaptive near-field gate for a household device microphone.
//
// The person talking to the device is about a metre away; a TV or other room
// voices are farther and quieter at the microphone, but they never stop. Fed
// whole, continuous far speech merges with the user's words into one long turn.
// The gate learns the background level (the median of recent frames it did not
// pass, sample-weighted) and only passes frames at least gateDb louder, with a
// sample-counted hold so soft endings survive. Frames it passes barely move the
// background, except when the gate has stayed open for longer than a person
// talks without pausing (the TV was turned up): then the background catches up.
export const NEAR_FIELD_DEFAULT_DB = 10;

const toDb = rms => 20 * Math.log10(rms / 32768);

export function createNearFieldGate({gateDb = NEAR_FIELD_DEFAULT_DB, holdMs = 400, windowMs = 12000, warmupMs = 1000, sustainedMs = 6000, sampleRate = 16000, minFloorDb = -75} = {}) {
  const perMs = sampleRate / 1000, cap = windowMs * perMs, hold = holdMs * perMs;
  const window = [], histogram = new Map();
  let windowWeight = 0, holdLeft = 0, openRun = 0, thresholdDb = null, gated = 0, total = 0;
  const background = () => {
    if (windowWeight < warmupMs * perMs) return null;
    const sorted = [...window].sort((a, b) => a.db - b.db);
    let seen = 0;
    for (const f of sorted) {seen += f.weight;if (seen >= windowWeight / 2) return Math.max(minFloorDb, f.db);}
    return null;
  };
  const remember = (db, weight) => {
    window.push({db, weight});windowWeight += weight;
    while (windowWeight - window[0].weight >= cap) windowWeight -= window.shift().weight;
  };
  return {
    /** rms of one PCM16 frame and its sample count; false means replace it with silence. */
    pass(rms, samples) {
      // Digital silence (a muted uplink) is neither speech nor background.
      if (!(rms >= 1)) return true;
      const db = toDb(rms), key = Math.max(-90, Math.round(db));
      histogram.set(key, (histogram.get(key) ?? 0) + samples);total += samples;
      const floor = background();
      if (floor === null) {remember(db, samples);return true;}
      thresholdDb = floor + gateDb;
      const open = db >= thresholdDb;
      if (open) holdLeft = hold;
      else if (holdLeft > 0) holdLeft -= samples;
      else {openRun = 0;remember(db, samples);gated += samples;return false;}
      // A passed frame (speech or its held tail) is probably the near person.
      openRun += samples;
      remember(db, openRun > sustainedMs * perMs ? samples : samples / 10);
      return true;
    },
    /** Bounded numeric telemetry for tuning; never audio. */
    summary() {
      const levels = [...histogram].sort((a, b) => a[0] - b[0]), at = q => {let seen = 0;for (const [db, n] of levels) {seen += n;if (seen >= total * q) return db;}return null;};
      return {gateDb, thresholdDb:thresholdDb === null ? null : Math.round(thresholdDb), gatedMs:Math.round(gated / perMs), inputMs:Math.round(total / perMs), levelDb:{p10:at(.1), p50:at(.5), p90:at(.9)}};
    },
  };
}
