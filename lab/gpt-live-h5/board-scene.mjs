// The call "board": a picture V keeps beside the conversation. A scene is a
// small list of typed blocks with stable ids, changed by one-line operations.
// Shared by the service (which validates what the director model wrote) and
// the page (which applies and renders it). Pure data: no DOM, no network.

export const BOARD_LIMITS = Object.freeze({blocks: 6, items: 8, columns: 4, rows: 8, nodes: 10, edges: 16});
export const BOARD_BLOCK_TYPES = Object.freeze(['note', 'sticky', 'photo', 'list', 'steps', 'compare', 'stats', 'bars', 'table', 'flow',
  // The diagram kit: shapes an explanation is built from (see BLOCKS below).
  'tiles', 'formula', 'timeline', 'versus', 'overlap', 'stack', 'scale']);
// How much of the page's width a block asks for; neighbours that ask stand side by side.
export const BOARD_WIDTHS = Object.freeze(['half', 'third']);
// Paper colours a block may sit on, and the marks V's pen may leave on an item.
export const BOARD_TONES = Object.freeze(['butter', 'peach', 'sky', 'lilac', 'blush']);
export const BOARD_MARKS = Object.freeze(['ring', 'underline', 'check', 'cross', 'star']);

// `pending` is the title of a new picture the director has announced but not
// yet drawn; the picture on screen stays until its first block arrives.
// `lesson`: the picture was written together with what V says (board-lesson.mjs); its pieces appear as they are spoken.
export const emptyScene = () => ({rev: 0, serial: 0, title: '', blocks: [], focus: '', pending: null, lesson: false});

const text = (value, limit) => typeof value === 'string' || typeof value === 'number'
  ? Array.from(String(value).replace(/\s+/gu, ' ').trim()).slice(0, limit).join('') : '';
const ident = (value, fallback) => {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^[A-Za-z0-9_-]{1,24}$/u.test(id) ? id : fallback;
};
const list = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];
const optional = (target, key, value) => { if (value) target[key] = value; return target; };
// `q`: a few of V's own words marking where V talks about this item, so the
// page can move the focus mark with the audio (see spokenFocus).
const quoted = (target, source) => optional(target, 'q', text(source.q, 40));
// One emoji (or two joined ones) in front of an item; anything longer is not an icon.
const icon = value => { const glyphs = typeof value === 'string' ? Array.from(value.trim()) : []; return glyphs.length && glyphs.length <= 4 && !/[\p{L}\p{N}]/u.test(value) ? glyphs.join('') : ''; };
// `img`: the name of a thing whose picture goes on the item (found by the service, like a photo block).
const dressed = (target, source) => optional(optional(optional(quoted(target, source), 'mark', BOARD_MARKS.includes(source.mark) ? source.mark : ''), 'icon', icon(source.icon)), 'img', text(source.img, 40));
// Model-written ids may repeat; later duplicates get a positional id instead.
const unique = (items, prefix) => {
  const seen = new Set();
  return items.map((item, index) => {
    const id = seen.has(item.id) ? `${prefix}${index + 1}` : item.id;
    seen.add(id);
    return id === item.id ? item : {...item, id};
  });
};
const entries = (raw, prefix) => unique(list(raw, BOARD_LIMITS.items).map((item, index) => {
  const entry = typeof item === 'string' ? {h: item} : item && typeof item === 'object' ? item : {};
  const h = text(entry.h ?? entry.label ?? entry.title, 60);
  return h ? dressed(optional({id: ident(entry.id, `${prefix}${index + 1}`), h}, 'd', text(entry.d ?? entry.detail, 160)), entry) : null;
}).filter(Boolean), prefix);

const BLOCKS = {
  note(raw) {
    const value = text(raw.text ?? raw.h, 120);
    return value ? {text: value} : null;
  },
  sticky(raw) { return BLOCKS.note(raw); },
  // A real photograph of a public thing, found by the service from `query`.
  photo(raw) {
    const query = text(raw.query, 60);
    return query ? optional({query}, 'caption', text(raw.caption, 40)) : null;
  },
  list(raw) {
    const items = entries(raw.items, 'i');
    return items.length ? optional({items}, 'h', text(raw.h, 40)) : null;
  },
  steps(raw) { return BLOCKS.list(raw); },
  compare(raw) {
    const cols = unique(list(raw.cols, BOARD_LIMITS.columns).map((col, index) => {
      if (!col || typeof col !== 'object') return null;
      const h = text(col.h ?? col.label, 30);
      const points = list(col.points, 6).map(point => text(point, 80)).filter(Boolean);
      return h ? dressed(optional({id: ident(col.id, `c${index + 1}`), h, points}, 'tag', text(col.tag, 10)), col) : null;
    }).filter(Boolean), 'c');
    return cols.length >= 2 ? optional({cols}, 'h', text(raw.h, 40)) : null;
  },
  stats(raw) {
    const items = unique(list(raw.items, 6).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const label = text(item.label ?? item.h, 30), value = text(item.value, 20);
      if (!label || !value) return null;
      return dressed(optional(optional({id: ident(item.id, `n${index + 1}`), label, value}, 'unit', text(item.unit, 10)), 'note', text(item.note, 60)), item);
    }).filter(Boolean), 'n');
    return items.length ? {items} : null;
  },
  bars(raw) {
    const items = unique(list(raw.items, BOARD_LIMITS.items).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const label = text(item.label ?? item.h, 30), value = Number(item.value);
      return label && Number.isFinite(value) && value >= 0 ? quoted({id: ident(item.id, `b${index + 1}`), label, value}, item) : null;
    }).filter(Boolean), 'b');
    return items.length >= 2 ? optional(optional({items}, 'h', text(raw.h, 40)), 'unit', text(raw.unit, 10)) : null;
  },
  table(raw) {
    const cols = list(raw.cols, 5).map(col => text(col, 24));
    if (cols.length < 2 || cols.some(col => !col)) return null;
    const rows = list(raw.rows, BOARD_LIMITS.rows).filter(Array.isArray)
      .map(row => cols.map((_, index) => text(row[index], 60)));
    return rows.length ? optional({cols, rows}, 'h', text(raw.h, 40)) : null;
  },
  flow(raw) {
    const nodes = unique(list(raw.nodes, BOARD_LIMITS.nodes).map((node, index) => {
      if (!node || typeof node !== 'object') return null;
      const label = text(node.label ?? node.h, 30);
      return label ? dressed(optional({id: ident(node.id, `f${index + 1}`), label}, 'sub', text(node.sub ?? node.d, 50)), node) : null;
    }).filter(Boolean), 'f');
    const known = new Set(nodes.map(node => node.id));
    const edges = list(raw.edges, BOARD_LIMITS.edges).map(edge => {
      const [from, to, label, said] = Array.isArray(edge) ? edge : [edge?.from, edge?.to, edge?.label, edge?.q];
      if (!known.has(from) || !known.has(to) || from === to) return null;
      // An optional fourth entry: the words of V's the arrow itself hangs on.
      const q = text(said, 40);
      return q ? [from, to, text(label, 16), q] : [from, to, text(label, 16)];
    }).filter(Boolean);
    return nodes.length >= 2 ? optional({nodes, edges}, 'h', text(raw.h, 40)) : null;
  },
  // Things one can count, laid out in rows: "16 blocks make a 4 by 4 square".
  // Each group is `n` tiles, `per` to a row, the first `lit` of them filled in.
  tiles(raw) {
    const items = unique(list(raw.items ?? raw.groups, 6).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const whole = value => { const number = Math.floor(Number(value)); return Number.isFinite(number) && number > 0 ? number : 0; };
      const rows = whole(item.rows), cols = whole(item.cols ?? item.per);
      const n = Math.min(60, whole(item.n) || rows * cols);
      if (!n) return null;
      const per = Math.min(10, cols || Math.ceil(Math.sqrt(n)));
      const group = {id: ident(item.id, `t${index + 1}`), n, per};
      const lit = Math.floor(Number(item.lit));
      if (Number.isFinite(lit) && lit >= 0 && lit < n && item.lit !== undefined && item.lit !== null) group.lit = lit;
      optional(group, 'h', text(item.h ?? item.label, 24));
      return dressed(optional(group, 'tone', BOARD_TONES.includes(item.tone) ? item.tone : ''), item);
    }).filter(Boolean), 't');
    return items.length ? optional({items}, 'h', text(raw.h, 40)) : null;
  },
  // A line read part by part: "x × x = 9", "price = cost + margin". Each part
  // is a few characters, with an optional caption under it.
  formula(raw) {
    const items = unique(list(raw.items ?? raw.parts, 9).map((item, index) => {
      const part = typeof item === 'string' || typeof item === 'number' ? {h: item} : item && typeof item === 'object' ? item : {};
      const h = text(part.h ?? part.text, 14);
      return h ? dressed(optional(optional({id: ident(part.id, `p${index + 1}`), h}, 'd', text(part.d ?? part.sub, 24)), 'tone', BOARD_TONES.includes(part.tone) ? part.tone : ''), part) : null;
    }).filter(Boolean), 'p');
    return items.length >= 2 ? optional({items}, 'h', text(raw.h, 40)) : null;
  },
  // Moments in order, each with when it happens: a history, a day's plan.
  timeline(raw) {
    const items = unique(list(raw.items, BOARD_LIMITS.items).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const h = text(item.h ?? item.label, 40);
      return h ? dressed(optional(optional({id: ident(item.id, `m${index + 1}`), h}, 'when', text(item.when ?? item.at, 14)), 'd', text(item.d, 80)), item) : null;
    }).filter(Boolean), 'm');
    return items.length >= 2 ? optional({items}, 'h', text(raw.h, 40)) : null;
  },
  // Two or three things compared one aspect at a time; `win` is the side
  // (counted from 0) that comes out ahead on that aspect.
  versus(raw) {
    const sides = list(raw.sides, 3).map(side => {
      const value = typeof side === 'string' ? {h: side} : side && typeof side === 'object' ? side : {};
      const h = text(value.h ?? value.label, 24);
      return h ? optional(optional({h}, 'icon', icon(value.icon)), 'img', text(value.img, 40)) : null;
    }).filter(Boolean);
    if (sides.length < 2) return null;
    const items = unique(list(raw.items ?? raw.rows, BOARD_LIMITS.rows).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const h = text(item.h ?? item.k, 16), cells = sides.map((_, at) => text(list(item.cells, 3)[at], 40));
      if (!h || cells.every(cell => !cell)) return null;
      const row = {id: ident(item.id, `r${index + 1}`), h, cells}, win = Number(item.win);
      if (Number.isInteger(win) && win >= 0 && win < sides.length && item.win !== null && item.win !== '') row.win = win;
      return quoted(optional(row, 'icon', icon(item.icon)), item);
    }).filter(Boolean), 'r');
    return items.length ? optional({sides, items}, 'h', text(raw.h, 40)) : null;
  },
  // Two things and what they share: `a`, `b`, and `both` in the middle.
  overlap(raw) {
    const part = (value, id) => {
      const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {points: value};
      const h = text(source.h ?? source.label, 20), points = list(typeof source.points === 'string' ? [source.points] : source.points, 4).map(point => text(point, 24)).filter(Boolean);
      return h || points.length ? dressed(optional({id, points}, 'h', h), source) : null;
    };
    // (Also read back in its stored form, where the three are `items`.)
    const stored = id => list(raw.items, 3).find(item => item?.id === id);
    const a = part(raw.a ?? stored('a'), 'a'), b = part(raw.b ?? stored('b'), 'b'), both = part(raw.both ?? stored('both'), 'both');
    return a?.h && b?.h && both ? optional({items: [a, both, b]}, 'h', text(raw.h, 40)) : null;
  },
  // Layers resting on one another, written from the top down: the last is the
  // ground the others stand on. `shape: "pyramid"` narrows towards the top.
  stack(raw) {
    const items = unique(list(raw.items ?? raw.layers, 6).map((item, index) => {
      const layer = typeof item === 'string' ? {h: item} : item && typeof item === 'object' ? item : {};
      const h = text(layer.h ?? layer.label, 30);
      return h ? dressed(optional(optional({id: ident(layer.id, `y${index + 1}`), h}, 'd', text(layer.d, 60)), 'tone', BOARD_TONES.includes(layer.tone) ? layer.tone : ''), layer) : null;
    }).filter(Boolean), 'y');
    return items.length >= 2 ? optional(optional({items}, 'h', text(raw.h, 40)), 'shape', raw.shape === 'pyramid' ? 'pyramid' : '') : null;
  },
  // Things placed by a number along one line: heights, sizes, prices, years.
  // `dir: "up"` stands the line upright (heights, depths).
  scale(raw) {
    const items = unique(list(raw.items ?? raw.marks, 7).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const h = text(item.h ?? item.label, 24), at = Number(item.at ?? item.value);
      return h && Number.isFinite(at) ? dressed(optional({id: ident(item.id, `k${index + 1}`), h, at}, 'd', text(item.d, 40)), item) : null;
    }).filter(Boolean), 'k');
    return items.length >= 2 ? optional(optional(optional({items}, 'h', text(raw.h, 40)), 'unit', text(raw.unit, 10)), 'dir', raw.dir === 'up' ? 'up' : '') : null;
  },
};

/**
 * Where each mark of a scale sits along its line, from 0 to 100. Values that
 * span more than two orders of magnitude are spaced by their logarithm, so a
 * drone at 120 m and an airliner at 10 000 m both stay readable.
 */
export function scalePositions(items) {
  const values = items.map(item => item.at), low = Math.min(...values), high = Math.max(...values);
  if (high === low) return items.map(() => 50);
  const log = low > 0 && high / low > 100, place = value => log ? Math.log(value) : value;
  return values.map(value => Math.round((place(value) - place(low)) / (place(high) - place(low)) * 1000) / 10);
}

/** Validate one operation written by the director model. Unknown or empty
 * operations return null; everything kept is bounded plain text. */
export function normalizeOp(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  switch (raw.op) {
    case 'none': case 'clear': return {op: raw.op};
    case 'scene': return raw.lesson === true ? {op: 'scene', title: text(raw.title, 40), lesson: true} : {op: 'scene', title: text(raw.title, 40)};
    case 'del': { const id = ident(raw.id, ''); return id ? {op: 'del', id} : null; }
    case 'focus': {
      const id = typeof raw.id === 'string' ? raw.id : '';
      return id === '' || /^[A-Za-z0-9_-]{1,24}(\/[A-Za-z0-9_-]{1,24})?$/u.test(id) ? {op: 'focus', id} : null;
    }
    case 'put': {
      const source = raw.block;
      if (!source || typeof source !== 'object' || !BOARD_BLOCK_TYPES.includes(source.t)) return null;
      const id = ident(source.id, ''), body = BLOCKS[source.t](source);
      // A whole block may hang on V's words too (a note, a print): `q` as on items.
      return id && body ? {op: 'put', block: quoted(optional(optional({id, t: source.t, ...body}, 'tone', BOARD_TONES.includes(source.tone) ? source.tone : ''), 'w', BOARD_WIDTHS.includes(source.w) ? source.w : ''), source)} : null;
    }
    default: return null;
  }
}

const focusTargets = block => block.t === 'compare' ? block.cols : block.t === 'flow' ? block.nodes : block.items ?? [];
/** Whether a focus id ("block" or "block/item") points at something on screen. */
export function focusExists(scene, id) {
  const [blockId, itemId] = id.split('/'), block = scene.blocks.find(b => b.id === blockId);
  return Boolean(block) && (itemId === undefined || focusTargets(block).some(item => item.id === itemId));
}

export const loose = value => value.replace(/[\s，。！？、；：,.!?;:"'“”‘’（）()\-—]/gu, '').toLowerCase();
// The start of a quote that counts as "V has begun saying it". Four Chinese
// characters are distinctive; four Latin letters ("ther") are not.
export const quoteHead = quote => quote.slice(0, Math.min(quote.length, /^[\x00-\x7f]*$/u.test(quote) ? 10 : 4));
// The words in V's reply that an item hangs on: the director's quote when it
// is really there, else the item's own wording where V used the same words
// (its heading, a leading part of it, or its number with unit).
function anchorOf(item, all) {
  const quote = item.q ? loose(item.q) : '';
  if (quote && all.includes(quote)) return quote;
  const name = loose(String(item.h ?? item.label ?? ''));
  for (let length = name.length; length >= 3; length--) if (all.includes(name.slice(0, length))) return name.slice(0, length);
  const figure = item.value === undefined ? '' : loose(String(item.value));
  if (figure.length >= 2) for (const text of [figure + loose(String(item.unit ?? '')), figure]) if (all.includes(text)) return text;
  return '';
}
/**
 * Where V's voice is on the board once `index` characters of `spoken` have
 * been said aloud. `focus` is the item being talked about (the one whose quote
 * starts latest at or before that point, '' before any). `ahead` lists the
 * quoted items V has written about but not yet reached: the page keeps those
 * in pencil until the voice gets there.
 */
export function spokenProgress(scene, spoken, index) {
  const all = loose(spoken), heard = loose(Array.from(spoken).slice(0, Math.max(0, index)).join(''));
  let focus = '', at = -1;
  const ahead = [];
  // Whole blocks that hang on a sentence wait for it like items do, but never take the mark.
  for (const block of scene.blocks) {
    const quote = block.q ? loose(block.q) : '';
    if (quote && all.includes(quote) && heard.indexOf(quoteHead(quote)) < 0) ahead.push(block.id);
  }
  for (const block of scene.blocks) for (const item of focusTargets(block)) {
    const quote = anchorOf(item, all);
    // No words of V's to tie the item to (or a miscopied quote): it is never held back.
    if (!quote) continue;
    // The quote counts once V has started saying it, not only when finished.
    // First occurrence: a later mention of the same words ("Server Hello
    // Done") must not pull the mark back to an item V has left.
    const found = heard.indexOf(quoteHead(quote));
    if (found < 0) { ahead.push(`${block.id}/${item.id}`); continue; }
    // When V comes back to an item and says its words again in full, the mark
    // comes back too. Only the full words count for a return, so "Server
    // Hello Done" does not return to the item quoted as "Server Hello本身".
    const latest = Math.max(found, heard.lastIndexOf(quote));
    if (latest > at) { at = latest; focus = `${block.id}/${item.id}`; }
  }
  // An arrow waits for both of its ends, and for its own words when it has some
  // ("grass beats water" is often said after both have been introduced).
  for (const block of scene.blocks) if (block.t === 'flow') for (const [from, to, , said] of block.edges) {
    const quote = said ? loose(said) : '';
    if (ahead.includes(`${block.id}/${from}`) || ahead.includes(`${block.id}/${to}`)
      || quote && all.includes(quote) && heard.indexOf(quoteHead(quote)) < 0) ahead.push(edgeId(block, from, to));
  }
  return {focus, ahead};
}
const quotesOf = scene => scene.blocks.flatMap(block => [block.q, ...focusTargets(block).map(item => item.q), ...(block.t === 'flow' ? block.edges.map(edge => edge[3]) : [])]).filter(Boolean);
/** Whether `text` is (part of) the script this scene's pieces hang on. */
export const speaksOf = (scene, text) => { const all = loose(String(text ?? '')); return quotesOf(scene).some(quote => all.includes(loose(quote))); };
/** A lesson before its first word: every piece that hangs on the script is still to come. */
export const unspoken = scene => spokenProgress(scene, quotesOf(scene).join('。'), 0);
export const edgeId = (block, from, to) => `${block.id}/${from}>${to}`;
export const spokenFocus = (scene, spoken, index) => spokenProgress(scene, spoken, index).focus;

/** Apply a normalized operation. Returns the same object when nothing changes. */
export function applyOp(scene, op) {
  const next = change => ({...scene, ...change, rev: scene.rev + 1});
  switch (op?.op) {
    case 'scene':
      // Announcing the picture already on screen is not a new picture.
      if (scene.blocks.length && scene.pending === null && op.title === scene.title) return scene;
      if (scene.blocks.length) return scene.pending === op.title ? scene : next({pending: op.title});
      return next({serial: scene.serial + 1, title: op.title, blocks: [], focus: '', pending: null, lesson: op.lesson === true});
    case 'clear': return scene.blocks.length || scene.title || scene.pending !== null ? next({title: '', blocks: [], focus: '', pending: null}) : scene;
    case 'put': {
      if (scene.pending !== null) return next({serial: scene.serial + 1, title: scene.pending, blocks: [op.block], focus: '', pending: null, lesson: false});
      const index = scene.blocks.findIndex(block => block.id === op.block.id);
      if (index >= 0) {
        if (JSON.stringify(scene.blocks[index]) === JSON.stringify(op.block)) return scene;
        const blocks = scene.blocks.slice(); blocks[index] = op.block;
        return next({blocks, focus: focusExists({blocks}, scene.focus) ? scene.focus : ''});
      }
      if (scene.blocks.length >= BOARD_LIMITS.blocks) return scene;
      return next({blocks: [...scene.blocks, op.block]});
    }
    case 'del': {
      if (!scene.blocks.some(block => block.id === op.id)) return scene;
      const blocks = scene.blocks.filter(block => block.id !== op.id);
      return next({blocks, focus: focusExists({blocks}, scene.focus) ? scene.focus : ''});
    }
    case 'focus':
      if (op.id === scene.focus || op.id && !focusExists(scene, op.id)) return scene;
      return next({focus: op.id});
    default: return scene;
  }
}

/** Every picture query on the board: photo blocks and items that carry one. */
export function scenePictures(scene) {
  const queries = new Set();
  for (const block of scene.blocks) {
    if (block.t === 'photo') queries.add(block.query);
    for (const item of focusTargets(block)) if (item.img) queries.add(item.img);
  }
  return queries;
}

/** A full scene received from the service replaces the page's copy. */
export function normalizeScene(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.rev) || !Array.isArray(raw.blocks)) return null;
  let scene = {...emptyScene(), serial: Number.isSafeInteger(raw.serial) ? raw.serial : 0, title: text(raw.title, 40)};
  for (const block of raw.blocks) { const op = normalizeOp({op: 'put', block}); if (op) scene = applyOp(scene, op); }
  const focus = typeof raw.focus === 'string' && focusExists(scene, raw.focus) ? raw.focus : '';
  return {...scene, focus, pending: typeof raw.pending === 'string' ? text(raw.pending, 40) : null, lesson: raw.lesson === true, rev: raw.rev};
}

/** The scene as the director model reads it back: compact, ids first. */
export const sceneDigest = scene => scene.pending !== null
  ? {title: scene.pending, focus: '', blocks: [], note: '新画面已开，还没有内容；放入第一个区块后屏幕才会换过去'}
  : scene.blocks.length || scene.title ? {title: scene.title, focus: scene.focus, blocks: scene.blocks} : null;

/** Split a streamed model reply into JSON lines. Fences and prose are skipped. */
export function createLineParser(onValue) {
  let buffer = '';
  const line = raw => {
    const value = raw.trim().replace(/,$/u, '');
    if (!value.startsWith('{')) return;
    try { onValue(JSON.parse(value)); } catch { /* A broken line is dropped; later lines still apply. */ }
  };
  return {
    feed(chunk) {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
    },
    end() { if (buffer.trim()) line(buffer); buffer = ''; },
  };
}

/**
 * Positions for a flow block, in percent of its box, and the shape they make:
 *   ring   - some edges lead round and back (water beats fire beats grass
 *            beats water): all the nodes sit on a circle, the loop first;
 *   row    - a single chain: left to right (top to bottom when `narrow`);
 *   layers - anything else: sources on top, each edge pointing downward. An
 *            edge that would close a cycle does not push its target.
 */
export function flowLayout(nodes, edges, {narrow = false} = {}) {
  const ids = nodes.map(node => node.id), position = {};
  // Follow the first way out of each node; a ring visits everything once and returns.
  const next = new Map();
  for (const [from, to] of edges) if (!next.has(from)) next.set(from, to);
  let round = [];
  for (const start of ids) {
    const walk = [];
    let at = start;
    while (at !== undefined && !walk.includes(at)) { walk.push(at); at = next.get(at); }
    const loop = at === undefined ? [] : walk.slice(walk.indexOf(at));
    if (loop.length > round.length) round = loop;
  }
  const circle = order => {
    order.forEach((id, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / order.length;
      position[id] = {x: 50 + Math.cos(angle) * 44, y: 50 + Math.sin(angle) * 44, layer: 0};
    });
    return {shape: 'ring', layers: [order], position};
  };
  // Things that only point into the ring (electric beats water) join the
  // circle after it, so the whole picture still fits one screen.
  if (round.length >= 3 && ids.length <= 6) return circle([...round, ...ids.filter(id => !round.includes(id))]);
  const depth = new Map(ids.map(id => [id, 0]));
  const forward = [], reaches = (from, to, seen = new Set()) => from === to
    || forward.some(([a, b]) => a === from && !seen.has(b) && (seen.add(b), reaches(b, to, seen)));
  for (const edge of edges) if (!reaches(edge[1], edge[0])) forward.push(edge);
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const [from, to] of forward) if (depth.get(to) < depth.get(from) + 1) { depth.set(to, depth.get(from) + 1); moved = true; }
    if (!moved) break;
  }
  const layers = [];
  for (const id of ids) (layers[depth.get(id)] ??= []).push(id);
  const rows = layers.filter(Boolean);
  // A chain too long for a phone's width would be a column several screens
  // tall; set round a circle, in order, all of it is in view at once.
  // The same for layers with three abreast, which overlap at that width.
  if (narrow && ids.length >= 4 && ids.length <= 6 && (rows.length > 3 || rows.some(row => row.length > 2))) return circle(rows.flat());
  if (rows.length > 1 && rows.every(row => row.length === 1) && !(narrow && rows.length > 3)) {
    rows.forEach((row, index) => { position[row[0]] = {x: (index + .5) / rows.length * 100, y: 50, layer: index}; });
    return {shape: 'row', layers: rows, position};
  }
  rows.forEach((row, y) => row.forEach((id, x) => {
    position[id] = {x: (x + 1) / (row.length + 1) * 100, y: rows.length === 1 ? 50 : y / (rows.length - 1) * 100, layer: y};
  }));
  return {shape: 'layers', layers: rows, position};
}
