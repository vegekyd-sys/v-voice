import {createSpeakerDiagnostics} from './diagnostics.mjs';
import {readFile} from 'node:fs/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {GatewayClient} from '../../lib/gateway-client.mjs';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {createDirectVoiceService} from '../realtime-direct-tools/session.mjs';
import {createLiveH5Server} from '../gpt-live-h5/server.mjs';
import {createEmbeddingWorker} from './online-speaker.mjs';
import {createStreamingSpeakerRoutingService} from './stream-service.mjs';
import {createSpeakerRoutingService} from './service.mjs';
import {LINUX_SPEAKER_CANDIDATE_RELEASE} from './linux-release.mjs';

const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE);
Object.assign(env,JSON.parse(await readFile(process.env.VOICE_NATIVE_CREDENTIAL_FILE,'utf8')));
const receipt=JSON.parse(await readFile(process.env.VOICE_SPEAKER_GATEWAY_RECEIPT??new URL('../../artifacts/speaker-native/gateway-receipt.private.json',import.meta.url),'utf8'));
const allowedGateways=new Map([['/var/lib/v-voice-candidates/speaker-native-01a13f2c',26367],['/var/lib/v-voice-candidates/speaker-product-20261019',26369]]);
if(allowedGateways.get(receipt.root)!==receipt.gatewayPort)throw Error('Not an isolated speaker candidate');
const gatewayPort=Number(process.env.VOICE_SPEAKER_GATEWAY_LOCAL_PORT??26368);
if(!Number.isInteger(gatewayPort)||gatewayPort<1024||gatewayPort>65535)throw Error('Invalid private Gateway port');
const gatewayOrigin=(process.env.VOICE_STREAM_LINUX==='1'?'http://127.0.0.1:':'http://[::1]:')+gatewayPort,port=Number(process.env.VOICE_STREAM_PORT??26325);
const publicOrigin=process.env.VOICE_STREAM_PUBLIC_ORIGIN??'',basePath=process.env.VOICE_STREAM_BASE_PATH??'';
const accessToken=process.env.VOICE_STREAM_ACCESS_TOKEN_FILE?(await readFile(process.env.VOICE_STREAM_ACCESS_TOKEN_FILE,'utf8')).trim():'';
if(process.env.VOICE_STREAM_LINUX==='1'&&(!publicOrigin||!basePath||accessToken.length<32||gatewayPort!==receipt.gatewayPort))throw Error('Linux candidate requires hosted admission and a server-local private Gateway');
const embedding=createEmbeddingWorker({python:process.env.VOICE_SPEAKER_PYTHON??new URL('../../artifacts/speaker-native/embedding-venv/bin/python',import.meta.url).pathname,model:process.env.VOICE_SPEAKER_MODEL??new URL('../../artifacts/speaker-native/speaker-embedding.onnx',import.meta.url).pathname});
await embedding.ready;
const diagnostics=createSpeakerDiagnostics({directory:process.env.VOICE_STREAM_DIAGNOSTICS_DIR});
let bridge;
const gateway=new GatewayClient({url:gatewayOrigin.replace('http:','ws:'),token:receipt.gatewayToken,caps:['voice-direct-tools','tool-events'],scopes:['operator.admin','operator.read','operator.write'],onEvent:e=>bridge?.emit(e),onHelloOk:()=>console.log('Private speaker Gateway ready'),onConnectError:e=>console.warn('Private candidate unavailable:',e.code??'CONNECT_ERROR')});gateway.start();
const speakerRouting=process.env.VOICE_STREAM_COMPARE_SERIAL==='1'?createSpeakerRoutingService({env}):createStreamingSpeakerRoutingService({env,embedding,onAudit:diagnostics.audit});
const directVoice=createDirectVoiceService({gateway,wsModule:{WebSocket,WebSocketServer},speakerRouting,audit:diagnostics.audit,apiKeys:{seeduplex:env.VOLCENGINE_REALTIME_API_KEY},loadContext:async()=>''});
const fixtures=new Set(['question','dialogue','side','collective','steady','background','ending']);
bridge=createLiveH5Server({gateway,directVoice,speakerRouting,publicOrigin,basePath,accessToken,candidateRelease:process.env.VOICE_STREAM_LINUX==='1'?LINUX_SPEAKER_CANDIDATE_RELEASE:undefined,maxActiveSessions:2,maxActiveSessionsPerIp:1,defaultModel:'seeduplex',gptProvider:'v-voice-gpt-live',avatarEvaluate:null,callControlEvaluate:null,
  speakerFixture:async id=>fixtures.has(id)?readFile(new URL('../../artifacts/speaker-native/'+id+'.wav',import.meta.url)):null,
  offer:async(reservation,sdp)=>{const r=await fetch(gatewayOrigin+reservation.offerUrl,{method:'POST',headers:{authorization:'Bearer '+reservation.clientSecret,'content-type':'application/sdp'},body:sdp,signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Native GPT unavailable: '+r.status);return r.text();},
});
bridge.server.listen(port,'127.0.0.1',()=>console.log('Doubao streaming candidate: http://127.0.0.1:'+port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void bridge.dispose().finally(()=>{gateway.stop();embedding.close();process.exit(0);}));
