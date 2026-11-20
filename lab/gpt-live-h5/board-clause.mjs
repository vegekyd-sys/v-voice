// V's words cut into the numbered clauses the cue illustrator and the canvas's eye count by
// (board-cue.mjs, board-eye.mjs). Apart from them so the director can use it too.
import {loose} from './board-scene.mjs';

/** V's words cut at punctuation into clauses; joined they are the words again. Very short clauses join the next. */
export function clauses(words) {
  const raw = String(words ?? '').match(/[^，。！？；：,.!?;:\n]+[，。！？；：,.!?;:\n]*|[，。！？；：,.!?;:\n]+/gu) ?? [];
  const parts = [];
  let carry = '';
  for (const piece of raw) {
    // ("但是，" is not a clause of its own: it goes with what follows.)
    if ((carry + piece).replace(/[^\p{L}\p{N}]/gu, '').length < 4) { carry += piece; continue; }
    parts.push(carry + piece); carry = '';
  }
  if (carry) { if (parts.length) parts[parts.length - 1] += carry; else parts.push(carry); }
  return parts;
}
export const numbered = parts => parts.map((part, index) => `[${index}]${part}`).join('');

/** The clause (its number) that the words `q` are in; 0 when they are not V's. */
export function clauseOf(said, q) {
  const parts = clauses(said), at = loose(String(said ?? '')).indexOf(loose(String(q ?? '')));
  if (at < 0 || !q) return 0;
  let seen = 0;
  for (let index = 0; index < parts.length; index++) { seen += loose(parts[index]).length; if (at < seen) return index; }
  return Math.max(0, parts.length - 1);
}

