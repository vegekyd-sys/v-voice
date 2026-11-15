// A lesson's script is read as host-injected speech, and injected speech stops the moment
// Seeduplex hears any sound (it gives no transcript while reading it, so that is the only
// way to cut a long backend read short). A cough, a television or someone else in the
// room then ended a lesson one sentence in, for good: the picture went on drawing with
// nothing said (Public call ab35cca0, 2026-11-14).
//
// The sound that stopped it is only a guess, like any barge-in. So a lesson that was
// stopped waits a moment: if no finished utterance with real words follows, nobody was
// talking to V, and it goes on from the sentence it was cut in. If the caller did speak,
// nothing changes: V answers them as before.
//
// Where it was cut: Seeduplex sends a script's audio about eight times faster than it
// plays (140 characters, 25 s of audio, all sent in 3.3 s: call b101ecc7), so whatever was
// sent says nothing about what was heard. What was heard is the time since the first
// frame went out, the same clock the page follows the voice with (board-client.mjs
// createSpokenCursor): a share of the script's audio when all of it has arrived, a
// speaking pace otherwise. It goes back to the start of that sentence; hearing the start
// of a sentence twice is better than hearing half of one.

export const NARRATION_RESUME = Object.freeze({
  // How long a stopped lesson waits for a finished utterance before going on.
  waitMs: 2_500,
  // Someone still talking when that is up is not talked over. A transcription that has
  // started and never finishes (Seeduplex does that with noise) stops the wait here.
  maxWaitMs: 6_000,
  // Each lesson goes on at most this many times; a room that keeps talking wins.
  maxResumes: 2,
  // The voice reads a script at about 5.5 characters a second (call b101ecc7: 140 in 25.2 s).
  charsPerSecond: 5.5,
  // Audio is sent ahead of the page playing it by about this much.
  playbackLagMs: 250,
  // Less than this left to say is not worth starting again for.
  minRestChars: 6,
  // Stopped this close to its end: it was heard.
  endSlackMs: 600,
});

const SENTENCE_END = /[。！？!?；;…\n]/u;

/** The start of the sentence that character `heard` of `text` falls in. */
export function narrationResumeIndex(text, heard) {
  const chars = Array.from(String(text ?? ''));
  let at = Math.max(0, Math.min(chars.length, Math.floor(heard)));
  while (at > 0 && !SENTENCE_END.test(chars[at - 1])) at--;
  while (at < chars.length && /[\s，,、]/u.test(chars[at])) at++;
  return at;
}

export class NarrationResume {
  constructor({ speak, diagnostic = () => {}, now, options = {} }) {
    this.speak = speak;
    this.diagnostic = diagnostic;
    this.now = now ?? options.now ?? (() => Date.now());
    this.options = { ...NARRATION_RESUME, ...options };
    this.current = null;
  }

  /** A lesson's script starts (or, with `from`, goes on). */
  start(text, { from = 0, resumes = 0, script = text } = {}) {
    this.#stopWaiting();
    const piece = Array.from(script).slice(from).join('');
    this.current = { script, from, piece, resumes, responseId: null, firstAudioAt: null, audioMs: 0, sent: false, pending: null };
    return piece;
  }

  /** Other speech took the voice: the lesson is over, whatever was left. */
  end(reason) {
    const current = this.current;
    if (!current) return;
    if (current.pending) this.diagnostic({ stage: 'narration-not-resumed', reason, ...this.#counts(current, current.pending.from) });
    this.#stopWaiting();
    this.current = null;
  }

  speechStarted(responseId, ttsType) {
    const current = this.current;
    if (!current) return;
    // Seeduplex's own reply ("default") is V answering something: not a lesson to go back to.
    if (ttsType === 'default') return this.end('model-replied');
    if (ttsType === 'chat_tts_text' && !current.responseId && !current.pending) current.responseId = responseId ?? '';
  }

  audio(responseId, bytes) {
    const current = this.current;
    if (!current || current.pending || current.responseId === null || (responseId && current.responseId && responseId !== current.responseId)) return;
    current.firstAudioAt ??= this.now();
    // 24 kHz, 16-bit mono.
    current.audioMs += bytes / 48;
  }

  audioDone(responseId) {
    const current = this.current;
    if (current && !current.pending && current.responseId !== null && (!responseId || !current.responseId || responseId === current.responseId)) current.sent = true;
  }

  /**
   * Local playback was cleared because a sound was heard. `confirmed` is a clear that is
   * not a guess (a speaker's echo cancellation heard someone, or the host cut V on purpose).
   */
  cleared({ confirmed = false } = {}) {
    const current = this.current;
    if (!current || current.pending) return;
    const o = this.options, chars = Array.from(current.piece).length;
    const playedMs = current.firstAudioAt === null ? 0 : Math.max(0, Math.min(current.audioMs, this.now() - current.firstAudioAt - o.playbackLagMs));
    if (current.sent && playedMs >= current.audioMs - o.endSlackMs) { this.current = null; return; }
    const totalMs = current.sent ? current.audioMs : Math.max(current.audioMs, chars / o.charsPerSecond * 1000);
    const heard = totalMs > 0 ? Math.min(chars, chars * playedMs / totalMs, playedMs / 1000 * o.charsPerSecond + 2) : 0;
    const from = current.from + narrationResumeIndex(current.piece, heard);
    const rest = Array.from(current.script).length - from;
    const counts = { ...this.#counts(current, from), heardChars: Math.floor(heard), playedMs: Math.round(playedMs) };
    this.diagnostic({ stage: 'narration-interrupted', ...counts });
    if (confirmed) return this.#drop('confirmed-speech', counts);
    if (rest < o.minRestChars) return this.#drop('nearly-done', counts);
    if (current.resumes >= o.maxResumes) return this.#drop('resume-limit', counts);
    const pending = current.pending = { from, waited: false, transcribing: false, timer: null, deadline: null };
    pending.timer = setTimeout(() => { pending.timer = null; pending.waited = true; if (!pending.transcribing) this.#resume(); }, o.waitMs);
    pending.deadline = setTimeout(() => { pending.deadline = null; this.#resume(); }, o.maxWaitMs);
    pending.timer.unref?.(); pending.deadline.unref?.();
  }

  inputStarted() {
    if (this.current?.pending) this.current.pending.transcribing = true;
  }

  /** A finished utterance: words mean the caller spoke to V; none means it was a sound. */
  inputFinished(text) {
    const pending = this.current?.pending;
    if (!pending) return;
    if (String(text ?? '').trim()) return this.end('user-spoke');
    pending.transcribing = false;
    if (pending.waited) this.#resume();
  }

  close() {
    this.#stopWaiting();
    this.current = null;
  }

  #resume() {
    const current = this.current;
    if (!current?.pending) return;
    const { from } = current.pending;
    const resumes = current.resumes + 1;
    this.diagnostic({ stage: 'narration-resumed', ...this.#counts(current, from), resumes });
    const piece = this.start(current.script, { from, resumes, script: current.script });
    this.speak(piece);
  }

  #drop(reason, counts) {
    this.diagnostic({ stage: 'narration-not-resumed', reason, ...counts });
    this.#stopWaiting();
    this.current = null;
  }

  #counts(current, from) {
    const total = Array.from(current.script).length;
    return { fromChar: from, totalChars: total, restChars: total - from, resumes: current.resumes };
  }

  #stopWaiting() {
    const pending = this.current?.pending;
    if (!pending) return;
    clearTimeout(pending.timer); clearTimeout(pending.deadline);
    this.current.pending = null;
  }
}
