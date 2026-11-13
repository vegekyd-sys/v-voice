import assert from 'node:assert/strict';
import test from 'node:test';
import {createPhotoFinder, pagePicture, publicHttps, sharePicture} from './board-photo.mjs';

const json = value => ({ok: true, status: 200, json: async () => value});
const big = (size = 5000) => new Uint8Array(size).buffer;
let serial = 0;
// A different file each time, as different pictures are.
const distinct = () => { const bytes = new Uint8Array(30000); new DataView(bytes.buffer).setUint32(0, ++serial); return bytes.buffer; };
const image = (bytes = big(), type = 'image/jpeg') => ({ok: true, status: 200, headers: new Headers({'content-type': type}), arrayBuffer: async () => bytes});
const html = text => ({ok: true, status: 200, headers: new Headers({'content-type': 'text/html; charset=utf-8'}), text: async () => text});
const pages = (...list) => ({query: {pages: Object.fromEntries(list.map((page, index) => [index, page]))}});
const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a.jpg/480px-a.jpg';
const lookup = async host => host.includes('intranet') ? [{address: '10.0.0.8'}] : [{address: '93.184.216.34'}];

test('the lead picture of the Wikipedia article is used and cached', async () => {
  const calls = [];
  const finder = createPhotoFinder({lookup, fetchImpl: async (url, init) => {
    calls.push({url, agent: init.headers['user-agent']});
    return url.includes('api.php') ? json(pages({title: '艾菲尔铁塔', thumbnail: {source: thumb}})) : image();
  }});
  const found = await finder.find('  埃菲尔  铁塔 ');
  assert.deepEqual([found.title, found.type, found.source, found.bytes.length], ['艾菲尔铁塔', 'image/jpeg', '维基百科', 5000]);
  assert.equal(calls[1].url, thumb);
  assert.match(calls[0].agent, /^VVoiceBoard\/[\d.]+ \(https:\/\//u);
  await Promise.all([finder.find('埃菲尔 铁塔'), finder.find('埃菲尔 铁塔')]);
  assert.equal(calls.length, 2, 'later lookups are served from memory');
});

test('Wikipedia is asked for the article with exactly that name, not for search guesses', async () => {
  const asked = [];
  const finder = createPhotoFinder({lookup, languages: ['zh'], fetchImpl: async url => { asked.push(url); return json(pages({title: '小火龍'})); }});
  assert.equal(await finder.find('小火龙'), null);
  assert.match(asked[0], /[?&]titles=%E5%B0%8F%E7%81%AB%E9%BE%99&redirects=1&converttitles=1/u);
  assert.equal(asked[0].includes('generator=search'), false);
});

test('when Wikipedia has no picture, the share picture of a page V\'s search found is used', async () => {
  const fetched = [], seen = [];
  const finder = createPhotoFinder({lookup, languages: ['zh'], observe: event => seen.push(event),
    search: async query => ({ok: true, output: {details: {results: [{title: '内网', url: 'https://wiki.intranet.example/p'}, {title: '没有配图', url: 'https://plain.example/p'}, {title: '皮卡丘 - 百科', url: 'https://wiki.example/pikachu?x=1'}, {title: 'http', url: 'http://insecure.example/p'}], query}}}),
    fetchImpl: async (url, init) => {
      fetched.push(url);
      assert.equal(init.credentials, 'omit');
      if (url.includes('api.php')) return json(pages({title: '皮卡丘', index: 1}));
      if (url === 'https://plain.example/p') return html('<html><head><title>皮卡丘 - 官网</title><meta property="og:image" content="/static/logo.png"></head></html>');
      if (url === 'https://wiki.example/pikachu?x=1') return html('<html><head><title>图鉴</title><meta property="og:image" content="/ogp.png"></head><body><img alt="站点" src="/banner.png"><img alt="皮卡丘" width="32" src="/tiny.png"><img alt="025 皮卡丘" data-src="/images/025.png?v=2&amp;w=600" src="data:image/gif;base64,AA"></body></html>');
      if (url === 'https://wiki.example/images/025.png?v=2&w=600') return image(big(20000), 'image/png');
      throw Error('unexpected ' + url);
    }});
  const found = await finder.find('皮卡丘');
  assert.deepEqual([found.source, found.type, found.bytes.length], ['wiki.example', 'image/png', 20000]);
  assert.equal(fetched.some(url => url.includes('intranet') || url.startsWith('http://')), false, 'private and plain-http pages are never fetched');
  assert.deepEqual([seen[0].type, seen[0].query, seen[0].found, seen[0].source], ['board.photo', '皮卡丘', true, 'wiki.example']);
});

test('icons, wrong types and oversized files are not pictures; failures are retried', async () => {
  const refuse = async picture => createPhotoFinder({lookup, languages: ['zh'], fetchImpl: async url => url.includes('api.php') ? json(pages({title: 'x', index: 1, thumbnail: {source: thumb}})) : picture}).find('x');
  assert.equal(await refuse(image(big(900))), null, 'an icon');
  assert.equal(await refuse(image(big(), 'image/svg+xml')), null);
  assert.equal(await refuse(image(big(2000000))), null);
  assert.equal(await createPhotoFinder().find('   '), null);
  let fail = true, calls = 0;
  const finder = createPhotoFinder({lookup, languages: ['zh'], fetchImpl: async url => { calls++; if (fail) throw Error('offline'); return url.includes('api.php') ? json(pages({title: 'x', index: 1, thumbnail: {source: thumb}})) : image(); }});
  assert.equal(await finder.find('x'), null);
  fail = false;
  assert.equal((await finder.find('x')).title, 'x');
  assert.equal(calls, 3);
});

test('only public https addresses are fetched; share pictures are read from either attribute order', async () => {
  for (const bad of ['http://example.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://printer.local/a', 'https://user:pw@example.com/a', 'https://example.com:8443/a', 'https://db.intranet.example/a', 'not a url'])
    assert.equal(await publicHttps(bad, {lookup}), null, bad);
  assert.equal((await publicHttps('https://example.com/a?b=1', {lookup})).href, 'https://example.com/a?b=1');
  assert.equal(sharePicture('<meta property="og:image" content="https://cdn.example/p.jpg">', 'https://a.example/x'), 'https://cdn.example/p.jpg');
  assert.equal(sharePicture("<meta name='twitter:image' content='//cdn.example/p.webp'>", 'https://a.example/x'), 'https://cdn.example/p.webp');
  assert.equal(sharePicture('<meta property="og:image" content="/site-logo.png">', 'https://a.example/x'), '');
  assert.equal(sharePicture('<p>no meta</p>', 'https://a.example/x'), '');
});

test('a page that fails after another page already gave the picture is not an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const finder = createPhotoFinder({lookup, languages: ['zh'],
    search: async () => ({results: [{url: 'https://good.example/a'}, {url: 'https://slow-forbidden.example/b'}]}),
    fetchImpl: async url => {
      if (url.includes('api.php')) return json(pages({title: 'x', index: 1}));
      if (url === 'https://good.example/a') return html('<img alt="x" src="https://good.example/p.jpg">');
      if (url === 'https://good.example/p.jpg') return image(big(9000));
      await new Promise(resolve => setTimeout(resolve, 20));
      return {ok: false, status: 403};
    }});
  assert.equal((await finder.find('x')).source, 'good.example');
  await new Promise(resolve => setTimeout(resolve, 60));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, []);
});

test('a page gives the image it labels with the name; its share picture only when the page is about the thing', () => {
  const base = 'https://dex.example/p/25';
  assert.equal(pagePicture('<title>图鉴</title><meta property="og:image" content="/ogp.png"><img alt="皮卡丘" src="/art/025.png">', base, '皮卡丘'), 'https://dex.example/art/025.png');
  assert.equal(pagePicture('<title>图鉴</title><meta property="og:image" content="/ogp.png"><img alt="杰尼龟" src="/art/007.png">', base, '皮卡丘'), '', 'a site picture on a page not about it');
  assert.equal(pagePicture('<title>皮卡丘 - 百科</title><meta property="og:image" content="/art/hero.jpg">', base, '皮卡丘'), 'https://dex.example/art/hero.jpg');
  assert.equal(pagePicture('<img alt="皮卡丘图标" src="/icons/pikachu-icon.png"><img title="皮卡丘（官方绘图）" src="//cdn.example/p.png">', base, '皮卡丘'), 'https://cdn.example/p.png');
});

test('the same file for two different things is not a picture of either', async () => {
  const finder = createPhotoFinder({lookup, languages: [], search: async query => ({results: [{url: 'https://portal.example/' + encodeURIComponent(query)}]}),
    fetchImpl: async url => url.endsWith('.png') ? image(big(30000), 'image/png') : html(`<title>${decodeURIComponent(url.split('/').pop())}</title><meta property="og:image" content="/ogp/share.png">`)});
  assert.equal((await finder.find('皮卡丘')).source, 'portal.example');
  assert.equal(await finder.find('妙蛙种子'), null);
});

test('with an image-search key the titled result is used, one request at a time', async () => {
  const calls = [], waits = [];
  let time = 0;
  const finder = createPhotoFinder({lookup, braveKey: 'test-key', now: () => time, wait: async ms => { waits.push(ms); time += ms; },
    fetchImpl: async (url, init) => {
      calls.push(url);
      if (url.startsWith('https://api.search.brave.com/')) {
        assert.equal(init.headers['x-subscription-token'], 'test-key');
        return json({results: [{title: '宝可梦大全', thumbnail: {src: 'https://imgs.search.brave.com/all'}}, {title: '杰尼龟 官方画像', thumbnail: {src: 'https://imgs.search.brave.com/squirtle'}}, {title: '别处', thumbnail: {src: 'https://evil.example/x'}}]});
      }
      return image(distinct(), 'image/png');
    }});
  const [a, b] = await Promise.all([finder.find('杰尼龟'), finder.find('小火龙')]);
  assert.deepEqual([a.source, a.title, b.source], ['Brave 图片搜索', '杰尼龟 官方画像', 'Brave 图片搜索']);
  assert.equal(calls[1], 'https://imgs.search.brave.com/squirtle');
  assert.deepEqual(waits, [1100], 'the second lookup waited its turn');
  assert.equal(calls.some(url => url.includes('wikipedia') || url.includes('evil')), false);
});

test('a page of pictures: with a queue for the image search the encyclopedia is asked first, and waiting a turn is not timed', async () => {
  // Real timers: the queue is 30 ms a turn and the limit 50 ms, so the last of six waits three limits.
  const asked = [];
  const finder = createPhotoFinder({lookup, braveKey: 'test-key', braveGapMs: 30, timeoutMs: 50,
    fetchImpl: async (url, init) => {
      if (init?.signal?.aborted) throw Error('aborted');
      if (url.includes('wikipedia.org')) { const title = decodeURIComponent(/titles=([^&]+)/u.exec(url)[1]); asked.push('wiki ' + title); return json(title === '急冻鸟' ? {query: {pages: {1: {title, thumbnail: {source: 'https://upload.wikimedia.org/a.png'}}}}} : {query: {pages: {}}}); }
      if (url.startsWith('https://api.search.brave.com/')) { asked.push('search ' + decodeURIComponent(/q=([^&]+)/u.exec(url)[1])); return json({results: [{title: 'x', thumbnail: {src: 'https://imgs.search.brave.com/x'}}]}); }
      return image(distinct(), 'image/png');
    }});
  const names = ['皮卡丘', '杰尼龟', '急冻鸟', '闪电鸟', '火焰鸟', '超梦'];
  const found = await Promise.all(names.map(name => finder.find(name)));
  assert.deepEqual(found.map(item => item?.source), ['Brave 图片搜索', 'Brave 图片搜索', '维基百科', 'Brave 图片搜索', 'Brave 图片搜索', 'Brave 图片搜索'], 'none timed out in the queue');
  assert.equal(asked.includes('search 急冻鸟'), false, 'the one the encyclopedia had never took a turn');
  assert.equal(asked.includes('wiki 皮卡丘'), false, 'with no queue the image search is asked directly');
});

test('the same file offered for two different things is a site picture: neither keeps it', async () => {
  const finder = createPhotoFinder({lookup, braveKey: 'test-key', braveGapMs: 0, languages: [],
    fetchImpl: async url => url.startsWith('https://api.search.brave.com/') ? json({results: [{title: 'Pokemon', thumbnail: {src: 'https://imgs.search.brave.com/logo'}}]}) : image(big(30000), 'image/png')});
  assert.ok(await finder.find('帕路奇亚'), 'alone, it is taken for a picture of the thing');
  assert.equal(await finder.find('快龙'), null, 'the second thing with the very same file gets nothing');
  assert.equal(await finder.find('帕路奇亚'), null, 'and the first does not keep it');
});

test('a picture found once is kept on disk and served without asking anyone again', async t => {
  const {mkdtemp, rm, readdir} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'board-photos-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  let asked = 0;
  const make = () => createPhotoFinder({lookup, braveKey: 'k', braveGapMs: 0, directory,
    fetchImpl: async url => { asked++; return url.startsWith('https://api.search.brave.com/') ? json({results: [{title: '小火龙', thumbnail: {src: 'https://imgs.search.brave.com/c'}}]}) : image(distinct(), 'image/png'); }});
  const first = await make().find('小火龙');
  for (let tries = 0; tries < 50 && (await readdir(directory)).length < 2; tries++) await new Promise(resolve => setTimeout(resolve, 5));
  const before = asked, seen = [];
  const again = await createPhotoFinder({lookup, directory, observe: event => seen.push(event), fetchImpl: async () => { asked++; throw Error('offline'); }}).find('小火龙');
  assert.deepEqual([Buffer.compare(Buffer.from(first.bytes), again.bytes), again.type, again.source, asked - before, seen[0].kept], [0, 'image/png', 'Brave 图片搜索', 0, true]);
  assert.equal(await createPhotoFinder({lookup, directory, languages: [], fetchImpl: async () => { throw Error('offline'); }}).find('杰尼龟'), null);
});

test('image-search results are ranked: titled with the name, from a reference, not stock art or a how-to-draw', async () => {
  const {rankPicture} = await import('./board-photo.mjs');
  const result = (title, source, extra = {}) => ({title, source, confidence: 'high', thumbnail: {src: 'https://imgs.search.brave.com/x', width: 400, height: 400}, properties: {url: 'https://example.com/a.png'}, ...extra});
  const order = (query, items) => items.map(item => [item.title + '@' + item.source, rankPicture(item, query)]).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  assert.deepEqual(order('小火龙', [result('怎样画简笔画——小火龙', 'jingyan.baidu.com'), result('小火龙', 'kuaipng.com'), result('小火龙的官方画像', 'pokemongjd.com'), result('小火龙', 'baike.baidu.com')]),
    ['小火龙@baike.baidu.com', '小火龙的官方画像@pokemongjd.com', '小火龙@kuaipng.com', '怎样画简笔画——小火龙@jingyan.baidu.com']);
  assert.ok(rankPicture(result('怎样画简笔画——小火龙', 'jingyan.baidu.com'), '小火龙') <= 1);
  assert.ok(rankPicture(result('快龙（超级进化）', 'pokedex.wiki'), '快龙') < rankPicture(result('快龙 雄性', 'pokedex.wiki'), '快龙'));
  assert.ok(rankPicture(result('2025 Tesla Model 3', 'cars.com'), '特斯拉 Model 3') > rankPicture(result('Tesla logo', 'cars.com'), '特斯拉 Model 3'), 'every word of the query counts');
  assert.ok(rankPicture(result('电车', 'pixabay.com', {thumbnail: {src: 'https://imgs.search.brave.com/x', width: 500, height: 120}}), '电车') < rankPicture(result('电车', 'baike.baidu.com'), '电车'));
});
