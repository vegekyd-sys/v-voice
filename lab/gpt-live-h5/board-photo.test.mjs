import assert from 'node:assert/strict';
import test from 'node:test';
import {createPhotoFinder, publicHttps, sharePicture} from './board-photo.mjs';

const json = value => ({ok: true, status: 200, json: async () => value});
const big = (size = 5000) => new Uint8Array(size).buffer;
const image = (bytes = big(), type = 'image/jpeg') => ({ok: true, status: 200, headers: new Headers({'content-type': type}), arrayBuffer: async () => bytes});
const html = text => ({ok: true, status: 200, headers: new Headers({'content-type': 'text/html; charset=utf-8'}), text: async () => text});
const pages = (...list) => ({query: {pages: Object.fromEntries(list.map((page, index) => [index, page]))}});
const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a.jpg/480px-a.jpg';
const lookup = async host => host.includes('intranet') ? [{address: '10.0.0.8'}] : [{address: '93.184.216.34'}];

test('the lead picture of the best Wikipedia match is used and cached', async () => {
  const calls = [];
  const finder = createPhotoFinder({lookup, fetchImpl: async (url, init) => {
    calls.push({url, agent: init.headers['user-agent']});
    return url.includes('api.php') ? json(pages({title: '别的条目', index: 2, thumbnail: {source: 'https://upload.wikimedia.org/other.jpg'}}, {title: '艾菲尔铁塔', index: 1, thumbnail: {source: thumb}})) : image();
  }});
  const found = await finder.find('  埃菲尔  铁塔 ');
  assert.deepEqual([found.title, found.type, found.source, found.bytes.length], ['艾菲尔铁塔', 'image/jpeg', '维基百科', 5000]);
  assert.equal(calls[1].url, thumb);
  assert.match(calls[0].agent, /^VVoiceBoard\/[\d.]+ \(https:\/\//u);
  await Promise.all([finder.find('埃菲尔 铁塔'), finder.find('埃菲尔 铁塔')]);
  assert.equal(calls.length, 2, 'later lookups are served from memory');
});

test('a lower-ranked article with a picture is not the thing asked for', async () => {
  const finder = createPhotoFinder({lookup, languages: ['zh'], fetchImpl: async url => url.includes('api.php') ? json(pages({title: '噴火龍', index: 1}, {title: '火龙果', index: 3, thumbnail: {source: thumb}})) : image()});
  assert.equal(await finder.find('喷火龙'), null);
});

test('when Wikipedia has no picture, the share picture of a page V\'s search found is used', async () => {
  const fetched = [], seen = [];
  const finder = createPhotoFinder({lookup, languages: ['zh'], observe: event => seen.push(event),
    search: async query => ({ok: true, output: {details: {results: [{title: '内网', url: 'https://wiki.intranet.example/p'}, {title: '没有配图', url: 'https://plain.example/p'}, {title: '皮卡丘 - 百科', url: 'https://wiki.example/pikachu?x=1'}, {title: 'http', url: 'http://insecure.example/p'}], query}}}),
    fetchImpl: async (url, init) => {
      fetched.push(url);
      assert.equal(init.credentials, 'omit');
      if (url.includes('api.php')) return json(pages({title: '皮卡丘', index: 1}));
      if (url === 'https://plain.example/p') return html('<html><head><meta property="og:image" content="/static/logo.png"></head></html>');
      if (url === 'https://wiki.example/pikachu?x=1') return html('<html><head><meta content="/images/025.png?v=2&amp;w=600" property="og:image" /></head></html>');
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
      if (url === 'https://good.example/a') return html('<meta property="og:image" content="https://good.example/p.jpg">');
      if (url === 'https://good.example/p.jpg') return image(big(9000));
      await new Promise(resolve => setTimeout(resolve, 20));
      return {ok: false, status: 403};
    }});
  assert.equal((await finder.find('x')).source, 'good.example');
  await new Promise(resolve => setTimeout(resolve, 60));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, []);
});
