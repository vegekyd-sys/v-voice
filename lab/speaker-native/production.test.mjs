import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionSpeaker} from './production.mjs';
test('production speaker is opt-in and does not read candidate files',async()=>{
 assert.equal(await createProductionSpeaker({env:{},read:()=>{throw Error('must not read');}}),null);
});
test('enabled production speaker fails before startup on missing credentials or wrong model',async()=>{
 await assert.rejects(createProductionSpeaker({env:{VOICE_STREAM_SPEAKER:'1'}}),/VOICE_SPEAKER_PYTHON/);
 const env={VOICE_STREAM_SPEAKER:'1',VOICE_SPEAKER_PYTHON:'/runtime/python',VOICE_SPEAKER_MODEL:'/runtime/model',VOLCENGINE_ASR_API_KEY:'test',OPENROUTER_API_KEY:'test'};
 await assert.rejects(createProductionSpeaker({env,read:async()=>Buffer.from('wrong'),worker:()=>{throw Error('must not spawn');}}),/checksum/);
});
test('an optional production speaker reports the failure and leaves native calls running',async()=>{
 const events=[],env={VOICE_STREAM_SPEAKER:'1',VOICE_STREAM_SPEAKER_OPTIONAL:'1',VOICE_SPEAKER_PYTHON:'/runtime/python',VOICE_SPEAKER_MODEL:'/runtime/model',VOLCENGINE_ASR_API_KEY:'test',OPENROUTER_API_KEY:'test'};
 assert.equal(await createProductionSpeaker({env,audit:e=>events.push(e),read:async()=>Buffer.from('wrong')}),null);
 assert.equal(events[0].type,'speaker.unavailable');assert.match(events[0].reason,/checksum/);
});
