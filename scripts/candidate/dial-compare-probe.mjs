// Compare two Voice code trees on the real dial path, on the Voice host.
//
//   node dial-compare-probe.mjs --a <tree> --b <tree> [--runs 6] [--chat oc_prefix] [--pause 2500]
//
// Each trial is one real Doubao call for an already bound Feishu caller: live
// Gateway admission, the tool catalog and conversation history through the
// caller's own actor gateway, the Doubao session, and the spoken greeting. It
// runs below the HTTP entry, so it sends nothing to the conversation, writes no
// call report and no transcript, and is invisible to the running service. The
// client is this process: there is no phone, no network leg and no microphone.
// It prints timings only.
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const args=Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(p=>p.trim().split(/\s+/u)));
const runs=Number(args.runs??6),pause=Number(args.pause??2500);
const load=(tree,path)=>import(pathToFileURL(join(resolve(tree),path)).href);

async function open(tree) {
  const [{connectGatewayClient},{createDirectVoiceService},directory,{readFeishuPhoneLoginFile},context,wsModule]=await Promise.all([
    load(tree,'lib/gateway-client.mjs'),load(tree,'lab/realtime-direct-tools/session.mjs'),load(tree,'lib/feishu-conversation-directory.mjs'),
    load(tree,'lib/feishu-phone-login.mjs'),load(tree,'lab/realtime-direct-tools/conversation-context.mjs'),load(tree,'node_modules/ws/wrapper.mjs')]);
  const config=JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
  const token=String(config.gateway.auth.token).replace(/\$\{([^}]+)\}/gu,(_,key)=>process.env[key]??'');
  const gateway=await connectGatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token,getToken:async()=>token,
    scopes:['operator.read','operator.write','operator.admin'],caps:['voice-direct-tools','tool-events','voice-feishu-actor-v1'],subscribeSessions:false,onEvent:()=>{}},{onConnectError:()=>{}});
  const login=await readFeishuPhoneLoginFile(process.env.VOICE_FEISHU_LOGIN_FILE);
  const stages=[];
  const interrupt=process.env.VOICE_NATIVE_INTERRUPT_ASR==='1'?await load(tree,'lab/realtime-direct-tools/native-interrupt.mjs'):null;
  const service=createDirectVoiceService({gateway,wsModule,
    nativeInterrupt:interrupt?({inputSampleRate,...callbacks})=>new interrupt.NativeInterruptAsr({apiKey:process.env.VOLCENGINE_ASR_API_KEY,inputSampleRate,...callbacks}):undefined,
    nativePlaybackPolicy:process.env.VOICE_NATIVE_PLAYBACK_POLICY??'courtesy',
    audit:event=>{if(event.type==='call.connection-stage')stages.push(event);},
    apiKeys:{seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY},
    loadContext:async(sessionKey,{gateway:callGateway=gateway}={})=>{
      const history=await callGateway.request('chat.history',{sessionKey,...context.VOICE_CONTEXT_HISTORY_REQUEST},{timeoutMs:10000});
      return context.voiceConversationContext(history.messages??[]);
    }});
  const resolveConversation=directory.createFeishuConversationDirectory({gateway,appId:login.appId,appSecret:login.appSecret,accountId:login.accountId});
  const grants=JSON.parse(await readFile(process.env.VOICE_IOS_BINDINGS_FILE,'utf8')).grants
    .filter(g=>g.principal?.type==='feishu'&&directory.parseFeishuConversationPhone(g.entry)?.accountId===login.accountId)
    .filter(g=>!args.chat||directory.parseFeishuConversationPhone(g.entry).chatId.startsWith(args.chat))
    .sort((a,b)=>b.createdAt-a.createdAt);
  if(!grants.length)throw Error('No bound Feishu caller matches');
  const {principal,entry}=grants[0];
  const identity={tenantKey:principal.tenantKey,openId:principal.openId,...(principal.userId?{userId:principal.userId}:{})};

  // One dial, in the order the entry runs it. A tree without prefetch() takes
  // the serial path; a tree with it overlaps, exactly as its entry would.
  async function dial() {
    stages.length=0;const t0=performance.now(),at=()=>Math.round(performance.now()-t0),row={};
    let prefetched=null,id=null;
    try {
      const binding=await resolveConversation(identity,entry,typeof service.prefetch==='function'?{speculate:hint=>{prefetched??=service.prefetch({...hint,model:'seeduplex'});}}:undefined);
      row.admitted=at();row.overlap=Boolean(prefetched);
      const reservation=await service.reserve({model:'seeduplex',sessionKey:binding.sessionKey,gateway:binding.gateway,actorScoped:true,agentId:binding.agentId,
        toolIdentity:binding.actorPrincipal,callerIdentity:binding.callerIdentity,sessionBound:true,inputPolicy:'native',...(prefetched?{prefetched}:{})});
      id=reservation.voiceSessionId;
      const client=new EventEmitter();client.readyState=1;client.close=()=>{if(client.readyState===3)return;client.readyState=3;client.emit('close');};
      const greet=()=>client.emit('message',Buffer.from(JSON.stringify({type:'greeting'})),false);
      const done=new Promise((settle,reject)=>{
        const timer=setTimeout(()=>reject(Error('timeout')),30000);
        client.send=raw=>{
          const value=JSON.parse(raw);
          // The page asks again at ready; a server that heard the early request ignores this one.
          if(value.type==='ready'&&row.ready===undefined){row.ready=at();greet();}
          if(value.type==='audio'&&row.greeting===undefined){row.greeting=at();clearTimeout(timer);settle();}
          if(value.type==='error'){clearTimeout(timer);reject(Error('call error'));}
        };
      });
      if(!service.attach(id,reservation.relayTicket,client))throw Error('attach refused');
      greet();
      await done;
      for(const stage of ['catalog-ready','context-ready','model-ready','speech-control-ready'])row[stage]=stages.find(e=>e.stage===stage)?.elapsedMs;
      return row;
    } finally {
      if(!prefetched?.adopted)prefetched?.discard();
      if(id)await service.close(id).catch(()=>{});
    }
  }
  return {dial,close:async()=>{await service.dispose?.();gateway.stop?.();}};
}

const trees={a:await open(args.a),b:await open(args.b)};
const rows={a:[],b:[]};
// Prime both: the first admission tells a tree's directory which conversation to expect.
for(const key of ['a','b'])await trees[key].dial().catch(error=>{console.error(JSON.stringify({prime:key,error:error.message}));});
for(let run=0;run<runs;run++)for(const key of run%2?['b','a']:['a','b']){
  await delay(pause);
  try{const row=await trees[key].dial();rows[key].push(row);console.log(JSON.stringify({tree:key,run,...row}));}
  catch(error){console.log(JSON.stringify({tree:key,run,error:error.message}));}
}
const median=values=>{const v=values.filter(Number.isFinite).sort((x,y)=>x-y);return v.length?v[v.length>>1]:null;};
const summary=Object.fromEntries(Object.entries(rows).map(([key,list])=>[key,{calls:list.length,overlap:list.some(r=>r.overlap),
  ...Object.fromEntries(['admitted','ready','greeting'].map(k=>[k,{min:Math.min(...list.map(r=>r[k])),median:median(list.map(r=>r[k])),max:Math.max(...list.map(r=>r[k]))}]))}]));
console.log(JSON.stringify({summary},null,1));
for(const tree of Object.values(trees))await tree.close().catch(()=>{});
process.exit(0);
