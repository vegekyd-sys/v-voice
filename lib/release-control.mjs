import {createServer} from 'node:http';
import {chmod, lstat, readFile, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export const workIsIdle = value => value?.known === true &&
  ['activeCalls', 'creatingSessions', 'backgroundTasks', 'deviceOperations'].every(key => value[key] === 0);

// This gate and admission run in the same JS event loop. There is no await
// between the last idle check and closing admission. Calls already in flight
// are counted before their first await and are never terminated by this gate.
export function createReleaseGate({readiness, now = Date.now}) {
  let lease = null;
  const current = () => { if (lease && now() >= lease.expiresAt) lease = null; return lease; };
  return {
    blocked: () => Boolean(current()),
    snapshot: () => {const held = current(); return {held: Boolean(held), id: held?.id ?? null, expiresAt: held?.expiresAt ?? null};},
    hold() {
      if (current() || !workIsIdle(readiness())) return null;
      lease = {id: randomUUID(), expiresAt: now() + 120000};
      return {...lease};
    },
    resume(id) {if (current()?.id !== id) return false; lease = null; return true;},
  };
}

export async function readRelease(root) {
  try {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    const shell = JSON.parse(await readFile(new URL('lab/gpt-live-h5/ios-shell-release.json', root), 'utf8'));
    return {commit: manifest.commit, filesSha256: manifest.filesSha256, iosShellRevision: shell.revision,
      contract: manifest.clients ?? null};
  } catch { return null; }
}

// Opt-in Unix socket, mode 0600. No network administrative endpoint and no
// browser/device token can acquire a release hold. A crashed publisher's hold
// expires automatically. The containing directory is owned by systemd.
export async function listenReleaseControl({socketPath, bridge, release}) {
  if (!socketPath?.startsWith('/')) throw Error('Absolute release socket required');
  try {
    const existing = await lstat(socketPath);
    if (!existing.isSocket()) throw Error('Release socket path is not a socket');
    // Never unlink an existing listener, even one from another version.
    throw Error('Release socket already exists');
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  const server = createServer(async (req, res) => {
    const reply = (status, value) => {res.writeHead(status, {'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    if (req.method === 'GET' && req.url === '/status') return reply(200, {
      schema: 1, pid: process.pid, release, ready: bridge.serviceReady?.() === true, readiness: bridge.releaseReadiness(),
      admission: bridge.releaseGate.snapshot(), devices: bridge.deviceInventory(),
    });
    if (req.method === 'POST' && req.url === '/hold') {
      const lease = bridge.releaseGate.hold();
      return reply(lease ? 200 : 409, {lease, readiness: bridge.releaseReadiness()});
    }
    if (req.method === 'POST' && req.url === '/resume') {
      let body = '';
      try {
        for await (const chunk of req) {body += chunk;if (body.length > 1024) return reply(413, {error:'too large'});}
        return reply(bridge.releaseGate.resume(JSON.parse(body).id) ? 200 : 409, {ok:true});
      } catch {return reply(400, {error:'invalid request'});}
    }
    reply(404, {error:'not found'});
  });
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(socketPath, resolve);});
  await chmod(socketPath, 0o600);
  return {close: async () => {server.closeAllConnections();await new Promise(resolve => server.close(resolve));await unlink(socketPath).catch(error => {if (error.code !== 'ENOENT') throw error;});}};
}
