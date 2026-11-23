// Page side of the call's shelf of made things (board-assets.mjs). The board's
// pages name a made thing by its id; this keeps what each id is (a picture or a
// video, how far along, where its file is) and tells the service which one the
// caller has tapped. Cosmetic like the board itself: nothing in the call waits
// for it, and a failed request only leaves the shelf as it was.

export const ASSET_POLL_MS = 1200;
// After the last change the page keeps asking for a little while: a thing just
// finished is looked at and named a moment later.
export const ASSET_SETTLE_MS = 8000;

/** The made things a page of the board shows, by id. */
const worksOf = scene => (scene?.blocks ?? []).filter(block => block?.t === 'work' && typeof block.asset === 'string').map(block => block.asset);

/**
 * `request(body)` resolves the service's view: {assets, picked, busy, stamp,
 * rev, sync?}. `rev()` is the board revision the page has; when the service's
 * differs, its reply carries the whole board (`sync`), handed to `onSync`.
 */
export function createAssetsClient({request, onChange = () => {}, onSync = () => {}, rev = () => 0, isCurrent = () => true, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let assets = new Map(), photos = new Map(), picked = '', stamp = -1, busy = false, closed = false, timer = null, asking = false, again = false, changedAt = -Infinity, refusals = 0, had = false, call = '';
  let wantPick = null;
  const seen = new Set(), told = new Set();
  // (`photos`: the photographs the board found, by what was searched for: {id, name}.)
  const view = () => ({assets, photos, picked});
  const schedule = wait => { if (closed || timer !== null) return; timer = setTimer(ask, wait); };
  async function ask() {
    timer = null;
    if (closed || !isCurrent()) return;
    if (asking) { again = true; return; }
    asking = true;
    const body = {rev: rev(), ...(call ? {call} : {})};
    if (wantPick !== null) { body.pick = wantPick; wantPick = null; }
    const fresh = [...seen].filter(id => !told.has(id));
    if (fresh.length) body.seen = fresh;
    try {
      const reply = await request(body);
      refusals = 0; had = true;
      for (const id of fresh) told.add(id);
      if (closed || !isCurrent() || !reply || !Array.isArray(reply.assets)) return;
      if (reply.sync) onSync(reply.sync);
      // (The call went on as another session after its connection was lost: its shelf is taken whole.)
      if (typeof reply.call === 'string' && reply.call !== call) { if (call) { stamp = -1; seen.clear(); told.clear(); } call = reply.call; }
      busy = reply.busy === true;
      if (reply.stamp !== stamp || reply.picked !== picked) {
        stamp = reply.stamp; changedAt = now();
        assets = new Map(reply.assets.filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
        photos = new Map((Array.isArray(reply.photos) ? reply.photos : []).filter(item => item && typeof item.query === 'string' && typeof item.id === 'string').map(item => [item.query, {id: item.id, name: item.name ?? ''}]));
        picked = typeof reply.picked === 'string' ? reply.picked : '';
        onChange(view());
      }
    } catch {
      // Not offered to this caller (or an older service): after two refusals in a row, no shelf for this call.
      // Once there has been one it is only out of reach for now (the call is being connected again; production
      // 11/22 01:46: two refusals in the gap, and the page showed nothing more for the rest of the call).
      if (++refusals >= 2 && !had) { closed = true; return; }
      changedAt = now();
    } finally {
      asking = false;
      if (!closed) {
        if (again) { again = false; schedule(0); }
        else if (refusals) { if (refusals < 60) schedule(Math.min(5000, ASSET_POLL_MS * refusals)); }
        else if (busy || now() - changedAt < ASSET_SETTLE_MS) schedule(ASSET_POLL_MS);
      }
    }
  }
  return {
    get view() { return view(); },
    /** Something happened that may have changed the shelf (a tool started or ended, a result arrived). */
    poke() { if (closed) return; refusals = Math.min(refusals, 1); changedAt = Math.max(changedAt, now() - ASSET_SETTLE_MS + 3 * ASSET_POLL_MS); if (asking) again = true; else { clearTimer(timer); timer = null; schedule(150); } },
    /** A page of the board arrived: a made thing on it that is not known yet is asked for. */
    scene(scene) { if (!closed && worksOf(scene).some(id => !assets.has(id))) this.poke(); },
    /** The caller tapped a thing (or tapped it again to let go: ''; `hold`: looking at it, never letting go). Shown at once; the service is told. */
    pick(id, hold = false) {
      if (closed || id !== '' && !assets.has(id) && ![...photos.values()].some(photo => photo.id === id)) return;
      if (hold && picked === id) return;
      picked = picked === id ? '' : id; wantPick = picked;
      onChange(view());
      if (asking) again = true; else { clearTimer(timer); timer = null; schedule(0); }
    },
    /** Where a thing can be fetched from to be saved (a found photograph is lent out for it). '' when it cannot. */
    async address(id) {
      if (closed) return '';
      try { const reply = await request({rev: rev(), address: id}); return reply?.address?.id === id && typeof reply.address.url === 'string' ? reply.address.url : ''; } catch { return ''; }
    },
    /** A thing's picture is on screen. */
    shown(id) { if (closed || seen.has(id)) return; seen.add(id); if (!asking && timer === null) schedule(300); },
    dispose() { closed = true; clearTimer(timer); timer = null; },
  };
}

/**
 * Every version of a made thing, oldest first: the picture, the same picture
 * changed, the video made of it. They share one frame on the board.
 */
export function assetFamily(assets, id) {
  let root = assets?.get?.(id);
  if (!root) return [];
  // (A found photograph a thing was made from is its source, not a version of it.)
  for (let step = 0; step < 12 && root.from && assets.get(root.from) && assets.get(root.from).source !== 'search'; step++) root = assets.get(root.from);
  const family = [root];
  for (let grew = true; grew && family.length < 12;) {
    grew = false;
    for (const item of assets.values()) if (item.from && !family.includes(item) && family.some(member => member.id === item.from)) { family.push(item); grew = true; }
  }
  return family.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}
