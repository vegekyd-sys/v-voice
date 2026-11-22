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

test('the App plays the sound where the picture is, and follows it', async () => {
  const {film, ops, timers} = app(), video = new Film();
  video.play(); video.currentTime = .5;
  assert.equal(await film.on(video), true);
  assert.equal(ops(), 'load play@0.5');
  video.pause();
  video.currentTime = 2; video.play();
  assert.equal(ops(), 'load play@0.5 stop play@2 play@2');
  // A jump (and going round to the start is one): quiet while it seeks, then from there.
  video.seeking = true; video.emit('seeking'); video.seeking = false; video.currentTime = 0; video.emit('seeked');
  assert.match(ops(), /stop play@0$/u);
  film.off(video);
  assert.match(ops(), /stop$/u); assert.equal(timers.size, 0);
  video.play();
  assert.match(ops(), /stop$/u, 'a video that is not heard says nothing to the App');
});

test('the sound is put back when it drifts, when the App lost it, and let go with the element', async () => {
  const {film, sent, state, timers} = app(), video = new Film();
  video.play(); await film.on(video);
  video.currentTime = 1; state.at = 1.05; sent.length = 0;
  await film.check(); assert.deepEqual(sent.map(value => value.op), ['at'], 'in step: left alone');
  state.at = 1.4; await film.check(); assert.equal(sent.at(-1).op, 'play');
  state.at = null; await film.check(); assert.equal(sent.at(-1).op, 'play', 'the audio was set up anew');
  video.currentTime = 5.8; sent.length = 0; await film.check(); assert.deepEqual(sent.map(value => value.op), ['at'], 'its last moments: over, not lost');
  video.isConnected = false; await film.check();
  assert.equal(sent.at(-1).op, 'stop'); assert.equal(film.heard(video), false); assert.equal(timers.size, 0);
});

test('one video is heard at a time, and the one before is told', async () => {
  const {film, ops} = app(), first = new Film(), second = new Film('https://cdn.test/b.mp4');
  let lost = 0;
  first.play(); await film.on(first, {lost: () => lost++});
  second.play(); await film.on(second);
  assert.equal(lost, 1); assert.equal(film.heard(second), true); assert.equal(film.heard(first), false);
  assert.equal(ops(), 'load play@0 stop load play@0');
});

test('a video without sound, or whose sound cannot be had, is silent; the latter is asked for again', async () => {
  const none = app({seconds: 0}), video = new Film();
  video.play();
  assert.equal(await none.film.on(video), false); assert.equal(await none.film.on(video), false);
  assert.equal(none.ops(), 'load', 'known to have none');
  const broken = app({fail: true});
  assert.equal(await broken.film.on(video), false); assert.equal(broken.film.heard(video), false);
  broken.state.fail = false;
  assert.equal(await broken.film.on(video), true); assert.equal(broken.ops(), 'load load play@0');
});

test('turned off while its sound was still being fetched, it never starts', async () => {
  const {film, ops} = app(), video = new Film();
  video.play();
  const turning = film.on(video); film.off(video);
  assert.equal(await turning, false); assert.equal(ops().includes('play'), false);
});
