#!/usr/bin/env node
// Explicit paid synthetic model experiment; tools are controlled fixtures, not
// live searches. No dialing, microphone capture, production writes or user data.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {createDirectVoiceService} from '../lab/realtime-direct-tools/session.mjs';
import {TOOLS} from '../lab/realtime-direct-tools/tools.mjs';
const dir=resolve(process.argv[2]??'');
if(!process.argv[2]||process.env.VOICE_SEARCH_EVAL_ALLOW_PAID!=='1')throw Error('Explicit paid synthetic study required');
const study=JSON.parse(await readFile(join(dir,'study.json'),'utf8'));
if(study.synthetic!==true||study.sampleRate!==16000||study.cases.length>8)throw Error('Bounded synthetic 16 kHz corpus required');
const {WebSocket}=createRequire(import.meta.url)('ws');
const key=process.env.VOLCENGINE_REALTIME_API_KEY??process.env.DOUBAO_SPEECH_API_KEY;
if(!key)throw Error('Native model credential unavailable');
await mkdir(join(dir,'results'),{recursive:true,mode:0o700});
for(const item of study.cases){
 if(!/^[a-z0-9-]+$/.test(item.id)||!['web_search','memory_search'].includes(item.tool)||!['off','model'].includes(item.mode)||item.delayMs<0||item.delayMs>10000)throw Error('Invalid study case');
 const events=[],chunks=[],began=Date.now(),stamp=()=>Date.now()-began;
 const record=e=>events.push({at:stamp(),...e});let service,timer,offset=-12800,inputEndAt,interruptOffset=-1;
 const pcm=await readFile(join(dir,item.input)),interrupt=item.interrupt?await readFile(join(dir,item.interrupt)):null;
 const gateway={request:async(method,args)=>{
  if(method==='tools.catalog')return {groups:[{tools:TOOLS.map(t=>({id:t.name,description:t.description}))}]};
  if(method!=='tools.invoke'||args.name!==item.tool)throw Error('Experiment blocks all nonfixture tools');
  record({type:'fixture.search-start',name:args.name});await delay(item.delayMs);
  record({type:'fixture.search-return'});
  const details={results:[item.result],debug:{searchMs:item.delayMs,hits:1}};
  return {ok:true,output:{content:[{type:'text',text:JSON.stringify(details,null,2)}],details}};
 }};
 class Client extends EventEmitter {
  readyState=1;
  send(raw){const e=JSON.parse(raw);if(e.type==='audio'){const audio=Buffer.from(e.audio,'base64');chunks.push(audio);record({...e,audio:undefined,bytes:audio.length});}else record(e);}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
 }
 class Server {handleUpgrade(_req,socket,_head,done){done(socket);}close(){}}
 const client=new Client();
 try{
  service=createDirectVoiceService({gateway,wsModule:{WebSocket,WebSocketServer:Server},apiKeys:{seeduplex:key},searchAcknowledgment:item.mode,
   audit:e=>{if(['tool.call','tool.delivered','tool.search-metrics','provider.event','audio.clear','response.done'].includes(e.type)){const {args,result,voiceSessionId,...safe}=e;record({origin:'audit',...safe});}}
  });
  const reservation=await service.reserve({model:'seeduplex',sessionKey:'agent:makaron:explicit:synthetic-search-eval',inputSampleRate:16000});
  service.upgrade({},client,Buffer.alloc(0),reservation.voiceSessionId,reservation.relayTicket);
  const readyDeadline=Date.now()+15000;while(!events.some(e=>e.type==='ready')&&Date.now()<readyDeadline&&client.readyState===1)await delay(20);
  if(!events.some(e=>e.type==='ready'))throw Error('Candidate not ready');
  timer=setInterval(()=>{
   const frame=Buffer.alloc(640);
   if(offset>=0&&offset<pcm.length)pcm.copy(frame,0,offset,Math.min(offset+640,pcm.length));
   offset+=640;if(offset>=pcm.length&&inputEndAt===undefined){inputEndAt=stamp();record({type:'input.end'});}
   if(interrupt&&inputEndAt!==undefined){
    const first=events.find(e=>e.type==='audio');
    if(interruptOffset<0&&first&&stamp()>first.at+250){interruptOffset=0;record({type:'interrupt.start'});}
    if(interruptOffset>=0&&interruptOffset<interrupt.length){interrupt.copy(frame,0,interruptOffset,Math.min(interruptOffset+640,interrupt.length));interruptOffset+=640;if(interruptOffset>=interrupt.length)record({type:'interrupt.end'});}
   }
   client.emit('message',frame,true);
  },20);
  const deadline=Date.now()+30000;while(Date.now()<deadline&&client.readyState===1){await delay(100);const result=events.find(e=>e.type==='tool.delivered');const done=events.findLast(e=>e.type==='response.done');if(result&&done&&done.at>result.at&&stamp()-done.at>1000)break;}
 }finally{clearInterval(timer);await service?.dispose();}
 const first=events.find(e=>e.type==='audio'),call=events.find(e=>e.type==='fixture.search-start'),returned=events.find(e=>e.type==='fixture.search-return');
 const summary={id:item.id,mode:item.mode,tool:item.tool,inputEndAt,firstAudioMs:first?first.at-inputEndAt:null,toolStartMs:call?call.at-inputEndAt:null,preamble:Boolean(first&&returned&&first.at<returned.at),toolCalls:events.filter(e=>e.type==='fixture.search-start').length,transcripts:events.filter(e=>e.type==='transcript'&&e.final).map(e=>({role:e.role,text:e.text})),metrics:events.filter(e=>e.type==='tool.search-metrics'),clears:events.filter(e=>e.type==='audio.clear').length,errors:events.filter(e=>e.type==='error')};
 await writeFile(join(dir,'results',item.id+'.json'),JSON.stringify({summary,events},null,2),{mode:0o600});
 await writeFile(join(dir,'results',item.id+'.pcm'),Buffer.concat(chunks),{mode:0o600});console.log(JSON.stringify(summary));
}
