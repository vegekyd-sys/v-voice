import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { createLiveH5Server } from "./server.mjs";
import { GPT_LIVE_PERSONAL_SESSION_KEY } from "./personal-session.mjs";

const token = "private-test-token-with-at-least-32-characters";
const origin = "https://openclaw.tianyi.live";
async function fixture(t, options = {}) {
  const calls = [];
  let id = 0;
  const bridge = createLiveH5Server({ basePath: "/voice", publicOrigin: origin, accessToken: token,
    ...options, gateway: { request: async (method, params) => {
      calls.push({ method, params });
      if (options.request) return options.request(method, params);
      return method === "talk.client.create" ? { voiceSessionId: `voice-${++id}`, model: "gpt-live-1-codex", transport: "webrtc", offerUrl: "/plugins/openai/realtime/calls", clientSecret: "server-only" } : { ok: true };
    } }, offer: async () => "v=0\r\nanswer" });
  await new Promise(resolve => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(() => bridge.dispose());
  const url = `http://127.0.0.1:${bridge.server.address().port}`;
  const request = (path, cookie, body, extra = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(url + path, { method: body === undefined ? "GET" : "POST",
      headers: { host: new URL(origin).host, origin, ...(cookie ? { cookie } : {}), "content-type": "application/json", ...extra } },
      response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })));
    req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const visitor = async () => {
    const response = await request("/voice/api/access", "", { access: token });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /Path=\/voice\/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure/u);
    return cookie.split(";", 1)[0];
  };
  return { bridge, calls, request, visitor };
}

test("the current page is personal; it keeps link access and cannot open a public session", async t => {
  const f = await fixture(t);
  const page = await f.request("/voice/");
  assert.equal(page.headers.get("set-cookie"), null);
  assert.equal((await f.request("/voice/api/status")).status, 401);
  assert.equal((await f.request("/voice/?entry=visitor")).status, 404);
  const owner = await f.visitor();
  const ownerCall = await (await f.request("/voice/api/session", owner, { entry: "visitor", speaker: "other", sessionKey: "agent:makaron:main" })).json();
  const creates = f.calls.filter(row => row.method === "talk.client.create");
  assert.equal(creates[0].params.sessionKey, GPT_LIVE_PERSONAL_SESSION_KEY);
  assert.equal((await f.request("/voice/api/session?entry=visitor", owner, {})).status, 404);
  assert.equal((await (await f.request("/voice/api/status?entry=tianyi", owner)).json()).activeCall, true);
  const samePage = await f.request("/voice/", owner);
  assert.equal(samePage.headers.get("set-cookie"), null);
  assert.equal((await f.request("/voice/api/close?entry=tianyi", owner, ownerCall)).status, 200);
});

test("original /voice/ path serves assets without creating a call and protects all APIs", async t => {
  const f = await fixture(t);
  const redirect = await f.request("/voice"); assert.equal(redirect.status, 308); assert.equal(redirect.headers.get("location"), "/voice/");
  for (const name of ["", "app.js", "styles.css", "events.mjs", "assets/v-idle-nohat-20260922.png"]) assert.equal((await f.request(`/voice/${name}`)).status, 200);
  assert.equal((await f.request("/api/status")).status, 404);
  assert.equal((await f.request("/voice/api/status?entry=tianyi")).status, 401);
  assert.equal((await f.request("/voice/api/access", "", { access: "wrong" })).status, 403);
  assert.equal((await f.request("/voice/api/access", "", { access: token }, { origin: "https://other.example" })).status, 403);
  assert.equal((await f.request("/voice/api/access", "", { access: token }, { origin: "" })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('iOS interface release is public static UI, uncached and does not authorize a call',async t=>{
  const f=await fixture(t);
  const response=await f.request('/voice/ios-shell-release.json');
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('set-cookie'),null);
  const release=await response.json();assert.equal(release.schema,1);assert.ok(release.files.length>50);
  assert.ok(release.files.every(file=>!file.path.startsWith('api/')));
  assert.equal(f.calls.length,0);
  assert.equal((await f.request('/voice/api/session','',{})).status,401);
});

test("redial keeps the group conversation but gets a new voice owner; another device cannot replace or close it", async t => {
  const f = await fixture(t);
  const payload = `${"a".repeat(32)}.${Date.now() + 60000}`;
  const oldCookie = `v_voice_access=${payload}.${createHmac("sha256", token).update(payload).digest("base64url")}`;
  assert.equal((await f.request("/voice/api/status?entry=tianyi", oldCookie)).status, 200);
  const second = await f.visitor();
  const a = await (await f.request("/voice/api/session?entry=tianyi", oldCookie, {})).json();
  assert.equal((await f.request("/voice/api/session?entry=tianyi", second, {})).status, 409);
  const creates = f.calls.filter(row => row.method === "talk.client.create");
  assert.equal(creates.length, 1);
  assert.equal((await f.request("/voice/api/close?entry=tianyi", second, { voiceSessionId: a.voiceSessionId })).status, 409);
  assert.equal((await f.request("/voice/api/close?entry=tianyi", oldCookie, a)).status, 200);
  const redial = await (await f.request("/voice/api/session?entry=tianyi", oldCookie, {})).json();
  assert.notEqual(redial.voiceSessionId, a.voiceSessionId);
  assert.equal(f.calls.filter(row => row.method === "talk.client.create")[1].params.sessionKey, creates[0].params.sessionKey);
  assert.equal(creates[0].params.sessionKey, GPT_LIVE_PERSONAL_SESSION_KEY);
  assert.equal((await f.request("/voice/api/close?entry=tianyi", oldCookie, a)).status, 409);
  assert.equal((await (await f.request("/voice/api/status?entry=tianyi", oldCookie)).json()).activeCall, true);
});

test("global admission counts a pending reservation and never evicts someone else's call", async t => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { maxActiveSessions: 1, maxActiveSessionsPerIp: 1, request: async method => {
    if (method === "talk.client.create") { began(); await held; return { voiceSessionId: "voice-held", model: "gpt-live-1-codex", transport: "webrtc", offerUrl: "/plugins/openai/realtime/calls" }; }
    return { ok: true };
  } });
  const a = await f.visitor(), b = await f.visitor();
  const first = f.request("/voice/api/session?entry=tianyi", a, {}); await started;
  assert.equal((await f.request("/voice/api/session?entry=tianyi", b, {})).status, 409);
  assert.equal((await f.request("/voice/api/session?entry=tianyi", a, {})).status, 409);
  release(); assert.equal((await first).status, 200);
  assert.equal(f.calls.filter(row => row.method === "talk.client.create").length, 1);
});

test("SSE tool events only reach the cookie owning the voice session", async t => {
  const f = await fixture(t), a = await f.visitor(), b = await f.visitor();
  const voiceA = await (await f.request("/voice/api/session?entry=tianyi", a, {})).json();
  const readerA = (await f.request("/voice/api/events?entry=tianyi", a)).body.getReader();
  const readerB = (await f.request("/voice/api/events?entry=tianyi", b)).body.getReader();
  await readerA.read(); await readerB.read();
  f.bridge.emit({ event: "talk.event", payload: { voiceSessionId: voiceA.voiceSessionId, talkEvent: { type: "tool.call", callId: "only-a" } } });
  const textA = new TextDecoder().decode((await readerA.read()).value);
  assert.match(textA, /only-a/u); assert.doesNotMatch(textA, /only-b/u);
  assert.equal(await Promise.race([readerB.read().then(() => "leaked"), new Promise(resolve => setTimeout(() => resolve("quiet"), 30))]), "quiet");
  await readerA.cancel(); await readerB.cancel();
});

test('first-frame styles are exact and only verified cookies receive an entry hint',async t=>{
 const f=await fixture(t);
 const anonymous=await f.request('/voice/');const publicHtml=await anonymous.text();
 assert.equal(anonymous.headers.get('cache-control'),'no-store');
 assert.match(publicHtml,/<style data-voice-entry>/u);
 assert.doesNotMatch(publicHtml,/id="voiceEntryStatus"/u);
 const css=await (await f.request('/voice/styles.css')).text();
 assert.equal(publicHtml.split('<style data-voice-entry>')[1].split('</style>')[0],css);
 const cookie=await f.visitor();
 const html=await (await f.request('/voice/',cookie)).text();
 const hint=JSON.parse(html.match(/id="voiceEntryStatus">([^<]+)<\/script>/u)[1]);
 assert.equal(hint.accessContext.entryKind,'fixed');
 assert.equal(hint.accessContext.mode,'connected');
 const {accessContext,...legacyHint}=hint;
 assert.deepEqual(legacyHint,{ready:true,preview:false,defaultModel:'gpt-live',conversation:{name:'我的 V',kind:'group',replySync:false,accountLabel:'预配置账号',entryKind:'fixed',scopeNote:'账号、通话人和会话由此入口预配置；切换浏览器账号不会替换它们。'},iosBindingAvailable:true});
 assert.doesNotMatch(html,new RegExp(token));
 const denied=await (await f.request('/voice/',cookie+'broken')).text();
 assert.doesNotMatch(denied,/id="voiceEntryStatus"/u);
 assert.equal((await f.request('/voice/api/session',cookie+'broken',{})).status,401);
 assert.equal(f.calls.length,0);
});

test('pre-generated listening samples require entry access and never create a voice session',async t=>{
 const accesses=[];const f=await fixture(t,{listening:{manifest:{schema:'voice-listening-v1',clips:[{id:'clip'}]},audio:async(id,range)=>{accesses.push({id,range});return id==='clip'?{status:206,headers:{'content-type':'audio/wav','content-range':'bytes 0-3/10','content-length':'4'},body:Buffer.from('RIFF')}:null;}}});
 assert.equal((await f.request('/voice/api/comparison')).status,401);assert.equal((await f.request('/voice/api/comparison/audio/clip')).status,401);assert.equal(accesses.length,0);
 const cookie=await f.visitor();assert.equal((await f.request('/voice/api/comparison',cookie)).status,200);
 const audio=await f.request('/voice/api/comparison/audio/clip',cookie,undefined,{range:'bytes=0-3'});assert.equal(audio.status,206);assert.equal(await audio.text(),'RIFF');assert.deepEqual(accesses,[{id:'clip',range:'bytes=0-3'}]);
 assert.equal((await f.request('/voice/api/comparison/audio/unknown',cookie)).status,404);assert.equal(f.calls.length,0);
});
test('candidate release notes are opt-in, inert JSON and preserve hosted admission',async t=>{
 const release={version:'linux-candidate',date:'2026-10-18',title:'Linux candidate',items:['A </script> tag stays text']};
 const f=await fixture(t,{candidateRelease:release});const html=await(await f.request('/voice/')).text();
 const raw=html.match(/id="voiceCandidateRelease">([^<]+)<\/script>/u)[1];
 assert.deepEqual(JSON.parse(raw),release);assert.doesNotMatch(raw,/<\/script>/u);
 assert.equal((await f.request('/voice/api/status')).status,401);
 const normal=await fixture(t);assert.doesNotMatch(await(await normal.request('/voice/')).text(),/id="voiceCandidateRelease"/u);
});

test("a camera device's photo upload reaches the device endpoint outside the page path, only on the public host", async t => {
  const uploads = [];
  const deviceEndpoint = { path: "/device/voice", otaPath: null, visionPath: "/device/vision", activeCalls: () => 0, busy: () => false, dispose: async () => {},
    handleVision: (req, res) => { uploads.push(req.headers.host); res.writeHead(200, { "content-type": "application/json" }); res.end('{"success":true,"result":"ok"}'); } };
  const f = await fixture(t, { deviceEndpoint });
  // Firmware sends no browser Origin and may omit the port from Host.
  const upload = await f.request("/device/vision", "", {}, { origin: "", host: new URL(origin).hostname });
  assert.equal(upload.status, 200);
  assert.deepEqual(await upload.json(), { success: true, result: "ok" });
  assert.equal((await f.request("/device/vision", "", {}, { host: "attacker.example" })).status, 403);
  assert.equal(uploads.length, 1);
});


test('a retired direct transport releases its visitor lock before heartbeat expiry, without evicting a live or cleanup-pending call',async t=>{
 const live=new Set();let id=0;const directVoice={models:()=>[{id:'seeduplex',available:true}],reserve:async()=>{const voiceSessionId='direct-'+(++id);live.add(voiceSessionId);return {voiceSessionId,transport:'gateway-relay'};},hasSession:id=>live.has(id),close:async id=>live.delete(id),dispose:async()=>{}};
 const f=await fixture(t,{directVoice}),a=await f.visitor(),b=await f.visitor();
 const old=await(await f.request('/voice/api/session?entry=tianyi',a,{model:'seeduplex'})).json();
 assert.equal((await f.request('/voice/api/session?entry=tianyi',b,{model:'seeduplex'})).status,409);
 // The transport has finished its own cleanup, while the dead phone cannot POST close.
 live.delete(old.voiceSessionId);
 const status=await(await f.request('/voice/api/status?entry=tianyi',a)).json();assert.equal(status.activeCall,false);assert.equal(status.releaseReadiness.activeCalls,0);
 const next=await(await f.request('/voice/api/session?entry=tianyi',b,{model:'seeduplex'})).json();assert.notEqual(next.voiceSessionId,old.voiceSessionId);
 assert.equal((await f.request('/voice/api/close?entry=tianyi',a,old)).status,409);
 assert(live.has(next.voiceSessionId));
});
