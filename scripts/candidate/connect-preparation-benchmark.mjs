// Controlled preparation replay. No provider, account API, microphone or charge.
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??'.');
const handoffDelayMs=Number(process.argv[3]??0);
if(!Number.isSafeInteger(handoffDelayMs)||handoffDelayMs<0||handoffDelayMs>3000)throw Error('Invalid controlled handoff delay');
const {createDirectVoiceService}=await import(pathToFileURL(root+'/lab/realtime-direct-tools/session.mjs'));
const samples=[];
for(let sample=0;sample<5;sample++){
 class WS extends EventEmitter {
  constructor(){super();this.readyState=1;setImmediate(()=>this.emit('open'));}
  send(raw){const v=JSON.parse(raw);if(v.type==='session.create')setTimeout(()=>{if(this.readyState===1)this.emit('message',Buffer.from(JSON.stringify({type:'session.created',session:{id:'fixture-dialog'}})),false);},600);}
  close(){if(this.readyState!==3){this.readyState=3;this.emit('close');}}
 }
 class Server {close(){}}
 const events=[],gateway={request:async()=>{await delay(650);return {groups:[{tools:[{id:'exec'}]}]};}};
 const service=createDirectVoiceService({gateway,wsModule:{WebSocket:WS,WebSocketServer:Server},apiKeys:{seeduplex:'fixture'},
  loadContext:async()=>{await delay(800);return 'fixture context';},nativePlaybackPolicy:'assisted',
  nativeInterrupt:()=>({async connect(){await delay(200);},append(){},close(){}}),audit:e=>events.push(e)});
 const at=performance.now();
 const reservation=await service.reserve({model:'seeduplex',sessionKey:'fixture',inputPolicy:'native',nativeRuntimeVersion:1,actorScoped:true,sessionBound:true});
 const client=new EventEmitter();client.readyState=1;client.send=raw=>{const v=JSON.parse(raw);if(v.type==='ready')client.ready=true;};client.close=()=>{if(client.readyState!==3){client.readyState=3;client.emit('close');}};
 await delay(handoffDelayMs);service.attach(reservation.voiceSessionId,reservation.relayTicket,client);
 for(let i=0;i<1000&&!client.ready;i++)await delay(5);
 if(!client.ready)throw Error('Replay never became ready');
 samples.push({toReadyMs:Math.round(performance.now()-at),stages:events.filter(e=>e.type==='call.connection-stage').map(({stage,elapsedMs})=>({stage,...(elapsedMs===undefined?{}:{elapsedMs})}))});
 await service.dispose();
}
console.log(JSON.stringify({kind:'controlled-preparation-replay',delaysMs:{catalog:650,context:800,model:600,speechControl:200,handoff:handoffDelayMs},providerConnections:0,samples}));
