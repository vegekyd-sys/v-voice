// Compares the board's two picture sources on the same queries: the Candidate's
// (Brave image search, then Wikipedia) and production's (Wikipedia, then the
// share pictures of the pages V's web_search finds). Run on V as the Candidate's
// service user with its environment (photo-compare-on-v.sh); writes the pictures
// and a results.json to the directory given. Prints nothing secret.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root = '/var/lib/v-voice-candidates/board-20261112/voice';
const {createPhotoFinder} = await import(join(root, 'lab/gpt-live-h5/board-photo.mjs'));
const {connectGatewayClient} = await import(join(root, 'lib/gateway-client.mjs'));
const out = process.argv[2], queries = JSON.parse(await readFile(process.argv[3], 'utf8'));
await mkdir(out, {recursive: true});
const config = JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const token = () => String(config.gateway.auth.token).replace(/\$\{([^}]+)\}/gu, (_, key) => process.env[key] ?? '');
const gateway = await connectGatewayClient({url: `ws://127.0.0.1:${config.gateway.port}`, token: token(), getToken: async () => token(), scopes: ['operator.read', 'operator.write'], caps: [], subscribeSessions: false, onEvent: () => {}});
let searches = 0;
const search = text => { searches++; return gateway.request('tools.invoke', {agentId: 'makaron', sessionKey: 'voice:guest:photo-compare', name: 'web_search', args: {query: text, count: 5}}, {timeoutMs: 12000}); };
const finders = {
  brave: createPhotoFinder({braveKey: process.env.VOICE_BOARD_BRAVE_KEY ?? ''}),
  production: createPhotoFinder({search}),
};
const results = [];
for (const [index, query] of queries.entries()) {
  const row = {index, query};
  for (const [name, finder] of Object.entries(finders)) {
    const started = Date.now();
    const found = await finder.find(query).catch(() => null);
    row[name] = {ms: Date.now() - started, found: Boolean(found), source: found?.source ?? null, bytes: found?.bytes.length ?? 0};
    if (found) { const file = `${String(index).padStart(2, '0')}-${name}.${found.type.split('/')[1]}`; await writeFile(join(out, file), found.bytes); row[name].file = file; }
  }
  results.push(row);
  console.log(index, query, 'brave', row.brave.found, row.brave.source, row.brave.ms, '| prod', row.production.found, row.production.source, row.production.ms);
}
await writeFile(join(out, 'results.json'), JSON.stringify({searches, results}, null, 1));
gateway.stop?.();
process.exit(0);
