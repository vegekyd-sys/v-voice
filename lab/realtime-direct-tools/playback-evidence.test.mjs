import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actualSpeakerIdle} from './playback-evidence.mjs';
test('a silent gap while PCM is still queued cannot be mistaken for speaker completion',()=>{
  const audio={type:'audio',at:1000};
  assert.equal(actualSpeakerIdle([audio,{type:'client.playback-stats',at:3500,stats:{queuedOutputBytes:613112}}],4000,0),false);
  assert.equal(actualSpeakerIdle([audio,{type:'client.playback-stats',at:3500,stats:{queuedOutputBytes:0}}],4000,0),true);
});
test('queue-empty proof must be fresh and later than the last actual PCM',()=>{
  const rows=[{type:'client.playback-stats',at:1000,stats:{queuedOutputBytes:0}},{type:'audio',at:2000}];
  assert.equal(actualSpeakerIdle(rows,4000,0),false);
  rows.push({type:'client.playback-stats',at:3500,stats:{queuedOutputBytes:0}});
  assert.equal(actualSpeakerIdle(rows,9000,0),false);assert.equal(actualSpeakerIdle(rows,4000,.01),false);
});
