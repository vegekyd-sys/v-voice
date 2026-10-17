import {readFileSync,writeFileSync,renameSync} from 'node:fs';

// A volume someone asked for by voice outlives the call. devices.json stays the
// operator's file and is never written here: a saved level applies only while
// the operator's configured volume is the one it was saved against, so editing
// devices.json still wins. With a file, levels also survive a service restart.
export const XIAOZHI_DEFAULT_VOLUME = 70;  // xiaozhi-esp32 firmware default
export const VOLUME_STEP = 15;

export function createVolumeStore({file = null} = {}) {
  const levels = new Map();
  if (file) {
    let saved = {};
    try {saved = JSON.parse(readFileSync(file, 'utf8'));} catch (error) {if (error.code !== 'ENOENT') throw error;}
    for (const [id, entry] of Object.entries(saved ?? {})) if (Number.isInteger(entry?.volume) && entry.volume >= 0 && entry.volume <= 100) levels.set(id, {volume:entry.volume, configured:entry.configured ?? null});
  }
  return {
    get(id, configured = null) {
      const entry = levels.get(id);
      return entry && entry.configured === configured ? entry.volume : configured;
    },
    /** Returns whether the level reached disk; memory always keeps it. */
    set(id, volume, configured = null) {
      levels.set(id, {volume, configured});
      if (!file) return false;
      try {
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(Object.fromEntries(levels)), {mode:0o600});
        renameSync(tmp, file);
        return true;
      } catch {return false;}
    },
  };
}

/** Resolve a spoken request to an absolute 0-100 level. */
export function targetVolume(current, {volume, change}) {
  if (Number.isInteger(volume)) return Math.max(0, Math.min(100, volume));
  const base = current ?? XIAOZHI_DEFAULT_VOLUME;
  return Math.max(0, Math.min(100, base + (change === 'down' ? -VOLUME_STEP : VOLUME_STEP)));
}
