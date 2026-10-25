// Isolated Public Candidate, optionally using the existing Gateway tools/tasks.
// Credentials stay on the server; no private chat history is preloaded.
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {connectGatewayClient} from '../../lib/gateway-client.mjs';
import * as wsModule from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
const publicOrigin=process.env.VOICE_IOS_PUBLIC_ORIGIN;
const state=process.env.VOICE_IOS_PUBLIC_STATE;
if(!publicOrigin||!state)throw Error('Configure Candidate HTTPS origin and private state directory');
await mkdir(state,{recursive:true,mode:0o700});
let directVoice;
let gateway={ready:true,async request(){throw Error('Public V tools are not configured');}};
if(process.env.OPENCLAW_CONFIG_PATH){
 const config=JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
 const token=String(config.gateway.auth.token).replace(/\$\{([^}]+)\}/gu,(_,key)=>process.env[key]??'');
 gateway=await connectGatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token,subscribeSessions:true,onEvent:event=>directVoice?.handleEvent(event)});
}
directVoice=createDirectVoiceService({gateway,wsModule,
 audit:event=>{
  if(process.env.VOICE_PUBLIC_AUDIT_FILE&&['tool.invoke','tool.call','backend.started','backend.child-run','backend.completed','backend.cancel-observed','call.closed'].includes(event.type))
   appendFileSync(process.env.VOICE_PUBLIC_AUDIT_FILE,JSON.stringify({at:Date.now(),type:event.type,voiceSessionId:event.voiceSessionId,name:event.name})+'\n',{mode:0o600});
 },
 apiKeys:{seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY,grok:process.env.XAI_API_KEY},
 loadContext:async()=>{throw Error('Public Candidate cannot load private context');}});
const bridge=createLiveH5Server({gateway,directVoice,basePath:'/voice',publicOrigin,
 accessToken:randomBytes(32).toString('base64url'),defaultModel:'seeduplex',phoneInputPolicy:'native',
 iosPublicEntry:true,publicTools:Boolean(process.env.OPENCLAW_CONFIG_PATH),iosBindingsFile:join(state,'guest-grants.private.json'),
 feishuLogin:{conversations:true,allowUnidentified:true,accountId:'public-candidate',appId:'cli_publiccandidate',appSecret:randomBytes(32).toString('base64url'),actors:[]},
 maxActiveSessions:2,maxActiveSessionsPerIp:2});
bridge.server.listen(Number(process.env.VOICE_IOS_PUBLIC_PORT??29481),'127.0.0.1',()=>console.log('Public Candidate listening'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await bridge.dispose({drain:true});gateway.stop?.();process.exit(0);});
