import {createSpeakerDiagnostics} from './diagnostics.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createEmbeddingWorker} from './online-speaker.mjs';
import {createStreamingSpeakerRoutingService} from './stream-service.mjs';

export const SPEAKER_MODEL_SHA256='f86cd6c509f331f0e20b07bd48d1b2eb7de54202643401c4e84695ac861a0e5a';
// Uses the existing Voice environment and Gateway. No candidate identity, backend,
// fixture route, copied conversation database or private memory snapshot is loaded.
export async function createProductionSpeaker(options={}){
  const {env=process.env,audit=()=>{}}=options;
  if(env.VOICE_STREAM_SPEAKER!=='1')return null;
  // A household-device node (VOICE_STREAM_SPEAKER_OPTIONAL=1) keeps serving
  // native calls when the voice worker cannot start, instead of crash-looping.
  if(env.VOICE_STREAM_SPEAKER_OPTIONAL!=='1')return startProductionSpeaker(options);
  try{return await startProductionSpeaker(options);}
  catch(error){audit({type:'speaker.unavailable',voiceSessionId:'speaker',reason:String(error?.message??error).slice(0,200)});return null;}
}
async function startProductionSpeaker({env=process.env,audit=()=>{},read=readFile,worker=createEmbeddingWorker,routing=createStreamingSpeakerRoutingService}={}){
  for(const key of ['VOICE_SPEAKER_PYTHON','VOICE_SPEAKER_MODEL','VOLCENGINE_ASR_API_KEY'])if(!env[key])throw Error('Speaker configuration missing: '+key);
  if(!env.VOICE_JEV_API_KEY&&!env.OPENROUTER_API_KEY)throw Error('Speaker decision credential missing');
  const digest=createHash('sha256').update(await read(env.VOICE_SPEAKER_MODEL)).digest('hex');
  if(digest!==SPEAKER_MODEL_SHA256)throw Error('Speaker model checksum mismatch');
  const diagnostics=createSpeakerDiagnostics({directory:env.VOICE_SPEAKER_DIAGNOSTICS_DIR});
  const record=event=>{audit(event);diagnostics.audit(event);};
  const embedding=worker({python:env.VOICE_SPEAKER_PYTHON,model:env.VOICE_SPEAKER_MODEL});
  try{await embedding.ready;const service=routing({env,embedding,onAudit:record,limits:{durationMs:7200000,inputSeconds:7200,decisionCalls:3000}});return {service,audit:record,close(){service.dispose();embedding.close();}};}
  catch(error){embedding.close();throw error;}
}
