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
const squeeze = value => String(value ?? '').toLowerCase().replace(/[\s·・\-_—()（）]/gu, '');
const attribute = (tag, name) => { const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu').exec(tag); return found ? (found[1] ?? found[2]).replace(/&amp;/gu, '&').trim() : ''; };
/**
 * The picture of `query` on a page: an <img> the page itself labels with that
 * name (alt or title). A share picture is only a fallback, and only on a page
 * whose own title is about the thing; otherwise it is usually the site's logo.
 */
export function pagePicture(html, base, query) {
  const wanted = squeeze(query);
  if (!wanted) return '';
  for (const tag of html.match(/<img\b[^>]*>/giu) ?? []) {
    const label = squeeze(attribute(tag, 'alt') || attribute(tag, 'title'));
    if (!label || !label.includes(wanted) || label.length > wanted.length + 24) continue;
    const source = attribute(tag, 'data-src') || attribute(tag, 'data-original') || attribute(tag, 'src');
    const width = Number(attribute(tag, 'width')) || 0;
    if (!source || source.startsWith('data:') || width && width < 80 || /logo|favicon|sprite|icon|avatar|\.svg(?:[?#]|$)/iu.test(source)) continue;
    try { return new URL(source, base).href; } catch { /* next image */ }
  }
  const title = squeeze(/<title[^>]*>([^<]*)<\/title>/iu.exec(html)?.[1]);
  return title.includes(wanted) ? sharePicture(html, base) : '';
}
const urlsIn = value => { const seen = new Set(); for (const [, url] of JSON.stringify(value ?? '').matchAll(/"url"\s*:\s*"(https:\/\/[^"\\]+)"/gu)) seen.add(url); return [...seen]; };

/**
 * `search(query)` is V's web search (any shape that carries result "url"s);
 * without it only Wikipedia is used. `observe` receives one line per lookup.
 */
export function createPhotoFinder({fetchImpl = fetch, search = null, lookup = dnsLookup, now = Date.now, observe = () => {}, maxBytes = 1500000, timeoutMs = 9000, ttlMs = 30 * 60000, maxEntries = 96,
  // Wikimedia refuses data-centre clients whose agent names no contact page.
  languages = ['zh', 'en'], userAgent = 'VVoiceBoard/0.1 (https://github.com/vegekyd-sys/v-voice)'} = {}) {
  const cache = new Map(), flights = new Map(), prints = new Map();
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
  // The article with exactly this name (or a redirect from it), never a search
  // guess: a search for 小火龙 once returned a person and 喷火龙 a dragon fruit.
  async function wikipedia(query, signal) {
    let failed = false;
    for (const language of languages) {
      const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(query)}&redirects=1&converttitles=1&prop=pageimages&piprop=thumbnail&pithumbsize=480`;
      let pages;
      try { pages = Object.values((await (await get(url, signal)).json())?.query?.pages ?? {}); } catch { failed = true; continue; }
      const page = pages.find(item => typeof item?.thumbnail?.source === 'string');
      if (!page) continue;
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
      const found = pagePicture((await response.text()).slice(0, 600000), address.href, query);
      const image = found && await publicHttps(found, {lookup});
      const result = image ? await picture(image.href, signal, address.hostname, query) : null;
      // The same file for two different things is a site picture, not either thing.
      if (result) { const print = result.bytes.length + ':' + result.bytes.subarray(0, 64).toString('hex'), owner = prints.get(print); if (owner && owner !== query) return null; prints.set(print, query); if (prints.size > 200) prints.delete(prints.keys().next().value); }
      return result;
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
