import {readFile} from 'node:fs/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {GatewayClient} from '../../lib/gateway-client.mjs';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {createDirectVoiceService} from '../realtime-direct-tools/session.mjs';
import {createLiveH5Server} from '../gpt-live-h5/server.mjs';
import {createSpeakerRoutingService} from './service.mjs';

const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE??process.env.VOLC_SPEAKER_ENV_FILE);
if(process.env.VOICE_NATIVE_CREDENTIAL_FILE)Object.assign(env,JSON.parse(await readFile(process.env.VOICE_NATIVE_CREDENTIAL_FILE,'utf8')));
const receipt=JSON.parse(await readFile(process.env.VOICE_SPEAKER_GATEWAY_RECEIPT??new URL('../../artifacts/speaker-native/gateway-receipt.private.json',import.meta.url),'utf8'));
const port=Number(process.env.VOICE_SPEAKER_PORT??26320),gatewayOrigin='http://[::1]:'+Number(process.env.VOICE_SPEAKER_GATEWAY_LOCAL_PORT??receipt.gatewayPort);
if(receipt.root!=='/var/lib/v-voice-candidates/speaker-native-01a13f2c'||receipt.gatewayPort!==26367)throw Error('Candidate Gateway receipt does not match the isolated instance');
let bridge;
const gateway=new GatewayClient({url:gatewayOrigin.replace('http:','ws:'),token:receipt.gatewayToken,
  caps:['voice-direct-tools','tool-events'],scopes:['operator.admin','operator.read','operator.write'],onEvent:event=>bridge?.emit(event),
  onHelloOk:()=>console.log('Private candidate Gateway connected'),onConnectError:e=>console.warn('Private candidate Gateway unavailable: '+(e.code??'CONNECT_ERROR'))});
gateway.start();
const speakerRouting=createSpeakerRoutingService({env});
const directVoice=createDirectVoiceService({gateway,wsModule:{WebSocket,WebSocketServer},speakerRouting,
  apiKeys:{seeduplex:env.VOLCENGINE_REALTIME_API_KEY??env.DOUBAO_SPEECH_API_KEY},loadContext:async()=>'',
});
const fixtures=new Set(['question','dialogue','side','collective']);
bridge=createLiveH5Server({gateway,directVoice,speakerRouting,defaultModel:'seeduplex',gptProvider:'v-voice-gpt-live',avatarEvaluate:null,callControlEvaluate:null,
  speakerFixture:async id=>fixtures.has(id)?readFile(new URL('../../artifacts/speaker-native/'+id+'.wav',import.meta.url)):null,
  offer:async(reservation,sdp)=>{
    const response=await fetch(gatewayOrigin+reservation.offerUrl,{method:'POST',headers:{authorization:'Bearer '+reservation.clientSecret,'content-type':'application/sdp'},body:sdp,signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error('Candidate native SDP exchange failed: '+response.status);return response.text();
  },
});
bridge.server.listen(port,'127.0.0.1',()=>console.log('V Voice speaker candidate: http://127.0.0.1:'+port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void bridge.dispose().finally(()=>{gateway.stop();process.exit(0);});});
