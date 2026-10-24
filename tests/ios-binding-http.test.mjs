import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import WebSocket from 'ws';
import {mkdtemp, readFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';

const origin = 'https://voice.example.com';
const legacyAccess = 'legacy-fixture-'.repeat(4);
const entries = ['dm', 'group', 'other'].map((kind, index) => ({
  id: 'phone-binding-' + kind, agentId: 'makaron',
  sessionKey: 'agent:makaron:feishu:group:oc_binding_' + kind,
  accountId: 'default', kind: kind === 'dm' ? 'dm' : 'group',
  displayName: kind === 'dm' ? '我的工作会话' : '产品讨论群 ' + index,
  callerId: 'tianyi', permissionProfile: 'personal-tianyi', accessToken: String(index + 1).repeat(40),
}));
const actor = {openId: 'ou_binding_test', tenantKey: 'tenant_binding_test', callerId: 'tianyi',
  defaultPhoneId: entries[0].id, phoneIds: entries.slice(0, 2).map(entry => entry.id)};
const cookie = response => response.headers.get('set-cookie').split(';')[0];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'voice-ios-binding-http-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = join(directory, 'grants.private.json'), calls = [], oauthRequests = [];
  let serial = 0;const sockets=new Set();
  const bridge = createLiveH5Server({basePath: '/voice', publicOrigin: origin,
    accessToken: legacyAccess, conversationEntries: entries, iosBindingsFile: file,
    gateway: {request: async (method, args) => {
      calls.push({method, args});
      if (method === 'sessions.describe') return {session:{key: args.key, agentId: 'makaron'}};
      if (method === 'talk.client.create') return {voiceSessionId: 'native-' + (++serial), model: 'gpt-live-1-codex', transport: 'webrtc', offerUrl: '/plugins/openai/realtime/calls'};
      return {ok: true};
    }},
    directVoice: {models: () => [], reserve: async args => {
      calls.push({method: 'direct.reserve', args}); return {voiceSessionId: 'direct-' + (++serial), provider: args.model,transport:'gateway-relay',relayTicket:'fixture'};
    }, attach:(id,_ticket,ws)=>{sockets.add(ws);ws.on('close',()=>sockets.delete(ws));ws.send(JSON.stringify({type:'ready',voiceSessionId:id}));return true;}, close: async () => {}, handleEvent: () => {}, dispose: async () => {for(const ws of sockets)ws.terminate();}},
    feishuLogin: {appId: 'cli_bindingtest', appSecret: 'fixture-server-secret', actors: [actor],
      fetchImpl: async (url, init) => {
        oauthRequests.push({url, init});
        return Response.json(url.includes('/token')
          ? {code: 0, access_token: 'fixture-provider-token', token_type: 'Bearer'}
          : {code: 0, data: {open_id: actor.openId, tenant_key: actor.tenantKey}});
      }},
  });
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  t.after(() => bridge.dispose());
  const request = (path, jar = '', body) => new Promise((resolve, reject) => {
    const req = httpRequest({host: '127.0.0.1', port: bridge.server.address().port,
      path, method: body === undefined ? 'GET' : 'POST',
      headers: {host: new URL(origin).host, origin, cookie: jar, 'content-type': 'application/json'}},
    res => resolve(new Response(Readable.toWeb(res), {status: res.statusCode, headers: res.headers})));
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const api = (entry, route, jar = '', body) => request('/voice/api/' + route + (entry ? '?phone=' + entry.id : ''), jar, body);
  const login = async entry => {
    const start = await request('/voice/feishu?phone=' + entry.id);
    assert.equal(start.status, 302);
    const authorization = new URL(start.headers.get('location'));
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    const finish = await request('/voice/feishu/callback?code=fixture-code&state=' + authorization.searchParams.get('state'), cookie(start));
    assert.equal(finish.status, 302);
    const actorCookie = cookie(finish), selected = await request(finish.headers.get('location'), actorCookie);
    assert.equal(selected.status, 200);
    assert.equal(selected.headers.get('location'), null);
    await selected.text();
    return actorCookie + '; ' + cookie(selected);
  };
  const nativeEntries = new Map();
  const issue = async (entry, jar) => {
    const response = await api(entry, 'ios-binding', jar, {}); assert.equal(response.status, 200);
    const value = await response.json(), url = new URL(value.bindingUrl);
    if(entry)assert.match(url.searchParams.get('phone'),/^ios-[a-f0-9]{40}$/u);
    else assert.equal(url.searchParams.get('phone'),null);
    nativeEntries.set(entry?.id,entry?{id:url.searchParams.get('phone')}:null);
    assert.equal(url.origin, origin); assert.equal(url.pathname, '/voice/');
    assert.ok(value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 300000);
    const serialized = JSON.stringify(value);
    for (const record of entries) { assert.ok(!serialized.includes(record.sessionKey)); assert.ok(!serialized.includes(record.accessToken)); }
    assert.ok(!serialized.includes('fixture-provider-token'));
    return {token: new URLSearchParams(url.hash.slice(1)).get('bind'), ...value};
  };
  const redeem = async (entry, token) => {
    const response = await api(nativeEntries.get(entry?.id), 'ios-binding/redeem', '', {token}); assert.equal(response.status, 200);
    const value = await response.json(); assert.match(value.deviceAccess, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(response.headers.get('set-cookie'), null, 'redeem never copies an OAuth cookie');
    return value;
  };
  const authorize = async (entry, deviceAccess) => {
    const nativeEntry=nativeEntries.get(entry?.id);
    const response = await api(nativeEntry, 'ios-binding/access', '', {deviceAccess}); assert.equal(response.status, 200);
    const jar = cookie(response); assert.ok(jar.startsWith((nativeEntry ? 'v_voice_' + nativeEntry.id : 'v_voice_access') + '='));
    assert.equal((await api(nativeEntry,'status',jar)).status,200);
    assert.ok(!jar.includes('v_feishu_phone'));
    return jar;
  };
  const fast=(entry,jar)=>new Promise(resolve=>{
    const ws=new WebSocket(`ws://127.0.0.1:${bridge.server.address().port}/voice/api/dial?phone=${entry.id}&model=seeduplex&dialVersion=1&nativeRuntimeVersion=1`,{headers:{host:new URL(origin).host,origin,cookie:jar},handshakeTimeout:1500});
    t.after(()=>ws.terminate());
    ws.on('message',raw=>{const v=JSON.parse(raw);if(v.type==='reservation')resolve({status:200,value:v,ws});});
    ws.on('unexpected-response',(_,res)=>{res.resume();resolve({status:res.statusCode,ws});ws.terminate();});ws.on('error',()=>resolve({status:0,ws}));
  });
  return {api, login, issue, redeem, authorize, calls, oauthRequests, file, fast};
}

for (const entry of entries.slice(0, 2)) test(`OAuth-to-iOS HTTP handoff retains exact ${entry.kind} conversation for native and relay calls`, async t => {
  const f = await fixture(t), browser = await f.login(entry);
  const handoff = await f.issue(entry, browser), grant = await f.redeem(entry, handoff.token);
  assert.deepEqual(grant.conversation, {name: entry.displayName, kind: entry.kind});
  const device = await f.authorize(entry, grant.deviceAccess);
  const status = await f.api(entry, 'status', device); assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).conversation, {name: entry.displayName, kind: entry.kind, replySync: false});
  assert.equal(f.calls.length, 0, 'binding and status must not start media');
  assert.equal(f.oauthRequests.length, 2, 'native device access uses its own grant, not a provider login');
  for (const model of ['gpt-live', 'seeduplex']) {
    const response = await f.api(entry, 'session', device, {model, sessionKey: entries[2].sessionKey, callerId: 'forged'});
    assert.equal(response.status, 200); const call = await response.json();
    const creation = f.calls.findLast(row => row.method === (model === 'gpt-live' ? 'talk.client.create' : 'direct.reserve'));
    assert.equal(creation.args.sessionKey, entry.sessionKey);
    assert.equal(f.calls.findLast(row => row.method === 'sessions.describe').args.key, entry.sessionKey);
    assert.equal((await f.api(entry, 'close', device, {voiceSessionId: call.voiceSessionId})).status, 200);
  }
  const disk = await readFile(f.file, 'utf8');
  assert.ok(!disk.includes(grant.deviceAccess)); assert.ok(!disk.includes(handoff.token));
  assert.ok(!disk.includes(entry.accessToken)); assert.ok(!disk.includes('fixture-provider-token'));
});

test('one-time binding and its device credential fail closed across entries, replay and forged identity parameters', async t => {
  const f = await fixture(t), entry = entries[1], browser = await f.login(entry), handoff = await f.issue(entry, browser);
  assert.equal((await f.api(entries[0], 'ios-binding/redeem', '', {token: handoff.token})).status, 403);
  assert.equal((await f.api(entry, 'ios-binding/redeem', '', {token: handoff.token, sessionKey: entries[2].sessionKey})).status, 400);
  const grant = await f.redeem(entry, handoff.token);
  assert.equal((await f.api(entry, 'ios-binding/redeem', '', {token: handoff.token})).status, 403);
  assert.equal((await f.api(entries[0], 'ios-binding/access', '', {deviceAccess: grant.deviceAccess})).status, 401);
  const device = await f.authorize(entry, grant.deviceAccess);
  assert.equal((await f.api(entries[0], 'status', device)).status, 401);
  assert.equal((await f.api(entries[2], 'status', device)).status, 401);
  assert.equal(f.calls.length, 0);
});

test('only the authorized browser can revoke or issue bindings; revoked device loses status, renewal and calls', async t => {
  const f = await fixture(t), entry = entries[1], browser = await f.login(entry);
  const handoff = await f.issue(entry, browser), grant = await f.redeem(entry, handoff.token);
  const device = await f.authorize(entry, grant.deviceAccess);
  assert.equal((await f.api(entry, 'ios-binding', device, {})).status, 403, 'a device cannot provision another device');
  assert.equal((await f.api(entry, 'ios-binding', device)).status, 403);
  const listing = await f.api(entry, 'ios-binding', browser); assert.equal(listing.status, 200);
  const {devices} = await listing.json(); assert.equal(devices.length, 1);
  assert.equal((await f.api(entry, 'ios-binding/revoke', device, {deviceId: devices[0].id})).status, 403);
  assert.equal((await f.api(entry, 'ios-binding/revoke', browser, {deviceId: devices[0].id})).status, 200);
  assert.equal((await f.api(entry, 'status', device)).status, 401);
  assert.equal((await f.api(entry, 'ios-binding/access', '', {deviceAccess: grant.deviceAccess})).status, 401);
  assert.equal((await f.api(entry, 'session', device, {model: 'seeduplex'})).status, 401);
  assert.equal(f.calls.length, 0);
});

test('legacy personal link and device handoff coexist without letting a device mint another binding', async t => {
  const f = await fixture(t);
  const legacy = await f.api(null, 'access', '', {access: legacyAccess}); assert.equal(legacy.status, 200);
  const browser = cookie(legacy), handoff = await f.issue(null, browser), grant = await f.redeem(null, handoff.token);
  const device = await f.authorize(null, grant.deviceAccess);
  assert.equal((await f.api(null, 'status', device)).status, 200);
  assert.equal((await f.api(null, 'status', browser)).status, 200, 'creating the app binding must preserve the old link');
  assert.equal((await f.api(null, 'ios-binding', device, {})).status, 403);
  assert.equal(f.calls.length, 0);
});

test('device-grant persistence failure is unavailable, not an expired link or a successful binding', async t => {
  const f = await fixture(t), entry = entries[1], browser = await f.login(entry);
  const handoff = await f.issue(entry, browser);
  // The destination becomes unwritable after startup, as with a service sandbox.
  await mkdir(f.file);
  const response = await f.api(entry, 'ios-binding/redeem', '', {token: handoff.token});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /无法保存 App 绑定/);
  const list = await f.api(entry, 'ios-binding', browser);
  assert.deepEqual((await list.json()).devices, []);
  assert.equal((await f.api(entry, 'status', browser)).status, 200);
  assert.equal(f.calls.length, 0);
  await rm(f.file, {recursive: true});
  const retry = await f.issue(entry, browser);
  const recovered = await f.redeem(entry, retry.token);
  assert.deepEqual(recovered.conversation, {name: entry.displayName, kind: entry.kind});
});


test('fast socket revalidates the iOS device grant, exact entry and revocation',async t=>{
 const f=await fixture(t),entry=entries[1],browser=await f.login(entry);
 const handoff=await f.issue(entry,browser),grant=await f.redeem(entry,handoff.token),device=await f.authorize(entry,grant.deviceAccess);
 assert.equal((await f.fast(entries[0],device)).status,401);
 const accepted=await f.fast(entry,device);assert.equal(accepted.status,200);
 assert.equal(f.calls.find(c=>c.method==='direct.reserve').args.sessionKey,entry.sessionKey);
 accepted.ws.terminate();await new Promise(resolve=>setTimeout(resolve,10));
 await f.api(entry,'close',device,{voiceSessionId:accepted.value.voiceSessionId});
 const {devices}=await(await f.api(entry,'ios-binding',browser)).json();
 assert.equal((await f.api(entry,'ios-binding/revoke',browser,{deviceId:devices[0].id})).status,200);
 assert.equal((await f.fast(entry,device)).status,401);
 assert.equal(f.calls.filter(c=>c.method==='direct.reserve').length,1);
});
