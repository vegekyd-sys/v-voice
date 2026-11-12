// The call "board": a picture V keeps beside the conversation. A scene is a
// small list of typed blocks with stable ids, changed by one-line operations.
// Shared by the service (which validates what the director model wrote) and
// the page (which applies and renders it). Pure data: no DOM, no network.

export const BOARD_LIMITS = Object.freeze({blocks: 6, items: 8, columns: 4, rows: 8, nodes: 10, edges: 16});
export const BOARD_BLOCK_TYPES = Object.freeze(['note', 'list', 'steps', 'compare', 'stats', 'bars', 'table', 'flow']);

export const emptyScene = () => ({rev: 0, serial: 0, title: '', blocks: [], focus: ''});

const text = (value, limit) => typeof value === 'string' || typeof value === 'number'
  ? Array.from(String(value).replace(/\s+/gu, ' ').trim()).slice(0, limit).join('') : '';
const ident = (value, fallback) => {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^[A-Za-z0-9_-]{1,24}$/u.test(id) ? id : fallback;
};
const list = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];
const optional = (target, key, value) => { if (value) target[key] = value; return target; };
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
  return h ? optional({id: ident(entry.id, `${prefix}${index + 1}`), h}, 'd', text(entry.d ?? entry.detail, 160)) : null;
}).filter(Boolean), prefix);

const BLOCKS = {
  note(raw) {
    const value = text(raw.text ?? raw.h, 120);
    return value ? {text: value} : null;
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
      return h ? optional({id: ident(col.id, `c${index + 1}`), h, points}, 'tag', text(col.tag, 10)) : null;
    }).filter(Boolean), 'c');
    return cols.length >= 2 ? optional({cols}, 'h', text(raw.h, 40)) : null;
  },
  stats(raw) {
    const items = unique(list(raw.items, 6).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const label = text(item.label ?? item.h, 30), value = text(item.value, 20);
      if (!label || !value) return null;
      return optional(optional({id: ident(item.id, `n${index + 1}`), label, value}, 'unit', text(item.unit, 10)), 'note', text(item.note, 60));
    }).filter(Boolean), 'n');
    return items.length ? {items} : null;
  },
  bars(raw) {
    const items = unique(list(raw.items, BOARD_LIMITS.items).map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const label = text(item.label ?? item.h, 30), value = Number(item.value);
      return label && Number.isFinite(value) && value >= 0 ? {id: ident(item.id, `b${index + 1}`), label, value} : null;
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
      return label ? optional({id: ident(node.id, `f${index + 1}`), label}, 'sub', text(node.sub ?? node.d, 50)) : null;
    }).filter(Boolean), 'f');
    const known = new Set(nodes.map(node => node.id));
    const edges = list(raw.edges, BOARD_LIMITS.edges).map(edge => {
      const [from, to, label] = Array.isArray(edge) ? edge : [edge?.from, edge?.to, edge?.label];
      return known.has(from) && known.has(to) && from !== to ? [from, to, text(label, 16)] : null;
    }).filter(Boolean);
    return nodes.length >= 2 ? optional({nodes, edges}, 'h', text(raw.h, 40)) : null;
  },
};

/** Validate one operation written by the director model. Unknown or empty
 * operations return null; everything kept is bounded plain text. */
export function normalizeOp(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  switch (raw.op) {
    case 'none': case 'clear': return {op: raw.op};
    case 'scene': return {op: 'scene', title: text(raw.title, 40)};
    case 'del': { const id = ident(raw.id, ''); return id ? {op: 'del', id} : null; }
    case 'focus': {
      const id = typeof raw.id === 'string' ? raw.id : '';
      return id === '' || /^[A-Za-z0-9_-]{1,24}(\/[A-Za-z0-9_-]{1,24})?$/u.test(id) ? {op: 'focus', id} : null;
    }
    case 'put': {
      const source = raw.block;
      if (!source || typeof source !== 'object' || !BOARD_BLOCK_TYPES.includes(source.t)) return null;
      const id = ident(source.id, ''), body = BLOCKS[source.t](source);
      return id && body ? {op: 'put', block: {id, t: source.t, ...body}} : null;
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

/** Apply a normalized operation. Returns the same object when nothing changes. */
export function applyOp(scene, op) {
  const next = change => ({...scene, ...change, rev: scene.rev + 1});
  switch (op?.op) {
    case 'scene': return next({serial: scene.serial + 1, title: op.title, blocks: [], focus: ''});
    case 'clear': return scene.blocks.length || scene.title ? next({title: '', blocks: [], focus: ''}) : scene;
    case 'put': {
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

/** A full scene received from the service replaces the page's copy. */
export function normalizeScene(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.rev) || !Array.isArray(raw.blocks)) return null;
  let scene = {...emptyScene(), serial: Number.isSafeInteger(raw.serial) ? raw.serial : 0, title: text(raw.title, 40)};
  for (const block of raw.blocks) { const op = normalizeOp({op: 'put', block}); if (op) scene = applyOp(scene, op); }
  const focus = typeof raw.focus === 'string' && focusExists(scene, raw.focus) ? raw.focus : '';
  return {...scene, focus, rev: raw.rev};
}

/** The scene as the director model reads it back: compact, ids first. */
export const sceneDigest = scene => scene.blocks.length || scene.title
  ? {title: scene.title, focus: scene.focus, blocks: scene.blocks} : null;

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

/** Layered positions for a flow block, in percent of its box. Sources sit in
 * the first layer; an edge that would close a cycle does not push its target. */
export function flowLayout(nodes, edges) {
  const depth = new Map(nodes.map(node => [node.id, 0]));
  const forward = [], reaches = (from, to, seen = new Set()) => from === to
    || forward.some(([a, b]) => a === from && !seen.has(b) && (seen.add(b), reaches(b, to, seen)));
  for (const edge of edges) if (!reaches(edge[1], edge[0])) forward.push(edge);
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const [from, to] of forward) if (depth.get(to) < depth.get(from) + 1) { depth.set(to, depth.get(from) + 1); moved = true; }
    if (!moved) break;
  }
  const layers = [];
  for (const node of nodes) (layers[depth.get(node.id)] ??= []).push(node.id);
  const rows = layers.filter(Boolean), position = {};
  rows.forEach((row, y) => row.forEach((id, x) => {
    position[id] = {x: (x + 1) / (row.length + 1) * 100, y: rows.length === 1 ? 50 : y / (rows.length - 1) * 100, layer: y};
  }));
  return {layers: rows, position};
}
