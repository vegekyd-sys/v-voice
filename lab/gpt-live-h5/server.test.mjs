import assert from "node:assert/strict";
import test from "node:test";
import { createLiveH5Server } from "./server.mjs";
import {createDirectVoiceService} from '../realtime-direct-tools/session.mjs';
import { transcriptEvent } from "./events.mjs";
import { AVATAR_FILES } from "./avatar-state.mjs";
import { GPT_LIVE_PERSONAL_SESSION_KEY } from "./personal-session.mjs";

async function fixture(t, overrides = {}) {
  const calls = [];
  const reservation = { voiceSessionId: "voice-private", model: "gpt-live-1-codex", transport: "webrtc", offerUrl: "/plugins/openai/realtime/calls", clientSecret: "never-expose-test-secret" };
  const gateway = { request: async (method, params) => {
    calls.push({ method, params });
    if (overrides.request) return overrides.request(method, params, reservation);
    return method === "talk.client.create" ? reservation : { ok: true };
  } };
  if (overrides.gatewayReady !== undefined) gateway.ready = overrides.gatewayReady;
  const offers = [];
  const bridge = createLiveH5Server({ gateway, offer: async (session, sdp) => { offers.push({ session, sdp }); return "v=0\r\nanswer"; }, preview: overrides.preview, defaultModel: overrides.defaultModel, avatarLog: overrides.avatarLog, avatarEvaluate: overrides.avatarEvaluate, directVoice: overrides.directVoice, gptProvider:overrides.gptProvider, speakerRouting:overrides.speakerRouting, phoneInputPolicy:overrides.phoneInputPolicy,callControlEvaluate:overrides.callControlEvaluate });
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(() => bridge.dispose());
  const url = `http://127.0.0.1:${bridge.server.address().port}`;
  const page = await fetch(url); const cookie = page.headers.get("set-cookie").split(";", 1)[0]; await page.text();
  const request = (route, payload = {}, headers = {}) => fetch(`${url}/api/${route}`, { method: "POST", headers: { cookie, "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
  return { bridge, gateway, calls, offers, url, cookie, request, reservation };
}

test("exact native model reservation and SDP proxy keep credentials off the browser", async (t) => {
  const f = await fixture(t);
  const created = await f.request("session"); assert.equal(created.status, 200);
  const result = await created.json(); assert.deepEqual(result, { voiceSessionId: "voice-private", model: "gpt-live-1-codex" });
  assert.equal(f.calls[0].params.model, "gpt-live-1-codex"); assert.equal(f.calls[0].params.transport, "webrtc");
  assert.equal(f.calls[0].params.sessionKey, GPT_LIVE_PERSONAL_SESSION_KEY);
  const answer = await f.request("offer", { voiceSessionId: result.voiceSessionId, sdp: "v=0\r\noffer" });
  assert.deepEqual(await answer.json(), { sdp: "v=0\r\nanswer" });
  assert.equal(f.offers[0].session.clientSecret, "never-expose-test-secret");
  const closed = await f.request("close", { voiceSessionId: result.voiceSessionId }); assert.equal(closed.status, 200);
  assert.equal((await f.request("offer", { voiceSessionId: result.voiceSessionId, sdp: "v=0" })).status, 409);
});

test("preview never creates a paid session and returns an explicit preview error", async (t) => {
  const f = await fixture(t, { preview: true });
  assert.equal((await f.request("session")).status, 503); assert.equal(f.calls.length, 0);
});

test('native preference is advertised while legacy clients retain speaker and capable clients opt in', async t => {
  const reservations=[];
  const directVoice={models:()=>[],reserve:async params=>{reservations.push(params);return {voiceSessionId:'native-phone',provider:params.model};},close:async()=>{},dispose:async()=>{}};
  const speakerRouting={snapshot:()=>({}),close(){},dispose(){}};
  const f=await fixture(t,{directVoice,speakerRouting,phoneInputPolicy:'native'});
  const status=await (await fetch(`${f.url}/api/status`,{headers:{cookie:f.cookie}})).json();
  assert.equal(status.phoneInputPolicy,'native');
  for(const params of [{model:'seeduplex'},{model:'seeduplex',inputPolicy:'native'},{model:'seeduplex',inputPolicy:'speaker'},{model:'grok'}]){
    assert.equal((await f.request('session',params)).status,200);
    assert.equal((await f.request('close',{voiceSessionId:'native-phone'})).status,200);
  }
  assert.deepEqual(reservations.map(p=>p.inputPolicy),['speaker','native','speaker','speaker']);
  assert(reservations.every(p=>p.sessionKey===GPT_LIVE_PERSONAL_SESSION_KEY));
  assert.equal((await f.request('session',{model:'seeduplex',inputPolicy:'untrusted'})).status,400);
});

test("page cookie, origin and voice ownership guard experiment requests", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.url}/api/session`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await f.request("session", {}, { origin: "http://example.com" })).status, 403);
  await f.request("session");
  assert.equal((await f.request("offer", { voiceSessionId: "other", sdp: "v=0" })).status, 409);
  assert.equal((await f.request("offer", { voiceSessionId: "voice-private", sdp: "bad" })).status, 400);
  assert.equal(f.offers.length, 0);
});

test("a mismatched inherited provider model is closed and rejected", async (t) => {
  const f = await fixture(t, { request: (method, params, reservation) => method === "talk.client.create" ? { ...reservation, model: "xiaohe-agent" } : { ok: true } });
  assert.equal((await f.request("session")).status, 409);
  assert.equal(f.calls.filter((item) => item.method === "talk.client.close").length, 1);
});

test("concurrent starts cannot leak a second provider reservation", async (t) => {
  let releaseCreate;
  const creating = new Promise((resolve) => { releaseCreate = resolve; });
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const f = await fixture(t, { request: async (method, params, reservation) => {
    if (method === "talk.client.create") { began(); await creating; return reservation; } return { ok: true };
  } });
  const first = f.request("session"); await started;
  assert.equal((await f.request("session")).status, 409);
  releaseCreate(); assert.equal((await first).status, 200);
  assert.equal(f.calls.filter((item) => item.method === "talk.client.create").length, 1);
});

test("failed cancellation or steering is never presented as successful delivery", async (t) => {
  const f = await fixture(t, { request: (method, params, reservation) => method === "talk.client.create" ? reservation : method === "talk.client.steer" ? { ok: false, reason: "abort_rejected", aborted: false } : { ok: true } });
  await f.request("session");
  for (const mode of ["cancel", "steer"]) {
    const response = await f.request("steer", { voiceSessionId: "voice-private", mode, text: "停止" });
    assert.equal(response.status, 409); assert.match((await response.json()).error, /没有|暂时/u);
  }
});

test("failed close retains ownership so cleanup can retry", async (t) => {
  let failures = 1;
  const f = await fixture(t, { request: (method, params, reservation) => {
    if (method === "talk.client.create") return reservation;
    if (method === "talk.client.close" && failures-- > 0) throw new Error("temporary failure");
    return { ok: true };
  } });
  await f.request("session");
  assert.equal((await f.request("close", { voiceSessionId: "voice-private" })).status, 500);
  assert.equal((await f.request("close", { voiceSessionId: "voice-private" })).status, 200);
});

test("a rejected model keeps failed cleanup owned until the next start retries", async (t) => {
  let creates = 0;
  let closes = 0;
  const f = await fixture(t, { request: (method, params, reservation) => {
    if (method === "talk.client.create") return ++creates === 1 ? { ...reservation, model: "xiaohe-agent" } : reservation;
    if (method === "talk.client.close" && ++closes === 1) throw new Error("temporary failure");
    return { ok: true };
  } });
  assert.equal((await f.request("session")).status, 500);
  assert.equal((await f.request("session")).status, 200);
  assert.equal(closes, 2);
  assert.equal(creates, 2);
});

test("native transcript projection excludes reasoning and preserves final text", () => {
  assert.equal(transcriptEvent({ type: "session.thinking.append", content: "hidden" }), null);
  assert.deepEqual(transcriptEvent({ type: "input_transcript.added", item: { id: "fragment", text: "请查周四" } }), { role: "user", id: "fragment", text: "请查周四", final: false });
  assert.deepEqual(transcriptEvent({ type: "turn.done", turn: { role: "user", transcript: "请查周四" } }), { role: "user", id: undefined, text: "请查周四", final: true });
});


test("the frozen H5 serves its own stylesheet and every browser module", async t => {
  const f = await fixture(t, {preview:true});
  for (const name of ["app.js", "ui-bundle.mjs", "call-view.mjs", "events.mjs", "duplex-playback.mjs", "microphone-capture.mjs", "transcript-presentation.mjs", "call-sounds.mjs", "styles.css"]) {
    const response = await fetch(`${f.url}/${name}`);
    assert.equal(response.status, 200, name); assert.match(response.headers.get("content-type"), name.endsWith("css") ? /text\/css/u : /javascript/u);
    assert((await response.text()).length > 0);
  }
  const css = await (await fetch(`${f.url}/styles.css`)).text(); assert.match(css, /\.turn-text/u);
  assert.equal(f.calls.length, 0, "Static preview does not create a model session");
});

test('pickup readiness uses an exact owned host operation without exposing broker fields', async t => {
  const f=await fixture(t); await f.request('session');
  const r=await f.request('ready',{voiceSessionId:'voice-private'});
  assert.equal(r.status,200); assert.deepEqual(await r.json(),{ok:true});
  const invocation=f.calls.find(row=>row.method==='talk.client.toolCall');
  assert.equal(invocation.params.name,'openclaw_live_call_control');
  assert.equal(invocation.params.voiceSessionId,'voice-private');
  assert.deepEqual(invocation.params.args,{action:'ready'});
  assert.match(invocation.params.callId,/^host-ready-/u);
  assert.equal(invocation.params.sessionKey, GPT_LIVE_PERSONAL_SESSION_KEY);
  assert.equal((await f.request('ready',{voiceSessionId:'old'})).status,409);
  assert.equal(f.calls.filter(row=>row.method==='talk.client.toolCall').length,1);
});

test('a rejected native readiness does not claim a greeting was sent or close the session',async t=>{
  const f=await fixture(t,{request:(method,params,reservation)=>method==='talk.client.create'?reservation:method==='talk.client.toolCall'?{ok:false}:{ok:true}});
  await f.request('session');
  const r=await f.request('ready',{voiceSessionId:'voice-private'});
  assert.equal(r.status,409); assert.match((await r.json()).error,/未就绪/u);
  assert.equal(f.calls.filter(row=>row.method==='talk.client.close').length,0);
});

test('only the owned end-call tool can carry closing metadata over SSE',async t=>{
  const f=await fixture(t); await f.request('session');
  const stop=new AbortController();
  const response=await fetch(f.url+'/api/events',{headers:{cookie:f.cookie},signal:stop.signal});
  const reader=response.body.getReader(); await reader.read();
  const emit=(voice,type,payload)=>f.bridge.emit({event:'talk.event',payload:{voiceSessionId:voice,talkEvent:{type,callId:'tool-id',payload}}});
  emit('other','tool.result',{name:'openclaw_end_call',requestId:'wrong',closeAfterPlayback:true});
  emit('voice-private','tool.result',{name:'openclaw_agent_consult',requestId:'fake',closeAfterPlayback:true,hidden:'not-for-browser'});
  const ordinary=new TextDecoder().decode((await reader.read()).value);
  assert.doesNotMatch(ordinary,/requestId|closeAfterPlayback|hidden|wrong/u);
  emit('voice-private','tool.result',{name:'openclaw_end_call',requestId:'end-id',originUserTurnId:'native-user-id',closeAfterPlayback:true,hidden:'not-for-browser'});
  const ended=new TextDecoder().decode((await reader.read()).value);
  assert.match(ended,/openclaw_end_call/u); assert.match(ended,/end-id/u); assert.match(ended,/closeAfterPlayback/u); assert.match(ended,/native-user-id/u); assert.doesNotMatch(ended,/hidden/u);
  stop.abort(); await reader.cancel().catch(()=>{});
});

test('owned backend model end receipts preserve real tool/run and native identity without leaking arbitrary data', async t => {
  const f = await fixture(t); await f.request('session');
  const stop = new AbortController();
  const response = await fetch(f.url + '/api/events', { headers: { cookie: f.cookie }, signal: stop.signal });
  const reader = response.body.getReader(); await reader.read();
  f.bridge.emit({ event: 'talk.event', payload: { voiceSessionId: 'voice-private', talkEvent: {
    type: 'tool.result', callId: 'call_real_end', payload: { name: 'openclaw_end_call', source: 'backend_model_client_tool',
      status: 'accepted', requestId: 'item_native', nativeDelegationId: 'item_native', originUserTurnId: 'turn_native',
      delegationGeneration: 3, backendToolCallId: 'call_real_end', backendRunId: 'talk-realtime-consult:actual:parent',
      nativeAssistantTurnIdAtAcceptance:'native_combined',
      closeAfterPlayback: true, userTurnText: 'private caller phrase', args: { secret: 'must not leak' }, hidden: 'not-for-browser' } } } });
  const body = new TextDecoder().decode((await reader.read()).value);
  const value = JSON.parse(body.slice(body.indexOf('data: ') + 6).trim());
  assert.equal(value.source, 'backend_model_client_tool'); assert.equal(value.status, 'accepted');
  assert.equal(value.callId, 'call_real_end'); assert.equal(value.backendToolCallId, 'call_real_end');
  assert.equal(value.requestId, 'item_native'); assert.equal(value.nativeDelegationId, 'item_native');
  assert.equal(value.originUserTurnId, 'turn_native'); assert.equal(value.delegationGeneration, 3);
  assert.equal(value.backendRunId, 'talk-realtime-consult:actual:parent');
  assert.equal(value.nativeAssistantTurnIdAtAcceptance,'native_combined');
  assert.doesNotMatch(body, /private caller|secret|hidden|not-for-browser/u);
  stop.abort(); await reader.cancel().catch(() => {});
});

test('SSE avatar activity belongs to the current voice and excludes tool arguments',async t=>{
  const f=await fixture(t);await f.request('session');
  const stop=new AbortController();
  const response=await fetch(f.url+'/api/events',{headers:{cookie:f.cookie},signal:stop.signal});
  const reader=response.body.getReader();await reader.read();
  const emit=(voice,name)=>f.bridge.emit({event:'talk.event',payload:{voiceSessionId:voice,talkEvent:{type:'tool.call',callId:'visual',payload:{name,args:{query:'private-avatar-query'},result:'private-result'}}}});
  emit('foreign','web_search');emit('voice-private','memory_search');
  const received=new TextDecoder().decode((await reader.read()).value);
  assert.match(received,/"activity":"memory"/u);
  assert.doesNotMatch(received,/foreign|private-avatar-query|private-result|args|web/u);
  stop.abort();await reader.cancel().catch(()=>{});
});

test('all new avatar assets and modules are served by the frozen whitelist',async t=>{
  const f=await fixture(t);
  for(const name of ['avatar.mjs','avatar-state.mjs','avatar-catalog.mjs','avatar-reactions.mjs',...AVATAR_FILES.map(s=>'assets/'+s)]){
    const r=await fetch(`${f.url}/${name}`);assert.equal(r.status,200,name);
    const bytes=new Uint8Array(await r.arrayBuffer());assert.ok(bytes.length>0);
    assert.match(r.headers.get('content-type'),name.endsWith('.webp')?/image\/webp/u:/javascript/u);
  }
  assert.equal((await fetch(f.url+'/assets/not-whitelisted.png',{headers:{cookie:f.cookie}})).status,404);
});
test('backend events reach direct voice even when they are not GPT Live talk events',async()=>{
 const received=[];const bridge=createLiveH5Server({gateway:{request(){}},directVoice:{handleEvent:e=>received.push(e),dispose:async()=>{}},offer:async()=>''});
 const e={event:'agent',payload:{runId:'voice-own',stream:'tool'}};bridge.emit(e);assert.deepEqual(received,[e]);await bridge.dispose();
});

test('backend document SSE belongs to exact active voice and carries original Markdown without unrelated fields',async t=>{
 const f=await fixture(t);await f.request('session');const stop=new AbortController();
 const response=await fetch(f.url+'/api/events',{headers:{cookie:f.cookie},signal:stop.signal}),reader=response.body.getReader();await reader.read();
 const text='## 原始方案\n| 日期 | 条件 |\n| --- | --- |\n| 2028-09 | 尚未核实 |';
 const emit=voiceSessionId=>f.bridge.emit({event:'talk.event',payload:{voiceSessionId,talkEvent:{type:'tool.result',callId:'doc',payload:{name:'openclaw_backend_result',text,secret:'不应进入浏览器'}}}});
 emit('foreign');emit('voice-private');const body=new TextDecoder().decode((await reader.read()).value),value=JSON.parse(body.slice(body.indexOf('data: ')+6).trim());
 assert.deepEqual(value,{voiceSessionId:'voice-private',type:'backend.result',callId:'doc',text,revision:1});assert(!body.includes('foreign'));assert(!body.includes('secret'));stop.abort();await reader.cancel().catch(()=>{});
});

test('authenticated presentation snapshot recovers pending work and full document without an SSE connection',async t=>{
 const f=await fixture(t);await f.request('session');
 const read=async(after=0)=>{
  const r=await fetch(f.url+`/api/presentation?after=${after}`,{headers:{cookie:f.cookie}});assert.equal(r.status,200);return r.json();
 };
 assert.equal((await fetch(f.url+'/api/presentation')).status,401);
 const emit=(type,callId,payload,voiceSessionId='voice-private')=>f.bridge.emit({event:'talk.event',payload:{voiceSessionId,talkEvent:{type,callId,payload}}});
 emit('tool.call','foreign',{name:'web_search'},'foreign-voice');
 emit('tool.call','run',{name:'openclaw_agent_consult',args:{secret:'private query'}});
 let view=await read();assert.equal(view.revision,1);assert.deepEqual(view.pending.map(x=>x.callId),['run']);assert(!JSON.stringify(view).includes('private query'));
 const text='## 完整原始报告\n'+ '日期和条件不变。'.repeat(500);
 emit('tool.result','run',{name:'openclaw_agent_consult'});emit('tool.result','doc',{name:'openclaw_backend_result',text});
 view=await read(1);assert.equal(view.controls[0].backendFinal,true);assert.equal(view.controls[0].callId,'run');assert.equal(view.pending.length,0);assert.equal(view.documents[0].text,text);assert.equal(view.revision,3);
 assert.equal((await read(3)).documents.length,0);
 emit('tool.result','end',{name:'openclaw_end_call',requestId:'end',originUserTurnId:'u',closeAfterPlayback:true,secret:'excluded'});
 view=await read(3);assert.equal(view.controls.length,2);assert.equal(view.controls[1].closeAfterPlayback,true);assert(!JSON.stringify(view.controls).includes('excluded'));
 const controlsAfter=await fetch(f.url+'/api/presentation?controlsAfter=4',{headers:{cookie:f.cookie}});assert.equal((await controlsAfter.json()).controls.length,0);
 await f.request('close',{voiceSessionId:'voice-private'});assert.equal((await read()).voiceSessionId,null);
 await f.request('session');view=await read();assert.equal(view.revision,0);assert.equal(view.documents.length,0);
});

test('event stream flushes headers and remains open for delayed events',async t=>{
 const f=await fixture(t);await f.request('session');const stop=new AbortController();
 const response=await fetch(f.url+'/api/events',{headers:{cookie:f.cookie},signal:stop.signal});
 assert(response.headers.get('cache-control').includes('no-transform'));assert.equal(response.headers.get('x-accel-buffering'),'no');
 const reader=response.body.getReader();await reader.read();
 await new Promise(resolve=>setTimeout(resolve,25));
 f.bridge.emit({event:'talk.event',payload:{voiceSessionId:'voice-private',talkEvent:{type:'tool.call',callId:'late',payload:{name:'web_search'}}}});
 assert(new TextDecoder().decode((await reader.read()).value).includes('late'));stop.abort();await reader.cancel().catch(()=>{});
});


test('all three voice owners share the contextual picture endpoint, independently of task routing',async t=>{
 for(const model of ['gpt-live','seeduplex','grok']){
  let input;const f=await fixture(t,{avatarEvaluate:async(...args)=>{input=args;return {answers:{picture:{type:'choice',choice:'listen-3',confidence:.95}}};},directVoice:{reserve:async()=>({voiceSessionId:'direct-'+model,transport:'gateway-relay'}),close:async()=>{},dispose:async()=>{}}});
  const {voiceSessionId}=await (await f.request('session',{model})).json();
  const payload={voiceSessionId,revision:1,turns:[{role:'user',text:'有点失落'},{role:'assistant',text:'我在这里陪你'}],activity:'memory',taskOutcome:'pending'};
  assert.equal((await f.request('avatar',{...payload,voiceSessionId:'foreign'})).status,409);
  const reply=await f.request('avatar',payload);assert.equal(reply.status,200);const selection=await reply.json();assert.equal(selection.picture,'listen-3');assert.equal(selection.reason,'selected');
  assert.deepEqual(input[0].turns,payload.turns);assert.equal((await f.request('avatar',payload)).status,409);
  assert.equal(f.calls.filter(c=>c.method==='talk.client.toolCall').length,0);
 }
});
test('a slow display decision cannot delay heartbeat or task events and cannot survive a closed call',async t=>{
 let resolve;const f=await fixture(t,{avatarEvaluate:()=>new Promise(r=>resolve=r)});await f.request('session');
 const pending=f.request('avatar',{voiceSessionId:'voice-private',revision:1,turns:[{role:'user',text:'有点失落'}]});
 while(!resolve)await new Promise(r=>setImmediate(r));
 assert.equal((await f.request('heartbeat',{voiceSessionId:'voice-private'})).status,200);
 await f.request('close',{voiceSessionId:'voice-private'});resolve({answers:{picture:{type:'choice',choice:'complete-2',confidence:1}}});
 assert.equal((await (await pending).json()).picture,null);
});

test('avatar recovery binds actual display to authenticated call, keeps delayed close flush, and rejects foreign data',async t=>{
 const {mkdtemp,readFile,readdir,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {createAvatarTelemetryLog}=await import('./avatar-telemetry-log.mjs');const dir=await mkdtemp(join(tmpdir(),'avatar-server-'));t.after(()=>rm(dir,{recursive:true,force:true}));const log=createAvatarTelemetryLog({directory:dir});t.after(()=>log.close());
 const f=await fixture(t,{avatarLog:log});await f.request('session');const event={type:'avatar.displayed',sequence:1,clientAt:Date.now(),elapsedMs:40,picture:'listen-3',source:'decision',visible:true,revision:1,turns:[{key:'user-1',role:'user',text:'陪我一下',complete:true,truncated:false}]};const body={voiceSessionId:'voice-private',captureId:'11111111-1111-4111-8111-111111111111',events:[event],sessionKey:'foreign',provider:'foreign'};
 assert.equal((await f.request('avatar-events',{...body,voiceSessionId:'foreign'})).status,409);assert.equal((await f.request('avatar-events',{...body,events:[{...event,picture:'../secret'}]})).status,400);assert.equal((await f.request('avatar-events',body,{origin:'http://evil.example'})).status,403);
 assert.equal((await f.request('avatar-events',body)).status,200);await f.request('close',{voiceSessionId:'voice-private'});assert.equal((await f.request('avatar-events',{...body,events:[{...event,sequence:2,source:'continuation'}]})).status,200);
 const rows=(await readFile(join(dir,(await readdir(dir))[0]),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert(rows.every(r=>r.provider==='openai'&&r.sessionKey===GPT_LIVE_PERSONAL_SESSION_KEY));assert.equal(f.calls.filter(c=>c.method.includes('avatar')).length,0);
});

test('all three providers persist browser reports under their authoritative voice owner and expire close grace',async t=>{
 for(const model of ['gpt-live','seeduplex','grok']){
  const rows=[];const f=await fixture(t,{avatarLog:{write:async row=>{rows.push(row);return {accepted:row.events.length};}},directVoice:{reserve:async()=>({voiceSessionId:'direct-'+model,model:model+'-real-reservation'}),close:async()=>{},dispose:async()=>{}}});
  const {voiceSessionId}=await (await f.request('session',{model})).json();const body={voiceSessionId,captureId:'11111111-1111-4111-8111-111111111111',events:[{type:'avatar.capture_started',sequence:1,clientAt:Date.now(),elapsedMs:0}]};
  assert.equal((await f.request('avatar-events',body)).status,200);assert.equal(rows[0].owner.provider,model==='gpt-live'?'openai':model);assert.equal(rows[0].owner.model,model==='gpt-live'?'gpt-live-1-codex':model+'-real-reservation');
  await f.request('close',{voiceSessionId});rows[0].owner.endedAt=Date.now()-300001;assert.equal((await f.request('avatar-events',body)).status,409);
 }
});
test('streamed USER control is owned, current and confirmed separately from proposal',async t=>{
 const f=await fixture(t,{callControlEvaluate:async()=>({answers:{endIntent:{type:'noul',noul:1}}})});await f.request('session');
 let revision=0;const emit=(text,turnId='u',final=false)=>f.request('call-control-input',{voiceSessionId:'voice-private',revision:++revision,turnId,text,final});
 await emit('请');await emit('请挂断电话');await new Promise(r=>setTimeout(r,1250));
 const snapshot=await (await fetch(f.url+'/api/presentation',{headers:{cookie:f.cookie}})).json();const value=snapshot.controls.at(-1);
 assert.equal(value.type,'voice.end.proposed');assert.equal(value.userText,'请挂断电话');assert.equal(f.calls.filter(x=>x.method==='voice.product.control').length,0);
 assert.equal((await f.request('call-control-confirm',{voiceSessionId:'foreign',control:value})).status,409);
 await emit('请挂断电话之前查一下日程');assert.equal((await f.request('call-control-confirm',{voiceSessionId:'voice-private',control:value})).status,409);assert.equal(f.calls.filter(x=>x.method==='voice.product.control').length,0);
 await emit('拜拜','bye',true);await new Promise(r=>setImmediate(r));
 const last=await (await fetch(f.url+'/api/presentation',{headers:{cookie:f.cookie}})).json();const confirmed=await f.request('call-control-confirm',{voiceSessionId:'voice-private',control:last.controls.at(-1)});
 assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).type,'voice.end.accepted');assert.equal(f.calls.filter(x=>x.method==='voice.product.control').length,1);
});
test('caption input rejects another reservation and obsolete revisions without allowing Gateway transcripts to revoke native input',async t=>{
 const f=await fixture(t,{callControlEvaluate:async()=>({answers:{endIntent:{type:'noul',noul:1}}})});await f.request('session');
 const caption={voiceSessionId:'voice-private',turnId:'native-current',text:'请挂断电话',final:true,revision:2};
 assert.equal((await f.request('call-control-input',{...caption,voiceSessionId:'foreign'})).status,409);
 assert.equal((await f.request('call-control-input',caption)).status,200);await new Promise(r=>setImmediate(r));
 assert.equal((await f.request('call-control-input',{...caption,text:'旧字幕',revision:1})).status,409);
 f.bridge.emit({event:'talk.event',payload:{voiceSessionId:'voice-private',talkEvent:{type:'transcript.done',turnId:'normalized-previous',payload:{role:'user',text:'旧话轮'}}}});
 const snapshot=await (await fetch(f.url+'/api/presentation',{headers:{cookie:f.cookie}})).json();assert.equal(snapshot.controls.at(-1).userText,'请挂断电话');
 assert.equal((await f.request('call-control-confirm',{voiceSessionId:'voice-private',control:snapshot.controls.at(-1)})).status,200);
});

test('relay reports recover through the owned presentation endpoint and require the matching UI receipt',async t=>{
 const received=[];const directVoice={reserve:async()=>({voiceSessionId:'direct-report',transport:'gateway-relay'}),close:async()=>{},dispose:async()=>{},
  presentation:(id,after)=>({voiceSessionId:id,revision:3,pending:[],documents:after<3?[{type:'backend.result',voiceSessionId:id,callId:'report-1',revision:3,text:'# 真实报告'}]:[],controls:[]}),
  contentShown:(id,callId)=>{received.push([id,callId]);return callId==='report-1';}};
 const f=await fixture(t,{directVoice});await f.request('session',{model:'seeduplex'});
 const view=await fetch(f.url+'/api/presentation?after=0',{headers:{cookie:f.cookie}});const data=await view.json();assert.equal(data.documents[0].text,'# 真实报告');
 assert.equal((await f.request('content-shown',{voiceSessionId:'foreign',callId:'report-1'})).status,409);assert.equal(received.length,0);
 assert.equal((await f.request('content-shown',{voiceSessionId:'direct-report',callId:'unknown'})).status,409);
 assert.equal((await f.request('content-shown',{voiceSessionId:'direct-report',callId:'report-1'})).status,200);
 assert.equal((await fetch(f.url+'/api/presentation?after=3',{headers:{cookie:f.cookie}}).then(r=>r.json())).documents.length,0);
});

test('candidate default model is server-owned and included in both readiness paths',async t=>{
 const f=await fixture(t,{preview:true,defaultModel:'grok'});
 const html=await (await fetch(f.url)).text();assert.match(html,/"defaultModel":"grok"/);
 const status=await (await fetch(f.url+'/api/status?model=gpt-live',{headers:{cookie:f.cookie}})).json();
 assert.equal(status.defaultModel,'grok');assert.equal(f.calls.length,0);
});
test('unsupported default voice models fail at startup',()=>{
 assert.throws(()=>createLiveH5Server({defaultModel:'arbitrary'}),/Invalid default voice model/);
});

test('disconnected Gateway is not dial-ready and cannot allocate a provider session',async t=>{
 const f=await fixture(t,{gatewayReady:false});
 const html=await (await fetch(f.url)).text();assert.match(html,/"ready":false,"preview":false/);
 const status=await (await fetch(f.url+'/api/status',{headers:{cookie:f.cookie}})).json();assert.equal(status.ready,false);assert.equal(status.preview,false);
 const blocked=await f.request('session',{model:'grok'});assert.equal(blocked.status,503);assert.match((await blocked.json()).error,/后端正在重新连接/);assert.equal(f.calls.length,0);
 f.gateway.ready=true;
 assert.equal((await (await fetch(f.url+'/api/status',{headers:{cookie:f.cookie}})).json()).ready,true);
});

test('Grok voice selection is validated before closing a call and server keeps identity binding',async t=>{
 const received=[],closed=[];
 const f=await fixture(t,{directVoice:{models:()=>[],reserve:async params=>{received.push(params);return {voiceSessionId:'selected',transport:'gateway-relay',voice:params.voice};},close:async id=>closed.push(id),dispose:async()=>{}}});
 const response=await f.request('session',{model:'grok',voice:'iris',sessionKey:'untrusted-browser'});
 assert.equal(response.status,200);assert.equal((await response.json()).voice,'iris');
 assert.deepEqual(received,[{model:'grok',voice:'iris',sessionKey:GPT_LIVE_PERSONAL_SESSION_KEY}]);
 for(const voice of ['',null,'unknown'])assert.equal((await f.request('session',{model:'grok',voice})).status,400);
 assert.equal(closed.length,0);assert.equal(received.length,1);
});

test('release readiness stays busy after direct hangup until backend execution and delivery settle', async t => {
 let pending=1;
 const f=await fixture(t,{directVoice:{models:()=>[],backgroundTaskCount:()=>pending,reserve:async()=>({voiceSessionId:'detached',transport:'gateway-relay'}),close:async()=>{},dispose:async()=>{}}});
 const status=async()=> (await (await fetch(f.url+'/api/status',{headers:{cookie:f.cookie}})).json());
 await f.request('session',{model:'seeduplex'});await f.request('close',{voiceSessionId:'detached'});
 const after=await status();assert.equal(after.activeCall,false);assert.deepEqual(after.releaseReadiness,{known:true,activeCalls:0,creatingSessions:0,backgroundTasks:1,deviceOperations:0});
 pending=0;assert.equal((await status()).releaseReadiness.backgroundTasks,0);
 assert.equal((await fetch(f.url+'/api/status')).status,401);
});

test('release readiness never treats an adapter without lifecycle reporting as idle', async t=>{
 const f=await fixture(t,{directVoice:{models:()=>[],dispose:async()=>{}}});
 const s=await (await fetch(f.url+'/api/status',{headers:{cookie:f.cookie}})).json();assert.equal(s.releaseReadiness.known,false);
});

test('native GPT task remains visible to release checks after its media owner closes',async t=>{
 let terminal;const final=new Promise(resolve=>terminal=resolve);
 const f=await fixture(t,{request:async(method,params,reservation)=>{
  if(method==='talk.client.create')return reservation;
  if(method==='agent.wait')return final;
  if(method==='chat.history')return {messages:[{role:'assistant',content:'已完成原任务',__openclaw:{runId:'original-run'}}]};
  return {ok:true};
 }});
 await f.request('session');
 f.bridge.emit({event:'talk.event',payload:{voiceSessionId:'voice-private',talkEvent:{type:'tool.call',callId:'original-run',payload:{name:'openclaw_agent_consult'}}}});
 await f.request('close',{voiceSessionId:'voice-private'});
 const status=async()=> (await (await fetch(f.url+'/api/status',{headers:{cookie:f.cookie}})).json()).releaseReadiness;
 assert.equal((await status()).backgroundTasks,1);assert.equal((await status()).activeCalls,0);
 terminal({status:'ok'});
 for(let n=0;n<20&&(await status()).backgroundTasks;n++)await new Promise(r=>setImmediate(r));
 assert.equal((await status()).backgroundTasks,0);
});

test('backend helper uses the bounded HTTP device channel without browser identity overrides',async t=>{
 const {spawn}=await import('node:child_process');
 const calls=[],lease='l'.repeat(43);
 const directVoice={models:()=>[],dispose:async()=>{},backendDeviceRequest:async args=>{calls.push(args);assert.equal(args.lease,lease);return {version:1,voiceSessionId:'owned-call',requestId:'owned-request',operation:args.operation,status:'ok',result:{verified:true}};}};
 const f=await fixture(t,{directVoice}),endpoint=`${f.url}/internal/device-request`;
 const request=body=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await request({lease,operation:'notes.create',args:{},actor:'foreign'})).status,403);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{origin:f.url},body:JSON.stringify({lease,operation:'notes.create',args:{}})})).status,403);
 assert.equal((await fetch(endpoint,{method:'POST',body:'not-json'})).status,400);
 assert.equal((await request({lease:'wrong',operation:'notes.create'})).status,403);
 assert.equal(calls.length,0);
 const child=spawn(process.execPath,['scripts/device-call.mjs','notes.create',JSON.stringify({title:'fixture'})],{stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill();});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
 const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 child.stdin.end(JSON.stringify({version:1,endpoint,lease,voiceSessionId:'owned-call'}));
 assert.equal(await ended,0,stderr);assert.equal(JSON.parse(stdout).status,'ok');
 assert.deepEqual(calls,[{lease,operation:'notes.create',args:{title:'fixture'}}]);assert(!stdout.includes(lease));
});

test('GPT binds only a backend-verified current device channel and never exposes its lease or helper to the client',async t=>{
 let descriptor;class Server{close(){}}
 const directVoice=createDirectVoiceService({gateway:{},wsModule:{WebSocketServer:Server},backendDeviceBundle:{root:'/real-backend',sha256:'a'.repeat(64)},backendDeviceBundleProbe:async value=>{
  descriptor=value.descriptor;
  const response=await fetch(descriptor.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lease:descriptor.lease,operation:'device.probe',args:{challenge:'actual-http'}})});
  return response.ok&&(await response.json()).result.challenge==='actual-http';
 }});
 const calls=[];
 const f=await fixture(t,{directVoice,gptProvider:'v-voice-gpt-live',request:(method,params,reservation)=>{calls.push({method,params});return method==='talk.client.create'?reservation:{accepted:true};}});
 const created=await f.request('session',{nativeDeviceActions:{version:1,capabilities:{'location.current':{status:'prompt'}}}});assert.equal(created.status,200);
 const reply=await created.json();assert.equal(reply.nativeDeviceActions.version,1);assert.match(reply.callerContext.text,/location.current/);
 assert(!JSON.stringify(reply).includes(descriptor.lease));assert(!JSON.stringify(reply).includes('/real-backend'));assert(!JSON.stringify(reply).includes('clientSecret'));
 assert.equal(calls.find(c=>c.method==='voice.product.device-context'&&c.params.revision===1).params.bridge.lease,descriptor.lease);
 const frame={type:'device.capabilities',version:1,voiceSessionId:reply.voiceSessionId,revision:1,capabilities:{'location.current':{status:'denied'}}};
 assert.equal((await f.request('device-result',{voiceSessionId:'foreign',frame})).status,409);
 assert.equal((await f.request('device-result',{voiceSessionId:reply.voiceSessionId,frame,actor:'other'})).status,409);
 assert.equal((await f.request('device-result',{voiceSessionId:reply.voiceSessionId,frame})).status,200);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.find(c=>c.params.revision===2)?.params.terminal.capabilities['location.current'].status,'denied');
 await f.request('close',{voiceSessionId:reply.voiceSessionId});
 const expired=await fetch(descriptor.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lease:descriptor.lease,operation:'device.probe',args:{challenge:'late'}})});assert(!expired.ok);
 assert.equal((await f.request('device-result',{voiceSessionId:reply.voiceSessionId,frame})).status,409);
});
test('a Gateway without GPT device support keeps the old call and advertises no usable device channel',async t=>{
 let opened=false;const directVoice={models:()=>[],openDeviceChannel(){opened=true;},dispose:async()=>{}};
 const f=await fixture(t,{directVoice,gptProvider:'v-voice-gpt-live',request:(method,params,reservation)=>{if(method==='voice.product.device-context')throw Error('unknown method');return method==='talk.client.create'?reservation:{ok:true};}});
 const result=await (await f.request('session',{nativeDeviceActions:{version:1,capabilities:{'location.current':{status:'prompt'}}}})).json();
 assert.equal(result.voiceSessionId,'voice-private');assert.equal(result.nativeDeviceActions,undefined);assert.equal(opened,false);
});

test('TV first HTML is transparent before modules run; regular Web and legacy TV keep their presentation',async t=>{
 const f=await fixture(t,{preview:true});
 for(const [query,expected] of [
  ['?tv=1&tvShell=1&tvSurface=1',/data-tv="true" data-tv-layout="medium" data-tv-presented="false"/],
  ['?tv=1&tvShell=1',/data-tv="true" data-tv-layout="medium" data-tv-presented="true"/],
  ['?tv=1',/data-tv="true" data-tv-layout="full" data-tv-presented="true"/],
 ]){
  const html=await(await fetch(f.url+'/'+query,{headers:{cookie:f.cookie}})).text();
  assert.match(html.split('</head>')[0],expected);
  assert.match(html,/<style data-voice-entry>/);
 }
 for(const query of ['','?tvShell=1&tvSurface=1']){
  const html=await(await fetch(f.url+'/'+query,{headers:{cookie:f.cookie}})).text();
  assert.match(html,/<html lang="zh-CN">/);assert.doesNotMatch(html.split('</head>')[0],/<html[^>]*data-tv=/);
 }
 assert.equal(f.calls.length,0);
});

test('TV entry uses bundled engine without changing identity snapshot or other terminals',async t=>{
 const f=await fixture(t,{preview:true});
 const tv=await (await fetch(`${f.url}/?tv=1&tvShell=1&tvSurface=1&tvOverlay=1`)).text();
 assert.match(tv,/src="\.\/tv-entry.bundle.mjs"/);assert.doesNotMatch(tv,/src="\.\/app.js"/);
 assert.doesNotMatch(tv,/modulepreload" href="\.\/app.js/);assert.doesNotMatch(tv,/modulepreload" href="\.\/ui-bundle/);
 assert.match(tv,/id="voiceEntryStatus"/);assert.match(tv,/src="\.\/entry-startup.mjs"/);
 assert.match(tv,/data-tv-presented="false"/);
 const normal=await (await fetch(f.url+'/')).text();assert.match(normal,/src="\.\/app.js"/);
 assert.match(tv,/as="fetch" type="application\/wasm"/);
 const dsp=await fetch(f.url+'/assets/tv-aec/webrtcaec3-0.3.0.wasm');assert.match(dsp.headers.get('cache-control'),/immutable/);
 const bundle=await fetch(f.url+'/tv-entry.bundle.mjs');assert.equal(bundle.status,200);assert.match(bundle.headers.get('content-type'),/javascript/);
 assert.equal(f.calls.length,0);
});
