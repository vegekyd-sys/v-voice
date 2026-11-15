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
  // Someone still talking when that is up is not talked over: the wait goes on until their
  // utterance is finished (a voice through a wall took 8 s: Candidate call 6b84c932). Only a
  // transcription that started and never finishes ends the wait here.
  maxWaitMs: 12_000,
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

// A finished utterance of nothing but a hum, a laugh or a cough is a sound, not words for V.
const NO_WORDS = /^[\s嗯啊哦噢呃额唉哎咳哈呵嘿呀诶欸唔嗯哼。，、！？!?,.…~～-]*$/u;
export const hasWords = text => !NO_WORDS.test(String(text ?? ''));

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
   * `playing`: only the script's generation was stopped and what was already sent still
   * plays (a phone call in native full duplex), so where to go on from is decided when it does.
   */
  cleared({ confirmed = false, playing = false } = {}) {
    const current = this.current;
    if (!current || current.pending) return;
    const o = this.options, at = this.#position(current);
    if (current.sent && at.playedMs >= current.audioMs - o.endSlackMs) { this.current = null; return; }
    const counts = { ...this.#counts(current, at.from), heardChars: Math.floor(at.heard), playedMs: Math.round(at.playedMs), audioMs: Math.round(current.audioMs) };
    this.diagnostic({ stage: 'narration-interrupted', ...counts });
    if (confirmed) return this.#drop('confirmed-speech', counts);
    if (!playing && Array.from(current.script).length - at.from < o.minRestChars) return this.#drop('nearly-done', counts);
    if (current.resumes >= o.maxResumes) return this.#drop('resume-limit', counts);
    const pending = current.pending = { from: at.from, playing, waited: false, transcribing: false, timer: null, deadline: null };
    pending.timer = setTimeout(() => { pending.timer = null; pending.waited = true; if (!pending.transcribing) this.#resume(); }, o.waitMs);
    pending.deadline = setTimeout(() => { pending.deadline = null; this.#resume(); }, o.maxWaitMs);
    pending.timer.unref?.(); pending.deadline.unref?.();
  }

  /** How much of the current piece has been heard by now, and the sentence to go on from. */
  #position(current) {
    const o = this.options, chars = Array.from(current.piece).length;
    const playedMs = current.firstAudioAt === null ? 0 : Math.max(0, Math.min(current.audioMs, this.now() - current.firstAudioAt - o.playbackLagMs));
    const totalMs = current.sent ? current.audioMs : Math.max(current.audioMs, chars / o.charsPerSecond * 1000);
    const heard = totalMs > 0 ? Math.min(chars, chars * playedMs / totalMs, playedMs / 1000 * o.charsPerSecond + 2) : 0;
    return { playedMs, heard, from: current.from + narrationResumeIndex(current.piece, heard) };
  }

  inputStarted() {
    if (this.current?.pending) this.current.pending.transcribing = true;
  }

  /** A finished utterance: words mean the caller spoke to V; none means it was a sound. */
  inputFinished(text) {
    const pending = this.current?.pending;
    if (!pending) return;
    if (hasWords(text)) return this.end('user-spoke');
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
    let { from } = current.pending;
    // What was sent before the stop has kept playing meanwhile: go on after it.
    if (current.pending.playing) {
      from = Math.max(from, this.#position(current).from);
      if (Array.from(current.script).length - from < this.options.minRestChars) return this.#drop('nearly-done', this.#counts(current, from));
    }
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
