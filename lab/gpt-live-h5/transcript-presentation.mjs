import {transcriptEvent} from './events.mjs';

export function formatTranscriptTime(at) {
  if (!Number.isFinite(at) || at < 0) return '';
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * One row per real native turn. Provider caption item IDs identify fragments,
 * not conversational turns. Text stays unchanged here; the view renders safe Markdown DOM.
 * This state lives in the page; it performs no persistence or network actions.
 */
export function createTranscriptPresentation() {
  let sequence = 0;
  const rows = [], nativeTurns = new Map(), openByRole = new Map(), fragments = new Map(), seenEvents = new Set();
  const view = row => ({
    key: row.key, role: row.role, speaker: row.document ? 'V · 完整方案' : row.role === 'user' ? '你' : 'V',
    text: row.text, document: row.document === true, ...(row.document?{callId:row.callId}:{}), at: row.at, time: formatTranscriptTime(row.at), complete: row.complete,
  });
  const snapshot = () => ({
    history: rows.filter(row => row.complete && row.text.trim()).map(view),
    current: rows.filter(row => !row.complete && row.text.trim()).map(view),
  });
  const turnKey = (role, id) => `${role}:${id}`;
  const bind = (row, id) => {
    if (typeof id === 'string' && id) {
      row.nativeId = id;
      nativeTurns.set(turnKey(row.role, id), row);
    }
    return row;
  };
  const newRow = (role, at, id, activate = true) => {
    const row = {key: `turn-${++sequence}`, role, at, text: '', pieces: [], nativeId: null, complete: false};
    rows.push(row);
    if (activate) openByRole.set(role, row);
    return bind(row, id);
  };
  const resolve = (role, at, id, activate = true) => {
    const known = typeof id === 'string' && id ? nativeTurns.get(turnKey(role, id)) : null;
    if (known) return known;
    const open = openByRole.get(role);
    if (open && !open.complete && (!id || open.nativeId === null || open.nativeId === id)) return bind(open, id);
    return newRow(role, at, id, activate);
  };
  return {
    snapshot,
    consume(event, at = Date.now()) {
      if (!Number.isFinite(at) || at < 0) throw new RangeError('Transcript time must be a nonnegative finite timestamp');
      if (!event || typeof event !== 'object') return snapshot();
      if (event.type === 'backend.result') {
        if (typeof event.callId !== 'string' || !event.callId || typeof event.text !== 'string' || !event.text.trim()) return snapshot();
        const id = `backend-document:${event.callId}`;
        if (nativeTurns.has(turnKey('assistant', id))) return snapshot();
        const row = newRow('assistant', at, id, false);
        row.text = event.text; row.complete = true; row.document = true; row.callId=event.callId;
        return snapshot();
      }
      if (typeof event.event_id === 'string') {
        if (seenEvents.has(event.event_id)) return snapshot();
        seenEvents.add(event.event_id);
      }
      if (event.type === 'turn.created') {
        if (['user', 'assistant'].includes(event.turn?.role) && typeof event.turn.id === 'string' && event.turn.id)
          resolve(event.turn.role, at, event.turn.id);
        return snapshot();
      }
      if (event.type === 'turn.done') {
        const turn = event.turn;
        if (!['user', 'assistant'].includes(turn?.role) ||
            (!(typeof turn.id === 'string' && turn.id) && typeof turn.transcript !== 'string')) return snapshot();
        // A role/ID terminal is still terminal when no final body is supplied.
        // Keep the received captions, and never displace a newer active row
        // merely because an unseen older terminal arrived late.
        const row = resolve(turn.role, at, turn.id, false);
        if (typeof turn.transcript === 'string') row.text = turn.transcript;
        row.complete = true;
        if (openByRole.get(turn.role) === row) openByRole.delete(turn.role);
        return snapshot();
      }
      const item = transcriptEvent(event);
      if (!item || event.type === 'turn.delta') return snapshot();
      // A transcript.done finalizes a caption segment, not a native turn.
      const fragmentId = event.item_id ?? event.item?.id;
      const atomic = /\.(added|done)$/u.test(event.type);
      const key = atomic && typeof fragmentId === 'string' ? turnKey(item.role, fragmentId) : null;
      const previous = key ? fragments.get(key) : null;
      if (previous?.row.complete) return snapshot();
      // New fragments without turn_id have no provable turn ownership. Keep
      // their real receive order in the latest role stream; do not infer it
      // from text or silently drop user content. Known fragment IDs and an
      // explicit turn_id remain anchored to their original row.
      const row = resolve(item.role, at, event.turn_id);
      if (row.complete) return snapshot();
      if (previous) {
        previous.row.pieces[previous.index] = item.text;
        previous.row.text = previous.row.pieces.join('');
      } else {
        const index = row.pieces.push(item.text) - 1;
        row.text = row.pieces.join('');
        if (key) fragments.set(key, {row, index});
      }
      return snapshot();
    },
    reset() {
      sequence = 0; rows.length = 0;
      nativeTurns.clear(); openByRole.clear(); fragments.clear(); seenEvents.clear();
      return snapshot();
    },
  };
}
