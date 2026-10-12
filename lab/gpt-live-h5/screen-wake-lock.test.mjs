import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenWakeLock } from './screen-wake-lock.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(request) {
  const events = {}, locks = [], states = [];
  const document = {visibilityState:'visible', addEventListener:(name, fn) => { events[name] = fn; }};
  const navigator = {wakeLock:{request: request ?? (async kind => {
    assert.equal(kind, 'screen');
    const lock = {releases:0, addEventListener(){}, async release(){ this.releases++; }};
    locks.push(lock); return lock;
  })}};
  return {document, events, locks, states, wake:createScreenWakeLock({navigator, document, onState:s => states.push(s)})};
}
test('call acquires one lock, returns from hidden page, and releases on hangup', async () => {
  const f = fixture(); f.wake.setActive(true); await tick(); f.wake.ensure(); await tick();
  assert.equal(f.locks.length,1); assert.equal(f.states.at(-1),'held');
  f.document.visibilityState='hidden'; f.events.visibilitychange(); await tick(); assert.equal(f.locks[0].releases,1);
  f.document.visibilityState='visible'; f.events.visibilitychange(); await tick(); assert.equal(f.locks.length,2);
  f.wake.setActive(false); await tick(); assert.equal(f.locks[1].releases,1); assert.equal(f.states.at(-1),'idle');
});
test('late acquisition after hangup is released rather than keeping phone awake', async () => {
  let resolve; const f = fixture(() => new Promise(r => {resolve=r;})); f.wake.setActive(true); await tick();
  f.wake.setActive(false); let releases=0; resolve({release:async()=>{releases++;}}); await tick(); assert.equal(releases,1);
});
test('OS denial and unsupported browser never prevent a call or create a retry loop', async () => {
  let attempts=0; const f=fixture(async()=>{attempts++; throw Error('denied');});
  f.wake.setActive(true); await tick(); assert.equal(attempts,1); assert.equal(f.states.at(-1),'denied');
  const states=[]; createScreenWakeLock({navigator:{},document:{},onState:s=>states.push(s)}).setActive(true);
  assert.deepEqual(states,['unavailable']);
});
