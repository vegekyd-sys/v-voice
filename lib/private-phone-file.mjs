import {lstat, readFile, open, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createConversationEntries} from './conversation-entries.mjs';

export async function readPhoneFile(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.mode & 0o077) throw new Error('Phone registry must be a private regular file (mode 0600)');
    const records = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(records)) throw new Error('Phone registry must be an array');
    createConversationEntries(records);
    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Only this task's temporary file and acquired lock are removed. Existing
// registry data is never overwritten with an unvalidated or partial mapping.
export async function updatePhoneFile(file, update) {
  file = resolve(file);
  const lock = `${file}.lock`, temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(lock, 'wx', 0o600);
  let ownsTemporary = false;
  try {
    const records = await readPhoneFile(file);
    const before = JSON.stringify(records);
    const next = await update(records);
    createConversationEntries(next);
    if (JSON.stringify(await readPhoneFile(file)) !== before) throw new Error('Phone registry changed during update');
    const output = await open(temporary, 'wx', 0o600); ownsTemporary = true;
    try {await output.writeFile(JSON.stringify(next, null, 2) + '\n'); await output.sync();}
    finally {await output.close();}
    await rename(temporary, file); ownsTemporary = false;
    return next;
  } finally {
    if (ownsTemporary) await unlink(temporary);
    await handle.close(); await unlink(lock);
  }
}
