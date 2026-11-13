import {open} from 'node:fs/promises';
import {constants} from 'node:fs';

const names = ['Codex', 'Claude Code', 'Grok', 'Gemini', 'DeepSeek'];
const states = new Set(['ready', 'unconfigured', 'unavailable']);
const labels = new Set(['5 小时', '周', '本期']);
const timestamp = n => Number.isFinite(n) && n > 0 && n < 1e10;

export async function readRelayUsage(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o077)) throw Error('Invalid snapshot');
    const data = JSON.parse(await handle.readFile('utf8'));
    if (data.version !== 1 || !timestamp(data.updated) || data.updated > Date.now()/1000+60 ||
        !Array.isArray(data.providers)) throw Error('Invalid snapshot');
    const providers = names.map(name => {
      const row = data.providers.find(p => p?.name === name);
      if (!row || !states.has(row.state)) return {name, state:'unavailable'};
      if (row.state !== 'ready') return {name, state:row.state};
      if (name === 'DeepSeek' && Number.isFinite(row.balance) && ['CNY','USD'].includes(row.currency))
        return {name, state:'ready', balance:row.balance, currency:row.currency};
      const windows = Array.isArray(row.windows) ? row.windows.filter(w => labels.has(w?.label) &&
        Number.isFinite(w.used) && w.used >= 0 && w.used <= 100 && (w.reset === null || timestamp(w.reset)))
        .slice(0,2).map(({label,used,reset}) => ({label,used,reset})) : [];
      return windows.length ? {name, state:'ready', windows} : {name, state:'unavailable'};
    });
    return {version:1, updated:data.updated, providers};
  } finally {
    await handle.close();
  }
}
