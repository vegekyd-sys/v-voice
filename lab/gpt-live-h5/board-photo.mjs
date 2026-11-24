// Pictures for the call board. The director names a thing ("埃菲尔铁塔",
// "皮卡丘"); this finds a picture of it and returns the image bytes, so the
// page loads it from the Voice service and the caller's browser never talks to
// a third party. Two sources, in order:
//   1. the lead picture of the best-matching Wikipedia article (fast, free);
//   2. V's own web search: the pages it finds usually declare a share picture
//      (og:image), which for a page about the thing is a picture of the thing.
// Lookups carry only the query. Pages and images are fetched without cookies,
// from public https hosts only, with size and time limits.
import {asksOnlyToFind} from './board-assets.mjs';
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
// The first of several fetches to give a picture; null when none does.
// The first of several ways to a picture that arrives, preferring a small file: a large one
// (an original of 1-2.5 MB) waits up to `graceMs` for a small one (the search's own thumbnail),
// as it would take seconds more to reach a phone across the border (11/21).
const SMALL_PICTURE = 400 * 1024;
const firstPicture = (ways, graceMs = 1200) => new Promise(resolve => {
  let left = ways.length, best = null, timer = null;
  if (!left) return resolve(null);
  const done = value => { clearTimeout(timer); resolve(value); };
  const settle = () => { if (--left === 0) done(best); };
  for (const way of ways) way.then(found => {
    if (found && found.bytes.length <= SMALL_PICTURE) return done(found);
    if (found && (!best || found.bytes.length < best.bytes.length)) { best = found; timer ??= setTimeout(() => done(best), graceMs); }
    settle();
  }, settle);
});
const STOCK = /(?:^|\.)(?:pixabay|699pic|kuaipng|shutterstock|alamy|istockphoto|gettyimages|dreamstime|123rf|depositphotos|freepik|vecteezy|pngtree|nipic|58pic|ibaotu|tukuppt|51yuansu|huaban|duitang|pinterest)\./iu;
const REFERENCE = /(?:^|\.)(?:wikipedia|wikimedia|baike\.baidu|baike\.sogou|moegirl|pokemon|portal-pokemon|pokedex|52poke|nasa|britannica|dpm\.org|gov)\b/iu;
// (Guides, data pages and app downloads too: their pictures are tables and adverts, 11/20.)
const OFF = /简笔画|怎样画|怎么画|教程|壁纸|表情包|头像|涂色|折纸|闪光|shiny|超级进化|mega|同人|手办|周边|logo|icon|图标|矢量|素材|模板|海报|高清图片|配招|攻略|玩法|种族值|招式|技能|性格|努力值|下载|官方版|安卓|手游|一览|排行/iu;
const OFF_ALL = new RegExp(OFF.source, 'giu');
// Words that say what kind of picture is wanted, not what it is of. A search
// written with many of them ("GTA6 预告片 露西娅 杰森 同框 截图") can find
// nothing at all; without them it finds the thing (11/20).
const KIND = /截图|截屏|官方|宣传图|宣传|海报|图片|照片|剧照|高清|壁纸|插画|同框|合照|立绘|画面|配图|大图/gu;
const KIND_WORDS = new Set(['fan', 'art', 'fanart', 'official', 'poster', 'wallpaper', 'screenshot', 'image', 'photo', 'picture', 'hd', 'artwork', 'key']);
// Whether a title names the thing: at least half the Chinese characters of its name (titles
// write 超夢 for 超梦, 航海王1199話 for 航海王1199话). A name with none says nothing either way.
function names(title, name) {
  const chars = [...new Set(String(name).match(/\p{Script=Han}/gu) ?? [])];
  return !chars.length || chars.filter(char => String(title).includes(char)).length >= Math.ceil(chars.length / 2);
}
/** Plainer searches to try when one finds nothing: without the kind-of-picture words, then
 * without its last word too (the thing searched for is written first). */
export function plainerSearches(query) {
  const words = String(query).split(/\s+/u).filter(Boolean);
  const plain = words.map(word => /^[\x00-\x7f]+$/u.test(word) ? (KIND_WORDS.has(word.toLowerCase()) ? '' : word) : word.replace(KIND, '')).filter(Boolean);
  const out = [];
  const add = list => { const text = list.join(' '); if (list.length && text !== words.join(' ') && !out.includes(text)) out.push(text); };
  add(plain);
  if (plain.length > 2) add(plain.slice(0, -1));
  return out;
}
/**
 * How well one image-search result suits a query: is it titled with the name,
 * does it come from somewhere that shows the thing itself rather than stock
 * art, is it a picture of a usable size. Zero or less: not used.
 */
export function rankPicture(item, query) {
  const wanted = squeeze(query), title = squeeze(item?.title), source = String(item?.source ?? '');
  // Every word of the query counts ("特斯拉 Model 3 汽车": the car, not the company's logo).
  const words = String(query).split(/\s+/u).map(squeeze).filter(Boolean);
  let score = 1;
  if (title && title.includes(wanted)) score += 3;
  else if (title) score += words.filter(word => title.includes(word)).length / words.length * 2;
  if (title === wanted) score += 1;
  // The thing searched for is written first. A Chinese title that does not name it is about
  // something else (Mega 烈空坐 for "超梦 Mega进化", a list of the whole Pokedex, 11/20).
  // Half its characters are enough: titles write 超夢 for 超梦, 航海王1199話 for 航海王1199话,
  // 露西亚 for 露西娅. (Only for a thing with a Chinese name: a Chinese title often leaves
  // out "GTA6", and an English title names a Chinese thing in other words.)
  if (words.length > 1 && /\p{Script=Han}/u.test(words[0]) && /\p{Script=Han}/u.test(title) && !names(title, words[0])) score -= 2;
  // An English title that shares no word with a search for a thing with a Chinese name cannot
  // be told to be about it (Mega Beedrill for "超梦 Mega进化 立绘", 11/21): nothing counts for it.
  // (Only for a search of several words: for a bare name the search's own results are sound.)
  if (words.length > 1 && /\p{Script=Han}/u.test(words[0]) && title && !/\p{Script=Han}/u.test(title) && !words.some(word => title.includes(word))) score -= 1;
  if (REFERENCE.test(source)) score += 2;
  if (STOCK.test(source)) score -= 3;
  // What the query itself asks for ("…海报", "…同人图", "超级超梦") is not held against a title.
  const asked = String(query).toLowerCase();
  const off = [...String(item?.title ?? '').matchAll(OFF_ALL)].some(([term]) => !asked.includes(term.toLowerCase()));
  if (off || /logo|icon|sprite|banner/iu.test(String(item?.properties?.url ?? ''))) score -= 3;
  const width = Number(item?.thumbnail?.width) || 0, height = Number(item?.thumbnail?.height) || 0;
  if (width && height) { if (Math.min(width, height) < 160) score -= 2; if (width / height > 2.2 || height / width > 2.2) score -= 1; }
  if (item?.confidence && item.confidence !== 'high') score -= 1;
  return score;
}
const urlsIn = value => { const seen = new Set(); for (const [, url] of JSON.stringify(value ?? '').matchAll(/"url"\s*:\s*"(https:\/\/[^"\\]+)"/gu)) seen.add(url); return [...seen]; };

/**
 * `search(query)` is V's web search (any shape that carries result "url"s);
 * without it only Wikipedia is used. `observe` receives one line per lookup.
 */
export function createPhotoFinder({fetchImpl = fetch, search = null, braveKey = '', braveGapMs = 1100, braveSettleMs = 300, pictureTimeoutMs = 3500, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), lookup = dnsLookup, now = Date.now, observe = () => {}, maxBytes = 1500000, timeoutMs = 9000, ttlMs = 30 * 60000, maxEntries = 96, directory = '', keepMs = 365 * 86400000,
  // Wikimedia refuses data-centre clients whose agent names no contact page.
  languages = ['zh', 'en'], userAgent = 'VVoiceBoard/0.1 (https://github.com/vegekyd-sys/v-voice)'} = {}) {
  const cache = new Map(), flights = new Map(), prints = new Map();
  // Pictures already found are kept on disk when a directory is given: the
  // same few characters are asked for call after call, and a lookup from the
  // server can take eight seconds. Only what a lookup returned is stored.
  // ("r2": pictures chosen before results were ranked are not carried over.)
  const fileOf = key => join(directory, createHash('sha256').update('r2:' + key).digest('hex').slice(0, 32));
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
  let braveSent = -Infinity, braveAnswered = -Infinity, braveSlowUntil = -Infinity, bravePumping = false, bravePerSecond = 1;
  const braveQueue = [];
  // The plan's rate, as each answer states it (x-ratelimit-limit: "1, 2000" on the free plan,
  // "50, …" on Search): with several a second there is no queue, a page's searches go at once.
  const learnRate = response => {
    const perSecond = Number(String(response?.headers?.get?.('x-ratelimit-limit') ?? '').split(',')[0]);
    if (Number.isFinite(perSecond) && perSecond >= 1) bravePerSecond = perSecond;
    return response;
  };
  // One request to the image search at a time: sent a gap after the one before was sent, and
  // a moment after its answer came back (the service counts requests as they arrive). When a
  // retry is refused too, twice the gap for ten seconds. (A single refusal no longer slows the
  // queue: it happens on most pages however the requests are spaced, and slowing down for it
  // spread a page of six over 12 s, 11/21.) `first`: a retry takes the next turn, so the
  // pictures still come in the order V speaks of them.
  const braveRequest = (ask, begin, first = false) => bravePerSecond >= 5 ? (begin(), ask().then(learnRate)) : new Promise((resolve, reject) => {
    const job = {ask: () => ask().then(learnRate), begin, resolve, reject};
    if (first) braveQueue.unshift(job); else braveQueue.push(job);
    if (!bravePumping) void bravePump();
  });
  async function bravePump() {
    bravePumping = true;
    try {
      while (braveQueue.length) {
        // The first answer of a page tells the plan's rate: on a fast plan the rest go at once.
        if (bravePerSecond >= 5) {
          for (const job of braveQueue.splice(0)) { job.begin(); job.ask().then(job.resolve, job.reject); }
          break;
        }
        const gap = Math.max(braveSent + (now() < braveSlowUntil ? 2 : 1) * braveGapMs, braveAnswered + braveSettleMs) - now();
        if (gap > 0) await wait(gap);
        const job = braveQueue.shift();
        braveSent = now();
        // Time spent queueing is not time spent looking.
        job.begin();
        try { job.resolve(await job.ask()); } catch (error) { job.reject(error); } finally { braveAnswered = now(); }
      }
    } finally { bravePumping = false; }
  }
  // One image search, through the queue.
  async function braveSearch(words, signal, begin) {
    const ask = () => fetchImpl(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(words)}&count=10&safesearch=strict`,
      {signal, headers: {'x-subscription-token': braveKey, accept: 'application/json'}});
    begin.stop?.();
    let response = await braveRequest(ask, begin);
    // "Too many requests" despite the queue: asked again through the queue, twice at most.
    // (A retry after a plain pause went out beside the next request in the queue and was
    // refused again: two to three pictures of every gallery, 11/20.)
    for (let again = 0; response.status === 429 && again < 2; again++) {
      if (again) braveSlowUntil = now() + 10000;
      begin.stop?.(); response = await braveRequest(ask, begin, true);
    }
    if (!response.ok) throw Error('image search HTTP ' + response.status);
    return ((await response.json())?.results ?? []).filter(item => typeof item?.thumbnail?.src === 'string');
  }
  // The results worth fetching: those `rankPicture` counts for, by its own score; their place
  // in the list only orders them (a good fourth result used to fall below the line, 11/20).
  // (Results it has nothing for or against are not taken: titled only with a site's name,
  // they were tables and adverts.)
  function worth(results, query) {
    return results.map((item, index) => ({item, score: rankPicture(item, query), index})).filter(entry => entry.score > 0)
      .sort((a, b) => (b.score - b.index * .2) - (a.score - a.index * .2)).slice(0, 9);
  }
  async function brave(query, signal, begin = () => {}) {
    if (!braveKey) return null;
    // A search that finds nothing worth fetching is tried plainer, twice at most.
    for (const words of [query, ...plainerSearches(query)]) {
      const ranked = worth(await braveSearch(words, signal, begin), query);
      if (!ranked.length) continue;
      // Three at a time are fetched at once (one slow file used to hold the others up for seven
      // seconds); the best-ranked usable one wins. When none of three can be fetched, the next
      // three are tried (轰鸣月: the three best were on a site that refuses other sites, 11/21).
      for (let start = 0; start < ranked.length; start += 3) {
        // Each file has 3.5 s: a thumbnail the search could not fetch answered 504 after 5 s,
        // and the next three waited for it (a picture ready at 13.7 s, its search at 7.5 s, 11/21).
        const fileSignal = typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function' ? AbortSignal.any([signal, AbortSignal.timeout(pictureTimeoutMs)]) : signal;
        const tried = ranked.slice(start, start + 3).map(({item}) => (async () => {
          const signal = fileSignal;
          const thumbnail = new URL(item.thumbnail.src);
          if (thumbnail.protocol !== 'https:' || thumbnail.hostname !== 'imgs.search.brave.com') return null;
          // The search's own thumbnail and the picture where it lives are asked
          // together: from this server one of the two is often seconds faster.
          const original = typeof item.properties?.url === 'string' ? await publicHttps(item.properties.url, {lookup}) : null;
          const ways = [picture(thumbnail.href, signal, 'Brave 图片搜索', item.title), ...(original ? [picture(original.href, signal, item.source || original.hostname, item.title)] : [])];
          return firstPicture(ways);
        })().catch(() => null));
        let fetched = false;
        for (const attempt of tried) { const found = await attempt; if (found) fetched = true; if (found && own(found, query)) return found; }
        // (A picture fetched but taken by another thing: the next three would be the same site's.)
        if (fetched) return null;
      }
      return null;
    }
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
      // A redirect to an article about something else is not this thing: 凯路迪欧 leads to
      // 第五世代寶可夢列表, whose picture is the Pokemon logo (11/21). (超梦 → 超夢 is the same.)
      if (!names(page.title, query)) continue;
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
    const crowded = Boolean(braveKey) && bravePerSecond < 5 && braveQueue.length + (bravePumping ? 1 : 0) >= 2;
    if (crowded) { begin(); await encyclopedia(); }
    if (!value) { try { value = await brave(key, signal, begin); } catch (error) { failed = true; why = String(error?.message ?? error).slice(0, 80); } }
    begin();
    if (!value && !crowded) await encyclopedia();
    // Scraping the pages V's search finds is the last resort of a service without an image search:
    // it is slow, and it is where site logos and unrelated pictures came from.
    if (!value && !braveKey) { try { value = await web(key, signal, searchNow); } catch { failed = true; } }
    observe({type: 'board.photo', query: key, found: Boolean(value), ...(why && !value ? {why} : {}), source: value?.source ?? null, bytes: value?.bytes.length ?? 0, durationMs: now() - started});
    // "No such picture" is worth remembering; "could not ask" is not.
    if (value) keep(key, value);
    if (value || !failed) { cache.delete(key); cache.set(key, {at: now(), value}); while (cache.size > maxEntries) cache.delete(cache.keys().next().value); }
    return value;
  }
  return {
    /** Whether "no picture" for this query is an answer worth keeping, not a lookup that could
     * not be made (the image search refused or timed out): the page may ask again for those. */
    settled(query) { const hit = cache.get(clean(query)); return Boolean(hit && now() - hit.at < ttlMs); },
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

// For an explicit request to look at photographs, collect the image bytes
// before naming the pictures. The same finder serves those bytes to the canvas.
export function photoCount(words='') {
  if(!asksOnlyToFind(words) || /开播|直播|不要找|不用找|别找/u.test(words))return 0;
  const n=/([1-9]\d*|[一两二三四五六七八九])\s*[张幅]/u.exec(words)?.[1];
  return Math.min(8,Number(n)||('一二三四五六七八九'.indexOf(n?.replace('两','二'))+1)||3);
}
export function createPhotoGallery({complete,find,director}){
  const prior=new Map();
  return async ({owner,ask,topic,signal})=>{
    const count=photoCount(ask), previous=prior.get(owner)??[];
    const more=/再|其他|其它|另外|换一批|不同/u.test(ask);
    const messages=[{role:'system',content:'为真实照片搜索列出具体拍摄对象。返回 JSON {"title":"简短中文主题","subjects":[{"name":"中文图名","query":"精确搜索词"}]}。按用户主题给出足量不同对象或视角，含两个备选。不要虚构。补充图片时避开上一批。仅输出 JSON。'},{role:'user',content:JSON.stringify({ask,topic,count,previous:more?previous.map(p=>p.name):[]})}];
    let raw='';
    for await(const part of complete({messages,signal}))raw+=part;
    const plan=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
    const seen=new Set(more?previous.flatMap(p=>[p.name,p.query,p.hash]):[]), items=[];
    const planned=Array.isArray(plan.subjects)?plan.subjects.slice(0,count+3):[];
    while(items.length<count && planned.length){
      signal?.throwIfAborted();
      const batch=planned.splice(0,count-items.length);
      const hits=await Promise.all(batch.map(async item=>{
        const name=String(item?.name??'').trim().slice(0,40), query=Array.from(clean(item?.query)).slice(0,40).join('');
        if(!name || !query || seen.has(name) || seen.has(query))return null;
        const photo=await find(query,{signal});
        return photo?.bytes?.length ? {name,query,hash:createHash('sha256').update(photo.bytes).digest('hex')} : null;
      }));
      for(const hit of hits)if(hit && ![hit.hash,hit.name,hit.query].some(k=>seen.has(k))){items.push(hit);[hit.hash,hit.name,hit.query].forEach(k=>seen.add(k));}
    }
    signal?.throwIfAborted();
    if(!items.length)return {say:'这次没有找到能显示的照片。'};
    prior.delete(owner);prior.set(owner,[...(more?previous:[]),...items].slice(-32));if(prior.size>64)prior.delete(prior.keys().next().value);
    director.gallery(owner,String(plan.title||'照片').slice(0,30),items);
    return {say:'找到了'+items.length+'张，按顺序是'+items.map(p=>p.name).join('、')+'。'};
  };
}
