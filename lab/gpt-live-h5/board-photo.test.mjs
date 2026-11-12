import assert from 'node:assert/strict';
import test from 'node:test';
import {createPhotoFinder} from './board-photo.mjs';

const json = value => ({ok: true, status: 200, json: async () => value});
const image = (bytes, type = 'image/jpeg') => ({ok: true, status: 200, headers: new Headers({'content-type': type}), arrayBuffer: async () => bytes});
const pages = (...list) => ({query: {pages: Object.fromEntries(list.map((page, index) => [index, page]))}});
const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a.jpg/480px-a.jpg';

test('the lead picture of the best match is fetched from Wikimedia and cached', async () => {
  const calls = [];
  const finder = createPhotoFinder({fetchImpl: async (url, init) => {
    calls.push({url, agent: init.headers['user-agent']});
    return url.includes('api.php') ? json(pages({title: '无图条目', index: 1}, {title: '艾菲尔铁塔', index: 2, thumbnail: {source: thumb}})) : image(new Uint8Array([1, 2, 3]).buffer);
  }});
  const found = await finder.find('  埃菲尔  铁塔 ');
  assert.deepEqual([found.title, found.type, found.source, [...found.bytes]], ['艾菲尔铁塔', 'image/jpeg', '维基百科', [1, 2, 3]]);
  assert.match(calls[0].url, /^https:\/\/zh\.wikipedia\.org\/w\/api\.php\?.*gsrsearch=%E5%9F%83%E8%8F%B2%E5%B0%94%20%E9%93%81%E5%A1%94/u);
  assert.equal(calls[1].url, thumb);
  assert.match(calls[0].agent, /^VVoiceBoard\/[\d.]+ \(https:\/\//u);
  await finder.find('埃菲尔 铁塔');
  assert.equal(calls.length, 2, 'the second lookup is served from memory');
});

test('nothing in Chinese falls back to English; unsafe or unusable pictures are refused', async () => {
  const seen = [];
  const finder = createPhotoFinder({fetchImpl: async url => {
    seen.push(new URL(url).hostname);
    if (url.includes('zh.wikipedia')) return json(pages());
    if (url.includes('api.php')) return json(pages({title: 'Giant panda', index: 1, thumbnail: {source: thumb}}));
    return image(new Uint8Array(4).buffer, 'image/png');
  }});
  assert.equal((await finder.find('giant panda')).title, 'Giant panda');
  assert.deepEqual(seen, ['zh.wikipedia.org', 'en.wikipedia.org', 'upload.wikimedia.org']);
  const refuse = async (source, picture) => (await createPhotoFinder({languages: ['zh'], fetchImpl: async url => url.includes('api.php') ? json(pages({title: 'x', index: 1, thumbnail: {source}})) : picture}).find('x'));
  assert.equal(await refuse('https://evil.example/a.jpg', image(new Uint8Array(4).buffer)), null, 'only Wikimedia hosts');
  assert.equal(await refuse('http://upload.wikimedia.org/a.jpg', image(new Uint8Array(4).buffer)), null, 'https only');
  assert.equal(await refuse(thumb, image(new Uint8Array(4).buffer, 'image/svg+xml')), null, 'raster images only');
  assert.equal(await refuse(thumb, image(new Uint8Array(800000).buffer)), null, 'too large');
  assert.equal(await createPhotoFinder().find('   '), null);
});

test('a failing source yields no picture and is tried again next time', async () => {
  let fail = true, calls = 0;
  const finder = createPhotoFinder({languages: ['zh'], fetchImpl: async url => {
    calls++;
    if (fail) throw Error('offline');
    return url.includes('api.php') ? json(pages({title: 'x', index: 1, thumbnail: {source: thumb}})) : image(new Uint8Array(2).buffer);
  }});
  assert.equal(await finder.find('x'), null);
  fail = false;
  assert.equal((await finder.find('x')).title, 'x');
  assert.equal(calls, 3);
});
