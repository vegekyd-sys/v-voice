import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playbackEchoLike} from './playback-echo.mjs';

// Invented replies and utterances; no words from real calls.
const reply = '海边的灯塔晚上会一闪一闪地亮，给远处的船指路。';

test('a short scrap of the reply being played is taken for V\'s own voice', () => {
  for (const heard of ['灯塔', '一闪一闪', '指路。', '远处的船', '亮灯']) assert.equal(playbackEchoLike(heard, reply), true, heard);
});

test('a short scrap mostly from the reply, misheard in one character, is still echo', () => {
  assert.equal(playbackEchoLike('灯塔晚尚', reply), true);
});

test('real interruptions keep interrupting', () => {
  // Longer than a scrap, unrelated, or an explicit request to stop.
  for (const heard of ['那灯塔是谁修的呀', '换个故事', '我想吃苹果', '停', '等一下', '不对不对', '别说了', '暂停', 'stop', 'wait a moment'])
    assert.equal(playbackEchoLike(heard, reply), false, heard);
});

test('nothing is echo without a reply or without words', () => {
  assert.equal(playbackEchoLike('灯塔', ''), false);
  assert.equal(playbackEchoLike('灯塔', undefined), false);
  assert.equal(playbackEchoLike('  。', reply), false);
});

test('Latin words are compared as words, not letters', () => {
  const english = 'The lighthouse blinks at night to guide the ships.';
  assert.equal(playbackEchoLike('guide the ships', english), true);
  assert.equal(playbackEchoLike('play some music', english), false);
});
