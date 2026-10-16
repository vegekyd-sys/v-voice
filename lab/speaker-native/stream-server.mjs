import {readFile} from 'node:fs/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {GatewayClient} from '../../lib/gateway-client.mjs';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {createDirectVoiceService} from '../realtime-direct-tools/session.mjs';
import {createLiveH5Server} from '../gpt-live-h5/server.mjs';
import {createEmbeddingWorker} from './online-speaker.mjs';
import {createStreamingSpeakerRoutingService} from './stream-service.mjs';

const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE);
Object.assign(env,JSON.parse(await readFile(process.env.VOICE_NATIVE_CREDENTIAL_FILE,'utf8')));
const receipt=JSON.parse(await readFile(new URL('../../artifacts/speaker-native/gateway-receipt.private.json',import.meta.url),'utf8'));
if(receipt.root!=='/var/lib/v-voice-candidates/speaker-native-01a13f2c'||receipt.gatewayPort!==26367)throw Error('Not the isolated speaker candidate');
const gatewayOrigin='http://[::1]:'+Number(process.env.VOICE_SPEAKER_GATEWAY_LOCAL_PORT??26368),port=Number(process.env.VOICE_STREAM_PORT??26325);
const embedding=createEmbeddingWorker({python:process.env.VOICE_SPEAKER_PYTHON??new URL('../../artifacts/speaker-native/embedding-venv/bin/python',import.meta.url).pathname,model:process.env.VOICE_SPEAKER_MODEL??new URL('../../artifacts/speaker-native/speaker-embedding.onnx',import.meta.url).pathname});
await embedding.ready;
let bridge;
const gateway=new GatewayClient({url:gatewayOrigin.replace('http:','ws:'),token:receipt.gatewayToken,caps:['voice-direct-tools','tool-events'],scopes:['operator.admin','operator.read','operator.write'],onEvent:e=>bridge?.emit(e),onHelloOk:()=>console.log('Private speaker Gateway ready'),onConnectError:e=>console.warn('Private candidate unavailable:',e.code??'CONNECT_ERROR')});gateway.start();
const speakerRouting=createStreamingSpeakerRoutingService({env,embedding});
const directVoice=createDirectVoiceService({gateway,wsModule:{WebSocket,WebSocketServer},speakerRouting,apiKeys:{seeduplex:env.VOLCENGINE_REALTIME_API_KEY},loadContext:async()=>''});
const fixtures=new Set(['question','dialogue','side','collective']);
bridge=createLiveH5Server({gateway,directVoice,speakerRouting,defaultModel:'seeduplex',gptProvider:'v-voice-gpt-live',avatarEvaluate:null,callControlEvaluate:null,
  speakerFixture:async id=>fixtures.has(id)?readFile(new URL('../../artifacts/speaker-native/'+id+'.wav',import.meta.url)):null,
  offer:async(reservation,sdp)=>{const r=await fetch(gatewayOrigin+reservation.offerUrl,{method:'POST',headers:{authorization:'Bearer '+reservation.clientSecret,'content-type':'application/sdp'},body:sdp,signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Native GPT unavailable: '+r.status);return r.text();},
});
bridge.server.listen(port,'127.0.0.1',()=>console.log('Doubao streaming candidate: http://127.0.0.1:'+port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void bridge.dispose().finally(()=>{gateway.stop();embedding.close();process.exit(0);}));
