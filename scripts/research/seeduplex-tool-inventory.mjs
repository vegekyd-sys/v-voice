// Offline only. Capture the actual session.create envelope through an in-memory
// WebSocket; no provider, Gateway, device, subprocess or paid model is contacted.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
import {TOOLS} from '../../lab/realtime-direct-tools/tools.mjs';
import {PUBLIC_CALL_TOOLS, PUBLIC_SEARCH_TOOLS} from '../../lib/public-voice-gateway.mjs';

const catalog = ['read','exec','process','memory_search','web_search','web_fetch'];
const metrics = tools => ({
  count: tools.length,
  names: tools.map(t => t.name),
  descriptionCharacters: tools.reduce((n,t) => n+[...t.description].length,0),
  schemaJsonBytes: Buffer.byteLength(JSON.stringify(tools.map(t => t.parameters))),
  toolsJsonBytes: Buffer.byteLength(JSON.stringify(tools)),
});
const scenarios = [
  {id:'personal-web', expected:16},
  {id:'verified-actor-web', sessionBound:true, actorScoped:true, toolIdentity:{fixture:true}, expected:16},
  {id:'verified-actor-no-reader', sessionBound:true, actorScoped:true, reader:false, expected:14},
  {id:'verified-actor-no-exec', sessionBound:true, actorScoped:true, toolIdentity:{fixture:true}, catalog:catalog.filter(x=>x!=='exec'), expected:13},
  {id:'public-web', unidentified:true, publicVoice:true, expected:9},
  {id:'unidentified-no-public', unidentified:true, expected:2},
  {id:'personal-ios-location', nativeRuntimeVersion:1,nativeLocationVersion:1,expected:17},
  {id:'personal-robot-volume-camera', surface:'speaker',speaker:{setVolume:async()=>{},look:async()=>{}},expected:17},
];
const results=[];
for (const scenario of scenarios) {
  const frames=[];
  class WS extends EventEmitter {
    constructor(url) {
      super(); assert.match(url,/^wss:\/\//); this.readyState=1;
      setImmediate(()=>this.emit('open'));
    }
    send(raw) {
      const value=JSON.parse(raw); frames.push(value);
      if(value.type==='session.create') queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'session.created',session:{id:'offline-fixture'}})),false));
    }
    close(){this.readyState=3;this.emit('close');}
  }
  class Server {close(){}}
  const gateway={publicVoice:scenario.publicVoice,async request(method) {
    assert.equal(method,'tools.catalog','Inventory must never execute a tool or create a backend task');
    return {groups:[{tools:(scenario.catalog??catalog).map(id=>({id,description:'Synthetic catalog entry.'}))}]};
  }};
  const service=createDirectVoiceService({gateway,wsModule:{WebSocket:WS,WebSocketServer:Server},apiKeys:{seeduplex:'offline-fixture-only'},
    calendar:async()=>{},larkRead:async()=>{},larkForActor:scenario.reader===false?undefined:async()=>({calendar:async()=>{},read:async()=>{}})});
  try {
    const reservation=await service.reserve({model:'seeduplex',sessionKey:'agent:makaron:explicit:offline-fixture',...scenario});
    const client=new EventEmitter(); client.readyState=1;client.send=()=>{};client.close=()=>{client.readyState=3;client.emit('close');};
    assert(service.attach(reservation.voiceSessionId,reservation.relayTicket,client));
    for(let i=0;i<100&&!frames.some(f=>f.type==='session.create');i++) await delay(2);
    const session=frames.find(f=>f.type==='session.create')?.session;
    assert(session,'Expected actual provider handshake');
    const summary=metrics(session.tools); assert.equal(summary.count,scenario.expected,scenario.id);
    if(scenario.unidentified) assert(session.tools.every(t=>(scenario.publicVoice?PUBLIC_CALL_TOOLS:new Set(['show_content','end_call'])).has(t.name)));
    if(scenario.publicVoice) assert(session.tools.filter(t=>PUBLIC_SEARCH_TOOLS.has(t.name)).length===3);
    results.push({id:scenario.id,...summary,instructionsCharacters:[...session.instructions].length,instructionsBytes:Buffer.byteLength(session.instructions)});
  } finally {await service.dispose();}
}
console.log(JSON.stringify({schema:'voice-offline-tool-inventory-v1',basis:'Actual createDirectVoiceService + SeeduplexRealtimeVoiceBridge with synthetic catalog and credentials; no real call',declared:metrics(TOOLS),scenarios:results,tokenCount:null,tokenCountReason:'UTF-8 bytes and Unicode characters are not model tokens; internal system prompt and live catalog/context are not measured.'},null,2));
