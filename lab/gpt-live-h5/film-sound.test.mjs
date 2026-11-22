import test from 'node:test';
import assert from 'node:assert/strict';
import {createFilmSound} from '../../ios/H5/film-sound.mjs';

class Film extends EventTarget {
  constructor(src = 'https://cdn.test/a.mp4') { super(); Object.assign(this, {src, isConnected: true, paused: true, ended: false, seeking: false, readyState: 4, currentTime: 0, muted: true}); }
  emit(type) { this.dispatchEvent(new Event(type)); }
  play() { this.paused = false; this.emit('play'); this.emit('playing'); }
  pause() { this.paused = true; this.emit('pause'); }
}
function app({seconds = 6, at = null, fail = false} = {}) {
  const sent = [], timers = new Set(), state = {seconds, at, fail};
  const film = createFilmSound({address: media => media.src, clock: {setInterval: run => { timers.add(run); return run; }, clearInterval: run => timers.delete(run)},
    post: async value => { sent.push(value); if (state.fail) throw Error('no'); return value.op === 'load' ? {seconds: state.seconds} : value.op === 'at' ? {at: state.at} : {}; }});
  return {film, sent, timers, state, ops: () => sent.map(value => value.op === 'play' ? `play@${value.at}` : value.op).join(' ')};
}

test('the sound begins once the picture has moved, and follows it', async () => {
  const {film, ops, timers} = app(), video = new Film();
  video.play(); video.currentTime = .5;
  assert.equal(await film.on(video), true);
  await film.tick(); assert.equal(ops(), 'load', 'it says it plays, and stands still: being fetched');
  video.currentTime = .55; await film.tick();
  assert.equal(ops(), 'load play@0.55');
  video.pause(); assert.match(ops(), /stop$/u);
  video.currentTime = 2; video.play(); await film.tick(); video.currentTime = 2.05; await film.tick();
  assert.equal(ops(), 'load play@0.55 stop play@2.05');
  // A jump (and going round to the start is one): quiet while it seeks, then from there.
  video.seeking = true; video.emit('seeking'); assert.match(ops(), /stop$/u);
  video.seeking = false; video.currentTime = 0; video.emit('seeked'); video.currentTime = .04; await film.tick();
  assert.match(ops(), /stop play@0\.04$/u);
  film.off(video);
  assert.match(ops(), /stop$/u); assert.equal(timers.size, 0);
  video.play(); await film.tick();
  assert.match(ops(), /stop$/u, 'a video that is not heard says nothing to the App');
});

test('the sound is put back when it drifts, when the App lost it, and let go with the element', async () => {
  const {film, sent, state, timers} = app(), video = new Film();
  video.play(); await film.on(video); video.currentTime = .05; await film.tick();
  const look = async () => { sent.length = 0; for (let i = 0; i < 18; i++) { await film.tick(); if (sent.length) break; } await Promise.resolve(); return sent.map(value => value.op).join(' '); };
  video.currentTime = 1; state.at = 1.05;
  assert.equal(await look(), 'at', 'in step: left alone');
  state.at = 1.4; assert.equal(await look(), 'at play');
  state.at = null; assert.equal(await look(), 'at play', 'the audio was set up anew');
  video.currentTime = 5.8; assert.equal(await look(), 'at', 'its last moments: over, not lost');
  sent.length = 0; video.isConnected = false; await film.tick();
  assert.equal(sent.at(-1).op, 'stop'); assert.equal(film.heard(video), false); assert.equal(timers.size, 0);
});

test('one video is heard at a time, and the one before is told', async () => {
  const {film, ops} = app(), first = new Film(), second = new Film('https://cdn.test/b.mp4');
  let lost = 0;
  first.play(); await film.on(first, {lost: () => lost++}); first.currentTime = .05; await film.tick();
  second.play(); await film.on(second); second.currentTime = .05; await film.tick();
  assert.equal(lost, 1); assert.equal(film.heard(second), true); assert.equal(film.heard(first), false);
  assert.equal(ops(), 'load play@0.05 stop load play@0.05');
});

test('a video without sound, or whose sound cannot be had, is silent; the latter is asked for again', async () => {
  const none = app({seconds: 0}), video = new Film();
  video.play();
  assert.equal(await none.film.on(video), false); assert.equal(await none.film.on(video), false);
  assert.equal(none.ops(), 'load', 'known to have none');
  const broken = app({fail: true});
  assert.equal(await broken.film.on(video), false); assert.equal(broken.film.heard(video), false);
  broken.state.fail = false;
  assert.equal(await broken.film.on(video), true); assert.equal(broken.ops(), 'load load');
});

test('turned off while its sound was still being fetched, it never starts', async () => {
  const {film, ops} = app(), video = new Film();
  video.play();
  const turning = film.on(video); film.off(video);
  assert.equal(await turning, false); video.currentTime = .1; await film.tick(); assert.equal(ops().includes('play'), false);
});
