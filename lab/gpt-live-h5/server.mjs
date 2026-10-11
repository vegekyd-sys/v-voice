#!/usr/bin/env node
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAvatarReactionSelector, avatarEvaluatorFromEnv } from "./avatar-decision.mjs";
import { AVATAR_FILES, taskActivity } from "./avatar-state.mjs";
import { createVoiceAccess } from "./access.mjs";
import { createConversationEntries } from "../../lib/conversation-entries.mjs";
import { verifyPhoneSession } from "../../lib/phone-provisioning.mjs";
import {createFeishuPhoneLogin,readFeishuPhoneLoginFile} from '../../lib/feishu-phone-login.mjs';
import {normalizeAvatarEvent} from './avatar-telemetry.mjs';
import {createAvatarTelemetryLog} from './avatar-telemetry-log.mjs';
import { createVoiceTranscriptLog } from '../realtime-direct-tools/transcript-log.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export function createLiveH5Server({ gateway, offer, directVoice, preview = false, basePath = "", publicOrigin = "", accessToken = "", maxActiveSessions = 8, maxActiveSessionsPerIp = 2, avatarEvaluate = avatarEvaluatorFromEnv(), avatarLog, conversationEntries = [], feishuLogin }) {
  basePath = basePath.replace(/\/$/u, "");
  if (basePath && !/^\/[a-zA-Z0-9_-]+$/u.test(basePath)) throw new Error("Invalid voice base path");
  const hosted = Boolean(publicOrigin || accessToken);
  const origin = hosted ? new URL(publicOrigin) : null;
  if (hosted && (origin.protocol !== "https:" || origin.origin !== publicOrigin || !basePath)) throw new Error("Hosted voice requires an HTTPS origin and base path");
  if (!Number.isInteger(maxActiveSessions) || maxActiveSessions < 1 || maxActiveSessions > 50 || !Number.isInteger(maxActiveSessionsPerIp) || maxActiveSessionsPerIp < 1 || maxActiveSessionsPerIp > maxActiveSessions) throw new Error("Invalid voice call limits");
  const entries = createConversationEntries(conversationEntries, accessToken);
  const phoneLogin = feishuLogin ? createFeishuPhoneLogin({...feishuLogin, publicOrigin, basePath, entries}) : null;
  const accessors = new Map();
  const entryAccess = binding => {
    if (!hosted) return null;
    if (!accessors.has(binding.id)) accessors.set(binding.id, createVoiceAccess(binding.accessToken, basePath, Date.now, {entry:binding.id}));
    return accessors.get(binding.id);
  };
  const access = entryAccess(entries.resolve(new URL("http://localhost")));
  const visual = createAvatarReactionSelector({evaluate:avatarEvaluate});
  const contexts = new Map();
  const local = { active: null, creatingSession: false, listeners: new Set(), touchedAt: Date.now(), entry: "tianyi" };
  const attempts = new Map();
  const allow = key => {
    const times = (attempts.get(key) ?? []).filter(at => Date.now() - at < 600000);
    if (times.length >= 6) return false;
    times.push(Date.now()); attempts.set(key, times); return true;
  };
  const cookie = randomBytes(32).toString("hex");
  const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
  const rememberAvatarCall = (context,active,provider) => {
    const registry=context.avatarOwners??=new Map();
    for(const [id,owner] of registry)if(owner.endedAt&&Date.now()-owner.endedAt>300000)registry.delete(id);
    if(registry.size>=3)registry.delete(registry.keys().next().value);
    registry.set(active.reservation.voiceSessionId,{voiceSessionId:active.reservation.voiceSessionId,sessionKey:active.sessionKey,
      provider,model:active.reservation.model??null,avatarSequences:new Map()});
  };
  const close = async (context = local) => {
    const old = context.active;
    if (old) visual.forget(old.reservation.voiceSessionId);
    if (old?.direct) await directVoice.close(old.reservation.voiceSessionId);
    else if (old) await gateway.request("talk.client.close", { sessionKey: old.sessionKey, voiceSessionId: old.reservation.voiceSessionId });
    if (context.active === old) {context.active = null;const owner=context.avatarOwners?.get(old?.reservation.voiceSessionId);if(owner)owner.endedAt=Date.now();}
  };
  const server = createServer(async (req, res) => {
    res.setHeader("referrer-policy", "no-referrer"); res.setHeader("x-content-type-options", "nosniff");
    try {
      const host = req.headers.host ?? "";
      if (hosted ? host !== origin.host : !/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)) return json(res, 403, { error: "请求入口不匹配" });
      const requestOrigin = hosted ? publicOrigin : `http://${host}`;
      if (req.headers.origin && req.headers.origin !== requestOrigin || hosted && req.method === "POST" && req.headers.origin !== requestOrigin) return json(res, 403, { error: "请求来源不匹配" });
      const url = new URL(req.url, requestOrigin);
      if (basePath && url.pathname === basePath && req.method === "GET") { res.writeHead(308, { location: `${basePath}/${url.search}`, "cache-control": "no-store" }); res.end(); return; }
      if (basePath && !url.pathname.startsWith(`${basePath}/`)) return json(res, 404, { error: "没有这个入口" });
      const pathname = basePath ? url.pathname.slice(basePath.length) : url.pathname;
      if (phoneLogin && req.method === 'GET' && (pathname === '/feishu' || pathname === '/feishu/callback')) {
        try {
          let location;
          if (pathname === '/feishu/callback') location = await phoneLogin.complete(req, res, url);
          else {
            const selected = phoneLogin.select(req, url.searchParams.get('phone'));
            if (selected) {
              entryAccess(selected).issue(res);
              location = `${basePath}/?phone=${encodeURIComponent(selected.id)}`;
            } else location = phoneLogin.begin(req, res, url.searchParams.get('phone'));
          }
          res.writeHead(302, {location, 'cache-control': 'no-store'}); res.end(); return;
        } catch { return json(res, 403, {error:'暂时无法确认这个电话入口。请使用已开通的飞书账号重新打开。'}); }
      }
      if (url.searchParams.get("entry") === "visitor") return json(res, 404, { error: "普通人电话入口尚未开放。" });
      const binding = entries.resolve(url);
      if (!binding) return json(res,404,{error:"这个电话入口不存在或已关闭。"});
      const entry = binding.id;
      const access = entryAccess(binding);
      if (phoneLogin?.protects(binding) && !phoneLogin.permits(req, binding)
        && (pathname === '/' || pathname.startsWith('/api/'))) {
        if (req.method === 'GET' && pathname === '/') {
          res.writeHead(302, {location: `${basePath}/feishu?phone=${encodeURIComponent(entry)}`, 'cache-control':'no-store'}); res.end(); return;
        }
        return json(res, 401, {error:'请从飞书电话入口登录后拨号。'});
      }
      const staticFiles = new Map([
        ["/", [join(here, "index.html"), "text/html; charset=utf-8"]],
        ["/markdown.mjs", [join(here, "markdown.mjs"), "text/javascript; charset=utf-8"]],
        ["/vendor/marked-18.0.5.mjs", [join(here, "vendor/marked-18.0.5.mjs"), "text/javascript; charset=utf-8"]],
        ["/app.js", [join(here, "app.js"), "text/javascript; charset=utf-8"]],
        ["/events.mjs", [join(here, "events.mjs"), "text/javascript; charset=utf-8"]],
        ["/duplex-playback.mjs", [join(here, "duplex-playback.mjs"), "text/javascript; charset=utf-8"]],
        ...["microphone-capture.mjs", "microphone-session.mjs", "transcript-presentation.mjs", "call-sounds.mjs", "relay-audio.mjs", "avatar.mjs", "avatar-state.mjs", "avatar-catalog.mjs", "avatar-reactions.mjs", "avatar-telemetry.mjs"].map((name) => [`/${name}`, [join(here, name), "text/javascript; charset=utf-8"]]),
        ["/styles.css", [join(here, "styles.css"), "text/css; charset=utf-8"]],
        ...AVATAR_FILES.map(name => [`/assets/${name}`, [join(here, "assets", name), name.endsWith(".webp") ? "image/webp" : "image/png"]]),
        ...["v-idle-nohat-20260922.png", "v-tool-busy-20260922.png"].map((name) => [`/assets/${name}`, [join(here, "../rtc-h5/assets", name), "image/png"]]),
      ]);
      if (req.method === "GET" && staticFiles.has(pathname)) {
        if (pathname === "/" && !hosted) res.setHeader("set-cookie", `v_live_experiment=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
        const [file, type] = staticFiles.get(pathname);
        const contents = await readFile(file);
        res.writeHead(200, { "content-type": type, "cache-control": pathname.startsWith("/assets/v-operator-") ? "public, max-age=86400" : "no-store" }); res.end(contents); return;
      }
      const readBody = async () => {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 70000) throw new Error("Request too large"); chunks.push(chunk); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      };
      const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown").slice(0, 128);
      if (hosted && req.method === "POST" && pathname === "/api/access") {
        if (!allow(`access:${ip}`)) return json(res, 429, { error: "尝试次数过多，请稍后再试" });
        const params = await readBody();
        if (!access.accepts(params.access)) return json(res, 403, { error: "分享链接无效或已失效" });
        const visitor = access.issue(res); return json(res, 200, { ok: true, expiresAt: visitor.expiresAt });
      }
      let context = local;
      if (!hosted) { context = contexts.get(entry) ?? {...local,listeners:new Set(),entry,sessionKey:binding.sessionKey}; contexts.set(entry,context); }
      if (hosted) {
        const visitor = access.read(req);
        if (!visitor) return json(res, 401, { error: "请使用完整的本人入口链接打开" });
        const contextId = `${entry}:${visitor.id}`;
        context = contexts.get(contextId);
        if (!context) {
          if (contexts.size >= 512) return json(res, 503, { error: "现在访问的人有点多，请稍后再试" });
          context = { active: null, creatingSession: false, listeners: new Set(), touchedAt: Date.now(), ip, entry, sessionKey:binding.sessionKey };
          contexts.set(contextId, context);
        }
      } else if (!String(req.headers.cookie ?? "").split(/;\s*/u).includes(`v_live_experiment=${cookie}`)) return json(res, 401, { error: "请先打开实验页面" });
      context.touchedAt = Date.now();
      if (req.method === "GET" && pathname === "/api/status") return json(res, 200, {
        ready: !preview, model: "gpt-live-1-codex", activeCall: Boolean(context.active), creatingSession: context.creatingSession,
        ...(directVoice ? {models:[{id:'gpt-live',label:'GPT Live',available:true},...directVoice.models()]} : {}),
      });
      if (preview) return json(res, 503, { error: "当前是页面预览，还未连接 VLab 候选服务。" });
      if (req.method === "GET" && pathname === "/api/presentation") {
        const active = context.active;
        if (!active || active.direct) return json(res, 200, { voiceSessionId: null });
        const view = active.presentation;
        const after = Number(url.searchParams.get("after") ?? 0);
        return json(res, 200, { voiceSessionId: active.reservation.voiceSessionId,
          revision: view.revision, pending: [...view.pending.values()],
          documents: [...view.documents.values()].filter(item => item.revision > after),
          controls: view.controls.filter(item => item.revision > Number(url.searchParams.get('controlsAfter') ?? 0)) });
      }
      if (req.method === "GET" && pathname === "/api/events") {
        if (context.listeners.size >= 2) return json(res, 429, { error: "通话连接已打开" });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
        res.flushHeaders();
        res.write(": connected\n\n"); context.listeners.add(res);
        const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15000); keepalive.unref();
        res.on("close", () => { clearInterval(keepalive); context.listeners.delete(res); }); return;
      }
      if (req.method !== "POST") return json(res, 404, { error: "没有这个入口" });
      const params = await readBody();
      if (pathname === "/api/session") {
        if (params.model && !['gpt-live','seeduplex','grok'].includes(params.model)) return json(res,400,{error:'没有这个语音模型'});
        if (params.model && params.model !== 'gpt-live' && !directVoice) return json(res,503,{error:'这个语音模型尚未接入'});
        if (context.creatingSession) return json(res, 409, { error: "正在连接 V，请稍等。" });
        // All devices share the selected personal conversation. Do not let a
        // second device replace another device's voice owner or pending work.
        if ([...contexts.values()].some(item => item !== context && item.sessionKey === binding.sessionKey && (item.active || item.creatingSession))) {
          return json(res, 409, { error: "另一台设备正在和 V 通话，请先结束那边的通话。" });
        }
        if (hosted) {
          const busy = [...contexts.values()].filter(item => item.active || item.creatingSession);
          if (!context.active && busy.length >= maxActiveSessions) return json(res, 503, { error: "现在和 V 说话的人有点多，请稍后再试" });
          if (!context.active && busy.filter(item => item.ip === ip).length >= maxActiveSessionsPerIp) return json(res, 429, { error: "这台设备已有通话，请先结束后再试" });
          if (!allow(`call:${ip}`)) return json(res, 429, { error: "通话开始得太频繁，请稍后再试" });
          context.ip = ip;
        }
        context.creatingSession = true;
        try {
          // New phone entries cannot create a guessed or stale conversation.
          // Keep the accepted legacy personal entry's startup path unchanged.
          if (binding.id !== 'tianyi') await verifyPhoneSession(gateway, binding);
          await close(context);
          const sessionKey = binding.sessionKey;
          if (params.model && params.model !== 'gpt-live') {
            const reservation = await directVoice.reserve({model:params.model,sessionKey});
            context.active={sessionKey,reservation,direct:true,touchedAt:Date.now(),cookie:req.headers.cookie};
            rememberAvatarCall(context,context.active,params.model);
            return json(res,200,reservation);
          }
          const reservation = await gateway.request("talk.client.create", { sessionKey, provider: "openai", model: "gpt-live-1-codex", voice: "sol", mode: "realtime", transport: "webrtc", brain: "agent-consult", capabilities: ["voice-transcript"] }, { timeoutMs: 45000 });
          context.active = { sessionKey, reservation, touchedAt: Date.now(), presentation: { revision: 0, pending: new Map(), documents: new Map(), controls: [] } };
          if (reservation.model !== "gpt-live-1-codex" || reservation.transport !== "webrtc" || reservation.offerUrl !== "/plugins/openai/realtime/calls") {
            await close(context);
            return json(res, 409, { error: "候选语音配置与 GPT Live 实验不匹配" });
          }
          rememberAvatarCall(context,context.active,'openai');
          return json(res, 200, { voiceSessionId: reservation.voiceSessionId, model: reservation.model });
        } finally {
          context.creatingSession = false;
        }
      }
      if(pathname==='/api/avatar-events'){
        const owner=context.avatarOwners?.get(params.voiceSessionId);
        if(!owner||owner.endedAt&&Date.now()-owner.endedAt>300000)return json(res,409,{error:'头像记录不属于此通话'});
        if(!avatarLog)return json(res,503,{error:'头像记录尚未启用'});
        if(typeof params.captureId!=='string'||!/^[a-f0-9-]{36}$/u.test(params.captureId)||!Array.isArray(params.events)||!params.events.length||params.events.length>20)return json(res,400,{error:'头像记录无效'});
        try{params.events.forEach(normalizeAvatarEvent);}catch{return json(res,400,{error:'头像记录无效'});}
        if(!owner.avatarSequences.has(params.captureId)&&owner.avatarSequences.size>=4)return json(res,429,{error:'头像记录来源过多'});
        try{return json(res,200,await avatarLog.write({owner,clientCaptureId:params.captureId,events:params.events}));}
        catch{return json(res,503,{error:'头像记录暂未保存'});}
      }
      if (!context.active || params.voiceSessionId !== context.active.reservation.voiceSessionId) return json(res, 409, { error: "通话已结束，请重新开始" });
      context.active.touchedAt = Date.now();
      if (pathname === '/api/avatar') {
        const active = context.active;
        if (!Number.isSafeInteger(params.revision) || params.revision < 1 || !Array.isArray(params.turns)
          || params.turns.length > 6 || params.turns.some(t => !['user','assistant'].includes(t?.role)
            || typeof t.text !== 'string' || t.text.length > 600)) return json(res,400,{error:'头像上下文无效'});
        if (params.revision <= (active.avatarRevision ?? 0)) return json(res,409,{error:'头像上下文已更新'});
        active.avatarRevision = params.revision;
        let outcome;
        const reaction = await visual.select({owner:params.voiceSessionId,context:params,
          onOutcome:value=>{outcome=value;},
          isCurrent:()=>context.active===active && active.avatarRevision===params.revision});
        return json(res,200,{picture:null,...reaction,revision:params.revision,reason:outcome?.reason??'unknown',durationMs:outcome?.durationMs});
      }
      if (context.active.direct) {
        if (pathname === '/api/close') { await close(context); return json(res,200,{ok:true}); }
        if (pathname === '/api/heartbeat') return json(res,200,{ok:true});
        if (pathname === '/api/steer') {
          if(!['steer','cancel'].includes(params.mode)||typeof params.text!=='string'||!params.text.trim()||params.text.length>2000)return json(res,400,{error:'补充内容无效'});
          return json(res,200,await directVoice.steer(params.voiceSessionId,params));
        }
        return json(res,400,{error:'当前模型使用实时音频通道'});
      }
      if (pathname === "/api/offer") {
        if (typeof params.sdp !== "string" || !params.sdp.startsWith("v=0") || params.sdp.length > 65536) return json(res, 400, { error: "语音连接参数无效" });
        const owner = context.active;
        const sdp = await offer(owner.reservation, params.sdp);
        if (context.active !== owner) return json(res, 409, { error: "通话已结束，请重新开始" });
        return json(res, 200, { sdp });
      }
      if (pathname === "/api/ready") {
        const result = await gateway.request("talk.client.toolCall", {
          sessionKey: context.active.sessionKey, voiceSessionId: context.active.reservation.voiceSessionId,
          callId: `host-ready-${randomUUID()}`, name: "openclaw_live_call_control", args: { action: "ready" },
        });
        if (result?.ok !== true) return json(res, 409, { error: "接通问候还未就绪，你可以直接说话。" });
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/steer") {
        if (!["steer", "cancel"].includes(params.mode) || typeof params.text !== "string" || !params.text.trim() || params.text.length > 2000) return json(res, 400, { error: "补充内容无效" });
        const result = await gateway.request("talk.client.steer", { sessionKey: context.active.sessionKey, text: params.text, mode: params.mode });
        if (result?.ok !== true) return json(res, 409, { error: params.mode === "cancel" ? "后台任务暂时没有取消成功，请直接对 V 说明。" : "后台任务没有接受这次补充，请直接对 V 说明。" });
        return json(res, 200, result);
      }
      if (pathname === "/api/heartbeat") return json(res, 200, { ok: true });
      if (pathname === "/api/close") { await close(context); return json(res, 200, { ok: true }); }
      return json(res, 404, { error: "没有这个入口" });
    } catch (error) {
      const message = /requires an active|No active|no active/iu.test(error.message) ? "目前没有正在运行的后台任务，可以直接对 V 说话。" : "这次连接没有完成，请重新开始通话。";
      json(res, error.message === "Request too large" ? 413 : 500, { error: message });
    }
  });
  const timer = setInterval(() => {
    for (const [id, context] of [...contexts, [null, local]]) {
      if (context.active && Date.now() - context.active.touchedAt > 45000) void close(context).catch(() => {});
      if (id && id !== "local-tianyi" && !context.active && !context.creatingSession && !context.listeners.size && Date.now() - context.touchedAt > 1800000) contexts.delete(id);
    }
    for (const [key, times] of attempts) if (!times.some(at => Date.now() - at < 600000)) attempts.delete(key);
  }, 15000); timer.unref();
  const emit = (event) => {
    directVoice?.handleEvent(event);
    if (event.event !== "talk.event") return;
    const context = [local, ...contexts.values()].find(item => item.active?.reservation.voiceSessionId === event.payload?.voiceSessionId);
    if (!context) return;
    const item = event.payload.talkEvent;
    const publish = message => {
      const view = context.active.presentation;
      if (view) {
        message.revision = ++view.revision;
        if (message.name === 'openclaw_end_call') {
          view.controls.push(message);
          if(view.controls.length > 64)view.controls.shift();
        }
        if (message.type === 'tool.call') view.pending.set(message.callId, message);
        else view.pending.delete(message.callId);
        if (message.type === 'backend.result') {
          view.documents.set(message.callId, message);
          if (view.documents.size > 16) view.documents.delete(view.documents.keys().next().value);
        }
      }
      for (const response of context.listeners) response.write(`data: ${JSON.stringify(message)}\n\n`);
    };
    if(item?.type==='tool.result' && item.payload?.name==='openclaw_backend_result' &&
      typeof item.callId==='string' && item.callId && typeof item.payload.text==='string' && item.payload.text.trim()) {
      const message={voiceSessionId:context.active.reservation.voiceSessionId,type:'backend.result',callId:item.callId,text:item.payload.text};
      publish(message);
      return;
    }
    if (!["tool.call", "tool.result", "tool.error"].includes(item?.type)) return;
    const message = { voiceSessionId: context.active.reservation.voiceSessionId, type: item.type, callId: item.callId };
    if (item.type === "tool.call") message.activity = taskActivity(item.payload?.name);
    if (item.payload?.name === "openclaw_end_call") {
      message.name = "openclaw_end_call";
      if (typeof item.payload.requestId === "string") message.requestId = item.payload.requestId;
      if (typeof item.payload.originUserTurnId === "string") message.originUserTurnId = item.payload.originUserTurnId;
      if (item.payload.source === "backend_model_client_tool") {
        message.source = item.payload.source;
        for (const field of ["nativeDelegationId", "backendRunId", "backendToolCallId", "status"])
          if (typeof item.payload[field] === "string") message[field] = item.payload[field];
        if (Number.isSafeInteger(item.payload.delegationGeneration)) message.delegationGeneration = item.payload.delegationGeneration;
      }
      if (item.type === "tool.result" && item.payload.closeAfterPlayback === true
        && typeof item.payload.requestId === "string" && item.payload.requestId) {
        message.closeAfterPlayback = true;
      }
    }
    publish(message);

  };
  server.on('upgrade',(req,socket,head)=>{
    const host=req.headers.host??'';
    const expectedOrigin=hosted?publicOrigin:`http://${host}`;
    if(!directVoice||(hosted?host!==origin.host:!/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host))||req.headers.origin!==expectedOrigin){socket.destroy();return;}
    const url=new URL(req.url,expectedOrigin);
    if(url.pathname!==`${basePath}/api/relay`){socket.destroy();return;}
    const context=[local,...contexts.values()].find(c=>c.active?.direct&&c.active.reservation.voiceSessionId===url.searchParams.get('voiceSessionId'));
    if(!context||!req.headers.cookie){socket.destroy();return;}
    // Re-check the live access cookie, not just a remembered session ticket.
    const binding=entries.resolve(url);
    if(!binding||binding.id!==context.entry||binding.sessionKey!==context.active.sessionKey){socket.destroy();return;}
    if(phoneLogin?.protects(binding)&&!phoneLogin.permits(req,binding)){socket.destroy();return;}
    const visitor=hosted?entryAccess(binding).read(req):null;
    const originalVisitor=hosted?entryAccess(binding).read({headers:{cookie:context.active.cookie}}):null;
    // Compare the entry's visitor identity, not the entire browser cookie jar:
    // opening another phone may legitimately add its cookie during this call.
    if(hosted?(!visitor||visitor.id!==originalVisitor?.id):!String(req.headers.cookie).split(/;\s*/u).includes(`v_live_experiment=${cookie}`)){socket.destroy();return;}
    directVoice.upgrade(req,socket,head,url.searchParams.get('voiceSessionId'),url.searchParams.get('ticket'));
  });
  return { server, emit, dispose: async () => {
    clearInterval(timer);
    for (const context of [local, ...contexts.values()]) { for (const response of context.listeners) response.end(); await close(context).catch(() => {}); }
    await directVoice?.dispose();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preview = process.env.GPT_LIVE_H5_PREVIEW === "1";
  const port = Number(process.env.GPT_LIVE_H5_PORT ?? process.env.RTC_H5_PORT ?? 26244);
  let gateway, bridge, transcriptLog, avatarLog;
  if (!preview) {
    const configPath = process.env.OPENCLAW_CONFIG_PATH;
    if (!configPath) throw new Error("OPENCLAW_CONFIG_PATH is required");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const token = String(config.gateway.auth.token).replace(/\$\{([^}]+)\}/gu, (_, key) => process.env[key] ?? "");
    const { GatewayClient } = await import("../../lib/gateway-client.mjs");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Candidate Gateway unavailable")), 15000);
      gateway = new GatewayClient({ url: `ws://127.0.0.1:${config.gateway.port}`, token, deviceIdentity: null, clientName: "cli", mode: "cli", scopes: ["operator.read", "operator.write", "operator.admin"], caps:["voice-direct-tools","tool-events"], onHelloOk: () => { clearTimeout(timeout); resolve(); }, onEvent: (event) => bridge?.emit(event), onConnectError: (error) => { clearTimeout(timeout); reject(error); } }); gateway.start();
    });
    const {createDirectVoiceService}=await import('../realtime-direct-tools/session.mjs');
    const wsModule=await import('ws');
    transcriptLog=createVoiceTranscriptLog({
      directory:process.env.RTC_H5_TRANSCRIPT_DIR??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-transcripts'),
      onError:({code})=>console.warn(JSON.stringify({type:'voice.transcript-write-error',code})),
    });
    avatarLog=createAvatarTelemetryLog({directory:process.env.RTC_H5_AVATAR_LOG_DIR??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-avatar-events'),
      onError:({code})=>console.warn(JSON.stringify({type:'voice.avatar-write-error',code})),
    });
    const directVoice=createDirectVoiceService({gateway,wsModule,
      audit:transcriptLog.audit,
      toolEnvironment:Object.fromEntries(["LARKSUITE_CLI_CONFIG_DIR","LARKSUITE_CLI_DATA_DIR"].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),
      apiKeys:{
      seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY,
      grok:process.env.XAI_API_KEY,
    },loadContext:async sessionKey=>{
      const history=await gateway.request('chat.history',{sessionKey,limit:6},{timeoutMs:10000});
      return JSON.stringify((history.messages??[]).map(m=>({role:m.role,content:m.content}))).slice(-12000);
    }});
    bridge = createLiveH5Server({ gateway,
      directVoice, avatarLog,
      conversationEntries: process.env.VOICE_ENTRIES_FILE ? JSON.parse(await readFile(process.env.VOICE_ENTRIES_FILE,"utf8")) : [],
      feishuLogin: process.env.VOICE_FEISHU_LOGIN_FILE ? await readFeishuPhoneLoginFile(process.env.VOICE_FEISHU_LOGIN_FILE) : undefined,
      basePath: process.env.GPT_LIVE_H5_BASE_PATH ?? process.env.RTC_H5_BASE_PATH ?? "",
      publicOrigin: process.env.GPT_LIVE_H5_PUBLIC_ORIGIN ?? process.env.RTC_H5_PUBLIC_ORIGIN
        ?? (process.env.RTC_H5_BASE_PATH && process.env.RTC_H5_ACCESS_TOKEN ? "https://openclaw.tianyi.live" : ""),
      accessToken: process.env.GPT_LIVE_H5_ACCESS_TOKEN ?? process.env.RTC_H5_ACCESS_TOKEN ?? "",
      maxActiveSessions: Number(process.env.RTC_H5_MAX_ACTIVE_SESSIONS ?? 8),
      maxActiveSessionsPerIp: Number(process.env.RTC_H5_MAX_ACTIVE_SESSIONS_PER_IP ?? 2),
      offer: async (reservation, sdp) => {
      const response = await fetch(`http://127.0.0.1:${config.gateway.port}${reservation.offerUrl}`, { method: "POST", headers: { authorization: `Bearer ${reservation.clientSecret}`, "content-type": "application/sdp" }, body: sdp, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error("Native SDP exchange failed"); return response.text();
    } });
  } else bridge = createLiveH5Server({ preview: true });
  bridge.server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ ready: true, host: "127.0.0.1", port, preview })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void bridge.dispose().finally(async () => { await transcriptLog?.close(); await avatarLog?.close(); gateway?.stop(); process.exit(0); }));
}
