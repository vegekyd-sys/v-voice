#!/usr/bin/env node
import {controlVoiceTask} from '../../lib/voice-task-control.mjs';
import {createVoiceCallControl,callControlEvaluatorFromEnv} from './call-control.mjs';
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAvatarReactionSelector, avatarEvaluatorFromEnv } from "./avatar-decision.mjs";
import { AVATAR_FILES, taskActivity } from "./avatar-state.mjs";
import { createVoiceAccess } from "./access.mjs";
import { createConversationEntries } from "../../lib/conversation-entries.mjs";
import {normalizeAvatarEvent} from './avatar-telemetry.mjs';
import {createAvatarTelemetryLog} from './avatar-telemetry-log.mjs';
import {createTaskDelivery} from '../realtime-direct-tools/task-delivery.mjs';
import {createVoiceLarkReader} from '../realtime-direct-tools/lark-readonly.mjs';
import { createVoiceTranscriptLog } from '../realtime-direct-tools/transcript-log.mjs';
import {voiceConversationContext} from '../realtime-direct-tools/conversation-context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export function createLiveH5Server({ gateway, offer, directVoice, preview = false, basePath = "", publicOrigin = "", accessToken = "", maxActiveSessions = 8, maxActiveSessionsPerIp = 2, avatarEvaluate = avatarEvaluatorFromEnv(), avatarLog, callControlAudit=()=>{}, callControlEvaluate=callControlEvaluatorFromEnv(), conversationEntries = [], gptProvider = process.env.VOICE_GPT_PROVIDER ?? "openai" }) {
  basePath = basePath.replace(/\/$/u, "");
  if (basePath && !/^\/[a-zA-Z0-9_-]+$/u.test(basePath)) throw new Error("Invalid voice base path");
  const hosted = Boolean(publicOrigin || accessToken);
  const origin = hosted ? new URL(publicOrigin) : null;
  if (hosted && (origin.protocol !== "https:" || origin.origin !== publicOrigin || !basePath)) throw new Error("Hosted voice requires an HTTPS origin and base path");
  if (!Number.isInteger(maxActiveSessions) || maxActiveSessions < 1 || maxActiveSessions > 50 || !Number.isInteger(maxActiveSessionsPerIp) || maxActiveSessionsPerIp < 1 || maxActiveSessionsPerIp > maxActiveSessions) throw new Error("Invalid voice call limits");
  const entries = createConversationEntries(conversationEntries, accessToken);
  const accessors = new Map();
  const entryAccess = binding => {
    if (!hosted) return null;
    if (!accessors.has(binding.id)) accessors.set(binding.id, createVoiceAccess(binding.accessToken, basePath, Date.now, {entry:binding.id}));
    return accessors.get(binding.id);
  };
  const access = entryAccess(entries.resolve(new URL("http://localhost")));
  const visual = createAvatarReactionSelector({evaluate:avatarEvaluate});
  const contexts = new Map(),nativeTasks=new Map(),nativeTaskOwners=new Set();let stopping=false;
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
    old?.taskDelivery?.close();
    old?.callControl?.close();
    if (old) visual.forget(old.reservation.voiceSessionId);
    if (old?.direct) await directVoice.close(old.reservation.voiceSessionId);
    else if (old) await gateway.request("talk.client.close", { sessionKey: old.sessionKey, voiceSessionId: old.reservation.voiceSessionId });
    if(old&&!old.direct)callControlAudit({type:'call.closed',voiceSessionId:old.reservation.voiceSessionId});
    if (context.active === old) {context.active = null;const owner=context.avatarOwners?.get(old?.reservation.voiceSessionId);if(owner)owner.endedAt=Date.now();}
  };
  const server = createServer(async (req, res) => {
    res.setHeader("referrer-policy", "no-referrer"); res.setHeader("x-content-type-options", "nosniff");
    try {
      if(stopping)return json(res,503,{error:"服务正在收尾，请稍后重新拨号"});
      const host = req.headers.host ?? "";
      if (hosted ? host !== origin.host : !/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)) return json(res, 403, { error: "请求入口不匹配" });
      const requestOrigin = hosted ? publicOrigin : `http://${host}`;
      if (req.headers.origin && req.headers.origin !== requestOrigin || hosted && req.method === "POST" && req.headers.origin !== requestOrigin) return json(res, 403, { error: "请求来源不匹配" });
      const url = new URL(req.url, requestOrigin);
      if (basePath && url.pathname === basePath && req.method === "GET") { res.writeHead(308, { location: `${basePath}/${url.search}`, "cache-control": "no-store" }); res.end(); return; }
      if (basePath && !url.pathname.startsWith(`${basePath}/`)) return json(res, 404, { error: "没有这个入口" });
      const pathname = basePath ? url.pathname.slice(basePath.length) : url.pathname;
      if (url.searchParams.get("entry") === "visitor") return json(res, 404, { error: "普通人电话入口尚未开放。" });
      const binding = entries.resolve(url);
      if (!binding) return json(res,404,{error:"这个电话入口不存在或已关闭。"});
      const entry = binding.id;
      const access = entryAccess(binding);
      const staticFiles = new Map([
        ["/", [join(here, "index.html"), "text/html; charset=utf-8"]],
        ["/markdown.mjs", [join(here, "markdown.mjs"), "text/javascript; charset=utf-8"]],
        ["/vendor/marked-18.0.5.mjs", [join(here, "vendor/marked-18.0.5.mjs"), "text/javascript; charset=utf-8"]],
        ["/entry-startup.mjs", [join(here, "entry-startup.mjs"), "text/javascript; charset=utf-8"]],
        ["/app.js", [join(here, "app.js"), "text/javascript; charset=utf-8"]],
        ["/events.mjs", [join(here, "events.mjs"), "text/javascript; charset=utf-8"]],
        ["/duplex-playback.mjs", [join(here, "duplex-playback.mjs"), "text/javascript; charset=utf-8"]],
        ...["media-references.mjs", "screen-wake-lock.mjs", "content-view.mjs", "product-controls.mjs", "microphone-capture.mjs", "microphone-session.mjs", "transcript-presentation.mjs", "call-sounds.mjs", "relay-audio.mjs", "avatar.mjs", "avatar-state.mjs", "avatar-catalog.mjs", "avatar-approved-reactions.mjs", "avatar-reactions.mjs", "avatar-telemetry.mjs"].map((name) => [`/${name}`, [join(here, name), "text/javascript; charset=utf-8"]]),
        ["/styles.css", [join(here, "styles.css"), "text/css; charset=utf-8"]],
        ["/changelog.mjs", [join(here, "changelog.mjs"), "text/javascript; charset=utf-8"]],
        ["/assets/v-voice-icon.svg", [join(here, "assets/v-voice-icon.svg"), "image/svg+xml"]],
        ...["v-voice-icon-32.png", "v-voice-apple-touch.png"].map(name => [`/assets/${name}`, [join(here, "assets", name), "image/png"]]),
        ...AVATAR_FILES.map(name => [`/assets/${name}`, [join(here, "assets", name), name.endsWith(".webp") ? "image/webp" : "image/png"]]),
        ...["v-idle-nohat-20260922.png", "v-tool-busy-20260922.png"].map((name) => [`/assets/${name}`, [join(here, "../rtc-h5/assets", name), "image/png"]]),
      ]);
      if (req.method === "GET" && staticFiles.has(pathname)) {
        if (pathname === "/" && !hosted) res.setHeader("set-cookie", `v_live_experiment=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
        const [file, type] = staticFiles.get(pathname);
        let contents = await readFile(file);
        if (pathname === "/") {
          // The first frame needs this CSS, so return the exact release bytes
          // in the HTML instead of requiring another mobile-network round trip.
          const css = await readFile(join(here, "styles.css"), "utf8");
          let html = contents.toString("utf8").replace('<link rel="stylesheet" href="./styles.css" />', `<style data-voice-entry>${css}</style>`);
          // Only an authenticated request receives an entry snapshot. It is a
          // presentation hint; every session/tool request still authorizes itself.
          const visitor = hosted ? access.read(req) : null;
          const canCheckEntry = visitor && (contexts.has(`${entry}:${visitor.id}`) || contexts.size < 512);
          if (!hosted || canCheckEntry) {
            const initial = JSON.stringify({ ready: !preview,
              ...(directVoice ? {models:[{id:'gpt-live',label:'GPT Live',available:true},...directVoice.models()]} : {}),
            }).replaceAll("<", "\\u003c");
            html = html.replace('<script type="module" src="./app.js"></script>', `<script type="application/json" id="voiceEntryStatus">${initial}</script><script type="module" src="./app.js"></script>`);
          }
          contents = Buffer.from(html);
        }
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
        if (!active) return json(res, 200, { voiceSessionId: null });
        if(active.direct)return json(res,200,directVoice.presentation(active.reservation.voiceSessionId,Number(url.searchParams.get("after")??0))??{voiceSessionId:null});
        const view = active.presentation;
        const after = Number(url.searchParams.get("after") ?? 0);
        return json(res, 200, { voiceSessionId: active.reservation.voiceSessionId,
          revision: view.revision, pending: [...view.pending.values()],
          documents: [...view.documents.values()].filter(item => item.revision > after),
          controls: view.controls.filter(item => item.revision > Number(url.searchParams.get('controlsAfter') ?? 0)) });
      }
      if(req.method==='POST' && pathname==='/api/content-shown'){
        const body=await readBody();const active=context.active;
        if(!active||body.voiceSessionId!==active.reservation.voiceSessionId||typeof body.callId!=='string'||!body.callId||body.callId.length>200)return json(res,409,{error:'展示归属不匹配'});
        const shown=active.direct?directVoice.contentShown(body.voiceSessionId,body.callId):active.presentation.documents.has(body.callId);
        return json(res,shown?200:409,{shown});
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
          await close(context);
          const sessionKey = binding.sessionKey;
          if (params.model && params.model !== 'gpt-live') {
            const reservation = await directVoice.reserve({model:params.model,sessionKey});
            context.active={sessionKey,reservation,direct:true,touchedAt:Date.now(),cookie:req.headers.cookie};
            rememberAvatarCall(context,context.active,params.model);
            return json(res,200,reservation);
          }
          const reservation = await gateway.request("talk.client.create", { sessionKey, provider: gptProvider, model: "gpt-live-1-codex", voice: "sol", mode: "realtime", transport: "webrtc", brain: "agent-consult", capabilities: ["voice-transcript"] }, { timeoutMs: 45000 });
          const taskDelivery=createTaskDelivery({gateway,sessionKey,ownerId:reservation.voiceSessionId,
            ...(gptProvider==='v-voice-gpt-live'?{readNativeResult:runId=>gateway.request('voice.product.task-result',{clientSecret:reservation.clientSecret,runId},{timeoutMs:10000})}:{}),
            audit:callControlAudit,onIdle:()=>{nativeTaskOwners.delete(taskDelivery);if(nativeTasks.get(reservation.voiceSessionId)===taskDelivery)nativeTasks.delete(reservation.voiceSessionId);}});
          nativeTaskOwners.add(taskDelivery);
          // Task audit only. Native GPT captions remain Gateway-owned.
          callControlAudit({type:'call.created',voiceSessionId:reservation.voiceSessionId,sessionKey,provider:'openai',model:reservation.model});
          context.active = { sessionKey, reservation, touchedAt: Date.now(), taskDelivery, presentation: { revision: 0, pending: new Map(), documents: new Map(), controls: [] } };
          nativeTasks.set(reservation.voiceSessionId,context.active.taskDelivery);
          if (reservation.model !== "gpt-live-1-codex" || reservation.transport !== "webrtc" || reservation.offerUrl !== "/plugins/openai/realtime/calls") {
            await close(context);
            return json(res, 409, { error: "候选语音配置与 GPT Live 实验不匹配" });
          }
          const owned=context.active;
          owned.callControl=createVoiceCallControl({evaluate:callControlEvaluate,audit:event=>callControlAudit({...event,voiceSessionId:owned.reservation.voiceSessionId}),isCurrent:()=>context.active===owned,onAccepted:async value=>{
            if(context.active!==owned)return;
            const message={...value,voiceSessionId:owned.reservation.voiceSessionId,revision:++owned.presentation.revision};
            owned.presentation.controls.push(message);if(owned.presentation.controls.length>64)owned.presentation.controls.shift();
            for(const response of context.listeners)response.write(`data: ${JSON.stringify(message)}\n\n`);
          }});
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
          const result=await directVoice.steer(params.voiceSessionId,params);
          return json(res,result?.ok===true?200:409,result);
        }
        return json(res,400,{error:'当前模型使用实时音频通道'});
      }
      if(pathname==='/api/call-control-input'){
        const owned=context.active;
        if(!Number.isSafeInteger(params.revision)||params.revision<1||typeof params.turnId!=='string'||!params.turnId||params.turnId.length>160||typeof params.text!=='string'||params.text.length>2400||typeof params.final!=='boolean')return json(res,400,{error:'通话字幕无效'});
        if(params.revision<=(owned.callControlCaptionRevision??0))return json(res,409,{error:'通话字幕已更新'});
        owned.callControlCaptionRevision=params.revision;
        if(params.final&&owned.taskDelivery?.observeUser(params.text))void owned.taskDelivery.subscribe().catch(error=>callControlAudit({type:'task.delivery-failed',voiceSessionId:params.voiceSessionId,error:error.message}));
        void owned.callControl?.observe({role:'user',turnId:params.turnId,text:params.text,final:params.final,snapshot:true});
        return json(res,200,{ok:true});
      }
      if (pathname === '/api/call-control-confirm') {
        const owned=context.active,value=params.control;
        if(!owned.callControl?.matches(value))return json(res,409,{error:'挂断意图已更新'});
        const proof=await gateway.request('voice.product.control',{clientSecret:owned.reservation.clientSecret,mode:'end'},{timeoutMs:3000});
        if(proof?.ok!==true||context.active!==owned||!owned.callControl.matches(value))return json(res,409,{error:'挂断意图已更新'});
        return json(res,200,{...value,type:'voice.end.accepted',voiceSessionId:owned.reservation.voiceSessionId});
      }
      if (pathname === "/api/offer") {
        if (typeof params.sdp !== "string" || !params.sdp.startsWith("v=0") || params.sdp.length > 65536) return json(res, 400, { error: "语音连接参数无效" });
        const sdp = await offer(context.active.reservation, params.sdp);
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
        const result = await controlVoiceTask({gateway,sessionKey:context.active.sessionKey,native:true},params);
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
    for(const delivery of nativeTaskOwners)delivery.handleEvent(event);
    const taskEvent=event.event==='talk.event'?event.payload?.talkEvent:null;
    if(taskEvent?.type==='tool.progress'&&taskEvent.payload?.name==='openclaw_background_task'){
      nativeTasks.get(event.payload.voiceSessionId)?.watch(taskEvent.payload.runId,taskEvent.callId);
    }
    if(event.event==='talk.event'&&event.payload?.talkEvent?.type==='tool.call'&&event.payload.talkEvent.payload?.name==='openclaw_agent_consult'){
      nativeTasks.get(event.payload.voiceSessionId)?.watch(event.payload.talkEvent.callId);
    }
    if (event.event !== "talk.event") return;
    const context = [local, ...contexts.values()].find(item => item.active?.reservation.voiceSessionId === event.payload?.voiceSessionId);
    if (!context) return;
    const item = event.payload.talkEvent;
    // Native caption snapshots are the single USER source: they also arrive when
    // a deployment filters Gateway transcript events. Mixing normalized and
    // native turn IDs would incorrectly revoke the current decision.
    if(item?.type==='output.text.done')void context.active.callControl?.observe({role:'assistant',text:item.payload?.text,final:true});
    const publish = message => {
      const view = context.active.presentation;
      if (view) {
        message.revision = ++view.revision;
        if (message.name === 'openclaw_end_call' || message.backendFinal === true) {
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
    if (item.type === "tool.result" && item.payload?.name === "openclaw_agent_consult") message.backendFinal = true;
    if (item.payload?.name === "openclaw_end_call") {
      message.name = "openclaw_end_call";
      if (typeof item.payload.requestId === "string") message.requestId = item.payload.requestId;
      if (typeof item.payload.originUserTurnId === "string") message.originUserTurnId = item.payload.originUserTurnId;
      if (item.payload.source === "backend_model_client_tool") {
        message.source = item.payload.source;
        for (const field of ["nativeDelegationId", "backendRunId", "backendToolCallId", "status", "nativeAssistantTurnIdAtAcceptance"])
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
    if(!context||!req.headers.cookie||req.headers.cookie!==context.active.cookie){socket.destroy();return;}
    // Re-check the live access cookie, not just a remembered session ticket.
    const binding=entries.resolve(url);
    if(!binding||binding.sessionKey!==context.active.sessionKey){socket.destroy();return;}
    if(hosted?!entryAccess(binding).read(req):!String(req.headers.cookie).split(/;\s*/u).includes(`v_live_experiment=${cookie}`)){socket.destroy();return;}
    directVoice.upgrade(req,socket,head,url.searchParams.get('voiceSessionId'),url.searchParams.get('ticket'));
  });
  return { server, emit, dispose: async ({drain=false}={}) => {
    stopping=true;clearInterval(timer);
    for (const context of [local, ...contexts.values()]) { for (const response of context.listeners) response.end(); await close(context).catch(() => {}); }
    if(drain)while([...nativeTaskOwners].some(d=>d.pending))await new Promise(resolve=>setTimeout(resolve,50));
    for(const delivery of nativeTaskOwners)delivery.dispose();nativeTaskOwners.clear();nativeTasks.clear();
    await directVoice?.dispose({drain});
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
      const timeout = setTimeout(() => { gateway?.stop(); reject(new Error("Gateway startup timed out")); }, 60000);
      gateway = new GatewayClient({ url: `ws://127.0.0.1:${config.gateway.port}`, token, deviceIdentity: null, clientName: "cli", mode: "cli", scopes: ["operator.read", "operator.write", "operator.admin"], caps:["voice-direct-tools","tool-events"], onHelloOk: () => { clearTimeout(timeout); resolve(); }, onEvent: (event) => bridge?.emit(event), onConnectError: (error) => {
        if(error.code === "UNAVAILABLE" && error.retryable === true) return;
        clearTimeout(timeout); gateway?.stop(); reject(error);
      } }); gateway.start();
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
    const lark=createVoiceLarkReader({environment:process.env});
    const directVoice=createDirectVoiceService({gateway,wsModule,calendar:lark.calendar,larkRead:lark.read,
      audit:transcriptLog.audit,
      toolEnvironment:Object.fromEntries(["LARKSUITE_CLI_CONFIG_DIR","LARKSUITE_CLI_DATA_DIR"].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),
      apiKeys:{
      seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY,
      grok:process.env.XAI_API_KEY,
    },loadContext:async sessionKey=>{
      const history=await gateway.request('chat.history',{sessionKey,limit:6},{timeoutMs:10000});
      return voiceConversationContext(history.messages??[]);
    }});
    bridge = createLiveH5Server({ gateway,
      directVoice, avatarLog,callControlAudit:transcriptLog.audit,
      conversationEntries: process.env.VOICE_ENTRIES_FILE ? JSON.parse(await readFile(process.env.VOICE_ENTRIES_FILE,"utf8")) : [],
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
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void bridge.dispose({drain:true}).finally(async () => { await transcriptLog?.close(); await avatarLog?.close(); gateway?.stop(); process.exit(0); }));
}
