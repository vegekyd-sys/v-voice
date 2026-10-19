import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';

// Drive the same application protocol used by the microphone UI, without its
// synthetic prebinding shortcut. Only existing generated fixture audio is sent.
const origin='http://127.0.0.1:26318',events=[];
const before=await(await fetch(origin+'/health')).json();
const ws=new WebSocket('ws://127.0.0.1:26318/stream',{origin});
ws.on('message',raw=>{events.push({...JSON.parse(raw.toString()),observedAt:new Date().toISOString()});});
const wait=async(predicate,timeout=20000)=>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const result=events.find(predicate);if(result)return result;const error=events.find(e=>e.type==='error');if(error)throw Error(error.message);await new Promise(r=>setTimeout(r,100));}
  throw Error('Calibration test deadline exceeded');
};
const feed=async id=>{
  const pcm=Buffer.concat([await readFile(`artifacts/volc-speaker/${id}.pcm`),Buffer.alloc(48000)]);
  for(let offset=0;offset<pcm.length;offset+=6400){ws.send(pcm.subarray(offset,offset+6400));await new Promise(r=>setTimeout(r,200));}
};
try{
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  ws.send(JSON.stringify({type:'start',mode:'adaptive',targetId:'tianyi'}));await wait(e=>e.type==='ready');
  ws.send(JSON.stringify({type:'bind',participantId:'tianyi'}));await feed('turn-a');const a=await wait(e=>e.type==='bound'&&e.participantId==='tianyi');
  ws.send(JSON.stringify({type:'bind',participantId:'shier'}));await feed('turn-b');const b=await wait(e=>e.type==='bound'&&e.participantId==='shier');
  assert.notEqual(a.speakerId,b.speakerId);
  const calibrationHealth=await(await fetch(origin+'/health')).json();assert.equal(calibrationHealth.modelCalls,before.modelCalls);
  await feed('handoff-a');const handoff=await wait(e=>e.type==='decision'&&e.turn.speaker.id==='tianyi');assert.equal(handoff.targetId,'shier');
  await feed('turn-b');ws.send(JSON.stringify({type:'finish'}));
  const child=await wait(e=>e.type==='decision'&&e.turn.speaker.id==='shier');assert.equal(child.decision.style,'child');assert.ok(child.decision.addresseeIds.includes('shier'));
  const speech=await wait(e=>e.type==='speech'&&e.forTurn.startMs===child.turn.startMs);
  await writeFile('artifacts/volc-speaker/calibration-reply.mp3',Buffer.from(speech.audio,'base64'),{mode:0o600});
  const sanitized=events.map(({audio,...event})=>({...event,...audio?{audioBytes:Buffer.from(audio,'base64').length}:{}}));
  await writeFile('artifacts/volc-speaker/calibration-verification.json',JSON.stringify({syntheticOnly:true,withoutPrebinding:true,checks:{separateBindings:true,calibrationDoesNotCallDialogueModel:true,handoffToChild:true,childReplyStyle:true,audioReturned:true},events:sanitized},null,2),{mode:0o600});
  console.log(JSON.stringify({passed:true,boundSpeakers:[a.speakerId,b.speakerId],handoff:handoff.targetId,childStyle:child.decision.style,childReply:child.decision.reply}));
}finally{if(ws.readyState===1)ws.send(JSON.stringify({type:'stop'}));ws.close();}
