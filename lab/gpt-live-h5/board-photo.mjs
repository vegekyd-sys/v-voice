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
import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

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
export function createPhotoFinder({fetchImpl = fetch, search = null, braveKey = '', braveGapMs = 1100, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), lookup = dnsLookup, now = Date.now, observe = () => {}, maxBytes = 1500000, timeoutMs = 9000, ttlMs = 30 * 60000, maxEntries = 96, directory = '', keepMs = 30 * 86400000,
  // Wikimedia refuses data-centre clients whose agent names no contact page.
  languages = ['zh', 'en'], userAgent = 'VVoiceBoard/0.1 (https://github.com/vegekyd-sys/v-voice)'} = {}) {
  const cache = new Map(), flights = new Map(), prints = new Map();
  // Pictures already found are kept on disk when a directory is given: the
  // same few characters are asked for call after call, and a lookup from the
  // server can take eight seconds. Only what a lookup returned is stored.
  const fileOf = key => join(directory, createHash('sha256').update(key).digest('hex').slice(0, 32));
  const kept = async key => {
    if (!directory) return null;
    try {
      const [meta, bytes] = await Promise.all([readFile(fileOf(key) + '.json', 'utf8'), readFile(fileOf(key) + '.bin')]);
      const {type, title, source, at} = JSON.parse(meta);
      return TYPES.has(type) && bytes.length <= maxBytes && now() - at < keepMs ? {bytes, type, title, source} : null;
    } catch { return null; }
  };
  const keep = (key, value) => {
    if (!directory) return;
    void mkdir(directory, {recursive: true, mode: 0o700}).then(() => Promise.all([writeFile(fileOf(key) + '.bin', value.bytes, {mode: 0o600}),
      writeFile(fileOf(key) + '.json', JSON.stringify({query: key, type: value.type, title: value.title, source: value.source, at: now()}), {mode: 0o600})])).catch(() => {});
  };
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
  // An image search, when a key is provisioned: the first result whose title
  // names the thing (else the first result), as the search's own thumbnail.
  // The plan allows about one request a second, so lookups queue.
  let braveTurn = Promise.resolve(), braveLast = -Infinity, braveWaiting = 0;
  async function brave(query, signal, begin = () => {}) {
    if (!braveKey) return null;
    braveWaiting++; begin.stop?.();
    const turn = braveTurn.then(async () => { const gap = braveLast + braveGapMs - now(); if (gap > 0) await wait(gap); braveLast = now(); });
    braveTurn = turn.catch(() => {});
    try { await turn; } finally { braveWaiting--; }
    // Time spent queueing is not time spent looking.
    begin();
    const ask = () => fetchImpl(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=6&safesearch=strict`,
      {signal, headers: {'x-subscription-token': braveKey, accept: 'application/json'}});
    let response = await ask();
    // "Too many requests" despite the queue (the service counts its own seconds): once more, after a pause.
    if (response.status === 429) { await wait(braveGapMs); braveLast = now(); response = await ask(); }
    if (!response.ok) throw Error('image search HTTP ' + response.status);
    const results = ((await response.json())?.results ?? []).filter(item => typeof item?.thumbnail?.src === 'string');
    const wanted = squeeze(query);
    // The three best are fetched at once (one slow thumbnail used to hold the
    // others up for seven seconds); the best-ranked usable one wins.
    const tried = [...new Set([...results.filter(item => squeeze(item.title).includes(wanted)), ...results])].slice(0, 3).map(item => (async () => {
      const source = new URL(item.thumbnail.src);
      if (source.protocol !== 'https:' || source.hostname !== 'imgs.search.brave.com') return null;
      return picture(source.href, signal, 'Brave 图片搜索', item.title);
    })().catch(() => null));
    for (const attempt of tried) { const found = await attempt; if (found && own(found, query)) return found; }
    return null;
  }
  // The same file for two different things is a site picture (a franchise
  // logo came back for two different Pokemon), not a picture of either.
  function own(result, query) {
    const print = result.bytes.length + ':' + result.bytes.subarray(0, 64).toString('hex'), owner = prints.get(print);
    if (owner && owner !== query) { prints.set(print, '*'); cache.delete(owner); if (directory && owner !== '*') for (const end of ['.bin', '.json']) void rm(fileOf(owner) + end, {force: true}).catch(() => {}); return false; }
    prints.set(print, query); if (prints.size > 200) prints.delete(prints.keys().next().value);
    return true;
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
      return result && own(result, query) ? result : null;
    })().catch(() => null));
    for (const attempt of tried) { const found = await attempt; if (found) return found; }
    return null;
  }
  async function find(key, signal, searchNow, begin) {
    const started = now();
    let value = await kept(key), failed = false, why = '';
    if (value) { cache.set(key, {at: now(), value}); observe({type: 'board.photo', query: key, found: true, source: value.source, kept: true, bytes: value.bytes.length, durationMs: now() - started}); return value; }
    // A page of a dozen pictures would queue for the image search one a
    // second (the last ones used to time out waiting). With a queue ahead,
    // the encyclopedia, which needs no turn, is asked first.
    const encyclopedia = async () => { try { value = await wikipedia(key, signal); } catch { failed = true; } };
    const crowded = Boolean(braveKey) && braveWaiting >= 2;
    if (crowded) { begin(); await encyclopedia(); }
    if (!value) { try { value = await brave(key, signal, begin); } catch (error) { failed = true; why = String(error?.message ?? error).slice(0, 80); } }
    begin();
    if (!value && !crowded) await encyclopedia();
    if (!value) { try { value = await web(key, signal, searchNow); } catch { failed = true; } }
    observe({type: 'board.photo', query: key, found: Boolean(value), ...(why && !value ? {why} : {}), source: value?.source ?? null, bytes: value?.bytes.length ?? 0, durationMs: now() - started});
    // "No such picture" is worth remembering; "could not ask" is not.
    if (value) keep(key, value);
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
        const controller = new AbortController();
        let timer = null;
        // The limit runs while a source is being asked; each start (after a queue) renews it.
        const begin = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), timeoutMs); };
        begin.stop = () => clearTimeout(timer);
        signal?.addEventListener('abort', () => controller.abort(), {once: true});
        flights.set(key, find(key, controller.signal, searchNow, begin).catch(() => null).finally(() => { clearTimeout(timer); flights.delete(key); }));
      }
      return flights.get(key);
    },
  };
}
