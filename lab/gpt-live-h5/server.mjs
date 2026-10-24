#!/usr/bin/env node
import {feishuCallerIdentityInstructions} from '../../lib/feishu-caller-identity.mjs';
import {createReleaseGate, readRelease, listenReleaseControl} from '../../lib/release-control.mjs';
import {controlVoiceTask} from '../../lib/voice-task-control.mjs';
import {createVoiceCallControl,callControlEvaluatorFromEnv} from './call-control.mjs';
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import {WebSocketServer, WebSocket} from "ws";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAvatarReactionSelector, avatarEvaluatorFromEnv } from "./avatar-decision.mjs";
import { AVATAR_FILES, taskActivity } from "./avatar-state.mjs";
import { createVoiceAccess } from "./access.mjs";
import {createConversationCalls,callIdValid,callSummarizerFromEnv} from '../../lib/conversation-calls.mjs';
import {createIosBindings,iosAppDownload,IosBindingAuthorizationError} from '../../lib/ios-bindings.mjs';
import { createConversationEntries } from "../../lib/conversation-entries.mjs";
import { verifyPhoneSession } from "../../lib/phone-provisioning.mjs";
import {conversationReplyTarget,createConversationReplyDelivery} from '../../lib/conversation-replies.mjs';
import {createFeishuConversationDirectory,parseFeishuConversationPhone,createUnidentifiedPhoneDirectory} from '../../lib/feishu-conversation-directory.mjs';
import {createFeishuPhoneLogin,readFeishuPhoneLoginFile,feishuPhoneLoginFailure,feishuPhoneLoginErrorPage} from '../../lib/feishu-phone-login.mjs';
import {normalizeAvatarEvent} from './avatar-telemetry.mjs';
import {createAvatarTelemetryLog} from './avatar-telemetry-log.mjs';
import {createTaskDelivery} from '../realtime-direct-tools/task-delivery.mjs';
import {createVoiceLarkReader} from '../realtime-direct-tools/lark-readonly.mjs';
import { createVoiceTranscriptLog } from '../realtime-direct-tools/transcript-log.mjs';
import {voiceConversationContext} from '../realtime-direct-tools/conversation-context.mjs';
import {grokVoice} from '../realtime-direct-tools/grok-provider.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export function createLiveH5Server({ gateway, offer, directVoice, listening, speakerRouting, speakerFixture, candidateRelease, phoneInputPolicy = "speaker", preview = false, basePath = "", publicOrigin = "", accessToken = "", maxActiveSessions = 8, maxActiveSessionsPerIp = 2, avatarEvaluate = avatarEvaluatorFromEnv(), avatarLog, callControlAudit=()=>{}, callControlEvaluate=callControlEvaluatorFromEnv(), conversationEntries = [], personalReply = {}, feishuAccounts = {}, feishuLogin, iosBindingsFile, iosAppDownloadUrl, callReportsDirectory, callSummarize=callSummarizerFromEnv(), defaultModel = "gpt-live", gptProvider = process.env.VOICE_GPT_PROVIDER ?? "openai", deviceEndpoint = null }) {
  if (!['native','speaker'].includes(phoneInputPolicy)) throw new Error('Invalid phone input policy');
  if (!["gpt-live","seeduplex","grok"].includes(defaultModel)) throw new Error("Invalid default voice model");
  basePath = basePath.replace(/\/$/u, "");
  if (basePath && !/^\/[a-zA-Z0-9_-]+$/u.test(basePath)) throw new Error("Invalid voice base path");
  const hosted = Boolean(publicOrigin || accessToken);
  const backendReady = () => !preview && gateway?.ready !== false;
  const origin = hosted ? new URL(publicOrigin) : null;
  if (hosted && (origin.protocol !== "https:" || origin.origin !== publicOrigin || !basePath)) throw new Error("Hosted voice requires an HTTPS origin and base path");
  if (!Number.isInteger(maxActiveSessions) || maxActiveSessions < 1 || maxActiveSessions > 50 || !Number.isInteger(maxActiveSessionsPerIp) || maxActiveSessionsPerIp < 1 || maxActiveSessionsPerIp > maxActiveSessions) throw new Error("Invalid voice call limits");
  const entries = createConversationEntries(conversationEntries, accessToken, personalReply);
  const replyTargets=new Map(entries.replyBindings().map(e=>[e.id,conversationReplyTarget(e,feishuAccounts)]));
  const appDownload=iosAppDownload(iosAppDownloadUrl);
  const phoneLogin = feishuLogin ? createFeishuPhoneLogin({...feishuLogin, publicOrigin, basePath, entries,
    ...(feishuLogin.conversations===true?{resolveConversation:createFeishuConversationDirectory({gateway,...feishuLogin})}:{})}) : null;
  const guestAccess=hosted&&feishuLogin?.conversations===true&&feishuLogin.allowUnidentified===true
    ?createVoiceAccess(createHash('sha256').update('voice-guest:'+feishuLogin.appSecret).digest('hex'),basePath,Date.now,{entry:'unidentified'}):null;
  const guestBinding=guestAccess?createUnidentifiedPhoneDirectory({accountId:feishuLogin.accountId,access:guestAccess}):()=>null;
  const resolveBinding=async(req,url)=>{
    const devicePhone=iosBindings?.canonicalPhone(url.searchParams.get('phone'))??url.searchParams.get('phone');
    const phone=phoneLogin?.canonicalPhone(devicePhone)??devicePhone;
    if(phone&&phone!==url.searchParams.get('phone')){url=new URL(url);url.searchParams.set('phone',phone);}
    try {
      const device=parseFeishuConversationPhone(url.searchParams.get('phone'))&&iosBindings?.principalFor(req,url.searchParams.get('phone'),req.iosExchangeBody);
      const binding=phoneLogin?.read(req)?await phoneLogin.resolve(req,url):device?.type==='guest'?guestBinding(req,url.searchParams.get('phone'),{id:device.visitorId}):device?await phoneLogin?.resolveDevice(device,url.searchParams.get('phone')):phoneLogin?await phoneLogin.resolve(req,url):entries.resolve(url);
      if(binding)return binding;
    }
    catch(error){if(!guestAccess||!parseFeishuConversationPhone(url.searchParams.get('phone')))throw error;}
    return guestBinding(req,url.searchParams.get('phone'));
  };
  const guestModel=()=>directVoice?.models().find(m=>m.available&&m.id==='seeduplex')?.id??directVoice?.models().find(m=>m.available)?.id??'seeduplex';
  const entryPresentation=binding=>binding.permissionProfile==='unidentified'?{unidentified:true,accountLoginHref:`${basePath}/feishu?phone=${encodeURIComponent(binding.id)}&oauth=1`,defaultModel:guestModel(),iosBindingAvailable:hosted,speakerRouting:false,comparisonAvailable:false,
    models:[{id:'gpt-live',label:'GPT Live One',available:false},...(directVoice?.models()??[])]}:binding.callerIdentity?{accountLabel:binding.callerIdentity.displayName||'飞书账号已连接',accountLoginHref:`${basePath}/feishu?phone=${encodeURIComponent(binding.id)}&retry=1`}:{};
  const callReports=createConversationCalls({gateway,directory:callReportsDirectory,publicOrigin,basePath,summarize:callSummarize,audit:callControlAudit});
  const accessors = new Map();
  const entryAccess = binding => {
    if (!hosted) return null;
    if(binding.permissionProfile==='unidentified')return guestAccess;
    const key=binding.id+':'+binding.callerId;
    const entry=binding.permissionProfile==='feishu-current'?'feishu-'+createHash('sha256').update(key).digest('hex').slice(0,40):binding.id;
    if (!accessors.has(key)) accessors.set(key, createVoiceAccess(binding.accessToken, basePath, Date.now, {entry}));
    return accessors.get(key);
  };
  const access = entryAccess(entries.resolve(new URL("http://localhost")));
  const iosBindings=hosted?createIosBindings({file:iosBindingsFile,basePath,publicOrigin,
    canonicalPhone:phone=>phoneLogin?.canonicalPhone(phone)??phone,legacyBinding:phone=>phoneLogin?.legacyBinding(phone),permits:(principal,binding)=>{
    if(principal?.type==='guest')return binding.permissionProfile==='unidentified'&&principal.visitorId===binding.visitorId;
    if(principal?.type==='feishu')return phoneLogin?.actorPermits(principal,binding)===true;
    return principal?.type==='entry'&&!phoneLogin?.protects(binding)&&principal.entry===binding.id;
  }}):null;
  const readVisitor=(req,binding)=>{
    const visitor=entryAccess(binding)?.read(req);
    return visitor&&(binding.permissionProfile!=='unidentified'||visitor.id===binding.visitorId)?visitor:iosBindings?.read(req,binding)??null;
  };
  const bindingPrincipal=(req,binding)=>{
    if(binding.permissionProfile==='unidentified')return guestAccess.read(req)?.id===binding.visitorId?{type:'guest',visitorId:binding.visitorId}:null;
    if(phoneLogin?.protects(binding)){
      const actor=phoneLogin.read(req);return actor&&phoneLogin.permits(req,binding)?{type:'feishu',tenantKey:actor.tenantKey,openId:actor.openId,...(actor.callerId?{callerId:actor.callerId}:{}),...(actor.userId?{userId:actor.userId}:{}),...(actor.displayName?{displayName:actor.displayName}:{})}:null;
    }
    return entryAccess(binding)?.read(req)?{type:'entry',entry:binding.id}:null;
  };
  const issueVisitor=(res,binding,visitor)=>{
    const cookies=res.getHeader('set-cookie');
    const issued=entryAccess(binding).issue(res,visitor);
    if(cookies)res.setHeader('set-cookie',[cookies].flat().concat([res.getHeader('set-cookie')].flat()));
    return issued;
  };
  const entrySnapshot=binding=>({ready:backendReady(),preview,defaultModel,
    ...(directVoice?.attach?{nativeDialVersion:1}:{}),conversation:{name:binding.displayName??'我的 V',kind:binding.kind,replySync:binding.replySync},iosBindingAvailable:hosted,
    ...(speakerRouting?{speakerRouting:true,phoneInputPolicy}:{}),...(listening?{comparisonAvailable:true}:{}),
    ...(directVoice?{models:[{id:'gpt-live',label:'GPT Live One',available:true,nativeTransport:'webrtc'},...directVoice.models()]}:{}),...entryPresentation(binding)});
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
    await old?.replyDelivery?.close();
    old?.callControl?.close();
    if(old)speakerRouting?.close(old.reservation.voiceSessionId);
    if (old) visual.forget(old.reservation.voiceSessionId);
    if (old?.direct) await directVoice.close(old.reservation.voiceSessionId);
    else if (old) await (old.gateway??gateway).request("talk.client.close", { sessionKey: old.sessionKey, voiceSessionId: old.reservation.voiceSessionId });
    if(old&&!old.direct)callControlAudit({type:'call.closed',voiceSessionId:old.reservation.voiceSessionId});
    if (context.active === old) {context.active = null;const owner=context.avatarOwners?.get(old?.reservation.voiceSessionId);if(owner)owner.endedAt=Date.now();}
  };
  const releaseClosedDirectCalls=()=>{
    if(typeof directVoice?.hasSession!=='function')return;
    for(const context of [local,...contexts.values()]){
      const old=context.active;
      // Reserved, live and cleanup-pending sessions remain owned. Only a
      // fully retired native session can release another device's lock.
      if(!old?.direct||directVoice.hasSession(old.reservation.voiceSessionId))continue;
      visual.forget(old.reservation.voiceSessionId);
      context.active=null;
      const owner=context.avatarOwners?.get(old.reservation.voiceSessionId);if(owner)owner.endedAt=Date.now();
    }
  };
  const releaseReadiness = () => ({
    known: !directVoice || typeof directVoice.backgroundTaskCount === 'function',
    activeCalls: [local, ...contexts.values()].filter(c=>c.active).length + (deviceEndpoint?.activeCalls() ?? 0),
    creatingSessions: [local, ...contexts.values()].filter(c=>c.creatingSession).length,
    backgroundTasks: callReports.pending + [...nativeTaskOwners].filter(task=>task.pending).length + (directVoice?.backgroundTaskCount?.() ?? 0),
    deviceOperations: deviceEndpoint?.pendingOperations?.() ?? 0,
  });
  const releaseGate = createReleaseGate({readiness: releaseReadiness});
  deviceEndpoint?.setAdmissionGate?.(() => releaseGate.blocked());
  // HTTP and one-connection native dialing share admission, exact-session
  // verification, limits, ownership and reservation. A transport never selects identity.
  const reservePhoneCall = async ({context,binding,params,req,ip,cancelled=()=>false}) => {
    const reply=(status,body)=>({status,body});
    const unidentified=binding.permissionProfile==='unidentified';
    if(unidentified){
      params={...params,model:params.model??guestModel(),inputPolicy:'native'};
      if(!directVoice||!directVoice.models().some(m=>m.id===params.model&&m.available))return reply(400,{error:'当前访客电话请选择小何或 Grok。'});
    }
    if (releaseGate.blocked()) return reply(503,{error:"V 正在更新，请稍后重新拨号。"});
    if (!backendReady()) return reply(503,{error:"V 后端正在重新连接，请稍后重拨。"});
    if(speakerRouting&&params.inputPolicy!==undefined&&!['native','speaker'].includes(params.inputPolicy))return reply(400,{error:'没有这个输入策略'});
    if(params.nativeRuntimeVersion!==undefined&&params.nativeRuntimeVersion!==1)return reply(400,{error:'不支持的原生能力协议'});
    if (params.model && !['gpt-live','seeduplex','grok'].includes(params.model)) return reply(400,{error:'没有这个语音模型'});
    if (params.model === 'grok') {
      try { grokVoice(params.voice); } catch (error) { return reply(400,{error:error.message}); }
    }
    if (params.model && params.model !== 'gpt-live' && !directVoice) return reply(503,{error:'这个语音模型尚未接入'});
    if (context.creatingSession) return reply( 409, { error: "正在连接 V，请稍等。" });
    // All devices share the selected personal conversation. Do not let a
    // second device replace another device's voice owner or pending work.
    if ([...contexts.values()].some(item => item !== context && item.sessionKey === binding.sessionKey && (item.active || item.creatingSession)) || deviceEndpoint?.busy(binding.sessionKey)) {
      return reply( 409, { error: "另一台设备正在和 V 通话，请先结束那边的通话。" });
    }
    if (hosted) {
      const busy = [...contexts.values()].filter(item => item.active || item.creatingSession);
      if (!context.active && busy.length >= maxActiveSessions) return reply( 503, { error: "现在和 V 说话的人有点多，请稍后再试" });
      if (!context.active && busy.filter(item => item.ip === ip).length >= maxActiveSessionsPerIp) return reply( 429, { error: "这台设备已有通话，请先结束后再试" });
      if (!allow(`call:${ip}`)) return reply( 429, { error: "通话开始得太频繁，请稍后再试" });
      context.ip = ip;
    }
    context.creatingSession = true;
    try {
      // New phone entries cannot create a guessed or stale conversation.
      // Keep the accepted legacy personal entry's startup path unchanged.
      if (binding.id !== 'tianyi'&&!unidentified) await verifyPhoneSession(binding.gateway??gateway, binding);
      if(cancelled())return reply(499,{error:"拨号已取消"});
      await close(context);
      if(cancelled())return reply(499,{error:"拨号已取消"});
      const sessionKey = binding.sessionKey;
      const callGateway=binding.gateway??gateway;
      const replyTarget=binding.replyTarget??replyTargets.get(binding.id)??null;
      // Use the verified App grant, not user agent or caller-supplied flags.
      // Shared by HTTP dialing (including GPT) and the native fast socket.
      const reportOptions={statusCard:!iosBindings?.read(req,binding)};
      if (params.model && params.model !== 'gpt-live') {
        // SeedDuplex needs the continuous microphone stream to own turn
        // taking. Keep household/multi-speaker routing available explicitly;
        // the deployment selects the phone default, not browser heuristics.
        // Clients opt in only after implementing native response ownership and reversible pause.
        const inputPolicy = params.inputPolicy ?? 'speaker';
        const reservation = await directVoice.reserve({model:params.model,sessionKey,voice:params.voice,...(unidentified?{unidentified:true}:{}),...(binding.callerIdentity?{callerIdentity:binding.callerIdentity}:{}),...(binding.gateway?{gateway:callGateway,actorScoped:true,agentId:binding.agentId}:{}),...(params.nativeRuntimeVersion===1?{nativeRuntimeVersion:1}:{}),...(replyTarget?{replyTarget,callReportFactory:ownerId=>callReports.begin(binding,replyTarget,ownerId,reportOptions)}:{}),...(binding.id!=='tianyi'?{sessionBound:true}:{}),...(speakerRouting||unidentified)?{inputPolicy}:{}});
        context.active={sessionKey,gateway:callGateway,reservation,direct:true,touchedAt:Date.now(),cookie:req.headers.cookie};
        if(cancelled()){await close(context);return reply(499,{error:"拨号已取消"});}
        rememberAvatarCall(context,context.active,params.model);
        return reply(200,reservation);
      }
      const reservation = await callGateway.request("talk.client.create", { sessionKey, provider: gptProvider, model: "gpt-live-1-codex", voice: "sol", mode: "realtime", transport: "webrtc", brain: "agent-consult", capabilities: ["voice-transcript"] }, { timeoutMs: 45000 });
      const replyDelivery=createConversationReplyDelivery({gateway:callGateway,target:replyTarget,ownerId:reservation.voiceSessionId,audit:callControlAudit,callReport:callReports.begin(binding,replyTarget,reservation.voiceSessionId,reportOptions),onStatus:value=>{for(const response of context.listeners)response.write(`data: ${JSON.stringify({type:'reply.sync',voiceSessionId:reservation.voiceSessionId,...value})}\n\n`);}});
      const taskDelivery=createTaskDelivery({gateway:callGateway,sessionKey,ownerId:reservation.voiceSessionId,replyDelivery,
        ...(gptProvider==='v-voice-gpt-live'?{readNativeResult:runId=>callGateway.request('voice.product.task-result',{clientSecret:reservation.clientSecret,runId},{timeoutMs:10000})}:{}),
        audit:callControlAudit,onIdle:()=>{nativeTaskOwners.delete(taskDelivery);if(nativeTasks.get(reservation.voiceSessionId)===taskDelivery)nativeTasks.delete(reservation.voiceSessionId);}});
      nativeTaskOwners.add(taskDelivery);
      // Task audit only. Native GPT captions remain Gateway-owned.
      callControlAudit({type:'call.created',voiceSessionId:reservation.voiceSessionId,sessionKey,provider:'openai',model:reservation.model});
      context.active = { sessionKey, gateway:callGateway, reservation, cookie:req.headers.cookie, touchedAt: Date.now(), taskDelivery, replyDelivery, presentation: { revision: 0, pending: new Map(), documents: new Map(), controls: [] } };
      nativeTasks.set(reservation.voiceSessionId,context.active.taskDelivery);
      if (reservation.model !== "gpt-live-1-codex" || reservation.transport !== "webrtc" || reservation.offerUrl !== "/plugins/openai/realtime/calls") {
        await close(context);
        return reply( 409, { error: "候选语音配置与 GPT Live 实验不匹配" });
      }
      const owned=context.active;
      owned.callControl=createVoiceCallControl({evaluate:callControlEvaluate,audit:event=>callControlAudit({...event,voiceSessionId:owned.reservation.voiceSessionId}),isCurrent:()=>context.active===owned,onAccepted:async value=>{
        if(context.active!==owned)return;
        const message={...value,voiceSessionId:owned.reservation.voiceSessionId,revision:++owned.presentation.revision};
        owned.presentation.controls.push(message);if(owned.presentation.controls.length>64)owned.presentation.controls.shift();
        for(const response of context.listeners)response.write(`data: ${JSON.stringify(message)}\n\n`);
      }});
      rememberAvatarCall(context,context.active,'openai');
      const speaker=speakerRouting?.reserve(reservation.voiceSessionId,{model:'gpt-live',policy:params.inputPolicy??'speaker'});
      return reply( 200, { voiceSessionId: reservation.voiceSessionId, model: reservation.model,...(binding.callerIdentity?{callerContext:{voiceSessionId:reservation.voiceSessionId,text:feishuCallerIdentityInstructions(binding.callerIdentity)}}:{}),...speaker?{speakerRouting:speaker}:{} });
    } finally {
      context.creatingSession = false;
    }
  };
  const dialSockets = new WebSocketServer({noServer:true,maxPayload:70000,perMessageDeflate:false});
  const server = createServer(async (req, res) => {
    res.setHeader("referrer-policy", "no-referrer"); res.setHeader("x-content-type-options", "nosniff");
    try {
      if(stopping)return json(res,503,{error:"服务正在收尾，请稍后重新拨号"});
      const host = req.headers.host ?? "";
      const devicePathname = deviceEndpoint && new URL(req.url, "http://device.invalid").pathname;
      if (deviceEndpoint && (deviceEndpoint.otaPath && devicePathname === deviceEndpoint.otaPath || deviceEndpoint.visionPath && devicePathname === deviceEndpoint.visionPath)) {
        // Device HTTP (OTA check, camera photo upload) authenticates itself; some firmware omits the port in Host.
        const hostname = (() => {try {return new URL(`http://${host}`).hostname;} catch {return "";}})();
        if (hosted ? hostname !== origin.hostname : !/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)) return json(res, 403, { error: "请求入口不匹配" });
        return devicePathname === deviceEndpoint.otaPath ? deviceEndpoint.handleOta(req, res) : deviceEndpoint.handleVision(req, res);
      }
      if (hosted ? host !== origin.host : !/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)) return json(res, 403, { error: "请求入口不匹配" });
      const requestOrigin = hosted ? publicOrigin : `http://${host}`;
      if (req.headers.origin && req.headers.origin !== requestOrigin || hosted && req.method === "POST" && req.headers.origin !== requestOrigin) return json(res, 403, { error: "请求来源不匹配" });
      const url = new URL(req.url, requestOrigin);
      if (basePath && url.pathname === basePath && req.method === "GET") { res.writeHead(308, { location: `${basePath}/${url.search}`, "cache-control": "no-store" }); res.end(); return; }
      if (basePath && !url.pathname.startsWith(`${basePath}/`)) return json(res, 404, { error: "没有这个入口" });
      let pathname = basePath ? url.pathname.slice(basePath.length) : url.pathname;
      if(req.method==='POST'&&pathname==='/api/entry-timing'){
        const ip=String(req.headers['cf-connecting-ip']??req.socket.remoteAddress??'unknown').slice(0,128);
        if(!allow('entry-timing:'+ip))return json(res,429,{ok:false});
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2048)return json(res,413,{ok:false});chunks.push(chunk);}
        let value;try{value=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{ok:false});}
        const duration=n=>Number.isFinite(n)&&n>=0&&n<=120000;
        if(!duration(value?.totalToDialMs)||!Array.isArray(value.stages))return json(res,400,{ok:false});
        const names=new Set(['login.start','sdk.loaded','sdk.ready','client.code','identity.confirmed','login.complete']);
        const stages=value.stages.slice(0,8).filter(s=>names.has(s?.name)&&duration(s.ms)).map(s=>({name:s.name,ms:Math.round(s.ms)}));
        const server=Object.fromEntries(['app_token','code_exchange','user_info','conversation'].filter(k=>duration(value.server?.[k])).map(k=>[k,Math.round(value.server[k])]));
        console.info(JSON.stringify({type:'voice.entry-timing',outcome:['identified','guest'].includes(value.outcome)?value.outcome:'unknown',totalToDialMs:Math.round(value.totalToDialMs),stages,server}));
        return json(res,200,{ok:true});
      }
      const iosExchange=pathname==='/api/ios-binding/redeem'||pathname==='/api/ios-binding/access';
      if(iosExchange&&req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return json(res,413,{error:'绑定请求过大'});chunks.push(chunk);}
        try{req.iosExchangeBody=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'绑定请求无效'});}
      }
      // Old group links are aliases, never a source of a caller's personal identity.
      const originalPhone=url.searchParams.get('phone'),devicePhone=iosBindings?.canonicalPhone(originalPhone)??originalPhone,canonicalPhone=phoneLogin?.canonicalPhone(devicePhone)??devicePhone;
      if(canonicalPhone&&canonicalPhone!==originalPhone)url.searchParams.set('phone',canonicalPhone);
      let entryVisitor = null, entryBinding = null, clientLoginConfig = null;
      const handoffBinding=phoneLogin&&pathname==='/feishu'?phoneLogin.consumeHandoff(req,url.searchParams.get('phone'),url.searchParams.get('identified')):null;
      if(phoneLogin&&pathname==='/feishu/client-login'&&req.method==='POST') {
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)return json(res,413,{error:'登录请求过大'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'登录请求无效'});}
        const pending=phoneLogin.clientPending(req,body.state);
        if(!pending)return json(res,401,{error:'请重新打开电话入口'});
        try {
          if(body.failure){
            phoneLogin.cancelClient(req,body.state);
            console.warn(JSON.stringify({type:'voice.feishu-client-error',stage:'sdk',providerCode:Number.isInteger(body.failure.code)?body.failure.code:null}));
          } else {
            const result=await phoneLogin.completeClient(req,res,body,{inline:true});
            issueVisitor(res,result.binding);
            return json(res,200,{location:result.location,status:entrySnapshot(result.binding)});
          }
        } catch(error) {console.warn(JSON.stringify({type:'voice.feishu-login-error',...feishuPhoneLoginFailure(error)}));}
        if(!guestAccess)return json(res,401,{error:'飞书账号暂未连接，请重试。'});
        phoneLogin.clearIdentity(res);
        const guest=guestBinding(req,pending.phone,guestAccess.read(req)??{id:randomBytes(16).toString('hex')});
        issueVisitor(res,guest,{id:guest.visitorId});
        return json(res,200,{location:`${basePath}/feishu?phone=${encodeURIComponent(pending.phone)}&guest=1`,status:entrySnapshot(guest)});
      }
      const currentPhone=url.searchParams.get('phone');
      const inFeishu=/Lark|Feishu/iu.test(req.headers['user-agent']??'');
      const sdkEntry=phoneLogin&&guestAccess&&req.method==='GET'&&parseFeishuConversationPhone(currentPhone)
        &&!handoffBinding&&url.searchParams.get('guest')!=='1'&&url.searchParams.get('oauth')!=='1'&&url.searchParams.get('retry')!=='1';
      if(sdkEntry&&inFeishu&&['/','/feishu'].includes(pathname)){
        // requestAccess validates the document URL. Use the already registered
        // callback as the phone page itself, not an intermediate login screen.
        const query=new URLSearchParams({phone:currentPhone});
        if(callIdValid(url.searchParams.get('call')))query.set('call',url.searchParams.get('call'));
        res.writeHead(302,{location:`${basePath}/feishu/callback?${query}`,'cache-control':'no-store'});res.end();return;
      }
      if(sdkEntry&&pathname==='/feishu/callback'&&(url.searchParams.get('client')==='1'||inFeishu&&!url.searchParams.has('code')&&!url.searchParams.has('state')&&!url.searchParams.has('error'))){
        const oldState=url.searchParams.get('client')==='1'?url.searchParams.get('state'):null;
        if(oldState&&!phoneLogin.clientPending(req,oldState))return json(res,401,{error:'请重新打开电话入口'});
        phoneLogin.clearIdentity(res);
        const cleared=res.getHeader('set-cookie');
        const callback=oldState?null:new URL(phoneLogin.beginClient(req,res,currentPhone),publicOrigin);
        if(callback)res.setHeader('set-cookie',[cleared,res.getHeader('set-cookie')]);
        entryBinding=guestBinding(req,currentPhone,guestAccess.read(req)??{id:randomBytes(16).toString('hex')});
        entryVisitor=issueVisitor(res,entryBinding,{id:entryBinding.visitorId});
        clientLoginConfig={appId:feishuLogin.appId,state:oldState??callback.searchParams.get('state'),endpoint:basePath+'/feishu/client-login'};
        pathname='/';
      }
      if(guestAccess&&req.method==='GET'&&pathname==='/feishu/connect'){
        res.writeHead(302,{location:`${basePath}/feishu?phone=${encodeURIComponent(url.searchParams.get('phone')??'')}`,'cache-control':'no-store'});res.end();return;
      }
      if(['/feishu/connect','/feishu/connect/status'].includes(pathname))return json(res,410,{error:'此登录方式已移除，请重新打开电话入口。'});
      if (phoneLogin && req.method === 'GET' && (pathname === '/feishu' || pathname === '/feishu/callback')) {
        try {
          let location;
          if (pathname === '/feishu/callback'&&(url.searchParams.has('code')||url.searchParams.has('state')||url.searchParams.has('error'))) location = await phoneLogin.complete(req, res, url);
          else {
            let selected=null;
            if(url.searchParams.get('retry')!=='1'&&url.searchParams.get('guest')!=='1'){
              try{selected=handoffBinding||await phoneLogin.select(req,url.searchParams.get('phone'));}
              catch(error){if(!guestAccess)throw error;}
            }
            const target=parseFeishuConversationPhone(url.searchParams.get('phone'));
            if(!selected&&guestAccess&&target?.accountId===feishuLogin.accountId&&url.searchParams.get('oauth')!=='1'&&url.searchParams.get('retry')!=='1'){
              entryVisitor=guestAccess.issue(res,guestAccess.read(req)??{});
              if(url.searchParams.get('guest')==='1') {
                const guestCookie=res.getHeader('set-cookie');phoneLogin.clearIdentity(res);
                res.setHeader('set-cookie',[res.getHeader('set-cookie'),guestCookie]);
              }
              selected=guestBinding(req,url.searchParams.get('phone'),entryVisitor);
            }
            if (selected) {
              entryBinding = selected;
              entryVisitor ??= issueVisitor(res,selected);
              // An explicit, authenticated phone entry can serve its first
              // frame here. Relative assets/API URLs keep the same base path.
              if (url.searchParams.get('phone') === selected.id) pathname = '/';
              else location = `${basePath}/?phone=${encodeURIComponent(selected.id)}${callIdValid(url.searchParams.get('call'))?'&call='+url.searchParams.get('call'):''}`;
            } else location = phoneLogin.begin(req, res, url.searchParams.get('phone'),url.searchParams.get('call'),{promptConsent:url.searchParams.get('retry')==='1'});
          }
          if (location) { res.writeHead(302, {location, 'cache-control': 'no-store'}); res.end(); return; }
        } catch (error) {
          if(guestAccess&&parseFeishuConversationPhone(error.recoveryPhone)) {
            res.writeHead(302,{location:`${basePath}/feishu?phone=${encodeURIComponent(error.recoveryPhone)}&guest=1`,'cache-control':'no-store'});res.end();return;
          }
          const failure=feishuPhoneLoginFailure(error);
          console.warn(JSON.stringify({type:'voice.feishu-login-error', ...failure}));
          // Login recovery is a public document; protected APIs still reject access.
          // Embedded browsers may replace a 403 document with their own error page.
          res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});
          res.end(feishuPhoneLoginErrorPage({reason:failure.reason,phone:error.recoveryPhone??url.searchParams.get('phone'),basePath}));
          return;
        }
      }
      if(req.method==='GET'&&pathname==='/feishu-client-login.mjs') {
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});
        res.end(await readFile(join(here,'feishu-client-login.mjs')));return;
      }
      if (url.searchParams.get("entry") === "visitor") return json(res, 404, { error: "普通人电话入口尚未开放。" });
      if(parseFeishuConversationPhone(url.searchParams.get('phone'))&&!phoneLogin?.read(req)&&!iosBindings?.principalFor(req,url.searchParams.get('phone'),req.iosExchangeBody)&&!guestBinding(req,url.searchParams.get('phone'))&&!entryBinding){
        if(req.method==='GET'&&pathname==='/'){res.writeHead(302,{location:`${basePath}/feishu?phone=${encodeURIComponent(url.searchParams.get('phone'))}`,'cache-control':'no-store'});res.end();return;}
        return json(res,401,{error:'请从飞书会话电话入口登录。'});
      }
      const binding = entryBinding ?? await resolveBinding(req,url);
      if (!binding) return json(res,404,{error:"这个电话入口不存在或已关闭。"});
      const entry = binding.id;
      const access = entryAccess(binding);
      if (phoneLogin?.protects(binding) && !phoneLogin.permits(req, binding) && !iosBindings?.read(req,binding)
        && !iosExchange && (pathname === '/' || pathname.startsWith('/api/'))) {
        if (req.method === 'GET' && pathname === '/') {
          res.writeHead(302, {location: `${basePath}/feishu?phone=${encodeURIComponent(entry)}${callIdValid(url.searchParams.get('call'))?'&call='+url.searchParams.get('call'):''}`, 'cache-control':'no-store'}); res.end(); return;
        }
        return json(res, 401, {error:'请从飞书电话入口登录后拨号。'});
      }
      const staticFiles = new Map([
        ["/ios-shell-release.json", [join(here, "ios-shell-release.json"), "application/json; charset=utf-8"]],
        ["/", [join(here, "index.html"), "text/html; charset=utf-8"]],
        ["/compare", [join(here, "comparison.html"), "text/html; charset=utf-8"]],
        ["/comparison.mjs", [join(here, "comparison.mjs"), "text/javascript; charset=utf-8"]],
        ["/comparison.css", [join(here, "comparison.css"), "text/css; charset=utf-8"]],
        ["/markdown.mjs", [join(here, "markdown.mjs"), "text/javascript; charset=utf-8"]],
        ["/vendor/marked-18.0.5.mjs", [join(here, "vendor/marked-18.0.5.mjs"), "text/javascript; charset=utf-8"]],
        ["/entry-startup.mjs", [join(here, "entry-startup.mjs"), "text/javascript; charset=utf-8"]],
        ["/app.js", [join(here, "app.js"), "text/javascript; charset=utf-8"]],
        ["/feishu-client-login.mjs", [join(here, "feishu-client-login.mjs"), "text/javascript; charset=utf-8"]],
        ["/events.mjs", [join(here, "events.mjs"), "text/javascript; charset=utf-8"]],
        ["/duplex-playback.mjs", [join(here, "duplex-playback.mjs"), "text/javascript; charset=utf-8"]],
        ["/speaker-routing.mjs", [join(here, "../speaker-native/client.mjs"), "text/javascript; charset=utf-8"]],
        ...["caller-context.mjs", "ui-bundle.mjs", "call-view.mjs", "media-references.mjs", "screen-wake-lock.mjs", "content-view.mjs", "microphone-capture.mjs", "microphone-session.mjs", "transcript-presentation.mjs", "call-sounds.mjs", "relay-audio.mjs", "avatar.mjs", "avatar-state.mjs", "avatar-catalog.mjs", "avatar-approved-reactions.mjs", "avatar-reactions.mjs", "avatar-telemetry.mjs"].map((name) => [`/${name}`, [join(here, name), "text/javascript; charset=utf-8"]]),
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
          let html = contents.toString("utf8").replace('<head>', `<head><base href="${basePath||''}/">`).replace('<link rel="stylesheet" href="./styles.css" />', `<style data-voice-entry>${css}</style>`);
          if(clientLoginConfig)html=html.replace('</head>','<link rel="preconnect" href="https://lf1-cdn-tos.bytegoofy.com"><link rel="preload" as="script" href="https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js"></head>').replace('<script type="module" src="./entry-startup.mjs"></script>',`<script type="application/json" id="login-config">${JSON.stringify(clientLoginConfig).replaceAll('<','\\u003c')}</script><script type="module" src="./entry-startup.mjs"></script>`);
          if(speakerRouting)html=html.replace('<body','<body data-speaker-routing="true"');
          if(candidateRelease)html=html.replace('<script type="module" src="./app.js"></script>',`<script type="application/json" id="voiceCandidateRelease">${JSON.stringify(candidateRelease).replaceAll('<','\\u003c')}</script><script type="module" src="./app.js"></script>`);
          // Only an authenticated request receives an entry snapshot. It is a
          // presentation hint; every session/tool request still authorizes itself.
          const visitor = hosted ? entryVisitor ?? readVisitor(req,binding) : null;
          const canCheckEntry = visitor && (contexts.has(`${entry}:${visitor.id}`) || contexts.size < 512);
          if (!hosted || canCheckEntry) {
            const initial = JSON.stringify(entrySnapshot(binding)).replaceAll("<", "\\u003c");
            html = html.replace('<script type="module" src="./app.js"></script>', `<script type="application/json" id="voiceEntryStatus">${initial}</script><script type="module" src="./app.js"></script>`);
          }
          contents = Buffer.from(html);
        }
        res.writeHead(200, { "content-type": type, "cache-control": pathname.startsWith("/assets/v-operator-") ? "public, max-age=86400" : "no-store" }); res.end(contents); return;
      }
      if(binding.permissionProfile==='unidentified'&&!new Set(['/api/status','/api/session','/api/presentation','/api/events','/api/content-shown','/api/avatar','/api/avatar-events','/api/heartbeat','/api/close','/api/ios-binding','/api/ios-binding/redeem','/api/ios-binding/access','/api/ios-binding/revoke']).has(pathname))return json(res,403,{error:'当前是身份未确认的临时通话。'});
      const readBody = async () => {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 70000) throw new Error("Request too large"); chunks.push(chunk); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      };
      const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown").slice(0, 128);
      if(hosted&&req.method==='POST'&&iosExchange){
        if(!allow(`ios-binding:${ip}`))return json(res,429,{error:'绑定尝试过多，请稍后再试。'});
        const params=req.iosExchangeBody??await readBody();
        if(Object.keys(params).some(key=>key!==(pathname.endsWith('/redeem')?'token':'deviceAccess')))return json(res,400,{error:'绑定请求包含不支持的参数。'});
        if(pathname.endsWith('/redeem')){
          try{return json(res,200,await iosBindings.redeem(binding,params.token));}
          catch(error){
            if(error instanceof IosBindingAuthorizationError)return json(res,403,{error:'绑定链接无效、已使用或已过期，请从当前飞书会话重新生成。'});
            console.warn(JSON.stringify({type:'voice.ios-binding-storage-error',reason:['EROFS','EACCES','ENOSPC','ENOTDIR'].includes(error.code)?error.code:'save_failed'}));
            return json(res,503,{error:'服务暂时无法保存 App 绑定，请稍后重新生成链接。原会话尚未切换。'});
          }
        }
        const result=iosBindings.authorize(binding,params.deviceAccess,res);
        return result?json(res,200,result):json(res,401,{error:'这个 App 绑定已失效，请从当前飞书会话重新绑定。'});
      }
      if (hosted && req.method === "POST" && pathname === "/api/access") {
        if (!allow(`access:${ip}`)) return json(res, 429, { error: "尝试次数过多，请稍后再试" });
        const params = await readBody();
        if (!access.accepts(params.access)) return json(res, 403, { error: "分享链接无效或已失效" });
        const visitor = access.issue(res); return json(res, 200, { ok: true, expiresAt: visitor.expiresAt });
      }
      let context = local;
      if (!hosted) { context = contexts.get(entry) ?? {...local,listeners:new Set(),entry,sessionKey:binding.sessionKey}; contexts.set(entry,context); }
      if (hosted) {
        const visitor = readVisitor(req,binding);
        if (!visitor) return json(res, 401, { error: "请使用完整的本人入口链接打开" });
        const contextId = `${entry}:${visitor.id}`;
        context = contexts.get(contextId);
        if (!context) {
          if (contexts.size >= 512) return json(res, 503, { error: "现在访问的人有点多，请稍后再试" });
          context = { active: null, creatingSession: false, listeners: new Set(), touchedAt: Date.now(), ip, entry, sessionKey:binding.sessionKey };
          contexts.set(contextId, context);
        }
      } else if (!String(req.headers.cookie ?? "").split(/;\s*/u).includes(`v_live_experiment=${cookie}`)) return json(res, 401, { error: "请先打开实验页面" });
      releaseClosedDirectCalls();
      context.touchedAt = Date.now();
      if(req.method==='GET'&&pathname.startsWith('/api/calls/')){
        const report=await callReports.read(binding,pathname.slice('/api/calls/'.length));return json(res,report?200:404,report??{error:'没有这通电话的记录，或当前会话无权查看。'});
      }
      if(hosted&&pathname==='/api/ios-binding'){
        const principal=bindingPrincipal(req,binding);
        if(!principal)return json(res,403,{error:'请从飞书或已授权网页入口生成新的 App 绑定。'});
        if(req.method==='GET')return json(res,200,{devices:iosBindings.list(binding,principal),appDownload});
        if(req.method==='POST'){
          if(!allow(`ios-binding-create:${entry}:${ip}`))return json(res,429,{error:'生成次数较多，请稍后再试。'});
          await iosBindings.refreshIdentity(binding,principal);
          return json(res,200,iosBindings.issue(binding,principal));
        }
      }
      if(hosted&&req.method==='POST'&&pathname==='/api/ios-binding/revoke'){
        const principal=bindingPrincipal(req,binding);if(!principal)return json(res,403,{error:'请从飞书或已授权网页入口管理绑定。'});
        const params=await readBody();const revoked=await iosBindings.revoke(binding,principal,params.deviceId);
        return json(res,revoked?200:404,revoked?{ok:true}:{error:'没有这个 App 绑定。'});
      }
      if (req.method === "GET" && pathname === "/api/status") return json(res, 200, {
        ready: backendReady(), preview, defaultModel, ...(directVoice?.attach?{nativeDialVersion:1}:{}), conversation:{name:binding.displayName??'我的 V',kind:binding.kind,replySync:binding.replySync},iosBindingAvailable:hosted, ...(speakerRouting&&binding.permissionProfile!=='unidentified'?{speakerRouting:true,phoneInputPolicy,speakerStats:speakerRouting.snapshot()}:{}),
        releaseReadiness: releaseReadiness(),
        ...(listening?{comparisonAvailable:true}:{}), model: "gpt-live-1-codex", activeCall: Boolean(context.active), creatingSession: context.creatingSession,
        ...(directVoice ? {models:[{id:'gpt-live',label:'GPT Live One',available:true,nativeTransport:'webrtc'},...directVoice.models()]} : {}),...entryPresentation(binding),
      });
      if(req.method==='GET'&&pathname==='/api/comparison')return listening?json(res,200,listening.manifest):json(res,404,{error:'当前没有试听样本'});
      if(req.method==='GET'&&pathname==='/api/speaker-fixture'){
        const fixture=await speakerFixture?.(url.searchParams.get('id'));
        if(!fixture)return json(res,404,{error:'没有这个内部验证音频'});
        res.writeHead(200,{'content-type':'audio/wav','cache-control':'no-store'});res.end(fixture);return;
      }
      if(['GET','HEAD'].includes(req.method)&&pathname.startsWith('/api/comparison/audio/')){
        const id=pathname.slice('/api/comparison/audio/'.length),audio=await listening?.audio(id,req.headers.range);
        if(!audio)return json(res,404,{error:'没有这个试听样本'});
        res.writeHead(audio.status,audio.headers);res.end(req.method==='HEAD'?undefined:audio.body);return;
      }
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
        const result=await reservePhoneCall({context,binding,params,req,ip});
        return json(res,result.status,result.body);
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
        if(params.final)owned.replyDelivery?.user(params.text,{turnId:params.turnId});
        if(params.final&&owned.taskDelivery?.observeUser(params.text))void owned.taskDelivery.subscribe().catch(error=>callControlAudit({type:'task.delivery-failed',voiceSessionId:params.voiceSessionId,error:error.message}));
        void owned.callControl?.observe({role:'user',turnId:params.turnId,text:params.text,final:params.final,snapshot:true});
        return json(res,200,{ok:true});
      }
      if (pathname === '/api/call-control-confirm') {
        const owned=context.active,value=params.control;
        if(!owned.callControl?.matches(value))return json(res,409,{error:'挂断意图已更新'});
        const proof=await (owned.gateway??gateway).request('voice.product.control',{clientSecret:owned.reservation.clientSecret,mode:'end'},{timeoutMs:3000});
        if(proof?.ok!==true||context.active!==owned||!owned.callControl.matches(value))return json(res,409,{error:'挂断意图已更新'});
        return json(res,200,{...value,type:'voice.end.accepted',voiceSessionId:owned.reservation.voiceSessionId});
      }
      if (pathname === "/api/offer") {
        if (typeof params.sdp !== "string" || !params.sdp.startsWith("v=0") || params.sdp.length > 65536) return json(res, 400, { error: "语音连接参数无效" });
        const owner = context.active;
        const sdp = await offer(owner.reservation, params.sdp);
        if (context.active !== owner) return json(res, 409, { error: "通话已结束，请重新开始" });
        owner.replyDelivery?.ready();
        return json(res, 200, { sdp });
      }
      if (pathname === "/api/ready") {
        const result = await (context.active.gateway??gateway).request("talk.client.toolCall", {
          sessionKey: context.active.sessionKey, voiceSessionId: context.active.reservation.voiceSessionId,
          callId: `host-ready-${randomUUID()}`, name: "openclaw_live_call_control", args: { action: "ready" },
        });
        if (result?.ok !== true) return json(res, 409, { error: "接通问候还未就绪，你可以直接说话。" });
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/steer") {
        if (!["steer", "cancel"].includes(params.mode) || typeof params.text !== "string" || !params.text.trim() || params.text.length > 2000) return json(res, 400, { error: "补充内容无效" });
        const result = await controlVoiceTask({gateway:context.active.gateway??gateway,sessionKey:context.active.sessionKey,native:true},params);
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
    releaseClosedDirectCalls();
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
    if(taskEvent?.type==='tool.call'&&taskEvent.payload?.name==='openclaw_background_task')nativeTasks.get(event.payload.voiceSessionId)?.requested(taskEvent.callId);
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
    if(item?.type==='output.text.delta')context.active.replyDelivery?.transcript(item.payload?.text??item.payload?.delta,{responseId:item.responseId??item.turnId});
    if(item?.type==='output.text.done'){
      void context.active.callControl?.observe({role:'assistant',text:item.payload?.text,final:true});
      context.active.replyDelivery?.transcript(item.payload?.text,{final:true,responseId:item.responseId??item.turnId});
      void context.active.replyDelivery?.finish({responseId:item.responseId??item.turnId});
    }
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
      void context.active.replyDelivery?.result(item.callId,item.payload.text);
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
  server.on('upgrade',async(req,socket,head)=>{
    const host=req.headers.host??'';
    // Hardware clients authenticate with their own device token, not a browser
    // cookie or Origin. They still arrive only through the configured host.
    const devicePath=deviceEndpoint&&new URL(req.url,'http://device.invalid').pathname;
    if(deviceEndpoint&&(devicePath===deviceEndpoint.path||deviceEndpoint.xiaozhiPath&&devicePath===deviceEndpoint.xiaozhiPath)){
      // Device clients authenticate by token; some firmware omits the port in Host.
      const hostname=(()=>{try{return new URL(`http://${host}`).hostname;}catch{return '';}})();
      if(hosted?hostname!==origin.hostname:!/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)){socket.destroy();return;}
      if(releaseGate.blocked()){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
      deviceEndpoint.handleUpgrade(req,socket,head,{dialect:devicePath===deviceEndpoint.path?'native':'xiaozhi'});return;
    }
    const expectedOrigin=hosted?publicOrigin:`http://${host}`;
    if(!directVoice||(hosted?host!==origin.host:!/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host))||req.headers.origin!==expectedOrigin){socket.destroy();return;}
    const url=new URL(req.url,expectedOrigin);
    if(url.pathname===`${basePath}/api/dial`){
      const reject=status=>socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      if(stopping||releaseGate.blocked()||!backendReady())return reject(503);
      if(typeof directVoice.attach!=='function')return reject(404);
      const allowed=new Set(['phone','model','voice','nativeRuntimeVersion','dialVersion']);
      if([...url.searchParams.keys()].some(k=>!allowed.has(k)||url.searchParams.getAll(k).length!==1)
        ||url.searchParams.get('dialVersion')!=='1'||url.searchParams.get('nativeRuntimeVersion')!=='1'
        ||!['seeduplex','grok'].includes(url.searchParams.get('model')))return reject(400);
      const binding=await resolveBinding(req,url).catch(()=>null);if(!binding)return reject(404);
      if(phoneLogin?.protects(binding)&&!phoneLogin.permits(req,binding)&&!iosBindings?.read(req,binding))return reject(401);
      const visitor=hosted?readVisitor(req,binding):null;
      if(hosted?!visitor:!String(req.headers.cookie??'').split(/;\s*/u).includes(`v_live_experiment=${cookie}`))return reject(401);
      const ip=String(req.headers['cf-connecting-ip']??req.socket.remoteAddress??'unknown').slice(0,128);
      const contextId=hosted?`${binding.id}:${visitor.id}`:binding.id;
      let context=contexts.get(contextId);
      if(!context){
        if(contexts.size>=512)return reject(503);
        context={active:null,creatingSession:false,listeners:new Set(),touchedAt:Date.now(),ip,entry:binding.id,sessionKey:binding.sessionKey};
        contexts.set(contextId,context);
      }
      releaseClosedDirectCalls();context.touchedAt=Date.now();
      const params={model:url.searchParams.get('model'),nativeRuntimeVersion:1,inputPolicy:phoneInputPolicy,
        ...(url.searchParams.has('voice')?{voice:url.searchParams.get('voice')}:{})};
      dialSockets.handleUpgrade(req,socket,head,client=>{
        client.on('error',()=>{});
        // Until attach owns the socket, reject all input. No microphone data
        // or arbitrary startup messages may race reservation/authentication.
        const earlyInput=()=>client.close(1008);client.on('message',earlyInput);
        const cancelled=()=>client.readyState!==WebSocket.OPEN;
        void (async()=>{
          let reservation;
          try{
            const result=await reservePhoneCall({context,binding,params,req,ip,cancelled});
            if(result.status!==200){if(!cancelled()){client.send(JSON.stringify({type:'dial.error',status:result.status}));client.close(1008);}return;}
            reservation=result.body;
            if(cancelled()){if(context.active?.reservation===reservation)await close(context);return;}
            // The caller learns its owned ID and policy before any provider frame.
            client.send(JSON.stringify({...reservation,type:'reservation',dialVersion:1,relayTicket:undefined}));
            client.removeListener('message',earlyInput);
            if(!directVoice.attach(reservation.voiceSessionId,reservation.relayTicket,client))throw Error('Dial attach failed');
          }catch{
            if(reservation&&context.active?.reservation===reservation)await close(context).catch(()=>{});
            if(!cancelled()){client.send(JSON.stringify({type:'dial.error',status:503}));client.close(1011);}
          }
        })();
      });
      return;
    }
    const speakerPath=url.pathname===`${basePath}/api/speaker-stream`&&speakerRouting;
    if(url.pathname!==`${basePath}/api/relay`&&!speakerPath){socket.destroy();return;}
    const context=[local,...contexts.values()].find(c=>(speakerPath||c.active?.direct)&&c.active?.reservation.voiceSessionId===url.searchParams.get('voiceSessionId'));
    if(!context||!req.headers.cookie){socket.destroy();return;}
    // Re-check the live access cookie, not just a remembered session ticket.
    const binding=await resolveBinding(req,url).catch(()=>null);
    if(!binding||binding.id!==context.entry||binding.sessionKey!==context.active.sessionKey){socket.destroy();return;}
    if(phoneLogin?.protects(binding)&&!phoneLogin.permits(req,binding)&&!iosBindings?.read(req,binding)){socket.destroy();return;}
    const visitor=hosted?readVisitor(req,binding):null;
    const originalVisitor=hosted?readVisitor({headers:{cookie:context.active.cookie}},binding):null;
    // Authenticate this entry's visitor even when another phone adds a cookie.
    if(hosted?(!visitor||visitor.id!==originalVisitor?.id):!String(req.headers.cookie).split(/;\s*/u).includes(`v_live_experiment=${cookie}`)){socket.destroy();return;}
    if(speakerPath)speakerRouting.upgrade(req,socket,head,url.searchParams.get('voiceSessionId'),url.searchParams.get('ticket'));
    else directVoice.upgrade(req,socket,head,url.searchParams.get('voiceSessionId'),url.searchParams.get('ticket'));
  });
  const sessionBusy = sessionKey => [local, ...contexts.values()].some(item => item.sessionKey === sessionKey && (item.active || item.creatingSession));
  return { server, emit, sessionBusy, serviceReady: backendReady, releaseReadiness, releaseGate, deviceInventory: () => deviceEndpoint?.inventory?.() ?? [], dispose: async ({drain=false}={}) => {
    stopping=true;clearInterval(timer);
    await deviceEndpoint?.dispose();
    for (const context of [local, ...contexts.values()]) { for (const response of context.listeners) response.end(); await close(context).catch(() => {}); }
    if(drain)while([...nativeTaskOwners].some(d=>d.pending))await new Promise(resolve=>setTimeout(resolve,50));
    for(const delivery of nativeTaskOwners)delivery.dispose();nativeTaskOwners.clear();nativeTasks.clear();
    for(const client of dialSockets.clients)client.terminate();dialSockets.close();
    await directVoice?.dispose({drain});
    await iosBindings?.flush();await callReports.flush();
    speakerRouting?.dispose();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preview = process.env.GPT_LIVE_H5_PREVIEW === "1";
  const port = Number(process.env.GPT_LIVE_H5_PORT ?? process.env.RTC_H5_PORT ?? 26244);
  let gateway, bridge, transcriptLog, avatarLog, productionSpeaker, releaseControl;
  if (!preview) {
    const configPath = process.env.OPENCLAW_CONFIG_PATH;
    if (!configPath) throw new Error("OPENCLAW_CONFIG_PATH is required");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const token = String(config.gateway.auth.token).replace(/\$\{([^}]+)\}/gu, (_, key) => process.env[key] ?? "");
    const { connectGatewayClient } = await import("../../lib/gateway-client.mjs");
    gateway = await connectGatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token,
      getToken:async()=>{
        const latest=JSON.parse(await readFile(configPath,"utf8"));
        return String(latest.gateway.auth.token).replace(/\$\{([^}]+)\}/gu,(_,key)=>process.env[key]??"");
      },
      scopes:["operator.read","operator.write","operator.admin"],caps:["voice-direct-tools","tool-events","voice-feishu-actor-v1"],subscribeSessions:true,onEvent:event=>bridge?.emit(event),
    },{onConnectError:error=>console.warn(JSON.stringify({type:"voice.gateway-connection-error",code:/^[A-Z0-9_]{1,80}$/.test(error.code??"")?error.code:"CONNECT_ERROR"}))});
    const {createDirectVoiceService}=await import('../realtime-direct-tools/session.mjs');
    const wsModule=await import('ws');
    transcriptLog=createVoiceTranscriptLog({
      directory:process.env.RTC_H5_TRANSCRIPT_DIR??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-transcripts'),
      onError:({code})=>console.warn(JSON.stringify({type:'voice.transcript-write-error',code})),
    });
    avatarLog=createAvatarTelemetryLog({directory:process.env.RTC_H5_AVATAR_LOG_DIR??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-avatar-events'),
      onError:({code})=>console.warn(JSON.stringify({type:'voice.avatar-write-error',code})),
    });
    productionSpeaker=await (await import('../speaker-native/production.mjs')).createProductionSpeaker({audit:transcriptLog.audit});
    const speakerRouting=productionSpeaker?.service;
    const lark=createVoiceLarkReader({environment:process.env});
    if(!lark.available)console.warn(JSON.stringify({type:'voice.lark-unavailable'}));
    const nativeInterruptModule=process.env.VOICE_NATIVE_INTERRUPT_ASR==='1'?await import('../realtime-direct-tools/native-interrupt.mjs'):null;
    const nativeInterrupt=nativeInterruptModule
      ? ({inputSampleRate,...callbacks})=>new nativeInterruptModule.NativeInterruptAsr({apiKey:process.env.VOLCENGINE_ASR_API_KEY,inputSampleRate,...callbacks}):undefined;
    const directVoice=createDirectVoiceService({gateway,wsModule,speakerRouting,nativeInterrupt,nativePlaybackPolicy:process.env.VOICE_NATIVE_PLAYBACK_POLICY??'courtesy',
      // Shared phone policy; explicit off remains available for rollback.
      searchAcknowledgment:process.env.VOICE_SEARCH_ACK==='off'?'off':'model',
      calendar:lark.available?lark.calendar:null,larkRead:lark.available?lark.read:null,
      grokModel:process.env.XAI_VOICE_MODEL,
      grokSpeed:Number(process.env.XAI_VOICE_SPEED ?? 1),
      grokExpressiveTags:process.env.XAI_VOICE_EXPRESSIVE_TAGS === '1',
      audit:productionSpeaker?.audit??transcriptLog.audit,
      toolEnvironment:Object.fromEntries(["LARKSUITE_CLI_CONFIG_DIR","LARKSUITE_CLI_DATA_DIR"].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),
      apiKeys:{
      seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY,
      grok:process.env.XAI_API_KEY,
    },loadContext:async (sessionKey,{gateway:callGateway=gateway}={})=>{
      const history=await callGateway.request('chat.history',{sessionKey,limit:6},{timeoutMs:10000});
      return voiceConversationContext(history.messages??[]);
    }});
    // Robot faces pick reactions with a fast classifier; without one they use
    // conservative keyword rules. Cosmetic only, never on the speech path.
    const robotEvaluatorFromEnv = async env => {
      if (env.ROBOT_REACTION_PROVIDER === 'deepseek' && env.DEEPSEEK_API_KEY) return (await import('../robot/robot-reactions.mjs')).createDeepSeekChoiceEvaluator({apiKey:env.DEEPSEEK_API_KEY});
      if (env.ROBOT_REACTION_PROVIDER === 'decisions') return avatarEvaluatorFromEnv(env);
      return null;
    };
    let deviceEndpoint = null;
    if (process.env.VOICE_DEVICES_FILE) {
      const {createDeviceEndpoint,parseDeviceEntries} = await import('../realtime-direct-tools/device-endpoint.mjs');
      const {createVolumeStore} = await import('../realtime-direct-tools/device-volume.mjs');
      deviceEndpoint = createDeviceEndpoint({directVoice,wsModule,audit:transcriptLog.audit,
        // Spoken volume changes; without a file they last until the service restarts.
        volumeStore:createVolumeStore({file:process.env.VOICE_DEVICE_VOLUME_FILE ?? null}),
        devices:parseDeviceEntries(JSON.parse(await readFile(process.env.VOICE_DEVICES_FILE,"utf8"))),
        path:process.env.VOICE_DEVICE_PATH ?? "/device/voice",
        xiaozhiPath:process.env.VOICE_XIAOZHI_PATH ?? null,
        otaPath:process.env.VOICE_XIAOZHI_OTA_PATH ?? null,
        xiaozhiPublicUrl:process.env.VOICE_XIAOZHI_PUBLIC_URL ?? null,
        isSessionBusy:sessionKey=>bridge?.sessionBusy(sessionKey) ?? true,
        // Camera devices (devices.json camera:true) look through DeepSeek's image model.
        visionPath:process.env.VOICE_DEVICE_VISION_PATH ?? "/device/vision",
        describeImage:process.env.DEEPSEEK_API_KEY ? (await import('../realtime-direct-tools/device-vision.mjs')).createDeepSeekVision({apiKey:process.env.DEEPSEEK_API_KEY,model:process.env.VOICE_DEVICE_VISION_MODEL ?? 'deepseek-flash'}) : null,
        robotEvaluate:await robotEvaluatorFromEnv(process.env)});
    }
    bridge = createLiveH5Server({ gateway, deviceEndpoint,
      candidateRelease:process.env.VOICE_CANDIDATE_RELEASE_FILE?JSON.parse(await readFile(process.env.VOICE_CANDIDATE_RELEASE_FILE,'utf8')):undefined,
      listening:process.env.VOICE_LISTENING_DIR ? await (await import('./listening.mjs')).loadVoiceListening(process.env.VOICE_LISTENING_DIR) : undefined,
      directVoice, speakerRouting, avatarLog,callControlAudit:transcriptLog.audit,
      phoneInputPolicy:process.env.VOICE_PHONE_INPUT_POLICY ?? 'speaker',
      defaultModel: process.env.VOICE_DEFAULT_MODEL ?? "gpt-live",
      feishuAccounts:process.env.VOICE_FEISHU_ACCOUNTS_FILE?JSON.parse(await readFile(process.env.VOICE_FEISHU_ACCOUNTS_FILE,'utf8')):config.channels?.feishu??{},
      personalReply: {replySync:!!process.env.VOICE_PERSONAL_REPLY_ACCOUNT_ID,accountId:process.env.VOICE_PERSONAL_REPLY_ACCOUNT_ID},
      conversationEntries: process.env.VOICE_ENTRIES_FILE ? JSON.parse(await readFile(process.env.VOICE_ENTRIES_FILE,"utf8")) : [],
      callReportsDirectory:process.env.VOICE_CALL_REPORTS_DIR??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-call-reports'),
      iosAppDownloadUrl:process.env.VOICE_IOS_APP_DOWNLOAD_URL,
      iosBindingsFile:process.env.VOICE_IOS_BINDINGS_FILE??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-ios-bindings.private.json'),
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
  if(Number(process.env.VOICE_RELEASE_BOOT_HOLD_UNTIL)>Date.now()) bridge.releaseGate.hold();
  if(process.env.VOICE_RELEASE_SOCKET) releaseControl = await listenReleaseControl({socketPath:process.env.VOICE_RELEASE_SOCKET,bridge,
    release:await readRelease(new URL('../../',import.meta.url))});
  bridge.server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ ready: true, host: "127.0.0.1", port, preview })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void bridge.dispose({drain:true}).finally(async () => { await releaseControl?.close(); await transcriptLog?.close(); await avatarLog?.close(); productionSpeaker?.close(); gateway?.stop(); process.exit(0); }));
}
