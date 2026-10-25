// Isolated, guest-only real-provider Candidate. No personal Gateway, OAuth,
// private history, Feishu credentials, or account tools are loaded.
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import * as wsModule from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
const publicOrigin=process.env.VOICE_IOS_PUBLIC_ORIGIN;
const state=process.env.VOICE_IOS_PUBLIC_STATE;
if(!publicOrigin||!state)throw Error('Configure Candidate HTTPS origin and private state directory');
await mkdir(state,{recursive:true,mode:0o700});
const gateway={ready:true,async request(){throw Error('Public Candidate has no personal Gateway');}};
const directVoice=createDirectVoiceService({gateway,wsModule,
 apiKeys:{seeduplex:process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY,grok:process.env.XAI_API_KEY},
 loadContext:async()=>{throw Error('Public Candidate cannot load private context');}});
const bridge=createLiveH5Server({gateway,directVoice,basePath:'/voice',publicOrigin,
 accessToken:randomBytes(32).toString('base64url'),defaultModel:'seeduplex',phoneInputPolicy:'native',
 iosPublicEntry:true,iosBindingsFile:join(state,'guest-grants.private.json'),
 feishuLogin:{conversations:true,allowUnidentified:true,accountId:'public-candidate',appId:'cli_public_candidate',appSecret:randomBytes(32).toString('base64url'),actors:[]},
 maxActiveSessions:2,maxActiveSessionsPerIp:2});
bridge.server.listen(Number(process.env.VOICE_IOS_PUBLIC_PORT??29481),'127.0.0.1',()=>console.log('Public Candidate listening'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await bridge.dispose();process.exit(0);});
