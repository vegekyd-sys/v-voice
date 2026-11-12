import {request} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';
import {createIosBindings} from '../lib/ios-bindings.mjs';

const digest = s => createHash('sha256').update(s).digest('hex');
const usageToken = s => digest('vvoice-usage-v1:' + digest(s));

test('only personal widget credentials can read the projected snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-usage-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const secret = 'owner-fixture-'.repeat(3);
  const file = join(directory, 'usage.json');
  const updated = Math.floor(Date.now() / 1000);
  await writeFile(file, JSON.stringify({version:1, updated, privateField:'private-fixture', providers:[
    {name:'Claude Code', state:'ready', windows:[{label:'周', used:0, reset:updated+60, email:'private-fixture'}]},
    {name:'Grok', state:'unavailable'},
  ]}), {mode:0o600});
  const bridge = createLiveH5Server({basePath:'/voice', publicOrigin:'https://voice.example.com',
    accessToken:secret, gateway:{}, relayUsageFile:file});
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  t.after(() => bridge.dispose());
  const url = 'http://127.0.0.1:' + bridge.server.address().port + '/voice/api/relay-usage';
  const read = (token, suffix='') => new Promise((resolve, reject) => {
    const req = request(url + suffix, {headers:{host:'voice.example.com', authorization:'Bearer '+token}}, res => {
      const parts = [];
      res.on('data', part => parts.push(part));
      res.on('end', () => resolve(new Response(Buffer.concat(parts), {status:res.statusCode, headers:res.headers})));
    });
    req.on('error', reject);
    req.end();
  });
  for (const token of ['', secret, usageToken('guest')]) assert.equal((await read(token)).status, 403);
  assert.equal((await read(usageToken(secret), '?phone=public')).status, 403);
  const reply = await read(usageToken(secret));
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  const data = await reply.json();
  assert(!JSON.stringify(data).includes('private-fixture'));
  assert.equal(data.providers.find(p => p.name === 'Claude Code').windows[0].used, 0);
  assert.equal(data.providers.find(p => p.name === 'Grok').state, 'unavailable');
  await chmod(file, 0o644);
  assert.equal((await read(usageToken(secret))).status, 503);
});

test('a widget grant follows the owner device expiry, rotation and revocation', async () => {
  let at = 1000;
  const store = createIosBindings({now:()=>at, permits:()=>true, basePath:'/voice', publicOrigin:'https://voice.example.com'});
  const owner = {id:'tianyi', permissionProfile:'personal-tianyi', accessToken:'x'.repeat(40)};
  const principal = {type:'entry', entry:'tianyi'};
  const handoff = new URL(store.issue(owner,principal).bindingUrl);
  const device = await store.redeem(owner, new URLSearchParams(handoff.hash.slice(1)).get('bind'));
  const token = usageToken(device.deviceAccess);
  assert(store.allowsUsageWidget(owner,token));
  assert(!store.allowsUsageWidget({...owner,id:'group'},token));
  assert(!store.allowsUsageWidget({...owner,accessToken:'y'.repeat(40)},token));
  assert.equal(store.authorize(owner,token,{}),null);
  at = device.expiresAt;
  assert(!store.allowsUsageWidget(owner,token));
  at = 1001;
  await store.revoke(owner,principal,store.list(owner,principal)[0].id);
  assert(!store.allowsUsageWidget(owner,token));
});
