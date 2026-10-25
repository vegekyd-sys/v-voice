// Authorized private provider probe: typed input only, no device point or ride order.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {GrokVoiceBridge} from '../../lab/realtime-direct-tools/grok-provider.mjs';
import {LOCATION_TOOL} from '../../lab/realtime-direct-tools/device-location.mjs';
const runtime=process.env.VLAB_CANDIDATE_RUNTIME??process.env.VOICE_CANDIDATE_RUNTIME;
const data=process.env.VLAB_CANDIDATE_DATA??process.env.VOICE_CANDIDATE_DATA;
if(!runtime||!data||!data.includes('/candidate-tests/runs/candidate-')&&!data.startsWith('/var/lib/v-voice-candidates/'))throw Error('Private Candidate required');
const require=createRequire(existsSync(runtime+'/openclaw/package.json')?runtime+'/openclaw/package.json':runtime+'/package.json'),{WebSocket}=require('ws');
const keyFile=process.env.VLAB_SHARED_STATE_DIR+'/secrets/store/XAI_API_KEY';
let apiKey=process.env.XAI_API_KEY??(existsSync(keyFile)?readFileSync(keyFile,'utf8').trim():undefined);
// Voice provider keys belong to the deployed Voice unit, not the Gateway.
// Read only this key locally on the server; no environment contents leave it.
if(!apiKey){try{
 const pid=Number(execFileSync('systemctl',['show','openclaw-rtc-h5.service','-p','MainPID','--value'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());
 if(pid>1)apiKey=readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').find(x=>x.startsWith('XAI_API_KEY='))?.slice('XAI_API_KEY='.length);
}catch{}}

if(!apiKey){console.log(JSON.stringify({probe:'typed-grok-location-selection',ok:false,reason:'provider_key_unavailable',humanSpeech:false,devicePosition:false,backendV:false,didi:false}));process.exit(2);}
let bridge,timer,audioBytes=0;const start=Date.now();
const result=await new Promise(resolve=>{
 let ended=false;
 const finish=value=>{if(ended)return;ended=true;clearTimeout(timer);resolve(value);};
 bridge=new GrokVoiceBridge({inputSampleRate:24000,
  instructions:'你是 V，当前通话的网页终端支持 location.current，权限待询问。用户要求从这里打车时先实际调用 get_current_location 获取位置。不要猜测位置，不要下单。若位置失败或被拒绝，如实解释，不能通过后台绕过。',tools:[LOCATION_TOOL],
  onToolCall:call=>finish({ok:call.name==='get_current_location',selectedTool:call.name}),
  onAudio:data=>{audioBytes+=data.length;},onError:()=>finish({ok:false,reason:'provider_error'}),
 },{createWebSocket:async(url,options)=>new WebSocket(url,options),apiKey});
 timer=setTimeout(()=>finish({ok:false,reason:'tool_selection_timeout'}),20000);
 bridge.connect().then(()=>bridge.sendUserMessage('帮我从这里打车到上海虹桥站，先查报价，不要下单。')).catch(()=>finish({ok:false,reason:'provider_connection_failed'}));
});
bridge.close();console.log(JSON.stringify({probe:'typed-grok-location-selection',...result,elapsedMs:Date.now()-start,audioBytesDiscarded:audioBytes,humanSpeech:false,devicePosition:false,backendV:false,didi:false}));
if(!result.ok)process.exitCode=1;
