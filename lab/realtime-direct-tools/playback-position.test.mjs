import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackPosition,splitSpoken} from './playback-position.mjs';

test('what is still to play is what was sent less what has played since it started, holds excluded', () => {
  let at = 0;
  const p = createPlaybackPosition({now: () => at, prefillMs: 0});
  assert.equal(p.snapshot(), null);
  p.sent('lesson', 48 * 30000); p.generated('lesson');
  at = 10000; assert.deepEqual(p.snapshot(), {responseId: 'lesson', scripted: false, playedMs: 10000, remainingMs: 20000, totalMs: 30000, generated: true});
  p.paused(true); at = 15000; assert.equal(p.snapshot().remainingMs, 20000, 'a hold does not count as playing');
  p.paused(false); at = 16000; assert.equal(p.snapshot().remainingMs, 19000);
  // The page's own count of its queue, when fresh, is believed over the clock (within a second).
  p.queued(48 * 18500); assert.equal(p.snapshot().remainingMs, 18500);
  p.cleared('other'); assert.notEqual(p.snapshot(), null, 'clearing something else leaves it');
  p.cleared('lesson'); assert.equal(p.snapshot(), null);
});

test('a response still being generated is as long as its words; one queued behind another starts after it', () => {
  let at = 0;
  const p = createPlaybackPosition({now: () => at, prefillMs: 0});
  p.sent('lesson', 48 * 2000);
  assert.equal(p.snapshot({chars: 100}).totalMs, 18000);
  p.drained(); assert.equal(p.snapshot(), null);
  p.sent('a', 48 * 5000); at = 1000; p.sent('b', 48 * 1000);
  assert.equal(p.snapshot().remainingMs, 1000, 'b plays only once a has');
  at = 5500; assert.equal(p.snapshot().remainingMs, 500);
});

test('the words around where playback is', () => {
  assert.deepEqual(splitSpoken('一二三四五六七八九十', 3000, 10000), {said: '一二三', ahead: '四五六七八九十'});
  assert.deepEqual(splitSpoken('', 1, 2), {said: '', ahead: ''});
});
