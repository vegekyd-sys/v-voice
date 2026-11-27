import test from 'node:test';
import assert from 'node:assert/strict';
import {createTypedSpeech, callerSpeaker, spokenPart, TYPED_SPOKEN_CHARS} from './typed-speech.mjs';

const line = value => JSON.stringify(value) + '\n';

test('the caller\'s words are said in a voice that is not V\'s', () => {
  assert.equal(callerSpeaker('zh_female_xiaohe_uranus_bigtts'), 'zh_male_m191_uranus_bigtts');
  assert.equal(callerSpeaker('zh_male_m191_uranus_bigtts'), 'zh_female_vv_uranus_bigtts');
  assert.equal(callerSpeaker(undefined), 'zh_male_m191_uranus_bigtts');
});

test('a short message is said whole; a long one up to a sentence end, with a word that more was written', () => {
  assert.deepEqual(spokenPart('  一加一\n等于几？ '), {text: '一加一 等于几？', whole: true});
  const long = '第一句话说的是背景。'.repeat(30);
  const said = spokenPart(long);
  assert.equal(said.whole, false);
  assert(Array.from(said.text).length < TYPED_SPOKEN_CHARS + 20);
  assert.match(said.text, /。……后面还有，我打字发给你了。$/u);
  // No sentence end early enough: cut at the limit.
  assert.equal(Array.from(spokenPart('长'.repeat(400)).text.split('……')[0]).length, TYPED_SPOKEN_CHARS);
});

test('one request with the realtime key; the streamed pieces of audio are joined into 16 kHz PCM', async () => {
  let asked;
  const speak = createTypedSpeech({apiKey: 'fixture-key', randomId: () => 'fixture-request', fetchImpl: async (url, init) => {
    asked = {url, init};
    return {ok: true, text: async () => line({code: 0, data: Buffer.from([1, 0, 2, 0]).toString('base64')}) + line({code: 0, data: Buffer.from([3, 0, 4]).toString('base64')}) + line({code: 20000000, message: 'ok', data: null})};
  }});
  const audio = await speak('你好', {speaker: 'zh_male_m191_uranus_bigtts'});
  assert.deepEqual([...audio], [1, 0, 2, 0, 3, 0], 'an odd trailing byte is dropped');
  assert.equal(asked.url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
  assert.equal(asked.init.headers['X-Api-Key'], 'fixture-key');
  assert.equal(asked.init.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
  const body = JSON.parse(asked.init.body);
  assert.deepEqual(body.req_params, {text: '你好', speaker: 'zh_male_m191_uranus_bigtts', audio_params: {format: 'pcm', sample_rate: 16000}});
});

test('a refusal, an empty answer or a slow one is an error, never silence', async () => {
  const refuse = createTypedSpeech({apiKey: 'k', fetchImpl: async () => ({ok: true, text: async () => line({code: 55000000, message: 'mismatch'})})});
  await assert.rejects(refuse('你好'), /55000000/u);
  const empty = createTypedSpeech({apiKey: 'k', fetchImpl: async () => ({ok: true, text: async () => line({code: 20000000})})});
  await assert.rejects(empty('你好'), /没有声音/u);
  const status = createTypedSpeech({apiKey: 'k', fetchImpl: async () => ({ok: false, status: 403, text: async () => ''})});
  await assert.rejects(status('你好'), /403/u);
  const slow = createTypedSpeech({apiKey: 'k', timeoutMs: 20, fetchImpl: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted'))))});
  await assert.rejects(slow('你好'), /aborted/u);
  assert.equal(createTypedSpeech({}), null, 'no key, no speech');
});
