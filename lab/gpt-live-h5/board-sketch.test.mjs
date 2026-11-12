import assert from 'node:assert/strict';
import test from 'node:test';
import {MARK_PATHS, arrow, fitPath, pointer, seeded, tilt} from './board-sketch.mjs';

const numbers = d => d.match(/-?\d+(?:\.\d+)?/gu).map(Number);

test('a stroke depends only on its seed and stays near its box', () => {
  for (const [name, make] of Object.entries(MARK_PATHS)) {
    assert.equal(make('item-1'), make('item-1'), name + ' repeats');
    assert.notEqual(make('item-1'), make('item-2'), name + ' varies');
    assert.match(make('item-1'), /^M[\d. -]+[CL]/u);
    assert.equal(numbers(make('item-1')).every(value => value > -12 && value < 112), true, name + ' stays near the box');
  }
  assert.equal(seeded('a')() === seeded('a')(), true);
});

test('a ring is one stroke that overshoots where it closes', () => {
  const d = MARK_PATHS.ring('k'), values = numbers(d);
  assert.equal((d.match(/M/gu) ?? []).length, 1);
  const start = values.slice(0, 2), end = values.slice(-2);
  assert.equal(Math.hypot(end[0] - start[0], end[1] - start[1]) > 3, true, 'the end does not land exactly on the start');
});

test('paths are refitted to a real box; x and y scale separately', () => {
  assert.equal(fitPath('M10 50 C20 40 30 60 100 50 M5 5 L50 100', 200, 10), 'M20 5 C40 4 60 6 200 5 M10 0.5 L100 10');
  const fitted = numbers(fitPath(pointer('p'), 28, 20));
  assert.equal(fitted.filter((_, index) => index % 2 === 0).every(x => x >= 0 && x <= 28), true);
});

test('an arrow ends at its target with a head; a piece of paper keeps its angle', () => {
  const d = arrow('e', [10, 10], [80, 70]);
  assert.match(d, /^M10 10 Q[\d. -]+ 80 70 M[\d. -]+ L80 70 L[\d. -]+$/u);
  assert.equal(tilt('note-1'), tilt('note-1'));
  assert.equal(Math.abs(tilt('note-1', 2)) <= 2, true);
});
