// Page side of the call board. Decides when the conversation has moved enough
// to ask the director for a picture, and applies the operations it streams
// back. Cosmetic like the avatar reactions: nothing here is awaited by speech,
// tools or the call itself, and a failed request only leaves the board as it was.
import {applyOp, emptyScene, normalizeOp, normalizeScene} from './board-scene.mjs';
import {orderedTranscriptRows} from './transcript-presentation.mjs';

export const BOARD_REQUEST_TIMEOUT_MS = 25000;
export const BOARD_PROGRESS_INTERVAL_MS = 2500;
const SETTLE_MS = 350;
const sentences = text => text.match(/[^。！？.!?\n]+[。！？.!?\n]+/gu)?.join('').trim() ?? '';
const signature = row => row ? row.key + '\u0000' + row.text : '';

/**
 * How far into V's current reply the audio has got, in characters. A realtime
 * model sends a reply's text and audio together, far ahead of playback, so the
 * share of this reply's received audio that has been played is also the share
 * of its received text that has been heard. Byte counts are cumulative for the
 * call (relay-audio stats); a new reply starts a new baseline.
 */
export const SPOKEN_CHARS_PER_SECOND = 6.4;
export function createSpokenCursor({now = () => performance.now()} = {}) {
  let key = null, base = 0, reached = 0, startedAt = null;
  return {
    index({key: turn, textLength, outputBytes, queuedBytes}) {
      const played = outputBytes - queuedBytes;
      if (turn !== key) { key = turn; base = played; reached = 0; startedAt = null; }
      const received = outputBytes - base;
      if (!(received > 0)) return reached;
      if (played > base) startedAt ??= now();
      // A script V is made to read arrives as text all at once while its audio
      // streams about as fast as it plays, so the played share is near 1 from
      // the start. Nobody speaks faster than this, whatever the share says.
      const pace = startedAt === null ? 0 : Math.ceil((now() - startedAt) / 1000 * SPOKEN_CHARS_PER_SECOND) + 2;
      // Early in a reply the ratio is noisy (little audio received yet); what
      // has been heard is never un-heard.
      reached = Math.max(reached, Math.min(pace, Math.floor(textLength * Math.min(1, Math.max(0, (played - base) / received)))));
      return reached;
    },
  };
}

/**
 * What of a lesson is on the page. A lesson's picture arrives a moment before
 * V starts reading its script (often while V is still saying "let me think"),
 * and with nothing said yet the page used to show all of it for half a second.
 * Until the script has been heard being spoken, everything waits; afterwards
 * the page follows the voice, and shows everything once V has finished.
 * `progress(text, index)` is spokenProgress for this scene.
 */
export function createLessonGate({now = () => Date.now(), patienceMs = 15000} = {}) {
  let serial = null, spoke = false, since = 0, shown = new Set();
  return {
    view({scene, text, speaking, progress, speaksOf, unspoken}) {
      if (!scene.lesson || !scene.blocks.length) return speaking && scene.blocks.length ? progress() : null;
      if (scene.serial !== serial) { serial = scene.serial; spoke = false; since = now(); shown = new Set(); }
      const pieces = unspoken(scene).ahead;
      // What has appeared stays: a later reply that happens to use a piece's
      // words again ("对啦，小火龙怕水") must not take it off the page.
      const following = () => {
        const at = progress(), ahead = at.ahead.filter(id => !shown.has(id));
        for (const id of pieces) if (!ahead.includes(id)) shown.add(id);
        return {...at, ahead};
      };
      if (speaking && (spoke || speaksOf(scene, text))) { spoke = true; return following(); }
      // Not begun (and not given up on): nothing is shown yet.
      if (!spoke && now() - since < patienceMs) return unspoken(scene);
      for (const id of pieces) shown.add(id);
      return speaking ? following() : null;
    },
  };
}

/** Read `data:` events from a streamed response body. */
export async function readEventStream(response, onEvent) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const drain = () => {
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      if (!line.startsWith('data:')) continue;
      try { onEvent(JSON.parse(line.slice(5))); } catch { /* One unreadable event does not end the stream. */ }
    }
  };
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true}); drain();
  }
  buffer += '\n'; drain();
}

export function createBoardClient({request, onScene = () => {}, isCurrent = () => true, now = Date.now, observe = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let scene = emptyScene(), closed = false, busy = false, timer = null, controller = null, latest = null, runs = 0;
  let lastUser = '', lastAssistantKey = '', lastAssistantText = '', lastAssistantAt = -Infinity, lastEnd = '', documents = 0, evidence = false;
  const schedule = (wait = SETTLE_MS) => {
    if (closed || busy || !latest) return;
    clearTimer(timer); timer = setTimer(run, wait);
  };
  // Returns the next reason to ask, how long to wait for it, or nothing.
  function candidate() {
    if (!latest) return null;
    const {rows, user, assistant} = latest;
    // The caption of the caller's turn must have stopped changing: it is
    // final, or V has already started answering it.
    if (user && signature(user) !== lastUser && (user.complete || rows.at(-1) !== user))
      return {trigger: 'user', wait: 0, mark: () => { lastUser = signature(user); }};
    const documentCount = rows.filter(row => row.document).length;
    if (evidence || documentCount > documents)
      return {trigger: 'evidence', mark: () => { evidence = false; documents = documentCount; }};
    // V's greeting before the caller has said anything is not worth a picture.
    if (!assistant || !user && !scene.blocks.length) return null;
    if (assistant.complete) {
      if (signature(assistant) === lastEnd) return null;
      return {trigger: 'assistant_end', mark: () => { lastEnd = signature(assistant); lastAssistantKey = assistant.key; lastAssistantText = assistant.text; }};
    }
    const spoken = sentences(assistant.text);
    if (!spoken || assistant.key === lastAssistantKey && spoken === lastAssistantText) return null;
    const wait = assistant.key === lastAssistantKey ? BOARD_PROGRESS_INTERVAL_MS - (now() - lastAssistantAt) : 0;
    if (wait > 0) return {wait};
    return {trigger: 'assistant_progress', spoken, mark: () => { lastAssistantKey = assistant.key; lastAssistantText = spoken; lastAssistantAt = now(); }};
  }
  function apply(value) {
    if (value?.op === 'done') { observe({type: 'done', reason: value.reason, durationMs: value.durationMs, firstOpMs: value.firstOpMs}); return; }
    let next = scene;
    if (value?.op === 'sync') next = normalizeScene(value.scene) ?? scene;
    else { const op = normalizeOp(value); if (op) next = applyOp(scene, op); }
    if (next === scene) return;
    scene = next; onScene(scene);
  }
  async function run() {
    timer = null;
    if (closed || busy || !isCurrent()) return;
    const next = candidate();
    if (!next?.trigger) { if (next?.wait > 0) schedule(next.wait); return; }
    next.mark();
    const turns = latest.rows.slice(-8).map((row, index, all) => ({
      role: row.document ? 'document' : row.role,
      // V may still be speaking: send only what is already a whole phrase.
      text: (next.spoken && index === all.length - 1 && row.role === 'assistant' ? next.spoken : row.text).slice(row.document ? -2000 : -800),
    })).filter(turn => turn.text.trim());
    if (!turns.length) return;
    busy = true;
    const own = controller = new AbortController(), started = now(), id = ++runs;
    const timeout = setTimer(() => own.abort('timeout'), BOARD_REQUEST_TIMEOUT_MS);
    observe({type: 'requested', run: id, trigger: next.trigger});
    try {
      await request({trigger: next.trigger, rev: scene.rev, turns}, {signal: own.signal,
        onEvent: value => { if (!closed && !own.signal.aborted && isCurrent()) apply(value); }});
      observe({type: 'finished', run: id, trigger: next.trigger, durationMs: now() - started});
    } catch {
      observe({type: own.signal.aborted ? 'aborted' : 'failed', run: id, trigger: next.trigger, reason: own.signal.aborted ? own.signal.reason : 'request_failed'});
    } finally {
      clearTimer(timeout); busy = false;
      if (!closed && candidate()) schedule(0);
    }
  }
  return {
    get scene() { return scene; },
    /** Called with every transcript snapshot the page renders. */
    update({snapshot}) {
      if (closed) return;
      const rows = orderedTranscriptRows({history: (snapshot?.history ?? []).map(row => ({...row, complete: row.complete ?? true})), current: snapshot?.current ?? []})
        .filter(row => ['user', 'assistant'].includes(row.role) && typeof row.text === 'string' && row.text.trim());
      const spoken = rows.filter(row => !row.document);
      const user = spoken.filter(row => row.role === 'user').at(-1) ?? null;
      const assistant = spoken.at(-1)?.role === 'assistant' ? spoken.at(-1) : null;
      // A new question retires a picture still being drawn for the last one.
      if (busy && user && latest?.user && user.key !== latest.user.key) controller?.abort('new_user_turn');
      latest = {rows, user, assistant};
      const next = candidate();
      if (next) schedule(next.wait ?? SETTLE_MS);
    },
    /** A lookup finished on the service; its result may be worth showing. */
    evidence() { if (closed) return; evidence = true; if (latest) schedule(); },
    dispose() { closed = true; clearTimer(timer); controller?.abort('call_closed'); latest = null; },
  };
}
