import assert from 'node:assert/strict';
import test from 'node:test';
import {createPhotoFinder, pagePicture, publicHttps, sharePicture} from './board-photo.mjs';

const json = value => ({ok: true, status: 200, json: async () => value});
const big = (size = 5000) => new Uint8Array(size).buffer;
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
      return image(big(30000), 'image/png');
    }});
  const [a, b] = await Promise.all([finder.find('杰尼龟'), finder.find('小火龙')]);
  assert.deepEqual([a.source, a.title, b.source], ['Brave 图片搜索', '杰尼龟 官方画像', 'Brave 图片搜索']);
  assert.equal(calls[1], 'https://imgs.search.brave.com/squirtle');
  assert.deepEqual(waits, [1100], 'the second lookup waited its turn');
  assert.equal(calls.some(url => url.includes('wikipedia') || url.includes('evil')), false);
});
