#!/usr/bin/env node
// Direct model experiment: no Gateway, Speaker tracker, auxiliary ASR, or tools.
// Inputs must be synthetic fixtures described by an explicit study manifest.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const {SeeduplexRealtimeVoiceBridge,SEEDUPLEX_MODEL}=await import(process.env.VOICE_NATIVE_EVAL_PROVIDER_MODULE??new URL('../lab/seeduplex-realtime-provider.mjs',import.meta.url));

const directory=resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('Usage: eval-seeduplex-native-speakers.mjs SYNTHETIC_STUDY_DIRECTORY');
const study=JSON.parse(await readFile(join(directory,'study.json'),'utf8'));
if(study.synthetic!==true||study.sampleRate!==16000)throw Error('Only synthetic 16 kHz PCM studies are supported');
const output=join(directory,'results');await mkdir(output,{recursive:true});
const summary={model:SEEDUPLEX_MODEL,synthetic:true,physicalMicrophone:false,externalSpeakerIdentity:false,auxiliaryAsr:false,gateway:false,tools:[],sessions:[]};
for(const session of study.sessions){
  let current=null,pending=null,timer,bridge,closed=false;const events=[],audio=[],began=Date.now();
  const stamp=()=>Date.now()-began;
  const add=e=>events.push({at:stamp(),...e});
  const inspect=(value,path='',out=[])=>{if(!value||typeof value!=='object')return out;for(const [key,v] of Object.entries(value)){
    const p=path?path+'.'+key:key;if(/speaker|voiceprint|diari[sz]|participant|identity/i.test(key)&&typeof v!=='object')out.push({path:p,value:v});
    if(v&&typeof v==='object'&&!Array.isArray(v))inspect(v,p,out);
  }return out;};
  const result={id:session.id,control:session.control??false,voices:session.voices,instructions:study.instructions,turns:[],errors:[],nativeIdentityFields:[]};
  try{
    bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{model:SEEDUPLEX_MODEL,voice:'xiaohe'},inputSampleRate:16000,nativeDuplex:true,language:'zh-CN',instructions:study.instructions,tools:[],
      onProtocolEvent:e=>{const fields=inspect(e);if(fields.length)result.nativeIdentityFields.push({type:e.type,fields});add({type:e.type,keys:Object.keys(e).filter(k=>!['delta','audio'].includes(k)),...(typeof e.transcript==='string'?{transcript:e.transcript}:{}),...(typeof e.text==='string'?{text:e.text}:{}),...(e.response_id?{responseId:e.response_id}:{})});},
      onTranscript:(role,text,final)=>{if(!current)return;if(role==='user')current.inputTranscript=text;else if(final){current.answer=text;current.finalAt=stamp();}else current.answerDelta=(current.answerDelta??'')+text;},
      onAudio:(pcm,metadata)=>{audio.push(pcm);if(current){current.audioBytes+=pcm.length;current.firstAudioAt??=stamp();current.lastAudioAt=stamp();}add({type:'observed.audio',responseId:metadata?.responseId,bytes:pcm.length});},
      onResponseDone:e=>{if(current){current.responseStatus=e.status;current.doneAt=stamp();}},
      onToolCall:()=>{result.errors.push('Unexpected model function call; not executed');},
      onError:()=>{result.errors.push('Model transport error');},onClose:()=>{closed=true;},
    });
    await bridge.connect();
    timer=setInterval(()=>{let frame=Buffer.alloc(640);if(pending){const p=pending;frame=p.pcm.subarray(p.offset,p.offset+640);if(frame.length<640)frame=Buffer.concat([frame,Buffer.alloc(640-frame.length)]);p.offset+=640;if(p.offset>=p.pcm.length){pending=null;p.resolve();}}bridge.sendAudio(frame);},20);
    await delay(400);
    for(const turn of session.turns){
      if(closed)throw Error('Native session closed');
      const pcm=await readFile(join(directory,turn.file));
      current={id:turn.id,kind:turn.kind,expected:turn.expected??null,voice:turn.voice,text:turn.text,inputSha256:createHash('sha256').update(pcm).digest('hex'),inputStartAt:stamp(),audioBytes:0};
      await new Promise(resolve=>pending={pcm,offset:0,resolve});current.inputEndAt=stamp();
      const deadline=Date.now()+16000;
      const complete=()=>current.doneAt>=current.finalAt&&current.audioBytes&&current.answer&&stamp()-(current.lastAudioAt??0)>=800;
      while(!complete()&&Date.now()<deadline&&!closed&&!result.errors.length)await delay(30);
      current.answer??=current.answerDelta??'';
      current.timeout=!complete();
      current.asrObserved=Boolean(current.inputTranscript);
      if(turn.expected)current.correct=current.answer.includes(turn.expected)&&!(turn.otherAnswers??[]).some(x=>current.answer.includes(x));
      result.turns.push(current);console.log(JSON.stringify({session:session.id,...current,answerDelta:undefined}));
      current=null;await delay(500);
    }
  }catch(error){result.errors.push(error.message);}
  finally{clearInterval(timer);bridge?.close();}
  result.durationMs=stamp();result.protocolEvents=events;
  await writeFile(join(output,session.id+'.json'),JSON.stringify(result,null,2),{mode:0o600});
  await writeFile(join(output,session.id+'-output.pcm'),Buffer.concat(audio),{mode:0o600});
  summary.sessions.push({...result,protocolEvents:undefined});
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});
  console.log(JSON.stringify({session:session.id,state:'complete',turns:result.turns.length,errors:result.errors}));
}
