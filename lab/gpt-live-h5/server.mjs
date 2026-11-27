#!/usr/bin/env node
import {once} from 'node:events';
import {createImprovShow,directorCommand} from '../realtime-direct-tools/improv-live.mjs';
import {voiceAccessContext} from '../../lib/access-context.mjs';
import {createPublicVoiceGateway} from '../../lib/public-voice-gateway.mjs';
import {createVoiceAgentControl,listenVoiceAgentControl} from '../../lib/voice-agent-control.mjs';
import {backendDeviceBundleFromEnv} from '../../lib/backend-device-bundle.mjs';
import {terminalInstructions,normalizeDeviceActions} from '../../lib/terminal-context.mjs';
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
import {readRelayUsage} from '../../lib/relay-usage.mjs';
import {createIosBindings,iosAppDownload,IosBindingAuthorizationError} from '../../lib/ios-bindings.mjs';
import { createConversationEntries } from "../../lib/conversation-entries.mjs";
import { verifyPhoneSession } from "../../lib/phone-provisioning.mjs";
import {conversationReplyTarget,createConversationReplyDelivery} from '../../lib/conversation-replies.mjs';
import {createFeishuConversationDirectory,parseFeishuConversationPhone,createUnidentifiedPhoneDirectory} from '../../lib/feishu-conversation-directory.mjs';
import {createFeishuPhoneLogin,readFeishuPhoneLoginFile,feishuPhoneLoginFailure,feishuPhoneLoginErrorPage} from '../../lib/feishu-phone-login.mjs';
import {normalizeAvatarEvent} from './avatar-telemetry.mjs';
import {createAvatarTelemetryLog} from './avatar-telemetry-log.mjs';
import {createTaskDelivery} from '../realtime-direct-tools/task-delivery.mjs';
import {homedir} from 'node:os';
import {createMediaAccounts} from '../realtime-direct-tools/media-accounts.mjs';
import {createVoiceMediaCli} from '../realtime-direct-tools/media-cli.mjs';
import {createVoiceLarkReader,personalLarkReader} from '../realtime-direct-tools/lark-readonly.mjs';
import { createVoiceTranscriptLog } from '../realtime-direct-tools/transcript-log.mjs';
import {VOICE_CONTEXT_HISTORY_REQUEST,voiceConversationContext} from '../realtime-direct-tools/conversation-context.mjs';
import {grokVoice} from '../realtime-direct-tools/grok-provider.mjs';
import {gptLiveVoice} from '../realtime-direct-tools/gpt-live-provider.mjs';
import {seeduplexVoice} from '../seeduplex-realtime-provider.mjs';
import {idleHangupFromEnv} from '../realtime-direct-tools/idle-hangup.mjs';
import {boardCompletionFromEnv,boardDirectorFromEnv,boundedBoardRequest} from './board-director.mjs';
import {createFloorJudge,floorJudgeFromEnv} from '../realtime-direct-tools/floor-judge.mjs';
import {createPhotoFinder,createPhotoGallery} from './board-photo.mjs';
import {STREAM_INSTRUCTIONS,createLessonWriter,refineStreamOp} from './board-lesson.mjs';
import {CANVAS_CUE_INSTRUCTIONS,CANVAS_SCRIPT_INSTRUCTIONS,CUE_INSTRUCTIONS,CUE_SCRIPT_INSTRUCTIONS,cueTurns,refineCueOp} from './board-cue.mjs';
import {createBoardEye} from './board-eye.mjs';
import {scenePictures,namedThings} from './board-scene.mjs';
import {ASSET_ID,ASSET_MAKE_NOTES,ASSET_NOTES,ASSET_SCRIPT_NOTES,SELF_IMAGE,SELF_IMAGE_FILE,SHELF_ID,createAssetEye,createAssetShelf,pictureName} from './board-assets.mjs';
import {roomyPicture} from './board-picture-size.mjs';
import {createVideoScriptWriter} from '../realtime-direct-tools/media-script.mjs';
import {createMaterialCheck} from '../realtime-direct-tools/material-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const opusAssets = dirname(fileURLToPath(import.meta.resolve('opusscript/build/opusscript_native_wasm.js')));
// Dialing is how a known caller retries; only anonymous callers keep the tight limit.
// Page features reachable as /api/page/<name> (see the request handler). Each maps to the route the web
// page uses, answered as JSON: the board's whole run at once, a photograph as base64.
// The served App page's build and the date of its latest update (ios-shell-release.json), read once.
let servedPageBuild;
const PAGE_FEATURES = Object.freeze({
  board: params => ({pathname: '/api/board', params: {...params, collect: true}}),
  'board-image': params => ({pathname: '/api/board-image', params: {...params, inline: true}}),
  'board-assets': params => ({pathname: '/api/board-assets', params}),
  // Which page the service serves the App now (its build), so the page can say whether it is the latest.
  version: () => ({pathname: '/api/page-version', params: {}}),
});
export const callAttemptLimit = binding => binding.permissionProfile === 'unidentified' ? 6 : 30;

export function createLiveH5Server({ gateway, offer, directVoice, listening, speakerRouting, speakerFixture, candidateRelease, board = null, boardPhotos = null, boardAssets = null, boardAudience = 'owner', director = process.env.VOICE_IMPROV_LIVE === '1' ? directorCommand() : null, directorOrigin = process.env.MAKARON_DIRECTOR_URL, enableGrok = false, enableGptLive11 = false, enableGptLiveOne = true, phoneInputPolicy = "speaker", preview = false, basePath = "", publicOrigin = "", accessToken = "", maxActiveSessions = 8, maxActiveSessionsPerIp = 2, avatarEvaluate = avatarEvaluatorFromEnv(), avatarLog, callControlAudit=()=>{}, callControlEvaluate=callControlEvaluatorFromEnv(), relayUsageFile = process.env.VOICE_RELAY_USAGE_FILE || '/var/lib/v-voice-usage/snapshot.json', conversationEntries = [], personalReply = {}, feishuAccounts = {}, feishuLogin, iosBindingsFile, iosPublicEntry = false, publicTools = iosPublicEntry, iosAppDownloadUrl = 'https://testflight.apple.com/join/5DybcrZA', callReportsDirectory, callSummarize=callSummarizerFromEnv(), defaultModel = "gpt-live", gptProvider = process.env.VOICE_GPT_PROVIDER ?? "openai", deviceEndpoint = null, backendDeviceEndpoint = '' }) {
  let agentControl = null;
  if (!['native','speaker'].includes(phoneInputPolicy)) throw new Error('Invalid phone input policy');
  if (!["gpt-live","seeduplex","grok","gpt-live-11"].includes(defaultModel)) throw new Error("Invalid default voice model");
  if (typeof enableGptLive11 !== 'boolean') throw new Error('Invalid GPT Live 1.1 visibility setting');
  if (typeof enableGptLiveOne !== 'boolean') throw new Error('Invalid GPT Live One visibility setting');
  if (typeof enableGrok !== 'boolean') throw new Error('Invalid Grok visibility setting');
  // Visibility belongs to the phone product catalog, not provider/device capability.
  // GPT Live One (the Gateway's browser session) can be taken out of the phone catalog: a service that
  // offers the relay models only. Its default then moves to a model that is offered.
  const phoneModels = () => [...(enableGptLiveOne ? [{id:'gpt-live',label:'GPT Live One',available:true,nativeTransport:'webrtc'}] : []),...(directVoice?.models?.() ?? [])].filter(m => (enableGrok || m.id !== 'grok') && (enableGptLive11 || m.id !== 'gpt-live-11'));
  const fallback = () => (enableGptLiveOne ? 'gpt-live' : null) ?? phoneModels().find(m => m.id === 'gpt-live-11' && m.available)?.id ?? phoneModels().find(m => m.id === 'seeduplex')?.id ?? phoneModels()[0]?.id ?? 'seeduplex';
  if (defaultModel === 'gpt-live-11' && !enableGptLive11) defaultModel = fallback();
  if (defaultModel === 'grok' && !enableGrok) defaultModel = phoneModels().find(m => m.id === 'seeduplex' && m.available)?.id ?? fallback();
  if (defaultModel === 'gpt-live' && !enableGptLiveOne) defaultModel = fallback();
  basePath = basePath.replace(/\/$/u, "");
  if (basePath && !/^\/[a-zA-Z0-9_-]+$/u.test(basePath)) throw new Error("Invalid voice base path");
  const hosted = Boolean(publicOrigin || accessToken);
  const bundles = new Map();
  function browserBundle(name = 'app-bundle.mjs') {
    if (!bundles.has(name)) bundles.set(name, readFile(join(here,name)).then(bytes=>({
      bytes,revision:createHash('sha256').update(bytes).digest('hex'),
    })).catch(error=>{bundles.delete(name);throw error;}));
    return bundles.get(name);
  }
  let entryBootstrapWork;
  const entryBootstrap=()=>entryBootstrapWork??=readFile(join(here,'entry-bootstrap.js'),'utf8');
  const backendReady = () => !preview && gateway?.ready !== false;
  const origin = hosted ? new URL(publicOrigin) : null;
  if (hosted && (origin.protocol !== "https:" || origin.origin !== publicOrigin || !basePath)) throw new Error("Hosted voice requires an HTTPS origin and base path");
  if (!Number.isInteger(maxActiveSessions) || maxActiveSessions < 1 || maxActiveSessions > 50 || !Number.isInteger(maxActiveSessionsPerIp) || maxActiveSessionsPerIp < 1 || maxActiveSessionsPerIp > maxActiveSessions) throw new Error("Invalid voice call limits");
  const entries = createConversationEntries(conversationEntries, accessToken, personalReply);
  // Photographs found for a call's board, lent out for half an hour under private addresses so that
  // one can be the reference of something V makes (board-assets.mjs `lend`): a generator fetches the
  // picture from here. Only where the service has a public HTTPS origin; the address is the whole permission.
  const lentPictures = new Map(), LEND_MS = 30 * 60000;
  // (And the pictures themselves, for the shelf's eye to check that each is the thing it was searched for.)
  // (V's own image is a picture the call always has: V's canonical avatar, or the file VOICE_SELF_IMAGE names.)
  let selfPicture = null;
  const pictureType = bytes => bytes.subarray(0, 4).toString('latin1') === 'RIFF' ? 'image/webp' : bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const standingPicture = query => query === SELF_IMAGE.query ? (selfPicture ??= readFile(process.env.VOICE_SELF_IMAGE || new URL('./assets/' + SELF_IMAGE_FILE, import.meta.url)).then(bytes => ({bytes, type: pictureType(bytes), title: SELF_IMAGE.name, source: 'V'}), () => null)) : null;
  const heldPicture = query => standingPicture(query) ?? boardPhotos?.find(query) ?? null;
  if (boardAssets) boardAssets.picture = heldPicture;
  if (boardAssets && hosted) boardAssets.share = async query => {
    // (A thumbnail is lent out larger: a video model refuses a reference under 256 px a side.)
    const found = await heldPicture(query), picture = found?.bytes?.length ? await roomyPicture(found, {least: 512}) : found;
    const kind = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[picture?.type];
    if (!picture?.bytes?.length || !kind) return null;
    for (const [key, lent] of lentPictures) if (lent.until < Date.now()) lentPictures.delete(key);
    while (lentPictures.size >= 40) lentPictures.delete(lentPictures.keys().next().value);
    const token = randomBytes(16).toString('hex'), until = Date.now() + LEND_MS;
    lentPictures.set(token, {bytes: picture.bytes, type: picture.type, until});
    return {url: `${publicOrigin}${basePath}/board-shared/${token}.${kind}`, until};
  };
  if (boardAssets && !hosted && director?.uploadReference) boardAssets.share = async query => {
    const picture = await heldPicture(query);
    return picture?.bytes ? {url:await director.uploadReference(picture.bytes,picture.type),until:Date.now()+LEND_MS} : null;
  };
  const replyTargets=new Map(entries.replyBindings().map(e=>[e.id,conversationReplyTarget(e,feishuAccounts)]));
  const appDownload=iosAppDownload(iosAppDownloadUrl);
  const phoneLogin = feishuLogin ? createFeishuPhoneLogin({...feishuLogin, publicOrigin, basePath, entries,
    ...(feishuLogin.conversations===true?{resolveConversation:createFeishuConversationDirectory({gateway,...feishuLogin})}:{})}) : null;
  const guestAccess=hosted&&feishuLogin?.conversations===true&&feishuLogin.allowUnidentified===true
    ?createVoiceAccess(createHash('sha256').update('voice-guest:'+feishuLogin.appSecret).digest('hex'),basePath,Date.now,{entry:'unidentified'}):null;
  const guestDirectory=guestAccess?createUnidentifiedPhoneDirectory({accountId:feishuLogin.accountId,access:guestAccess,publicEntry:iosPublicEntry}):()=>null;
  const guestBinding=(req,...args)=>withPublicGateway(req,guestDirectory(req,...args));
  // One inbound request may reuse its own just-verified dynamic route. This is
  // never an identity cache across requests; slow request bodies must recheck.
  const requestAdmissions=new WeakMap();
  const resolveBinding=async(req,url,admission)=>{
    const startedAt=performance.now();
    const requestedPhone=new URL(req.url??url.href,'http://voice.invalid').searchParams.get('phone');
    if(requestedPhone?.startsWith('cli_')){
      const managed=agentControl?.resolve(requestedPhone);
      if(!managed)return null;
      const binding=guestDirectory(req,'public',{id:managed.entry.visitorId});
      if(!binding)return null;
      return withPublicGateway(req,Object.freeze({...binding,id:requestedPhone,cliManaged:true,
        cliEntry:managed.entry.id,accessToken:undefined,cliAccess:managed.access}));
    }
    const devicePhone=iosBindings?.canonicalPhone(requestedPhone)??requestedPhone;
    const phone=phoneLogin?.canonicalPhone(devicePhone)??devicePhone;
    if(phone&&phone!==url.searchParams.get('phone')){url=new URL(url);url.searchParams.set('phone',phone);}
    if(url.searchParams.get('phone')==='public'){
      const principal=iosBindings?.principalFor(req,'public',req.iosExchangeBody);
      if(!iosPublicEntry)return null;
      if(principal?.type==='guest')return guestBinding(req,'public',{id:principal.visitorId});
      // A browser Public cookie cannot replace a missing/revoked native grant.
      return requestedPhone==='public'?guestBinding(req,'public'):null;
    }
    try {
      const device=parseFeishuConversationPhone(url.searchParams.get('phone'))&&iosBindings?.principalFor(req,url.searchParams.get('phone'),req.iosExchangeBody);
      const binding=phoneLogin?.read(req)?await phoneLogin.resolve(req,url,admission):device?.type==='guest'?guestBinding(req,url.searchParams.get('phone'),{id:device.visitorId}):device?await phoneLogin?.resolveDevice(device,url.searchParams.get('phone'),admission):phoneLogin?await phoneLogin.resolve(req,url,admission):entries.resolve(url);
      if(binding){
        if(binding.permissionProfile==='feishu-current')requestAdmissions.set(req,{binding,startedAt,at:performance.now()});
        return binding;
      }
    }
    catch(error){if(!guestAccess||!parseFeishuConversationPhone(url.searchParams.get('phone')))throw error;}
    return guestBinding(req,url.searchParams.get('phone'));
  };
  const guestModel=()=>phoneModels().find(m=>m.available&&m.id==='seeduplex')?.id??phoneModels().find(m=>m.available&&m.id!=='gpt-live')?.id??'seeduplex';
  const entryPresentation=(binding,req)=>{
    const remembered=binding.id==='public'&&req?phoneLogin?.rememberedPhone(req):null;
    return {...{...(phoneLogin?.confirmation&&parseFeishuConversationPhone(binding.id)?{confirmationAvailable:true}:{}),accessContext:voiceAccessContext(binding,{publicEnabled:iosPublicEntry,publicTools}),...(iosPublicEntry&&guestAccess?{publicHref:`${basePath}/?phone=public`}:{}),...(remembered?{returnToAccountHref:`${basePath}/feishu?phone=${encodeURIComponent(remembered)}`}:{})},...(binding.permissionProfile==='unidentified'?{unidentified:true,accountLoginHref:binding.id==='public'?null:phoneLogin?.confirmation?`${basePath}/feishu/confirm?phone=${encodeURIComponent(binding.id)}`:`${basePath}/feishu?phone=${encodeURIComponent(binding.id)}&oauth=1`,defaultModel:guestModel(),iosBindingAvailable:hosted,speakerRouting:false,comparisonAvailable:false,
      models:phoneModels().map(m=>m.id==='gpt-live'?{...m,available:false}:m)}:binding.callerIdentity?{accountLabel:binding.callerIdentity.displayName||'飞书账号已连接',accountLoginHref:phoneLogin?.confirmation?`${basePath}/feishu/confirm?phone=${encodeURIComponent(binding.id)}`:`${basePath}/feishu?phone=${encodeURIComponent(binding.id)}&retry=1`}:{}),...(binding.cliManaged?{iosBindingAvailable:false,accountLoginHref:null,confirmationAvailable:false}:{})};
  };
  const callReports=createConversationCalls({gateway,directory:callReportsDirectory,publicOrigin,basePath,summarize:callSummarize,audit:callControlAudit});
  const accessors = new Map();
  const entryAccess = binding => {
    if (!hosted) return null;
    if(binding.cliManaged)return binding.cliAccess;
    if(binding.permissionProfile==='unidentified')return guestAccess;
    const key=binding.id+':'+binding.callerId;
    const entry=binding.permissionProfile==='feishu-current'?'feishu-'+createHash('sha256').update(key).digest('hex').slice(0,40):binding.id;
    if (!accessors.has(key)) accessors.set(key, createVoiceAccess(binding.accessToken, basePath, Date.now, {entry}));
    return accessors.get(key);
  };
  const access = entryAccess(entries.resolve(new URL("http://localhost")));
  const iosBindings=hosted?createIosBindings({file:iosBindingsFile,basePath,publicOrigin,
    canonicalPhone:phone=>phoneLogin?.deviceCanonicalPhone(phone)??phone,legacyBinding:phone=>phoneLogin?.legacyBinding(phone),permits:(principal,binding)=>{
    if(principal?.type==='guest')return binding.permissionProfile==='unidentified'&&principal.visitorId===binding.visitorId;
    if(principal?.type==='feishu')return phoneLogin?.actorPermits(principal,binding)===true;
    return principal?.type==='entry'&&!phoneLogin?.protects(binding)&&principal.entry===binding.id;
  }}):null;
  const withPublicGateway=(req,binding)=>{
    if(!binding||binding.permissionProfile!=='unidentified'||!iosPublicEntry||!publicTools)return binding;
    const authorized=()=>{
      if(binding.cliManaged){const visitor=entryAccess(binding)?.read(req);return agentControl?.active(binding.id)&&visitor?.id===binding.visitorId?'browser:'+visitor.id:null;}
      const device=iosBindings?.read(req,binding);
      if(device)return 'device:'+device.deviceId;
      const visitor=guestAccess?.read(req);
      return visitor?.id===binding.visitorId?'browser:'+visitor.id:null;
    };
    const owner=authorized();if(!owner)return binding;
    return Object.freeze({...binding,gateway:createPublicVoiceGateway({gateway,sessionKey:binding.sessionKey,
      isAuthorized:()=>authorized()===owner})});
  };
  const readVisitor=(req,binding)=>{
    const visitor=entryAccess(binding)?.read(req);
    if(binding.cliManaged)return agentControl?.active(binding.id)&&visitor?.id===binding.visitorId?visitor:null;
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
  const conversationPresentation=binding=>{const context=voiceAccessContext(binding,{publicEnabled:iosPublicEntry,publicTools});return {name:context.conversationLabel,kind:binding.kind,replySync:binding.replySync,accountLabel:context.accountLabel,entryKind:context.entryKind,scopeNote:context.scopeNote};};
  const improvAllowed = binding => Boolean(director) && binding.permissionProfile === 'personal-tianyi';
  const entrySnapshot=(binding,req)=>({ready:backendReady(),preview,defaultModel,
    ...(directVoice?.attach?{nativeDialVersion:1,webDialVersion:2,dialGreeting:true,tvDialStandby:hosted}:{}),conversation:conversationPresentation(binding),iosBindingAvailable:hosted,
    ...(speakerRouting?{speakerRouting:true,phoneInputPolicy}:{}),...(listening?{comparisonAvailable:true}:{}),
    models:phoneModels(),...entryPresentation(binding,req),...(improvAllowed(binding)?{improvLive:true,...(director.uploadReference && boardAssets && boardAllowed(binding) ? {referenceUpload:true} : {})}:{}),...(boardAllowed(binding)?{board:true}:{})});
  const visual = createAvatarReactionSelector({evaluate:avatarEvaluate});
  // The board sends lookup results to its own text model, so it stays on the
  // owner's fixed entry until other callers have agreed to that.
  // (VOICE_BOARD_AUDIENCE=all opens it to every caller, Feishu and public; their words then go to the board's text model
  // as they already go to the voice model, and are not kept in the board's own record.)
  function boardAllowed(binding) { return Boolean(board?.available) && (boardAudience === 'all' || binding?.permissionProfile === 'personal-tianyi'); }
  const contexts = new Map(),nativeTasks=new Map(),nativeTaskOwners=new Set();let stopping=false;
  const local = { active: null, creatingSession: false, listeners: new Set(), touchedAt: Date.now(), entry: "tianyi" };
  const attempts = new Map();
  const allow = (key, limit = 6) => {
    const times = (attempts.get(key) ?? []).filter(at => Date.now() - at < 600000);
    if (times.length >= limit) return false;
    times.push(Date.now()); attempts.set(key, times); return true;
  };
  const cookie = randomBytes(32).toString("hex");
  const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data?.error&&iosPublicEntry&&guestAccess?{...data,publicHref:`${basePath}/?phone=public`}:data)); };
  const rememberAvatarCall = (context,active,provider) => {
    const registry=context.avatarOwners??=new Map();
    for(const [id,owner] of registry)if(owner.endedAt&&Date.now()-owner.endedAt>300000)registry.delete(id);
    if(registry.size>=3)registry.delete(registry.keys().next().value);
    registry.set(active.reservation.voiceSessionId,{voiceSessionId:active.reservation.voiceSessionId,sessionKey:active.sessionKey,
      provider,model:active.reservation.model??null,avatarSequences:new Map()});
  };
  // A relay can finish cleanup before the phone's HTTP close arrives. Retain
  // only confirmed completions in the same authenticated visitor context, so
  // the existing app can clear its pending ID without retrying on the next dial.
  const rememberClosedCall = (context,id) => {
    const completed=context.completedCalls??=new Map(),now=Date.now();
    for(const [key,at] of completed)if(now-at>300000)completed.delete(key);
    completed.set(id,now);
    while(completed.size>4)completed.delete(completed.keys().next().value);
  };
  const isClosedCall = (context,id) => {
    const at=context.completedCalls?.get(id);
    if(at===undefined)return false;
    if(Date.now()-at>300000){context.completedCalls.delete(id);return false;}
    return true;
  };
  // A call whose connection was lost (not hung up) is connected again as another session: the iOS App when
  // something takes its audio, a page whose network went. What it had on the board is kept for it a little
  // while and goes on with the next session; a hang-up, or no redial in time, lets it go.
  const CARRY_MS = 120000;
  const letGo = (context, id) => { if (context.lost && (!id || context.lost.id === id)) { clearTimeout(context.lost.timer); board?.forget(context.lost.id); context.lost = null; } };
  const keepForRedial = (context, id) => {
    letGo(context);
    const timer = setTimeout(() => letGo(context, id), CARRY_MS); timer.unref?.();
    context.lost = {id, timer};
  };
  const carryOn = (context, id) => {
    const lost = context.lost; if (!lost) return;
    clearTimeout(lost.timer); context.lost = null;
    const carried = board?.adopt?.(id, lost.id) === true;
    if (!carried) board?.forget(lost.id);
    callControlAudit({type:'call.carried',voiceSessionId:id,from:lost.id,board:carried});
  };
  const close = async (context = local, {redial = false} = {}) => {
    const old = context.active;
    old?.improv?.close();
    old?.deviceChannel?.close();
    if(old?.deviceBound)await (old.gateway??gateway).request('voice.product.device-context',{clientSecret:old.reservation.clientSecret,voiceSessionId:old.reservation.voiceSessionId,mode:'close'},{timeoutMs:5000}).catch(()=>{});
    old?.taskDelivery?.close();
    await old?.replyDelivery?.close();
    old?.callControl?.close();
    if(old)speakerRouting?.close(old.reservation.voiceSessionId);
    if (old) visual.forget(old.reservation.voiceSessionId);
    // (A new dial while the last call was never hung up: that call is being connected again.)
    if (old) { if (redial && old.direct && board?.adopt) keepForRedial(context, old.reservation.voiceSessionId); else { letGo(context); board?.forget(old.reservation.voiceSessionId); } }
    if (old?.direct) await directVoice.close(old.reservation.voiceSessionId, redial ? 'redial' : 'requested');
    else if (old) await (old.gateway??gateway).request("talk.client.close", { sessionKey: old.sessionKey, voiceSessionId: old.reservation.voiceSessionId });
    if(old)rememberClosedCall(context,old.reservation.voiceSessionId);
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
      old.improv?.close();
      visual.forget(old.reservation.voiceSessionId);
      if(board?.adopt&&directVoice.lostCall?.(old.reservation.voiceSessionId))keepForRedial(context,old.reservation.voiceSessionId);else board?.forget(old.reservation.voiceSessionId);
      rememberClosedCall(context,old.reservation.voiceSessionId);
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
  // What a page says about the call it lost before dialling again: numbers and flags only.
  const lostCallReport = raw => {
    const int = (value, max) => Number.isFinite(value) && value >= 0 ? Math.min(max, Math.round(value)) : null;
    return {code: int(raw.code, 4999), clean: raw.clean === true, quietMs: int(raw.quietMs, 600000), silentMs: int(raw.silentMs, 600000), heldMs: int(raw.heldMs, 86400000), online: raw.online !== false, hidden: raw.hidden === true,
      net: typeof raw.net === 'string' && /^[a-z0-9-]{1,12}$/u.test(raw.net) ? raw.net : null};
  };
  const reservePhoneCall = async ({context,binding,params,req,ip,cancelled=()=>false,prefetched=null}) => {
    const reply=(status,body)=>({status,body});
    // An old cached native preference must not silently start another model or
    // end an existing call. The existing options refresh selects the new default.
    if ((!params.model || params.model === 'gpt-live') && !enableGptLiveOne) return reply(409,{error:'GPT Live One 已下线，请返回首页刷新后选择可用模型。',code:'model_hidden',fallbackModel:defaultModel});
    if (params.model === 'gpt-live-11' && !enableGptLive11) return reply(409,{error:'GPT Live 1.1 尚未开放，请返回首页刷新后选择可用模型。',code:'model_hidden',fallbackModel:defaultModel});
    if (params.model === 'grok' && !enableGrok) return reply(409,{error:'Grok 目前仅供测试，请返回首页刷新后选择可用模型。',code:'model_hidden',fallbackModel:defaultModel});
    const externalCancelled=cancelled;
    cancelled=()=>externalCancelled()||Boolean(binding.cliManaged&&!agentControl?.active(binding.id));
    const unidentified=binding.permissionProfile==='unidentified';
    if(unidentified){
      params={...params,model:params.model??guestModel(),inputPolicy:'native'};
      if(!directVoice||!directVoice.models().some(m=>m.id===params.model&&m.available))return reply(400,{error:enableGrok?'当前访客电话请选择小何或 Grok。':'当前访客电话请选择小何。'});
    }
    if (releaseGate.blocked()) return reply(503,{error:"V 正在更新，请稍后重新拨号。"});
    if (!backendReady()) return reply(503,{error:"V 后端正在重新连接，请稍后重拨。"});
    if(speakerRouting&&params.inputPolicy!==undefined&&!['native','speaker'].includes(params.inputPolicy))return reply(400,{error:'没有这个输入策略'});
    try{normalizeDeviceActions(params.nativeDeviceActions);}catch{return reply(400,{error:'不支持的设备能力协议'});}
    if(params.nativeRuntimeVersion!==undefined&&params.nativeRuntimeVersion!==1)return reply(400,{error:'不支持的原生能力协议'});
    if (params.model && !['gpt-live','seeduplex','grok','gpt-live-11'].includes(params.model)) return reply(400,{error:'没有这个语音模型'});
    if (params.model === 'grok') {
      try { grokVoice(params.voice); } catch (error) { return reply(400,{error:error.message}); }
    }
    if (params.model === 'gpt-live-11' && params.voice !== undefined) {
      try { gptLiveVoice(params.voice); } catch (error) { return reply(400,{error:error.message}); }
    }
    // Doubao opens a session for a speaker it does not know and then never sends audio: refuse it here.
    if (params.model === 'seeduplex' && params.voice !== undefined) {
      try { seeduplexVoice(params.voice); } catch (error) { return reply(400,{error:error.message}); }
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
      if (!allow(`call:${ip}`, callAttemptLimit(binding))) return reply( 429, { error: "通话开始得太频繁，请稍后再试" });
      context.ip = ip;
    }
    context.creatingSession = true;
    try {
      // New phone entries cannot create a guessed or stale conversation.
      // Keep the accepted legacy personal entry's startup path unchanged.
      const admitted=requestAdmissions.get(req);requestAdmissions.delete(req);
      const verifyStartedAt=performance.now();
      const currentAdmission=binding.permissionProfile==='feishu-current'&&admitted?.binding===binding&&performance.now()-admitted.at<1000;
      if (binding.id !== 'tianyi'&&!unidentified&&!currentAdmission) await verifyPhoneSession(binding.gateway??gateway, binding);
      const verifiedAt=performance.now();
      if(cancelled())return reply(499,{error:"拨号已取消"});
      await close(context,{redial:true});
      const closedAt=performance.now();
      if(cancelled())return reply(499,{error:"拨号已取消"});
      const recordAdmissionTiming=reservation=>{
        const now=performance.now(),resolved=admitted?.binding===binding;
        callControlAudit({type:'call.admission-timing',voiceSessionId:reservation.voiceSessionId,
          ...(resolved?{resolveMs:Math.round(admitted.at-admitted.startedAt)}:{}),
          verificationMs:Math.round(verifiedAt-verifyStartedAt),previousCloseMs:Math.round(closedAt-verifiedAt),
          reservationMs:Math.round(now-closedAt),toReservationMs:Math.round(now-(resolved?admitted.startedAt:verifyStartedAt))});
      };
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
        const improv = params.improvLive === true && !params.nativeRuntimeVersion && improvAllowed(binding) ? createImprovShow({run:director,story:process.env.VOICE_IMPROV_STORY!=='0'}) : null;
        // Tianyi's own entries pay for media like the session's background tasks do: with the owner's account.
        const reservation = await directVoice.reserve({...(improv?{improv}:{}),...(binding.permissionProfile==='personal-tianyi'?{ownerMedia:true}:{}),model:params.model,sessionKey,...(params.resumed&&typeof params.resumed==='object'?{resumed:lostCallReport(params.resumed)}:{}),...(binding.nativeChatId?{nativeChatId:binding.nativeChatId}:{}),voice:params.voice,...(unidentified?{unidentified:true}:{}),...(binding.callerIdentity?{callerIdentity:binding.callerIdentity}:{}),...(binding.gateway?{gateway:callGateway,actorScoped:true,agentId:binding.agentId,toolIdentity:binding.actorPrincipal}:{}),...(params.nativeRuntimeVersion===1?{nativeRuntimeVersion:1}:{}),...(params.nativeDeviceActions?{nativeDeviceActions:params.nativeDeviceActions,terminalKind:iosBindings?.read(req,binding)?'ios':'web',backendDeviceURL:backendDeviceEndpoint||`${hosted?publicOrigin:`http://127.0.0.1:${server.address().port}`}${basePath}/internal/device-request`}:{}),...(params.nativeLocationVersion===1?{nativeLocationVersion:1}:{}),...(replyTarget?{replyTarget,callReportFactory:ownerId=>callReports.begin(binding,replyTarget,ownerId,reportOptions)}:{}),...(binding.id!=='tianyi'?{sessionBound:true}:{}),...(speakerRouting||unidentified)?{inputPolicy}:{},...(prefetched?{prefetched}:{})});
        context.active={improv,sessionKey,gateway:callGateway,reservation,direct:true,touchedAt:Date.now(),cookie:req.headers.cookie};
        carryOn(context,reservation.voiceSessionId);
        if(cancelled()){await close(context);return reply(499,{error:"拨号已取消"});}
        rememberAvatarCall(context,context.active,params.model);
        recordAdmissionTiming(reservation);
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
      if(params.nativeDeviceActions&&directVoice?.openDeviceChannel&&gptProvider==='v-voice-gpt-live'){
        const ownerParams={clientSecret:reservation.clientSecret,voiceSessionId:reservation.voiceSessionId};
        let channel;
        try{
          const supported=await callGateway.request('voice.product.device-context',{...ownerParams,mode:'check'},{timeoutMs:5000});
          if(supported?.accepted&&context.active===owned){
            let revision=1,updates=Promise.resolve();
            const publish=terminal=>{
              const message={type:'device.context',voiceSessionId:reservation.voiceSessionId,terminalContext:terminal,text:terminalInstructions(terminal)};
              for(const response of context.listeners)response.write(`data: ${JSON.stringify(message)}\n\n`);
            };
            channel=directVoice.openDeviceChannel({voiceSessionId:reservation.voiceSessionId,nativeDeviceActions:params.nativeDeviceActions,
              terminalKind:iosBindings?.read(req,binding)?'ios':'web',callerIdentity:binding.callerIdentity,gateway:callGateway,agentId:binding.agentId??'makaron',sessionKey,
              backendDeviceURL:backendDeviceEndpoint||`${hosted?publicOrigin:`http://127.0.0.1:${server.address().port}`}${basePath}/internal/device-request`,
              isCurrent:()=>context.active===owned&&!owned.deviceRetired,
              send:frame=>{if(context.active===owned)for(const response of context.listeners)response.write(`data: ${JSON.stringify(frame)}\n\n`);},
              onContext:terminal=>{
                publish(terminal);
                updates=updates.then(async()=>{
                  if(!owned.deviceBound||context.active!==owned)return;
                  const result=await callGateway.request('voice.product.device-context',{...ownerParams,revision:++revision,terminal,bridge:owned.deviceDescriptor},{timeoutMs:5000});
                  if(!result?.accepted)throw Error('Device metadata update rejected');
                }).catch(()=>{owned.deviceRetired=true;channel?.close();});
              }});
            owned.deviceChannel=channel;
            const descriptor=await channel?.descriptor();
            if(descriptor&&context.active===owned){
              const bound=await callGateway.request('voice.product.device-context',{...ownerParams,revision,terminal:channel.terminalContext(),bridge:descriptor},{timeoutMs:5000});
              if(!bound?.accepted)throw Error('Device metadata binding rejected');
              owned.deviceBound=true;owned.deviceDescriptor=descriptor;
            }else channel?.close();
          }
        }catch{channel?.close();owned.deviceRetired=true;}
      }
      rememberAvatarCall(context,context.active,'openai');
      const speaker=speakerRouting?.reserve(reservation.voiceSessionId,{model:'gpt-live',policy:params.inputPolicy??'speaker'});
      const terminal=owned.deviceBound&&!owned.deviceRetired?owned.deviceChannel.terminalContext():null;
      const callerText=[binding.callerIdentity?feishuCallerIdentityInstructions(binding.callerIdentity):'',terminal?terminalInstructions(terminal):''].filter(Boolean).join('\n');
      if(cancelled()){await close(context);return reply(499,{error:'拨号已取消'});}
      recordAdmissionTiming(reservation);
      // The native owner selects its audio backend from this public field.
      // Keep the validated transport while withholding provider credentials.
      return reply(200,{voiceSessionId:reservation.voiceSessionId,model:reservation.model,transport:reservation.transport,...(callerText?{callerContext:{voiceSessionId:reservation.voiceSessionId,text:callerText}}:{}),...(terminal?{nativeDeviceActions:{version:1,capabilities:terminal.capabilities},terminalContext:terminal}:{}),...speaker?{speakerRouting:speaker}:{}});
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
      if(req.method==='POST'&&new URL(req.url,'http://device.invalid').pathname===`${basePath}/internal/device-request`){
        if(req.headers.origin||(hosted?host!==origin.host:!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)))return json(res,403,{error:'Local backend only'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)return json(res,413,{error:'Too large'});}
        let body;try{body=JSON.parse(raw);}catch{return json(res,400,{error:'Invalid JSON'});}
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['lease','operation','args'].includes(k))||typeof body.lease!=='string'||body.lease.length!==43)return json(res,403,{error:'Invalid device lease'});
        return json(res,200,await directVoice.backendDeviceRequest(body));
      }
      const devicePathname = deviceEndpoint && new URL(req.url, "http://device.invalid").pathname;
      if (deviceEndpoint && (deviceEndpoint.otaPath && devicePathname === deviceEndpoint.otaPath || deviceEndpoint.visionPath && devicePathname === deviceEndpoint.visionPath)) {
        // Device HTTP (OTA check, camera photo upload) authenticates itself; some firmware omits the port in Host.
        const hostname = (() => {try {return new URL(`http://${host}`).hostname;} catch {return "";}})();
        if (hosted ? hostname !== origin.hostname : !/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)) return json(res, 403, { error: "请求入口不匹配" });
        return devicePathname === deviceEndpoint.otaPath ? deviceEndpoint.handleOta(req, res) : deviceEndpoint.handleVision(req, res);
      }
      if (hosted ? host !== origin.host : !/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)) return json(res, 403, { error: "请求入口不匹配" });
      // Server-to-server callback authenticates its exact bytes independently;
      // browser Origin exceptions apply to this one path only.
      if(phoneLogin?.confirmation&&req.method==='POST'&&new URL(req.url,'http://voice.invalid').pathname===`${basePath}/feishu/confirm/callback`){
        if(req.headers.origin)return json(res,403,{error:'身份回调无效'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return json(res,413,{error:'身份回调过大'});}
        try{const result=await phoneLogin.confirmation.callback(raw,req.headers['x-voice-confirm-signature']);console.info(JSON.stringify({type:'voice.card-confirmation',stage:'confirmed'}));return json(res,200,result);}
        catch(error){console.warn(JSON.stringify({type:'voice.card-confirmation-rejected',reason:error.confirmationReason??'unavailable'}));return json(res,403,{error:'身份确认无效或已过期'});}
      }
      const requestOrigin = hosted ? publicOrigin : `http://${host}`;
      if (req.headers.origin && req.headers.origin !== requestOrigin || hosted && req.method === "POST" && req.headers.origin !== requestOrigin) return json(res, 403, { error: "请求来源不匹配" });
      const url = new URL(req.url, requestOrigin);
      if (basePath && url.pathname === basePath && req.method === "GET") { res.writeHead(308, { location: `${basePath}/${url.search}`, "cache-control": "no-store" }); res.end(); return; }
      if (basePath && !url.pathname.startsWith(`${basePath}/`)) return json(res, 404, { error: "没有这个入口" });
      let pathname = basePath ? url.pathname.slice(basePath.length) : url.pathname;
      // The player authenticates its own single-show ticket at Makaron. No phone cookie or API key crosses this relay.
      const directorAsset = req.method==='GET' && ['/director/player.html','/director/player.js','/director/transport.mjs','/director/playout.mjs'].includes(pathname);
      const directorOp = req.method==='POST' && /^\/api\/director\/player\/(poll|signal|recording|stop)$/.test(pathname);
      if(director && directorOrigin && (directorAsset || directorOp)){
        const target=new URL(pathname,directorOrigin);
        const headers={};
        if(directorOp){
          const ticket=req.headers['x-director-player'], id=url.searchParams.get('id');
          if(!/^[a-zA-Z0-9_-]{43}$/.test(ticket??'') || !/^[a-f0-9-]{36}$/.test(id??''))return json(res,403,{error:'播放票据无效'});
          target.searchParams.set('id',id);
          for(const key of ['x-director-player','x-fal-target-url','content-type'])if(req.headers[key])headers[key]=req.headers[key];
          // A recording arrives in parts; each names its byte offset, the last also the total.
          if(pathname.endsWith('/recording'))for(const key of ['x-recording-offset','x-recording-final'])if(/^\d{1,12}$/.test(req.headers[key]??''))headers[key]=req.headers[key];
        }
        const closed = new AbortController();
        // A recording leaves the caller's browser after the show over whatever uplink it has;
        // give that one upload minutes, not the 95 s every other player request gets.
        const signal = AbortSignal.any([closed.signal, AbortSignal.timeout(pathname.endsWith('/recording') ? 900000 : 95000)]);
        res.once('close',()=>closed.abort());
        try {
          const upstream=await fetch(target,{method:req.method,headers,redirect:'error',signal,...(directorOp?{body:req,duplex:'half'}:{})});
          res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/octet-stream','cache-control':'no-store','referrer-policy':'no-referrer'});
          if (upstream.body) for await (const chunk of upstream.body) {
            if (!res.write(chunk)) await once(res,'drain',{signal});
          }
          res.end();
        } catch(error) {
          if (!closed.signal.aborted && !res.headersSent) throw error;
          res.destroy();
        }
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/board-shared/')) {
        const lent = lentPictures.get(/^\/board-shared\/([a-f0-9]{32})\.(?:jpg|png|webp)$/u.exec(pathname)?.[1]);
        if (!lent || lent.until < Date.now()) return json(res, 404, {error: '没有这张图'});
        res.writeHead(200, {'content-type': lent.type, 'content-length': lent.bytes.length, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'});
        res.end(req.method === 'HEAD' ? undefined : lent.bytes); return;
      }
      if(req.method==='GET'&&/^\/invite\/[a-f0-9]{32}$/u.test(pathname)){
        const location=agentControl?.invitation(pathname.slice('/invite/'.length));
        if(!location)return json(res,410,{error:'这个邀请已撤销、过期或不存在。'});
        res.writeHead(302,{location,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return;
      }
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
      if(pathname==='/public'&&req.method==='GET'){
        res.writeHead(302,{location:`${basePath}/?phone=public`,'cache-control':'no-store'});res.end();return;
      }
      if (pathname === '/api/relay-usage') {
        const bearer = /^Bearer ([a-f0-9]{64})$/u.exec(req.headers.authorization ?? '')?.[1];
        const personal = entries.resolve(new URL('/', 'http://voice.invalid'));
        if (req.method !== 'GET' || url.search || !hosted || !iosBindings?.allowsUsageWidget(personal, bearer))
          return json(res, 403, {error:'此小组件需要本人的个人入口。'});
        try { return json(res, 200, await readRelayUsage(relayUsageFile)); }
        catch { return json(res, 503, {error:'用量暂未更新。'}); }
      }
      if(pathname==='/api/ios-public'&&req.method==='POST'){
        if(!iosPublicEntry||!guestAccess||!iosBindingsFile||!backendReady()||!phoneModels().some(m=>m.id!=='gpt-live'&&m.available))return json(res,503,{error:'Public 暂不可用，请稍后重试。'});
        const ip=String(req.headers['cf-connecting-ip']??req.socket.remoteAddress??'unknown').slice(0,128);
        if(!allow('ios-public:'+ip))return json(res,429,{error:'准备次数较多，请稍后重试。'});
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>512)return json(res,413,{error:'请求过大。'});chunks.push(chunk);}
        let params;try{params=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'请求无效。'});}
        if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).length!==1||typeof params.deviceKey!=='string')return json(res,400,{error:'仅接受设备凭证。'});
        try{return json(res,200,await iosBindings.provisionPublic(params.deviceKey,id=>guestBinding(req,'public',{id})));}
        catch(error){return json(res,error instanceof IosBindingAuthorizationError?403:503,{error:'无法准备 Public，请稍后重试。'});}
      }
      const iosExchange=pathname==='/api/ios-binding/redeem'||pathname==='/api/ios-binding/access';
      if(iosExchange&&req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return json(res,413,{error:'绑定请求过大'});chunks.push(chunk);}
        try{req.iosExchangeBody=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'绑定请求无效'});}
      }
      // Managed historical bookmarks enter the current-account flow. Never
      // rewrite callback state, API requests, or existing personal grants.
      const browserEntry=req.method==='GET'&&['/','/feishu','/feishu/confirm'].includes(pathname);
      const originalPhone=url.searchParams.get('phone'),devicePhone=iosBindings?.canonicalPhone(originalPhone)??originalPhone;
      const canonicalPhone=(browserEntry?phoneLogin?.browserCanonicalPhone(devicePhone):phoneLogin?.canonicalPhone(devicePhone))??devicePhone;
      if(canonicalPhone&&canonicalPhone!==originalPhone)url.searchParams.set('phone',canonicalPhone);
      if(browserEntry&&canonicalPhone&&canonicalPhone!==devicePhone){
        // The browser and its subsequent API requests must share the same
        // canonical address, including when opened outside Feishu.
        res.writeHead(302,{location:`${basePath}${pathname}${url.search}`,'cache-control':'no-store'});res.end();return;
      }
      // Existing confirmation links now open the phone itself. Sending requires
      // the same-origin POST below, never a navigation side effect.
      if(phoneLogin?.confirmation&&pathname==='/feishu/confirm'&&req.method==='GET'){
        pathname='/feishu';url.searchParams.set('connect','1');
      }
      if(phoneLogin?.confirmation&&pathname==='/feishu/confirm/prepare'&&req.method==='POST'){
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512)return json(res,413,{error:'请求过大'});}
        let body;try{body=JSON.parse(raw);}catch{return json(res,400,{error:'请求无效'});}
        if(!body||Array.isArray(body)||Object.keys(body).length)return json(res,400,{error:'请求无效'});
        const ip=String(req.headers['cf-connecting-ip']??req.socket.remoteAddress??'unknown').slice(0,128);
        if(!allow('feishu-confirm:'+ip))return json(res,429,{error:'请求较多，请稍后重试。'});
        try{
          if(!guestAccess)throw Error('guest_unavailable');
          const setup=phoneLogin.confirmation.prepare(req,res,canonicalPhone);
          const confirmationCookie=res.getHeader('set-cookie');phoneLogin.clearIdentity(res);
          res.setHeader('set-cookie',[confirmationCookie,res.getHeader('set-cookie')]);
          const guest=guestBinding(req,canonicalPhone,guestAccess.read(req)??{id:randomBytes(16).toString('hex')});
          issueVisitor(res,guest,{id:guest.visitorId});
          return json(res,200,{...setup,entry:entrySnapshot(guest)});
        }catch{return json(res,400,{error:'请从原飞书会话重新打开电话。'});}
      }
      if(phoneLogin?.confirmation&&['/feishu/confirm/start','/feishu/confirm/status','/feishu/confirm/cancel'].includes(pathname)&&req.method==='POST'){
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512)return json(res,413,{error:'请求过大'});}
        let body;try{body=JSON.parse(raw);}catch{return json(res,400,{error:'请求无效'});}
        if(!body||Object.keys(body).length!==1||typeof body.state!=='string')return json(res,400,{error:'请求无效'});
        try{
          if(pathname.endsWith('/cancel')){phoneLogin.confirmation.cancel(req,body.state);return json(res,200,{status:'cancelled'});}
          if(pathname.endsWith('/start')){const started=await phoneLogin.confirmation.start(req,body.state);console.info(JSON.stringify({type:'voice.card-confirmation',stage:'start',status:started.status}));return json(res,200,started);}
          const result=await phoneLogin.confirmation.poll(req,res,body.state);
          if(result.binding)issueVisitor(res,result.binding);
          return json(res,200,{status:result.status,...(result.binding?{entry:entrySnapshot(result.binding)}:{}),...(result.location?{location:result.location}:{})});
        }catch(error){if(pathname.endsWith('/start'))console.warn(JSON.stringify({type:'voice.card-confirmation',stage:'send-failed',reason:error.message==='confirmation_rate_limited'?'rate_limited':error.message==='confirmation_delivery_failed'?'delivery':'request'}));
          return json(res,error.message==='confirmation_rate_limited'?429:403,{error:error.message==='confirmation_rate_limited'?'此会话刚收到确认请求，请稍后重试。':'连接请求无效或已过期，请重新连接。'});}
      }
      let entryVisitor = null, entryBinding = null, clientLoginConfig = null;
      const handoffBinding=phoneLogin&&pathname==='/feishu'?phoneLogin.consumeHandoff(req,url.searchParams.get('phone'),url.searchParams.get('identified')):null;
      if(phoneLogin&&pathname==='/feishu/client-login'&&req.method==='POST') {
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)return json(res,413,{error:'登录请求过大'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'登录请求无效'});}
        const pending=phoneLogin.clientPending(req,body.state);
        if(!pending)return json(res,401,{error:'请重新打开电话入口'});
        try {
          if(body.failure){
            console.warn(JSON.stringify({type:'voice.feishu-client-error',stage:'sdk',providerCode:Number.isInteger(body.failure.code)?body.failure.code:null}));
            const remembered=await phoneLogin.resumeConfirmedClient(req,body.state);
            if(remembered){
              issueVisitor(res,remembered);
              return json(res,200,{status:entrySnapshot(remembered)});
            }
            // A card clicked after its page closed (Feishu mobile) is redeemed
            // by the same browser on reopening; otherwise it would be orphaned.
            const confirmed=await phoneLogin.confirmation?.resume(req,res,pending.phone);
            if(confirmed?.binding){
              console.info(JSON.stringify({type:'voice.card-confirmation',stage:'redeemed-on-reopen'}));
              issueVisitor(res,confirmed.binding);
              return json(res,200,{status:entrySnapshot(confirmed.binding)});
            }
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
        &&!handoffBinding&&url.searchParams.get('guest')!=='1'&&url.searchParams.get('oauth')!=='1'&&url.searchParams.get('retry')!=='1'&&url.searchParams.get('connect')!=='1';
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
        if(!phoneLogin.hasConfirmedIdentity(req))phoneLogin.clearIdentity(res);
        const cleared=res.getHeader('set-cookie');
        const callback=oldState?null:new URL(phoneLogin.beginClient(req,res,currentPhone),publicOrigin);
        if(cleared&&callback)res.setHeader('set-cookie',[cleared,res.getHeader('set-cookie')]);
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
            if(url.searchParams.get('retry')!=='1'&&url.searchParams.get('guest')!=='1'&&url.searchParams.get('connect')!=='1'){
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
          res.end(feishuPhoneLoginErrorPage({reason:failure.reason,phone:error.recoveryPhone??url.searchParams.get('phone'),basePath,publicHref:iosPublicEntry&&guestAccess?`${basePath}/?phone=public`:null}));
          return;
        }
      }
      if(req.method==='GET'&&pathname==='/feishu-client-login.mjs') {
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});
        res.end(await readFile(join(here,'feishu-client-login.mjs')));return;
      }
      if(url.searchParams.get('entry')==='visitor'){
        if(iosPublicEntry&&guestAccess&&req.method==='GET'&&pathname==='/'){
          res.writeHead(302,{location:`${basePath}/?phone=public`,'cache-control':'no-store'});res.end();return;
        }
        return json(res,404,{error:'请从 Public 入口重新进入。'});
      }
      if(iosPublicEntry&&guestAccess&&req.method==='GET'&&pathname==='/'&&url.searchParams.get('phone')==='public'){
        entryVisitor=guestAccess.issue(res,guestAccess.read(req)??{});
        entryBinding=guestBinding(req,'public',entryVisitor);
      }
      if(parseFeishuConversationPhone(url.searchParams.get('phone'))&&!phoneLogin?.read(req)&&!iosBindings?.principalFor(req,url.searchParams.get('phone'),req.iosExchangeBody)&&!guestBinding(req,url.searchParams.get('phone'))&&!entryBinding){
        if(req.method==='GET'&&pathname==='/'){res.writeHead(302,{location:`${basePath}/feishu?phone=${encodeURIComponent(url.searchParams.get('phone'))}`,'cache-control':'no-store'});res.end();return;}
        return json(res,401,{error:'请从飞书会话电话入口登录。'});
      }
      const binding = entryBinding ?? await resolveBinding(req,url);
      if (!binding) return json(res,iosPublicEntry&&url.searchParams.get('phone')==='public'?401:404,{error:"这个电话入口不存在或已关闭。"});
      const entry = binding.id;
      const access = entryAccess(binding);
      // Managed guest capabilities must not be converted into independent
      // long-lived iOS grants that outlive their revocation/expiry.
      if(binding.cliManaged&&pathname.startsWith('/api/ios-binding'))return json(res,403,{error:'此临时授权不支持转为长期设备绑定。'});
      if (phoneLogin?.protects(binding) && !phoneLogin.permits(req, binding) && !iosBindings?.read(req,binding)
        && !iosExchange && (pathname === '/' || pathname.startsWith('/api/'))) {
        if (req.method === 'GET' && pathname === '/') {
          res.writeHead(302, {location: `${basePath}/feishu?phone=${encodeURIComponent(entry)}${callIdValid(url.searchParams.get('call'))?'&call='+url.searchParams.get('call'):''}`, 'cache-control':'no-store'}); res.end(); return;
        }
        return json(res, 401, {error:'请从飞书电话入口登录后拨号。'});
      }
      const staticFiles = new Map([
        ["/tv-opus.mjs", [join(here, "tv-opus.mjs"), "text/javascript; charset=utf-8"]],
        ["/assets/opus-0.1.1/decoder.mjs", [join(opusAssets, "opusscript_native_wasm.js"), "text/javascript; charset=utf-8"]],
        ["/assets/opus-0.1.1/decoder.wasm", [join(opusAssets, "opusscript_native_wasm.wasm"), "application/wasm"]],
        ["/assets/opus-0.1.1/LICENSE", [join(opusAssets, "../LICENSE"), "text/plain"]],
        ["/assets/opus-0.1.1/COPYING.libopus", [join(opusAssets, "COPYING.libopus"), "text/plain"]],
        ["/ios-shell-release.json", [join(here, "ios-shell-release.json"), "application/json; charset=utf-8"]],
        ["/", [join(here, "index.html"), "text/html; charset=utf-8"]],
        ["/compare", [join(here, "comparison.html"), "text/html; charset=utf-8"]],
        ["/comparison.mjs", [join(here, "comparison.mjs"), "text/javascript; charset=utf-8"]],
        ["/comparison.css", [join(here, "comparison.css"), "text/css; charset=utf-8"]],
        ["/markdown.mjs", [join(here, "markdown.mjs"), "text/javascript; charset=utf-8"]],
        ["/vendor/marked-18.0.5.mjs", [join(here, "vendor/marked-18.0.5.mjs"), "text/javascript; charset=utf-8"]],
        ["/feishu-confirmation-client.mjs", [join(here, "feishu-confirmation-client.mjs"), "text/javascript; charset=utf-8"]],
        ["/entry-startup.mjs", [join(here, "entry-startup.mjs"), "text/javascript; charset=utf-8"]],
        ["/model-options.mjs", [join(here, "model-options.mjs"), "text/javascript; charset=utf-8"]],
        ["/app.js", [join(here, "app.js"), "text/javascript; charset=utf-8"]],
        ["/app-bundle.mjs", [join(here, "app-bundle.mjs"), "text/javascript; charset=utf-8"]],
        ["/dial-connection.mjs", [join(here, "dial-connection.mjs"), "text/javascript; charset=utf-8"]],
        ["/tv-startup.bundle.mjs", [join(here, "tv-startup.bundle.mjs"), "text/javascript; charset=utf-8"]],
        ["/tv-entry.bundle.mjs", [join(here, "tv-entry.bundle.mjs"), "text/javascript; charset=utf-8"]],
        ["/tv-host.mjs", [join(here,"tv-host.mjs"), "text/javascript; charset=utf-8"]],
        ...["tv-array-capture.mjs","tv-array-dsp.mjs","tv-array-worker.js"].map(name=>[`/${name}`,[join(here,name),"text/javascript; charset=utf-8"]]),
        ["/assets/tv-aec/webrtcaec3-0.3.0.js",[join(here,"assets/tv-aec/webrtcaec3-0.3.0.js"),"text/javascript; charset=utf-8"]],
        ["/assets/tv-aec/webrtcaec3-0.3.0.wasm",[join(here,"assets/tv-aec/webrtcaec3-0.3.0.wasm"),"application/wasm"]],
        ["/feishu-client-login.mjs", [join(here, "feishu-client-login.mjs"), "text/javascript; charset=utf-8"]],
        ["/events.mjs", [join(here, "events.mjs"), "text/javascript; charset=utf-8"]],
        ["/duplex-playback.mjs", [join(here, "duplex-playback.mjs"), "text/javascript; charset=utf-8"]],
        ["/speaker-routing.mjs", [join(here, "../speaker-native/client.mjs"), "text/javascript; charset=utf-8"]],
        ...["device-location.mjs", "caller-context.mjs", "ui-bundle.mjs", "call-view.mjs", "improv-player.mjs", "board-client.mjs", "board-assets-client.mjs", "board-scene.mjs", "board-sketch.mjs", "media-references.mjs", "screen-wake-lock.mjs", "content-view.mjs", "microphone-capture.mjs", "microphone-session.mjs", "transcript-presentation.mjs", "call-sounds.mjs", "relay-audio.mjs", "upload-backpressure.mjs", "avatar.mjs", "avatar-state.mjs", "avatar-catalog.mjs", "avatar-approved-reactions.mjs", "avatar-reactions.mjs", "avatar-telemetry.mjs"].map((name) => [`/${name}`, [join(here, name), "text/javascript; charset=utf-8"]]),
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
        const bundled = ['/app-bundle.mjs','/tv-entry.bundle.mjs','/tv-startup.bundle.mjs'].includes(pathname) ? await browserBundle(pathname.slice(1)) : null;
        let contents = bundled?.bytes ?? await readFile(file);
        if (pathname === "/assets/opus-0.1.1/decoder.mjs") contents = Buffer.concat([contents, Buffer.from("\nexport default Module;\n")]);
        if (pathname === "/") {
          // The first frame needs this CSS, so return the exact release bytes
          // in the HTML instead of requiring another mobile-network round trip.
          const css = await readFile(join(here, "styles.css"), "utf8");
          let html = contents.toString("utf8").replace('<head>', `<head><base href="${basePath||''}/">`).replace('<link rel="stylesheet" href="./styles.css" />', `<style data-voice-entry>${css}</style>`);
          // TV transparency/layout must exist before the first paint, not after app.js loads.
          if(url.searchParams.get('tv')==='1') {
            // These versioned local DSP assets contain no user data. Fetch them
            // with the entry instead of waiting for the capture worker waterfall.
            html=html.replace('</head>','<link rel="preload" as="script" href="./assets/tv-aec/webrtcaec3-0.3.0.js"><link rel="preload" as="fetch" type="application/wasm" crossorigin href="./assets/tv-aec/webrtcaec3-0.3.0.wasm"></head>');
            const shell=url.searchParams.get('tvShell')==='1';
            const presented=!(shell&&url.searchParams.get('tvSurface')==='1');
            html=html.replace('<html lang="zh-CN">',`<html lang="zh-CN" data-tv="true" data-tv-layout="${shell?'medium':'full'}" data-tv-presented="${presented}"${url.searchParams.get('tvOverlay')==='1'?' data-tv-overlay="true"':''}>`);
          }
          if(clientLoginConfig)html=html.replace('</head>','<link rel="preconnect" href="https://lf1-cdn-tos.bytegoofy.com"><link rel="preload" as="script" href="https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js"></head>').replace('<script type="module" src="./entry-startup.mjs"></script>',`<script type="application/json" id="login-config">${JSON.stringify(clientLoginConfig).replaceAll('<','\\u003c')}</script><script type="module" src="./entry-startup.mjs"></script>`);
          if(speakerRouting)html=html.replace('<body','<body data-speaker-routing="true"');
          if(candidateRelease)html=html.replace('<script type="module" src="./app.js"></script>',`<script type="application/json" id="voiceCandidateRelease">${JSON.stringify(candidateRelease).replaceAll('<','\\u003c')}</script><script type="module" src="./app.js"></script>`);
          // Only an authenticated request receives an entry snapshot. It is a
          // presentation hint; every session/tool request still authorizes itself.
          const visitor = hosted ? entryVisitor ?? readVisitor(req,binding) : null;
          const canCheckEntry = visitor && (contexts.has(`${entry}:${visitor.id}`) || contexts.size < 512);
          if (!hosted || canCheckEntry) {
            const initial = JSON.stringify(entrySnapshot(binding,req)).replaceAll("<", "\\u003c");
            html = html.replace('<script type="module" src="./app.js"></script>', `<script type="application/json" id="voiceEntryStatus">${initial}</script><script type="module" src="./app.js"></script>`);
          }
          // Keep the early startup/auth module as the single entry owner. The
          // TV engine bundle removes the high-latency static-import waterfall.
          if(url.searchParams.get('tv')==='1'){
            html=html.replace(/<link rel="modulepreload" href="[^"]+" \/>/g,'');
            const [startup, engine] = await Promise.all(['tv-startup.bundle.mjs','tv-entry.bundle.mjs'].map(name=>browserBundle(name)));
            const startupUrl = './tv-startup.bundle.mjs?v=' + startup.revision;
            const engineUrl = './tv-entry.bundle.mjs?v=' + engine.revision;
            html=html.replace('src="./entry-startup.mjs"',`src="${startupUrl}"`);
            html=html.replace('</head>',`<link rel="modulepreload" href="${startupUrl}"><link rel="modulepreload" href="${engineUrl}"></head>`);
            html=html.replace('src="./app.js"',`src="${engineUrl}"`);
          } else {
          // Only public application code is cacheable. HTML, inline account
          // status, login/SDK exchanges and every API keep their existing gate
          // and no-store policy. A new artifact gets a new bundle URL.
          const {revision}=await browserBundle();
          html=html.replaceAll('./app.js',`./app-bundle.mjs?v=${revision}`);
          const bootstrap=(await entryBootstrap()).replace(/<\/script/giu,'<\\/script');
          html=html.replace('<script type="module" src="./entry-startup.mjs"></script>',
            `<script type="module" data-voice-entry-bootstrap>${bootstrap}</script>`);
          }
          contents = Buffer.from(html);
        }
        res.writeHead(200, { "content-type": type, "cache-control": (pathname.startsWith("/assets/tv-aec/webrtcaec3-0.3.0.") || pathname.startsWith("/assets/opus-0.1.1/")) ? "public, max-age=31536000, immutable" : bundled && url.searchParams.get("v") === bundled.revision ? "private, max-age=31536000, immutable" : pathname.startsWith("/assets/v-operator-") ? "public, max-age=86400" : "no-store" }); res.end(contents); return;
      }
      if(binding.permissionProfile==='unidentified'&&!pathname.startsWith('/api/page/')&&!new Set(['/api/board','/api/board-image','/api/board-assets','/api/status','/api/session','/api/presentation','/api/events','/api/content-shown','/api/avatar','/api/avatar-events','/api/heartbeat','/api/close','/api/ios-binding','/api/ios-binding/redeem','/api/ios-binding/access','/api/ios-binding/revoke',...(binding.cliManaged?['/api/access']:[])]).has(pathname))return json(res,403,{error:'当前是身份未确认的临时通话。'});
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
        if(binding.cliManaged&&Object.keys(params).some(key=>key!=='access'))return json(res,400,{error:'临时授权只接受访问凭据。'});
        if (!access.accepts(params.access)) return json(res, 403, { error: "分享链接无效或已失效" });
        const visitor = access.issue(res,binding.cliManaged?{id:binding.visitorId}:{});
        const includeStatus = binding.id === 'tianyi' && url.searchParams.get('snapshot') === '1' && contexts.size < 512;
        return json(res, 200, { ok: true, expiresAt: visitor.expiresAt, ...(includeStatus ? {status:entrySnapshot(binding,req)} : {}) });
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
        ready: backendReady(), preview, defaultModel, ...(directVoice?.attach?{nativeDialVersion:1,webDialVersion:2,dialGreeting:true,tvDialStandby:hosted}:{}), conversation:conversationPresentation(binding),iosBindingAvailable:hosted, ...(speakerRouting&&binding.permissionProfile!=='unidentified'?{speakerRouting:true,phoneInputPolicy,speakerStats:speakerRouting.snapshot()}:{}),
        releaseReadiness: releaseReadiness(),
        ...(listening?{comparisonAvailable:true}:{}), model: "gpt-live-1-codex", activeCall: Boolean(context.active), creatingSession: context.creatingSession,
        models:phoneModels(),...entryPresentation(binding,req),
        ...(improvAllowed(binding)?{improvLive:true,...(director.uploadReference && boardAssets && boardAllowed(binding) ? {referenceUpload:true} : {})}:{}),
        ...(boardAllowed(binding)?{board:true}:{}),
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
      if (pathname === '/api/reference-image') {
        const active = context.active;
        if (!active?.improv || !improvAllowed(binding) || !boardAllowed(binding) || !boardAssets || !director?.uploadReference ||
            active.reservation.voiceSessionId !== url.searchParams.get('call')) return json(res,409,{error:'参考图需要当前通话'});
        const type = req.headers['content-type'], chunks = [];
        let size = 0;
        if (!['image/jpeg','image/png','image/webp'].includes(type)) return json(res,415,{error:'请选择 JPG、PNG 或 WebP 图片'});
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8*1024*1024) return json(res,413,{error:'请选择小于 8 MB 的图片'});
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        const matches = type==='image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from([255,216,255])) :
          type==='image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
          bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
        if (!matches) return json(res,415,{error:'文件内容和图片格式不一致'});
        const link = await director.uploadReference(bytes,type);
        if (context.active !== active) return json(res,409,{error:'这通电话已结束'});
        const owner=active.reservation.voiceSessionId;
        const item=boardAssets.add(owner,{url:link,name:'我上传的参考图',source:'upload'});
        boardAssets.pick(owner,item.id);
        return json(res,200,{id:item.id});
      }
      let params = await readBody();
      // Page features (`/api/page/<name>`): what a page may ask the service for, beside the call itself.
      // The iOS App relays any of them through one bridge command, so a new one ships with the service
      // and the page alone. Each is the same request as the web page's own route; access is decided there.
      if (pathname.startsWith('/api/page/')) {
        const name = pathname.slice('/api/page/'.length), feature = Object.hasOwn(PAGE_FEATURES, name) ? PAGE_FEATURES[name] : null;
        if (!feature) return json(res,404,{error:'没有这个入口'});
        ({pathname, params} = feature(params));
      }
      if (pathname === "/api/page-version") {
        servedPageBuild ??= readFile(join(here, "ios-shell-release.json"), "utf8").then(text => {const {build = null, updated = null} = JSON.parse(text);return {build, updated};}).catch(() => ({build: null, updated: null}));
        return json(res, 200, await servedPageBuild);
      }
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
      // (Hung up after its connection had already gone: nothing is kept for a redial.)
      if(pathname==='/api/close'&&params.voiceSessionId!==context.active?.reservation.voiceSessionId&&isClosedCall(context,params.voiceSessionId)){letGo(context,params.voiceSessionId);return json(res,200,{ok:true});}
      if (!context.active || params.voiceSessionId !== context.active.reservation.voiceSessionId) return json(res, 409, { error: "通话已结束，请重新开始" });
      context.active.touchedAt = Date.now();
      if(pathname==='/api/improv-end')return json(res,200,{ended:await context.active.improv?.end(params.id,['time','failed','caller'].includes(params.reason)?params.reason:'')??false});
      // Player milestones carry no content: which stage, how long since the start receipt, and why it ended.
      if(pathname==='/api/improv-stage'){
        const stage=['ice','offer','configured','first-frame','direction-played','beat-played','ended','recorded','record-failed'].includes(params.stage)?params.stage:null;
        if(stage&&context.active.improv)callControlAudit({type:'improv.stage',voiceSessionId:context.active.reservation.voiceSessionId,stage,
          ...(Number.isSafeInteger(params.ms)&&params.ms>=0&&params.ms<3_600_000?{ms:params.ms}:{}),
          ...(['time','failed','caller','call','provider'].includes(params.reason)?{reason:params.reason}:{}),
          ...(Number.isSafeInteger(params.status)&&params.status>=100&&params.status<600?{status:params.status}:{})});
        return json(res,200,{ok:true});
      }
      if(pathname==='/api/device-result'){
        const active=context.active;
        if(active.direct||!active.deviceBound||active.deviceRetired||Object.keys(params).some(k=>!['voiceSessionId','frame'].includes(k)))return json(res,409,{error:'设备通道已结束'});
        let accepted=false;try{accepted=active.deviceChannel.receive(params.frame);}catch{}
        return json(res,accepted?200:409,{accepted});
      }

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
      if (pathname === '/api/board') {
        if (!boardAllowed(binding)) return json(res,404,{error:'没有这个入口'});
        const request = boundedBoardRequest(params), active = context.active;
        if (!request) return json(res,400,{error:'画面上下文无效'});
        // One operation per event, flushed as the model writes it. The page
        // going away (hang-up, newer request) stops the model call.
        // (`collect`: the iOS app's native bridge cannot pass a stream. It gets every operation of
        // the run in one JSON reply instead, the same operations in the same order.)
        const collected = params.collect === true ? [] : null;
        if (!collected) { res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store, no-transform','x-accel-buffering':'no'}); res.flushHeaders(); }
        const gone = new AbortController();
        res.on('close',()=>{ if (!res.writableEnded) gone.abort(); });
        const send = value => { if (collected) { if (collected.length < 200) collected.push(value); return; } if (!res.writableEnded && !gone.signal.aborted) res.write(`data: ${JSON.stringify(value)}\n\n`); };
        const result = await board.run({owner:params.voiceSessionId,...request,signal:gone.signal,quiet:binding?.permissionProfile!=='personal-tianyi',
          // (A call whose model is never handed a lesson's script: nothing prepared ahead will take the page.)
          unscripted:directVoice?.unscripted?.(params.voiceSessionId)===true,
          onOp:op=>{ if (context.active === active) send(op); }});
        // (A call whose V explains in its own words is told what the caller's question put on the page, or that
        // nothing was: V then names those things in that order and the mark can follow its voice. See `namedThings`.)
        if(request.trigger==='user'&&context.active===active&&directVoice?.boardOpening&&directVoice.unscripted?.(params.voiceSessionId)===true)
          directVoice.boardOpening(params.voiceSessionId,result.reason==='drawn'?namedThings(board.scene(params.voiceSessionId)):[]);
        send({op:'done',reason:result.reason,rev:result.rev??board.scene(params.voiceSessionId).rev,durationMs:result.durationMs,firstOpMs:result.firstOpMs??null});
        if (collected) return json(res,200,{ops:collected});
        res.end();return;
      }
      if (pathname === '/api/board-image') {
        if (!boardAllowed(binding) || !boardPhotos) return json(res,404,{error:'没有这个入口'});
        // Only a photograph the director has put on this call's board.
        const query = typeof params.query === 'string' ? params.query : '';
        // (Any page of this call's canvas: earlier pages stay on it.)
        if (!scenePictures(board.scene(params.voiceSessionId)).has(query)&&!(board.canvas?.(params.voiceSessionId).zones??[]).some(zone=>scenePictures(zone).has(query))) return json(res,404,{error:'画面上没有这张照片'});
        // V's own web search, in this call's session, for things Wikipedia has no picture of.
        const active = context.active;
        const search = text => (active.gateway??gateway).request('tools.invoke',{agentId:binding.agentId??'makaron',sessionKey:active.sessionKey,name:'web_search',args:{query:text,count:5}},{timeoutMs:12000});
        const found = await boardPhotos.find(query,{search});
        // 404: there is no such picture. 503: it could not be looked for just now (the image
        // search refused or timed out), so the page may ask again (11/20: a "show me more"
        // gallery lost pictures that were found the second time).
        if (!found) return boardPhotos.settled?.(query) === false ? json(res,503,{error:'暂时找不到照片'}) : json(res,404,{error:'没有找到照片'});
        // On the caller's screen from now on: V can name it as the picture to work from (board-assets.mjs).
        if (boardAssets) { const state = board.state?.(params.voiceSessionId); boardAssets.found(params.voiceSessionId, {query, name: pictureName([state?.scene, ...(state?.canvas?.zones ?? [])], query)}); }
        // (`inline`: for the iOS app's native bridge, which passes JSON only.)
        if (params.inline === true) return found.bytes.length <= 1400*1024 ? json(res,200,{type:found.type,data:Buffer.from(found.bytes).toString('base64')}) : json(res,404,{error:'照片太大'});
        res.writeHead(200,{'content-type':found.type,'cache-control':'no-store','content-length':found.bytes.length});
        res.end(found.bytes);return;
      }
      if (pathname === '/api/board-assets') {
        // The call's shelf of made things (board-assets.mjs): what each id on the board is, which
        // one the caller has tapped, and the whole board when the page's copy is behind.
        if (!boardAllowed(binding) || !boardAssets) return json(res,404,{error:'没有这个入口'});
        const owner = params.voiceSessionId;
        if (typeof params.pick === 'string' && (params.pick === '' || SHELF_ID.test(params.pick))) boardAssets.pick(owner, params.pick);
        // (`address`: where the thing can be saved from. A found photograph is lent out for it.)
        const address = typeof params.address === 'string' && SHELF_ID.test(params.address) ? {id: params.address, url: await boardAssets.address(owner, params.address)} : null;
        if(Array.isArray(params.visible))boardAssets.visible?.(owner,params.visible);
        if (Array.isArray(params.seen)) boardAssets.seen(owner, params.seen.filter(id => typeof id === 'string' && SHELF_ID.test(id)),params.shapes);
        const state = board.state(owner);
        return json(res,200,{...boardAssets.page(owner),rev:state.scene.rev,...(address?{address}:{}),...(Number.isSafeInteger(params.rev)&&(params.rev!==state.scene.rev||typeof params.call==='string'&&params.call!==owner.slice(0,8))?{sync:state}:{})});
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
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      const message = /requires an active|No active|no active/iu.test(error.message) ? "目前没有正在运行的后台任务，可以直接对 V 说话。" : "这次连接没有完成，请重新开始通话。";
      json(res, error.message === "Request too large" ? 413 : 500, { error: message });
    }
  });
  const timer = setInterval(() => {
    void invalidateManagedCalls().catch(()=>{});
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
  const waitingDials=new Map();
  async function admitDial(req,url,accept,rejectRequest){
      // While this dial's live admission is in flight, the reads it will need
      // may start for the conversation the caller was last admitted to.
      let prefetched=null;
      const reject=status=>{prefetched?.discard();rejectRequest(status);};
      if(stopping||releaseGate.blocked()||!backendReady())return reject(503);
      if(typeof directVoice.attach!=='function')return reject(404);
      const dialVersion=url.searchParams.get('dialVersion');
      const allowed=new Set(['phone','model','voice','nativeRuntimeVersion','nativeDeviceActions','dialVersion',...(dialVersion==='2'?['inputPolicy','improvLive','greeting']:[])]);
      if([...url.searchParams.keys()].some(k=>!allowed.has(k)||url.searchParams.getAll(k).length!==1)
        ||!['1','2'].includes(dialVersion)
        ||(dialVersion==='1'?url.searchParams.get('nativeRuntimeVersion')!=='1':url.searchParams.has('nativeRuntimeVersion'))
        ||url.searchParams.has('greeting')&&url.searchParams.get('greeting')!=='1'
        ||url.searchParams.has('inputPolicy')&&!['native','speaker'].includes(url.searchParams.get('inputPolicy'))
        ||!['seeduplex','grok','gpt-live-11'].includes(url.searchParams.get('model')))return reject(400);
      const dialModel=url.searchParams.get('model');
      const binding=await resolveBinding(req,url,typeof directVoice.prefetch==='function'?{speculate:hint=>{if(!prefetched)prefetched=directVoice.prefetch({...hint,model:dialModel});}}:undefined).catch(()=>null);if(!binding)return reject(404);
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
      let actions;try{actions=url.searchParams.has('nativeDeviceActions')?JSON.parse(url.searchParams.get('nativeDeviceActions')):undefined;normalizeDeviceActions(actions);}catch{return reject(400);}
      const params={model:url.searchParams.get('model'),...(dialVersion==='2'&&url.searchParams.get('improvLive')==='1'?{improvLive:true}:{}),...(dialVersion==='1'?{nativeRuntimeVersion:1,inputPolicy:phoneInputPolicy}:url.searchParams.has('inputPolicy')?{inputPolicy:url.searchParams.get('inputPolicy')}:{}),...(actions?{nativeDeviceActions:actions}:{}),
        ...(url.searchParams.has('voice')?{voice:url.searchParams.get('voice')}:{}),...(url.searchParams.has('resumed')?{resumed:(()=>{try{return JSON.parse(url.searchParams.get('resumed'));}catch{return {};}})()}:{})};
      accept(client=>{
        client.on('error',()=>{});
        // Until attach owns the socket, reject all input. No microphone data
        // or arbitrary startup messages may race reservation/authentication.
        const earlyInput=()=>client.close(1008);client.on('message',earlyInput);
        const cancelled=()=>client.readyState!==WebSocket.OPEN;
        void (async()=>{
          let reservation;
          try{
            const result=await reservePhoneCall({context,binding,params,req,ip,cancelled,prefetched}).finally(()=>{if(!prefetched?.adopted)prefetched?.discard();});
            if(result.status!==200){if(!cancelled()){client.send(JSON.stringify({type:'dial.error',status:result.status}));client.close(1008);}return;}
            reservation=result.body;
            if(cancelled()){if(context.active?.reservation===reservation)await close(context);return;}
            // The caller learns its owned ID and policy before any provider frame.
            client.send(JSON.stringify({...reservation,type:'reservation',dialVersion:Number(dialVersion),relayTicket:undefined}));
            client.removeListener('message',earlyInput);
            if(!directVoice.attach(reservation.voiceSessionId,reservation.relayTicket,client,{greeting:url.searchParams.get('greeting')==='1'}))throw Error('Dial attach failed');
          }catch{
            if(reservation&&context.active?.reservation===reservation)await close(context).catch(()=>{});
            if(!cancelled()){client.send(JSON.stringify({type:'dial.error',status:503}));client.close(1011);}
          }
        })();
      });
  }
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
    const rejectUpgrade=status=>socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if(url.pathname===`${basePath}/api/dial`){
      await admitDial(req,url,handler=>dialSockets.handleUpgrade(req,socket,head,handler),rejectUpgrade);
      return;
    }
    if(url.pathname===`${basePath}/api/dial-standby`){
      // Hold only an authenticated browser transport. Admission, prefetch, and the
      // provider start inside admitDial, after the explicit dial message.
      if(!hosted||stopping||releaseGate.blocked()||!req.headers.cookie||url.searchParams.size)return rejectUpgrade(403);
      const ip=String(req.headers['cf-connecting-ip']??socket.remoteAddress??'unknown').slice(0,128);
      if(waitingDials.size>=64||[...waitingDials.values()].filter(value=>value===ip).length>=4)return rejectUpgrade(429);
      waitingDials.set(socket,ip);
      const release=()=>waitingDials.delete(socket);
      socket.once('close',release);
      const binding=await resolveBinding(req,url).catch(()=>null);
      if(socket.destroyed){release();return;}
      if(!binding||!readVisitor(req,binding)||phoneLogin?.protects(binding)&&!phoneLogin.permits(req,binding)&&!iosBindings?.read(req,binding)){
        release();return rejectUpgrade(403);
      }
      dialSockets.handleUpgrade(req,socket,head,client=>{
        client.on('error',()=>{});
        // Cached TV renderers may suspend their event loop. Keep the authenticated
        // transport alive through proxies without requiring an idle renderer to answer.
        const timer=setInterval(()=>{
          if(client.readyState!==WebSocket.OPEN||client.bufferedAmount>2048){client.terminate();return;}
          client.send('{"type":"standby.pulse"}');
        },25000);
        timer.unref?.();
        const cleanup=()=>{release();clearInterval(timer);};
        client.once('close',cleanup);
        client.once('message',(raw,binary)=>{
          cleanup();
          if(binary||raw.length>2048){client.close(1008);return;}
          const dial=new URL(`${basePath}/api/dial`,expectedOrigin);
          dial.search=raw.toString();
          if(dial.searchParams.has('phone')||dial.searchParams.get('dialVersion')!=='2'){client.close(1008);return;}
          const reject=()=>client.close(1008);
          client.once('message',reject);
          void admitDial(req,dial,handler=>{
            client.off('message',reject);
            handler(client);
          },reject).catch(()=>client.close(1011));
        });
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
  async function invalidateManagedCalls(){
    for(const context of contexts.values())if(context.entry?.startsWith('cli_')&&!agentControl?.active(context.entry)){
      for(const response of context.listeners)response.end();context.listeners.clear();
      await close(context);
    }
  }
  return { server, emit, sessionBusy, serviceReady: backendReady, releaseReadiness, releaseGate,
    setAgentControl:control=>{if(agentControl||entries.publicEntries().some(e=>e.id.startsWith('cli_')))throw Error('CLI controller or reserved entry prefix already in use');agentControl=control;},
    invalidateManagedCalls,
    cliConfiguration:()=>({publicOrigin,basePath,accountId:feishuLogin?.conversations?feishuLogin.accountId:null,guestEnabled:!!guestAccess&&iosPublicEntry,publicTools:!!guestAccess&&iosPublicEntry&&publicTools}),
    cliStatus:()=>({ready:backendReady(),preview,models:directVoice?.models().map(({id,available})=>({id,available}))??[],readiness:releaseReadiness()}),
    cliActivity:entry=>({activeCalls:[...contexts.values()].filter(c=>c.active&&agentControl?.entryId(c.entry)===entry).length,creatingSessions:[...contexts.values()].filter(c=>c.creatingSession&&agentControl?.entryId(c.entry)===entry).length}),
    deviceInventory: () => deviceEndpoint?.inventory?.() ?? [], dispose: async ({drain=false}={}) => {
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
  let gateway, bridge, transcriptLog, avatarLog, productionSpeaker, releaseControl, agentControl, agentSocket;
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
    const {gptLiveFromEnv}=await import('../realtime-direct-tools/gpt-live-auth.mjs');
    const {endingJudgeFromEnv}=await import('../realtime-direct-tools/gpt-live-router.mjs');
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
    const feishuLoginConfig=process.env.VOICE_FEISHU_LOGIN_FILE?await readFeishuPhoneLoginFile(process.env.VOICE_FEISHU_LOGIN_FILE):undefined;
    const personalLark=await personalLarkReader(lark,feishuLoginConfig);
    if(!personalLark.calendar)console.warn(JSON.stringify({type:'voice.lark-unavailable'}));
    const nativeInterruptModule=process.env.VOICE_NATIVE_INTERRUPT_ASR==='1'?await import('../realtime-direct-tools/native-interrupt.mjs'):null;
    const nativeInterrupt=nativeInterruptModule
      ? ({inputSampleRate,...callbacks})=>new nativeInterruptModule.NativeInterruptAsr({apiKey:process.env.VOLCENGINE_ASR_API_KEY,inputSampleRate,...callbacks}):undefined;
    const voiceAudit=productionSpeaker?.audit??transcriptLog.audit;
    // Timing and outcome only; the picture's content is not written to the call log.
    // With lessons on, the board has one way of drawing: V's own answers are
    // illustrated by the lesson writer too (VOICE_BOARD_UNIFIED=0 keeps the old line-by-line director for them).
    let lesson=null,photos=null;
    // V's own answers are drawn by the streaming illustrator, as they are spoken (VOICE_BOARD_STREAM=0: one page once the answer is complete).
    // In parallel mode there is no lesson to wait for, so nothing is deferred.
    // The canvas (cue pages only; VOICE_BOARD_CANVAS=0 turns it off): what can be seen goes up large on a stage, and the places V
    // talks about are ringed on its photographs by a model that has seen them (docs/research/board-canvas).
    const canvas=process.env.VOICE_BOARD_CANVAS!=='0'&&process.env.VOICE_BOARD_FOLLOW!=='word';
    // The shelf of made things (board-assets.mjs): what V generates in a call goes up on the board,
    // and the voice model is told what is on the caller's screen. On wherever the board streams (VOICE_BOARD_ASSETS=0 turns it off).
    const assetsOn=process.env.VOICE_BOARD_ASSETS!=='0'&&process.env.VOICE_BOARD_STREAM!=='0';
    const board=boardDirectorFromEnv(process.env,{audit:voiceAudit,prefetch:query=>photos?.find(query),...(canvas?{eye:complete=>createBoardEye({complete,find:query=>photos?.find(query)})}:{}),defer:process.env.VOICE_BOARD_STREAM==='0'&&process.env.VOICE_BOARD_LESSON_SOURCE!=='parallel',...(process.env.VOICE_BOARD_UNIFIED==='0'?{}:{illustrate:args=>lesson?.illustrate(args)??null,
      ...(process.env.VOICE_BOARD_STREAM==='0'?{}:{stream:process.env.VOICE_BOARD_FOLLOW!=='word'?{instructions:(canvas?CANVAS_CUE_INSTRUCTIONS:CUE_INSTRUCTIONS)+(assetsOn?ASSET_NOTES+ASSET_MAKE_NOTES:''),refine:refineCueOp,turns:cueTurns,cue:true,...(canvas?{canvas:true}:{})}:{instructions:STREAM_INSTRUCTIONS+(assetsOn?ASSET_NOTES:''),refine:refineStreamOp}})})});
    const assets=board&&assetsOn?createAssetShelf({director:board,...(process.env.VOICE_SELF_IMAGE==='0'?{}:{standing:[SELF_IMAGE]}),audit:event=>board.log?.(event),lookWaitMs:Math.max(0,Math.min(6000,Number(process.env.VOICE_BOARD_LOOK_WAIT_MS??0)||0)),makeLimit:Math.max(0,Math.min(6,Number(process.env.VOICE_BOARD_MAKE_MAX??3)||0)),
      // One look at each thing made, on the board's own model, so V can say what is really in it (VOICE_BOARD_LOOK=0: no look).
      see:process.env.VOICE_BOARD_LOOK==='0'?null:createAssetEye({complete:boardCompletionFromEnv({...process.env,VOICE_BOARD_MAX_TOKENS:'700'})})}):null;
    if(assets){board.shelf=assets;assets.audience=process.env.VOICE_BOARD_AUDIENCE==='all'?'all':'owner';}
    // The director's pass over a video's script (media-script.mjs), on the board's own model and shown the
    // reference pictures. On with the shelf; VOICE_MEDIA_SCRIPT=text (not shown the pictures) or off.
    const scriptMode=process.env.VOICE_MEDIA_SCRIPT??(assets?'vision':'off');
    const pictureData=async(url,signal)=>{const response=await fetch(url,{signal});const type=String(response.headers.get('content-type')??'').split(';')[0].trim();if(!response.ok||!/^image\/(png|jpe?g|webp)$/u.test(type))return '';const bytes=Buffer.from(await response.arrayBuffer());return bytes.length&&bytes.length<=4*1024*1024?`data:${type};base64,${bytes.toString('base64')}`:'';};
    const videoScript=assets&&['text','vision'].includes(scriptMode)?createVideoScriptWriter({complete:boardCompletionFromEnv({...process.env,VOICE_BOARD_MAX_TOKENS:'1400'}),vision:scriptMode==='vision',look:pictureData,audit:event=>board.log?.(event)}):null;
    // Lesson mode (experiment): its own flag. Through OpenRouter the writer is
    // a stronger model thinking briefly: on real calls it was the only one
    // tried that kept its facts straight (which Pokemon beats which), in about
    // four seconds. The director's model is the fallback, and the writer where
    // only a direct key is provisioned.
    const routed=!(process.env.VOICE_BOARD_API_KEY??process.env.DEEPSEEK_API_KEY)&&Boolean(process.env.OPENROUTER_API_KEY);
    const lessonModel=process.env.VOICE_BOARD_LESSON_MODEL??(routed?'anthropic/claude-sonnet-5.5':''),lessonReasoning=process.env.VOICE_BOARD_LESSON_REASONING??(process.env.VOICE_BOARD_LESSON_MODEL?'':'low');
    const directorWriter=boardCompletionFromEnv({...process.env,VOICE_BOARD_MAX_TOKENS:'1600'});
    lesson=board&&process.env.VOICE_BOARD_LESSON==='1'?createLessonWriter({director:board,record:board.log,
      photoGallery:assetsOn?createPhotoGallery({complete:directorWriter,find:(query,options)=>photos.find(query,options),director:board}):null,...(process.env.VOICE_BOARD_FOLLOW!=='word'?{scriptInstructions:(canvas?CANVAS_SCRIPT_INSTRUCTIONS:CUE_SCRIPT_INSTRUCTIONS)+(assetsOn?ASSET_SCRIPT_NOTES:''),early:Number(process.env.VOICE_BOARD_EARLY??2)||0}:{}),
      // (Naming the director's own model as the lesson model means one writer, not two racing.)
      ...(lessonModel&&lessonModel!==(process.env.VOICE_BOARD_MODEL??'deepseek/deepseek-v4.1-flash')?{complete:boardCompletionFromEnv({...process.env,VOICE_BOARD_MODEL:lessonModel,VOICE_BOARD_REASONING:lessonReasoning,VOICE_BOARD_MAX_TOKENS:lessonReasoning?'4000':'1600'}),fallback:directorWriter}:{complete:directorWriter})}):null;
    // How a lesson is made (to compare): "service" - written here, with what is looked up first;
    // "backend" - V's own agent writes it with its tools; "parallel" - no lesson tool at all,
    // V answers in its own words and the answer is illustrated as it is spoken.
    if(lesson)lesson.audience=process.env.VOICE_BOARD_AUDIENCE==='all'?'all':'owner';
    if(lesson)lesson.results=process.env.VOICE_BOARD_RESULT_LESSON!=='0';
    if(lesson)lesson.reroute=process.env.VOICE_BOARD_REROUTE==='1';
    if(lesson)lesson.source=['backend','parallel'].includes(process.env.VOICE_BOARD_LESSON_SOURCE)?process.env.VOICE_BOARD_LESSON_SOURCE:'service';
    // (VOICE_MATERIAL_CHECK=0: nothing is looked at before a creation is submitted.)
    const materialCheck=assets&&process.env.VOICE_MATERIAL_CHECK!=='0'?createMaterialCheck({complete:boardCompletionFromEnv({...process.env,VOICE_BOARD_MAX_TOKENS:'120'}),audit:event=>board.log?.(event)}):null;
    // Whether speech over a lesson still playing is said to V: the Decisions API (floor-judge.mjs),
    // with the board's text model as the fallback. VOICE_FLOOR_JUDGE=0 leaves it to the voice model.
    const floorJudge=process.env.VOICE_FLOOR_JUDGE==='0'?null:(floorJudgeFromEnv(process.env)??(()=>{const completion=boardCompletionFromEnv({...process.env,VOICE_BOARD_MAX_TOKENS:'8'});return completion?createFloorJudge({complete:completion}):null;})());
    const directVoice=createDirectVoiceService({gateway,wsModule,lesson,assets,floorJudge,
      endingJudge:endingJudgeFromEnv(process.env),videoScript,materialCheck,backendDeviceBundle:backendDeviceBundleFromEnv(),idleHangup:idleHangupFromEnv(process.env),speakerRouting,nativeInterrupt,nativePlaybackPolicy:process.env.VOICE_NATIVE_PLAYBACK_POLICY??'courtesy',playbackEchoGuard:process.env.VOICE_PLAYBACK_ECHO_GUARD!=='0',
      // Shared phone policy; explicit off remains available for rollback.
      searchAcknowledgment:process.env.VOICE_SEARCH_ACK==='off'?'off':'model',
      mediaCli:process.env.VOICE_MEDIA_CLI==='1'?createVoiceMediaCli({accounts:createMediaAccounts(
        join(homedir(),'.makaron','chat-keys.json'),join(homedir(),'.openclaw','secrets','store','MAKARON_API_KEY'))}):null,
      calendar:personalLark.calendar,larkRead:personalLark.read,larkForActor:lark.forActor,
      gptLive:gptLiveFromEnv(process.env,{gatewayRequest:(method,params,options)=>gateway.request(method,params,options)}),
      grokModel:process.env.XAI_VOICE_MODEL,
      grokSpeed:Number(process.env.XAI_VOICE_SPEED ?? 1),
      grokExpressiveTags:process.env.XAI_VOICE_EXPRESSIVE_TAGS === '1',
      audit:board?event=>{board.observe(event);assets?.observe(event);voiceAudit(event);}:voiceAudit,
      toolEnvironment:Object.fromEntries(["LARKSUITE_CLI_CONFIG_DIR","LARKSUITE_CLI_DATA_DIR"].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),
      apiKeys:{
      seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY,
      grok:process.env.XAI_API_KEY,
    },loadContext:async (sessionKey,{gateway:callGateway=gateway}={})=>{
      const history=await callGateway.request('chat.history',{sessionKey,...VOICE_CONTEXT_HISTORY_REQUEST},{timeoutMs:10000});
      return voiceConversationContext(history.messages??[]);
    }});
    // Robot faces reuse the shared H5 semantic selector and map its pose to
    // hardware renderings. Neutral fallback; cosmetic, never on the speech path.
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
        devices:parseDeviceEntries(JSON.parse(await readFile(process.env.VOICE_DEVICES_FILE,"utf8")),process.env.VOICE_ENTRIES_FILE?JSON.parse(await readFile(process.env.VOICE_ENTRIES_FILE,'utf8')):[]),
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
    bridge = createLiveH5Server({ gateway, deviceEndpoint,backendDeviceEndpoint:process.env.VOICE_BACKEND_DEVICE_ENDPOINT??'',
      candidateRelease:process.env.VOICE_CANDIDATE_RELEASE_FILE?JSON.parse(await readFile(process.env.VOICE_CANDIDATE_RELEASE_FILE,'utf8')):undefined,
      listening:process.env.VOICE_LISTENING_DIR ? await (await import('./listening.mjs')).loadVoiceListening(process.env.VOICE_LISTENING_DIR) : undefined,
      directVoice, speakerRouting, avatarLog,board,boardAssets:assets,boardAudience:process.env.VOICE_BOARD_AUDIENCE==='all'?'all':'owner',boardPhotos:board?photos=createPhotoFinder({braveKey:process.env.VOICE_BOARD_BRAVE_KEY??'',directory:process.env.VOICE_BOARD_PHOTO_DIR??(process.env.RTC_H5_TRANSCRIPT_DIR?join(process.env.RTC_H5_TRANSCRIPT_DIR,'board-photos'):''),observe:event=>board.log?.(event)}):null,callControlAudit:transcriptLog.audit,
      phoneInputPolicy:process.env.VOICE_PHONE_INPUT_POLICY ?? 'speaker',
      enableGrok: process.env.VOICE_ENABLE_GROK === '1',
      enableGptLive11: process.env.VOICE_ENABLE_GPT_LIVE_11 === '1',
      // Offline unless asked for: the relay models are what the phone is offered.
      enableGptLiveOne: process.env.VOICE_ENABLE_GPT_LIVE_ONE === '1',
      defaultModel: process.env.VOICE_DEFAULT_MODEL ?? "gpt-live",
      feishuAccounts:process.env.VOICE_FEISHU_ACCOUNTS_FILE?JSON.parse(await readFile(process.env.VOICE_FEISHU_ACCOUNTS_FILE,'utf8')):config.channels?.feishu??{},
      personalReply: {groupChatId:process.env.VOICE_PERSONAL_GROUP_CHAT_ID,replySync:!!process.env.VOICE_PERSONAL_REPLY_ACCOUNT_ID,accountId:process.env.VOICE_PERSONAL_REPLY_ACCOUNT_ID},
      conversationEntries: process.env.VOICE_ENTRIES_FILE ? JSON.parse(await readFile(process.env.VOICE_ENTRIES_FILE,"utf8")) : [],
      callReportsDirectory:process.env.VOICE_CALL_REPORTS_DIR??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-call-reports'),
      iosAppDownloadUrl:process.env.VOICE_IOS_APP_DOWNLOAD_URL,
      iosPublicEntry:process.env.VOICE_IOS_PUBLIC_ENTRY==='1',
      publicTools:process.env.VOICE_PUBLIC_TOOLS!=='0',
      iosBindingsFile:process.env.VOICE_IOS_BINDINGS_FILE??join(process.env.OPENCLAW_STATE_DIR??dirname(configPath),'state','voice-ios-bindings.private.json'),
      feishuLogin: feishuLoginConfig,
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
  if(process.env.VOICE_CLI_SOCKET||process.env.VOICE_CLI_REGISTRY){
    if(!process.env.VOICE_CLI_SOCKET||!process.env.VOICE_CLI_REGISTRY||preview)throw Error('CLI needs a hosted service, socket and persistent private registry');
    agentControl=await createVoiceAgentControl({file:process.env.VOICE_CLI_REGISTRY,
      ...bridge.cliConfiguration(),status:bridge.cliStatus,activity:bridge.cliActivity,onInvalidate:bridge.invalidateManagedCalls});
    bridge.setAgentControl(agentControl);
    agentSocket=await listenVoiceAgentControl({socketPath:process.env.VOICE_CLI_SOCKET,controller:agentControl});
  }
  if(Number(process.env.VOICE_RELEASE_BOOT_HOLD_UNTIL)>Date.now()) bridge.releaseGate.hold();
  if(process.env.VOICE_RELEASE_SOCKET) releaseControl = await listenReleaseControl({socketPath:process.env.VOICE_RELEASE_SOCKET,bridge,
    release:await readRelease(new URL('../../',import.meta.url))});
  bridge.server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ ready: true, host: "127.0.0.1", port, preview })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void bridge.dispose({drain:true}).finally(async () => { await agentSocket?.close();await agentControl?.close();await releaseControl?.close(); await transcriptLog?.close(); await avatarLog?.close(); productionSpeaker?.close(); gateway?.stop(); process.exit(0); }));
}
