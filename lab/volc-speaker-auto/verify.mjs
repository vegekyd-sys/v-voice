import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
const origin=process.env.VOLC_SPEAKER_ORIGIN??'http://127.0.0.1:26319',dir='artifacts/volc-speaker/auto';
const before=await(await fetch(origin+'/health')).json();
const ws=new WebSocket(origin.replace('http','ws')+'/stream',{origin}),events=[];
ws.on('message',raw=>{const e=JSON.parse(raw);events.push(e);if(['decision','error','identity-revision'].includes(e.type))console.log(JSON.stringify({event:e.type,speakerId:e.turn?.speakerId,status:e.status,target:e.targetId,mode:e.mode,names:e.participants?.map(p=>({id:p.id,name:p.name,certainty:p.certainty})),error:e.message}));});
const wait=async(predicate,timeout=25000)=>{const until=Date.now()+timeout;while(Date.now()<until){const found=events.find(predicate);if(found)return found;const error=events.find(e=>['error','identity-revision'].includes(e.type));if(error)throw Error(error.message);await new Promise(r=>setTimeout(r,100));}throw Error('Candidate verification timed out');};
let checks={},failure;
try{
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.send(JSON.stringify({type:'start',mode:'adaptive'}));await wait(e=>e.type==='ready');
 const first=events.find(e=>e.type==='configured');assert.equal(first.participants.length,0);assert.equal(first.targetId,null);checks.emptyInitialRoster=true;
 const pcm=await readFile(`${dir}/turn-taking.pcm`);
 for(let offset=0;offset<pcm.length;offset+=6400){if(events.some(e=>['error','identity-revision'].includes(e.type)))throw Error('Server rejected a turn');ws.send(pcm.subarray(offset,offset+6400));await new Promise(r=>setTimeout(r,200));}
 ws.send(JSON.stringify({type:'finish'}));
 const truth=JSON.parse(await readFile(`${dir}/ground-truth.json`,'utf8'));
 const finalInterval=truth.at(-1);
 const last=await wait(e=>e.type==='decision'&&e.turn.endMs>finalInterval.startMs,60000);
 const turns=events.filter(e=>e.type==='decision');
 const at=id=>{const t=truth.find(t=>t.id===id);return turns.find(e=>e.turn.startMs<t.endMs&&e.turn.endMs>t.startMs);};
 const a=at('intro-a'),b=at('intro-b'),guess=at('guess-b'),handoff=at('focus-a'),filteredA=at('filtered-a'),filteredC=at('filtered-c'),reply=at('reply-b');
 assert.ok(a&&b&&guess&&handoff&&filteredA&&filteredC&&reply,'expected separate final turns');
 assert.notEqual(a.turn.speaker.id,b.turn.speaker.id);assert.notEqual(filteredC.turn.speaker.id,b.turn.speaker.id);checks.threeAnonymousSpeakers=true;
 assert.match(a.participants.find(p=>p.id===a.turn.speaker.id).name,/天意|天一/);checks.spokenAdultName=true;
 const guessed=guess.participants.find(p=>p.id===guess.turn.speaker.id);assert.equal(guessed.certainty,'suggested');assert.match(guessed.name,/十二|12/);checks.contextualGuessMarkedUncertain=true;
 const child=b.participants.find(p=>p.id===b.turn.speaker.id);assert.match(child.name,/十二|12/);assert.equal(child.certainty,'stated');assert.equal(child.role,'child');checks.spokenNameConfirmsGuess=true;
 assert.equal(b.mode,'adaptive');assert.equal(at('ask-a').mode,'adaptive');checks.noPrematureExclusiveMode=true;
 assert.equal(handoff.mode,'exclusive');assert.equal(handoff.targetId,b.turn.speaker.id);checks.dialogueHandoff=true;
 assert.equal(filteredA.modelCalled,false);assert.equal(filteredC.modelCalled,false);checks.formerSpeakerAndBystanderWithheld=true;
 assert.equal(reply.decision.style,'child');assert.deepEqual(reply.decision.addresseeIds,[b.turn.speaker.id]);checks.childReply=true;
 const speech=await wait(e=>e.type==='speech-end'&&e.forTurn.startMs===last.turn.startMs);
 const audio=Buffer.concat(events.filter(e=>e.type==='speech-chunk'&&e.speechId===speech.speechId).map(e=>Buffer.from(e.audio,'base64')));assert.equal(audio.length,speech.audioBytes);
 await writeFile(`${dir}/verified-reply.mp3`,audio,{mode:0o600});checks.realSpeechReturned=true;
 const after=await(await fetch(origin+'/health')).json();assert.equal(after.modelCalls-before.modelCalls,turns.filter(t=>t.modelCalled).length);checks.actualModelCallsMatchGating=true;
}catch(error){failure=error.message;}
finally{
 const sanitized=events.map(({audio,...e})=>({...e,...audio?{audioBytes:Buffer.from(audio,'base64').length}:{}}));
 const result={passed:!failure,syntheticOnly:true,noEnrollment:true,noManualCalibration:true,noPreassignedNames:true,checks,failure,events:sanitized};
 await writeFile(`${dir}/verification.json`,JSON.stringify(result,null,2),{mode:0o600});
 if(ws.readyState===1)ws.send(JSON.stringify({type:'stop'}));ws.close();console.log(JSON.stringify({passed:!failure,checks,failure}));if(failure)process.exitCode=1;
}
