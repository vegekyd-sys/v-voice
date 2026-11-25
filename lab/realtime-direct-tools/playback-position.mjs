// Where the phone is in V's speech. SeedDuplex generates speech (a board lesson most of all) two to
// three times faster than it plays, so upstream believes V has finished while half a minute still
// plays on the phone (11/24–25: lessons of 25–48 s were generated in 3–15 s). Anything said in the
// room then reaches the model as a new turn after V's finished answer, and its own duplex judgement
// (stay quiet for side talk, keep the answer for a backchannel) has nothing left to keep.
//
// This keeps, per call, how much of the response now on the phone has been sent and roughly how much
// of it has played: from the time its audio started plus the phone's own reports (playback.state;
// the page's playback.stats queue size where it sends them). It is an estimate for telling the model
// the state it is in; it never decides anything about the caller's speech itself.

const BYTES_PER_MS = 48; // 24 kHz PCM16 mono
const PREFILL_MS = 150;
// Chinese speech of this voice: about 180 ms a character (11/24–25 lessons: 162–191).
export const SPOKEN_MS_PER_CHAR = 180;

export function createPlaybackPosition({now = Date.now, prefillMs = PREFILL_MS} = {}) {
  let current = null;
  const reset = () => { current = null; };
  const elapsed = (at, c) => Math.max(0, at - c.startAt - c.pausedMs - (c.pausedAt === null ? 0 : at - c.pausedAt));
  const position = {
    /** `bytes` of 24 kHz PCM16 of `responseId` were sent to the phone; `scripted`: speech V reads out (a lesson). */
    sent(responseId, bytes, {scripted = false} = {}) {
      const at = now();
      if (!current || current.responseId !== (responseId ?? null)) {
        // A response queued behind one still playing starts when that one ends.
        const before = current ? current.startAt + current.pausedMs + current.sentMs : 0;
        current = {responseId: responseId ?? null, scripted, sentMs: 0, startAt: Math.max(at + prefillMs, before), pausedMs: 0, pausedAt: null, generated: false, queued: null};
      }
      current.sentMs += bytes / BYTES_PER_MS;
    },
    /** Upstream finished generating `responseId`: everything of it is on the phone. */
    generated(responseId) { if (current && (responseId === undefined || current.responseId === responseId)) current.generated = true; },
    /** The phone holds (pauses) or resumes playback. */
    paused(value) {
      if (!current) return;
      const at = now();
      if (value && current.pausedAt === null) current.pausedAt = at;
      if (!value && current.pausedAt !== null) { current.pausedMs += at - current.pausedAt; current.pausedAt = null; }
    },
    /** The page's own count of what it has not played yet. */
    queued(bytes) { if (current && Number.isFinite(bytes) && bytes >= 0) current.queued = {ms: bytes / BYTES_PER_MS, at: now()}; },
    /** The phone reports it has nothing left to play, or its queue was cleared. */
    drained: reset,
    cleared(retiredResponseId) { if (!retiredResponseId || current?.responseId === retiredResponseId) reset(); },
    /**
     * What is still to play: {responseId, scripted, playedMs, remainingMs, totalMs, generated}, or null.
     * `chars`: the length of the text being said, for a response still being generated.
     */
    snapshot({chars = 0} = {}) {
      if (!current) return null;
      const at = now(), c = current;
      const totalMs = c.generated ? c.sentMs : Math.max(c.sentMs, chars * SPOKEN_MS_PER_CHAR);
      let remainingMs = Math.max(0, totalMs - elapsed(at, c));
      // The page counts its own queue every two seconds; a fresh count is better than the clock.
      if (c.generated && c.queued && at - c.queued.at <= 2500) remainingMs = Math.max(0, Math.min(remainingMs + 1000, c.queued.ms - (c.pausedAt === null ? at - c.queued.at : 0)));
      return {responseId: c.responseId, scripted: c.scripted, playedMs: Math.round(totalMs - remainingMs), remainingMs: Math.round(remainingMs), totalMs: Math.round(totalMs), generated: c.generated};
    },
  };
  return position;
}

/** The part of `text` already said and the part still to come, at `played` of `total`. */
export function splitSpoken(text, playedMs, totalMs) {
  const chars = Array.from(String(text ?? ''));
  if (!chars.length || !(totalMs > 0)) return {said: '', ahead: ''};
  const at = Math.max(0, Math.min(chars.length, Math.round(chars.length * playedMs / totalMs)));
  return {said: chars.slice(Math.max(0, at - 40), at).join(''), ahead: chars.slice(at, at + 60).join('')};
}
