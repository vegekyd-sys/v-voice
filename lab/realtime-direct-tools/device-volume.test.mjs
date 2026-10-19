import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVolumeStore,targetVolume} from './device-volume.mjs';

test('spoken levels are relative to the current level and stay within 0-100', () => {
  assert.equal(targetVolume(85, {change:'up'}), 100);
  assert.equal(targetVolume(85, {change:'down'}), 70);
  assert.equal(targetVolume(10, {change:'down'}), 0);
  assert.equal(targetVolume(null, {change:'up'}), 85, 'unknown level starts from the firmware default 70');
  assert.equal(targetVolume(85, {volume:40}), 40);
});

test('a spoken level persists until the operator changes devices.json', () => {
  const store = createVolumeStore();
  assert.equal(store.get('stackchan', 85), 85);
  assert.equal(store.set('stackchan', 55, 85), false, 'memory only without a file');
  assert.equal(store.get('stackchan', 85), 55);
  assert.equal(store.get('stackchan', 60), 60, 'a new operator volume wins over the saved one');
  assert.equal(store.get('other', null), null);
});

test('a volume file survives a restart and is written privately and atomically', t => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-volume-'));t.after(() => rmSync(dir, {recursive:true, force:true}));
  const file = join(dir, 'device-volumes.json');
  assert.equal(createVolumeStore({file}).get('stackchan', 85), 85, 'a missing file is an empty store');
  const store = createVolumeStore({file});
  assert.equal(store.set('stackchan', 40, 85), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {stackchan:{volume:40, configured:85}});
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(createVolumeStore({file}).get('stackchan', 85), 40);
  assert.equal(createVolumeStore({file:join(dir, 'missing-dir', 'v.json')}).set('stackchan', 40, 85), false, 'a write failure keeps the call going');
});
