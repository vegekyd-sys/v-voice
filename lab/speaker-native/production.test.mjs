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
