// Pictures for the call board. The director names a thing ("埃菲尔铁塔",
// "皮卡丘"); this finds a picture of it and returns the image bytes, so the
// page loads it from the Voice service and the caller's browser never talks to
// a third party. Two sources, in order:
//   1. the lead picture of the best-matching Wikipedia article (fast, free);
//   2. V's own web search: the pages it finds usually declare a share picture
//      (og:image), which for a page about the thing is a picture of the thing.
// Lookups carry only the query. Pages and images are fetched without cookies,
// from public https hosts only, with size and time limits.
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';

const WIKIMEDIA = /^(?:upload|thumb)\.wikimedia\.org$/u;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const clean = query => String(query ?? '').replace(/\s+/gu, ' ').trim().slice(0, 60);
const privateAddress = address => /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/u.test(address)
  || /^(?:::1?$|f[cd]|fe80:|::ffff:(?:0\.|10\.|127\.|169\.254\.|192\.168\.))/iu.test(address);

/** A URL the service may fetch for a picture: https on a public host. */
export async function publicHttps(value, {lookup = dnsLookup} = {}) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null;
  if (isIP(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home|corp)$/iu.test(host)) return null;
  try { const found = await lookup(host, {all: true}); if (!found.length || found.some(item => privateAddress(item.address))) return null; } catch { return null; }
  return url;
}
/** The picture a page offers when shared, as an absolute URL. */
export function sharePicture(html, base) {
  const meta = name => {
    for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
      if (!new RegExp(`(?:property|name)\\s*=\\s*["']${name}["']`, 'iu').test(tag)) continue;
      const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(tag);
      if (content) return (content[1] ?? content[2]).replace(/&amp;/gu, '&').trim();
    }
    return '';
  };
  const found = meta('og:image(?::secure_url)?') || meta('twitter:image(?::src)?');
  // A site-wide logo says nothing about the thing asked for.
  if (!found || /logo|favicon|sprite|placeholder|default[-_]?(?:share|og|image)|\.svg(?:[?#]|$)/iu.test(found)) return '';
  try { return new URL(found, base).href; } catch { return ''; }
}
const urlsIn = value => { const seen = new Set(); for (const [, url] of JSON.stringify(value ?? '').matchAll(/"url"\s*:\s*"(https:\/\/[^"\\]+)"/gu)) seen.add(url); return [...seen]; };

/**
 * `search(query)` is V's web search (any shape that carries result "url"s);
 * without it only Wikipedia is used. `observe` receives one line per lookup.
 */
export function createPhotoFinder({fetchImpl = fetch, search = null, lookup = dnsLookup, now = Date.now, observe = () => {}, maxBytes = 1500000, timeoutMs = 9000, ttlMs = 30 * 60000, maxEntries = 96,
  // Wikimedia refuses data-centre clients whose agent names no contact page.
  languages = ['zh', 'en'], userAgent = 'VVoiceBoard/0.1 (https://github.com/vegekyd-sys/v-voice)'} = {}) {
  const cache = new Map(), flights = new Map();
  const get = async (url, signal, accept = '*/*') => {
    const response = await fetchImpl(url, {signal, headers: {'user-agent': userAgent, accept}, redirect: 'follow', credentials: 'omit'});
    if (!response.ok) throw Error('HTTP ' + response.status);
    return response;
  };
  async function picture(url, signal, source, title) {
    const response = await get(url, signal, 'image/*');
    const type = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!TYPES.has(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    // Under a few kilobytes it is an icon, not a picture of anything.
    if (bytes.length < 4000 || bytes.length > maxBytes) return null;
    return {bytes, type, title: String(title ?? '').slice(0, 80), source};
  }
  async function wikipedia(query, signal) {
    let failed = false;
    for (const language of languages) {
      const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&gsrsearch=${encodeURIComponent(query)}&prop=pageimages&piprop=thumbnail&pithumbsize=480&redirects=1`;
      let pages;
      try { pages = Object.values((await (await get(url, signal)).json())?.query?.pages ?? {}); } catch { failed = true; continue; }
      // Only the best match counts. Taking the first result that happens to
      // have a picture put a dragon fruit on the board for 喷火龙.
      const page = pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99))[0];
      if (typeof page?.thumbnail?.source !== 'string') continue;
      let source;
      try { source = new URL(page.thumbnail.source); } catch { continue; }
      if (source.protocol !== 'https:' || !WIKIMEDIA.test(source.hostname)) continue;
      try { const found = await picture(source.href, signal, '维基百科', page.title); if (found) return found; } catch { failed = true; }
    }
    if (failed) throw Error('photo source unavailable');
    return null;
  }
  async function web(query, signal, searchNow) {
    if (!searchNow) return null;
    const pages = urlsIn(await searchNow(query)).slice(0, 5);
    // Every page is tried at once; the best-ranked one that has a usable picture wins.
    // Each attempt settles to a picture or null: one that fails after another
    // has already won must not become an unhandled rejection (that ended the
    // Voice process on the Candidate).
    const tried = pages.map(page => (async () => {
      const address = await publicHttps(page, {lookup});
      if (!address) return null;
      const response = await get(address.href, signal, 'text/html');
      if (!/html/iu.test(response.headers.get('content-type') ?? '')) return null;
      const share = sharePicture((await response.text()).slice(0, 400000), address.href);
      const image = share && await publicHttps(share, {lookup});
      return image ? picture(image.href, signal, address.hostname, query) : null;
    })().catch(() => null));
    for (const attempt of tried) { const found = await attempt; if (found) return found; }
    return null;
  }
  async function find(key, signal, searchNow) {
    const started = now();
    let value = null, failed = false;
    try { value = await wikipedia(key, signal); } catch { failed = true; }
    if (!value) { try { value = await web(key, signal, searchNow); } catch { failed = true; } }
    observe({type: 'board.photo', query: key, found: Boolean(value), source: value?.source ?? null, bytes: value?.bytes.length ?? 0, durationMs: now() - started});
    // "No such picture" is worth remembering; "could not ask" is not.
    if (value || !failed) { cache.delete(key); cache.set(key, {at: now(), value}); while (cache.size > maxEntries) cache.delete(cache.keys().next().value); }
    return value;
  }
  return {
    /** The picture for a query, or null when nothing suitable is found. */
    async find(query, {signal, search: searchNow = search} = {}) {
      const key = clean(query);
      if (!key) return null;
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      // Several items asking for the same thing share one lookup.
      if (!flights.has(key)) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
        signal?.addEventListener('abort', () => controller.abort(), {once: true});
        flights.set(key, find(key, controller.signal, searchNow).catch(() => null).finally(() => { clearTimeout(timer); flights.delete(key); }));
      }
      return flights.get(key);
    },
  };
}
