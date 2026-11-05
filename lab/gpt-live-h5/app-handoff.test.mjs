import test from 'node:test';
import assert from 'node:assert/strict';
import {openAppWithFallback, refreshBindingOnExpiry} from './app-handoff.mjs';

const appUrl = 'vvoice://settings/bind#url=https%3A%2F%2Ffixture.invalid%2F%23bind%3Dlocal-only';
const downloadUrl = 'https://testflight.apple.com/join/5DybcrZA';
function browser() {
  const win = new EventTarget(), doc = new EventTarget(), timers = new Map(), visited = [];
  let id = 0, focused = true;
  doc.hidden = false; doc.hasFocus = () => focused;
  win.setTimeout = callback => { timers.set(++id, callback); return id; };
  win.clearTimeout = key => timers.delete(key);
  win.location = {assign: url => visited.push(url)};
  return {
    window: win, document: doc, visited,
    start: options => openAppWithFallback({appUrl, downloadUrl, window: win, document: doc, ...options}),
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    hide() { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); },
    show() { doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); },
    blur() { focused = false; win.dispatchEvent(new Event('blur')); },
    focus() { focused = true; win.dispatchEvent(new Event('focus')); },
  };
}
test('no app handoff opens only the download URL, without the binding fragment', () => {
  const b = browser(); b.start(); assert.deepEqual(b.visited, [appUrl]);
  b.tick(); assert.deepEqual(b.visited, [appUrl, downloadUrl]);
  b.focus(); b.tick(); assert.equal(b.visited.length, 2);
});
test('switching to the installed app cancels fallback even after returning to Safari', () => {
  const b = browser(); b.start(); b.blur(); b.hide(); b.tick(); b.show(); b.focus(); b.tick();
  assert.deepEqual(b.visited, [appUrl]);
});
test('native confirmation can remain open beyond the fallback delay', () => {
  const b = browser(); b.start(); b.blur(); b.tick(); assert.deepEqual(b.visited, [appUrl]);
  b.hide(); b.focus(); b.tick(); assert.deepEqual(b.visited, [appUrl]);
});
test('dismissing an unsuccessful native prompt resumes the download fallback', () => {
  const b = browser(); b.start(); b.blur(); b.tick(); b.focus(); b.tick();
  assert.deepEqual(b.visited, [appUrl, downloadUrl]);
});
test('navigating away cancels fallback', () => {
  const b = browser(); b.start(); b.window.dispatchEvent(new Event('pagehide')); b.tick();
  assert.deepEqual(b.visited, [appUrl]);
});
test('closing the binding sheet cancels pending navigation', () => {
  const b = browser(), cancel = b.start(); cancel(); b.focus(); b.tick();
  assert.deepEqual(b.visited, [appUrl]);
});
test('a replacement attempt cannot navigate using the previous binding', () => {
  const b = browser(), cancel = b.start(); cancel(); b.start({appUrl: appUrl + '-new'}); b.tick();
  assert.deepEqual(b.visited, [appUrl, appUrl + '-new', downloadUrl]);
});
test('disabling app download preserves direct app opening', () => {
  const b = browser(); b.start({downloadUrl: undefined}); b.tick();
  assert.deepEqual(b.visited, [appUrl]);
});
test('installation can outlast the binding token: refresh once on return', () => {
  const b = browser(); let now = 0, refreshes = 0;
  refreshBindingOnExpiry({...b, expiresAt: 300000, now: () => now, refresh: () => refreshes++});
  b.hide(); now = 360000; b.tick(); assert.equal(refreshes, 0);
  b.show(); b.window.dispatchEvent(new Event('pageshow')); assert.equal(refreshes, 1);
});
test('Safari back-forward cache return refreshes an expired binding', () => {
  const b = browser(); let now = 0, refreshes = 0;
  refreshBindingOnExpiry({...b, expiresAt: 300000, now: () => now, refresh: () => refreshes++});
  now = 360000; b.window.dispatchEvent(new Event('pageshow')); assert.equal(refreshes, 1);
  b.tick(); assert.equal(refreshes, 1);
});
test('active sheet refreshes on expiry', () => {
  const b = browser(); let now = 0, refreshes = 0;
  refreshBindingOnExpiry({...b, expiresAt: 300000, now: () => now, refresh: () => refreshes++});
  now = 300000; b.tick(); assert.equal(refreshes, 1);
});
test('closing the sheet cancels expiry refresh', () => {
  const b = browser(); let now = 0, refreshes = 0;
  const cancel = refreshBindingOnExpiry({...b, expiresAt: 300000, now: () => now, refresh: () => refreshes++});
  cancel(); now = 360000; b.tick(); b.window.dispatchEvent(new Event('pageshow'));
  assert.equal(refreshes, 0);
});
