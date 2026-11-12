// Real photographs for the call board. The director names a public thing
// ("埃菲尔铁塔", "大熊猫"); this finds that thing's lead picture on Wikipedia and
// returns the image bytes, so the page loads it from the Voice service and the
// caller's browser never talks to a third party. Lookups carry only the query.
const HOSTS = /^(?:upload|thumb)\.wikimedia\.org$/u;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const clean = query => String(query ?? '').replace(/\s+/gu, ' ').trim().slice(0, 60);

export function createPhotoFinder({fetchImpl = fetch, now = Date.now, maxBytes = 700000, timeoutMs = 6000, ttlMs = 30 * 60000, maxEntries = 64,
  // Wikimedia refuses data-centre clients whose agent names no contact page.
  languages = ['zh', 'en'], userAgent = 'VVoiceBoard/0.1 (https://github.com/vegekyd-sys/v-voice)'} = {}) {
  const cache = new Map();
  async function request(url, signal) {
    const response = await fetchImpl(url, {signal, headers: {'user-agent': userAgent, accept: '*/*'}, redirect: 'follow'});
    if (!response.ok) throw Error('photo source HTTP ' + response.status);
    return response;
  }
  async function lookup(query, signal) {
    let failed = false;
    for (const language of languages) {
      const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&gsrsearch=${encodeURIComponent(query)}&prop=pageimages&piprop=thumbnail&pithumbsize=480&redirects=1`;
      let pages;
      try { pages = Object.values((await (await request(url, signal)).json())?.query?.pages ?? {}); } catch { failed = true; continue; }
      const page = pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99)).find(item => typeof item?.thumbnail?.source === 'string');
      if (!page) continue;
      let source;
      try { source = new URL(page.thumbnail.source); } catch { continue; }
      if (source.protocol !== 'https:' || !HOSTS.test(source.hostname)) continue;
      const image = await request(source.href, signal);
      const type = String(image.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!TYPES.has(type)) continue;
      const bytes = Buffer.from(await image.arrayBuffer());
      if (!bytes.length || bytes.length > maxBytes) continue;
      return {bytes, type, title: String(page.title ?? '').slice(0, 80), source: '维基百科'};
    }
    // "No such picture" is an answer worth remembering; "could not ask" is not.
    if (failed) throw Error('photo source unavailable');
    return null;
  }
  return {
    /** The picture for a query, or null when nothing suitable is found. Failures are not cached. */
    async find(query, {signal} = {}) {
      const key = clean(query);
      if (!key) return null;
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const controller = new AbortController(), abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
      const timer = setTimeout(abort, timeoutMs);
      try {
        const value = await lookup(key, controller.signal);
        cache.delete(key); cache.set(key, {at: now(), value});
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return value;
      } catch { return null; } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  };
}
