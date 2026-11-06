import {test} from 'node:test';
import assert from 'node:assert/strict';
import {idleHangupDue,idleHangupExempt,idleHangupFromEnv,IDLE_HANGUP_DEFAULTS} from './idle-hangup.mjs';

const base={now:200_000,startedAt:1,activityAt:1,busy:false,speaking:false,ending:false,exempt:false};
test('silence past the limit ends the call; activity, an ending or a meeting does not',()=>{
  assert.equal(idleHangupDue(base),'silence');
  assert.equal(idleHangupDue({...base,activityAt:base.now-IDLE_HANGUP_DEFAULTS.idleMs+1}),null);
  assert.equal(idleHangupDue({...base,busy:true}),null);
  assert.equal(idleHangupDue({...base,ending:true}),null);
  assert.equal(idleHangupDue({...base,exempt:idleHangupExempt('meeting')}),null);
  assert.equal(idleHangupExempt('phone'),false);
  assert.equal(idleHangupDue({...base,startedAt:0}),null,'not connected yet');
  assert.equal(idleHangupDue(base,{idleMs:0}),null,'0 disables the silence rule');
});
test('the length cap waits for nobody to be mid-sentence but not for background work',()=>{
  const long={...base,now:IDLE_HANGUP_DEFAULTS.maxCallMs+2,activityAt:IDLE_HANGUP_DEFAULTS.maxCallMs+1};
  assert.equal(idleHangupDue(long),'max-duration');
  assert.equal(idleHangupDue({...long,busy:true}),'max-duration');
  assert.equal(idleHangupDue({...long,busy:true,speaking:true}),null);
  assert.equal(idleHangupDue(long,{maxCallMs:0}),null);
});
test('limits come from one server setting with safe fallbacks',()=>{
  assert.deepEqual(idleHangupFromEnv({}),IDLE_HANGUP_DEFAULTS);
  assert.deepEqual(idleHangupFromEnv({VOICE_IDLE_HANGUP_MS:'30000',VOICE_MAX_CALL_MS:'0'}),{idleMs:30000,maxCallMs:0});
  assert.deepEqual(idleHangupFromEnv({VOICE_IDLE_HANGUP_MS:'-5',VOICE_MAX_CALL_MS:'abc'}),IDLE_HANGUP_DEFAULTS);
});
