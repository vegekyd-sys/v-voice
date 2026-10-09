import assert from 'node:assert/strict';
import test from 'node:test';
import {createH5DuplexPlaybackGate} from './duplex-playback.mjs';

function fixture(options = {}) {
  const changes = [];
  const gate = createH5DuplexPlaybackGate({mode: 'strict-local', onGateChange: change => changes.push(change), ...options});
  const sample = (at, microphoneRms = 0, remoteRms = 0.2) => gate.observe({at, microphoneRms, remoteRms});
  const speak = (at = 0) => {sample(at, 0.04); sample(at + 50, 0.04); return sample(at + 100, 0.04);};
  const frames = (start, end, microphone = 0, remote = 0) => {
    for (let at = start; at <= end; at += 50) sample(at, microphone, remote);
    return gate.snapshot();
  };
  return {gate, sample, speak, frames, changes};
}

test('continuous microphone speech suppresses existing output once', () => {
  const f = fixture();
  assert.equal(f.sample(0, 0.04).localPlaybackMuted, false);
  assert.equal(f.sample(50, 0.04).localPlaybackMuted, false);
  assert.equal(f.sample(100, 0.04).localPlaybackMuted, true);
  f.sample(150, 0.04); f.sample(200, 0.04);
  assert.deepEqual(f.changes.map(({localPlaybackMuted, reason, at}) => ({localPlaybackMuted, reason, at})),
    [{localPlaybackMuted: true, reason: 'local-user-speech', at: 100}]);
});

test('a short click or discontinuous loud samples do not count as speech', () => {
  const f = fixture();
  f.sample(0, 0.08); f.sample(40, 0); f.sample(90, 0.08); f.sample(300, 0.08); f.sample(340, 0);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
  assert.deepEqual(f.changes, []);
});

test('background microphone noise never suppresses a genuine model reply', () => {
  const f = fixture(); f.frames(0, 1000, 0.005, 0.15);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
  assert.deepEqual(f.changes, []);
});

test('microphone hysteresis retains speech without flickering near attack threshold', () => {
  const f = fixture(); f.speak(); f.frames(150, 750, 0.015, 0);
  assert.equal(f.gate.snapshot().localUserSpeaking, true);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.changes.length, 1);
});

test('true microphone silence releases a zero end threshold after terminal and drain', () => {
  const f = fixture({micEndRms: 0}); f.speak();
  f.gate.notifyAssistantTurnDone('old', 125); f.frames(150, 600);
  assert.equal(f.gate.snapshot().localUserSpeaking, false);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('a half-second old-answer pause cannot release the gate or leak its tail', () => {
  const f = fixture(); f.gate.notifyAssistantTurnCreated('old', 0); f.speak();
  f.frames(150, 650);
  assert.equal(f.gate.snapshot().localUserSpeaking, false);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.gate.snapshot().oldTurnTerminal, false);
  assert.equal(f.gate.snapshot().outputDrained, false);
  assert.equal(f.sample(700, 0, 0.2).localPlaybackMuted, true, 'The old answer resumes behind the gate');
});

test('assistant done is not audio clear: active queued RTP still prevents recovery', () => {
  const f = fixture(); f.speak(); f.gate.notifyAssistantTurnDone('old', 125);
  f.frames(150, 650, 0, 0.2);
  assert.equal(f.gate.snapshot().oldTurnTerminal, true);
  assert.equal(f.gate.snapshot().outputDrained, false);
  assert.equal(f.gate.snapshot().phase, 'waiting-output-drain');
  f.frames(700, 900);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.sample(950, 0, 0).localPlaybackMuted, false);
  assert.equal(f.sample(1000, 0, 0.2).localPlaybackMuted, false, 'The next answer is audible');
  assert.deepEqual(f.changes.map(change => change.reason), ['local-user-speech', 'assistant-terminal-and-output-drained']);
});

test('a new created event and a different terminal cannot release a known old turn', () => {
  const f = fixture(); f.gate.notifyAssistantTurnCreated('old', 0); f.speak();
  f.gate.notifyAssistantTurnCreated('new', 125);
  f.gate.notifyAssistantTurnDone('new', 130);
  f.frames(150, 1000);
  assert.equal(f.gate.snapshot().oldTurnTerminal, false);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  f.gate.notifyAssistantTurnDone('old', 1010);
  f.frames(1050, 1250);
  assert.equal(f.gate.snapshot().outputDrained, false, 'Pre-terminal silence is not credited');
  assert.equal(f.sample(1300, 0, 0).localPlaybackMuted, false);
});

test('delayed assistant metadata never releases an unknown old output before terminal', () => {
  const f = fixture(); f.speak(); f.frames(150, 600);
  f.gate.notifyAssistantTurnCreated('delayed', 625); f.frames(650, 1000);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.gate.snapshot().oldTurnTerminal, false);
  f.gate.notifyAssistantTurnDone('delayed', 1025); f.frames(1050, 1300);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('a proven drain while the caller speaks survives the new reply until microphone release', () => {
  const f = fixture(); f.gate.notifyAssistantTurnCreated('old', 0); f.speak();
  f.gate.notifyAssistantTurnDone('old', 125); f.frames(150, 400, 0.04, 0);
  assert.equal(f.gate.snapshot().outputDrained, true);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  f.gate.notifyAssistantTurnCreated('new', 425); f.frames(450, 1000, 0.04, 0.2);
  assert.equal(f.gate.snapshot().outputDrained, true, 'Fresh incoming audio cannot undo a proven old drain');
  f.frames(1050, 1450, 0, 0.2);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.sample(1500, 0, 0.2).localPlaybackMuted, false);
});

test('a short post-terminal gap and renewed speech do not briefly reopen playback', () => {
  const f = fixture(); f.speak(); f.gate.notifyAssistantTurnDone('old', 125);
  f.frames(150, 600, 0, 0.2);
  f.sample(650, 0, 0); f.sample(700, 0, 0); f.sample(750, 0, 0.2);
  f.sample(800, 0.04, 0); f.sample(850, 0.04, 0); f.sample(900, 0.04, 0);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.gate.snapshot().localUserSpeaking, true);
  assert.equal(f.changes.length, 1);
});

test('renewed speech at the exact drain boundary does not reopen during attack', () => {
  const f = fixture(); f.speak(); f.gate.notifyAssistantTurnDone('old', 125);
  f.frames(150, 600, 0, 0.2); f.frames(650, 850);
  assert.equal(f.sample(900, 0.04, 0).localPlaybackMuted, true);
  assert.equal(f.sample(950, 0.04, 0).localPlaybackMuted, true);
  f.sample(1000, 0.04, 0);
  assert.equal(f.changes.length, 1);
});

test('missing samples cannot prove a drain even if native metadata keeps arriving', () => {
  const f = fixture(); f.speak(); f.gate.notifyAssistantTurnDone('old', 125);
  f.sample(150, 0, 0);
  f.gate.notifyAssistantTurnCreated('new', 950);
  assert.equal(f.sample(1000, 0, 0).outputDrained, false);
  f.frames(1050, 1400);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.sample(1450, 0, 0).localPlaybackMuted, false);
});

test('dispose restores playback and ignores late old-call observations and native events', () => {
  const f = fixture(); f.speak(); f.gate.dispose(); f.gate.dispose();
  assert.equal(f.gate.snapshot().localUserSpeaking, false);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
  assert.equal(f.gate.snapshot().phase, 'disposed');
  assert.equal(f.changes.length, 2);
  assert.equal(f.changes[1].reason, 'disposed');
  const next = fixture(); next.speak();
  f.sample(500, 0.5, 0.5); f.gate.notifyAssistantTurnDone('old', 0); f.gate.notifyOutputAudioCleared(0);
  assert.equal(f.changes.length, 2);
  assert.equal(next.gate.snapshot().localPlaybackMuted, true);
});

test('native user turn fallback still requires a terminal and a real post-terminal gap', () => {
  const f = fixture(); f.sample(0, 0.005, 0.2); f.gate.notifyUserTurnStarted(10);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.changes[0].reason, 'provider-user-turn-start');
  f.frames(50, 550, 0, 0.2); f.gate.notifyAssistantTurnDone('old', 575);
  f.frames(600, 850);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('real native audio-cleared permits drain observation but not immediate unmuting', () => {
  const f = fixture(); f.speak(); f.gate.notifyOutputAudioCleared(125);
  assert.equal(f.gate.snapshot().oldTurnTerminal, true);
  assert.equal(f.gate.snapshot().outputDrained, false);
  f.frames(150, 400, 0.04, 0);
  assert.equal(f.gate.snapshot().outputDrained, true);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  f.frames(450, 900, 0, 0.2);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('initial caller speech without previous output does not lock the first answer', () => {
  const f = fixture(); f.frames(0, 100, 0.04, 0); f.frames(150, 600);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
  f.gate.notifyAssistantTurnCreated('first', 625); f.frames(650, 1000, 0, 0.2);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
  assert.deepEqual(f.changes, []);
});

test('native initial user event without previous output does not lock an early reply', () => {
  const f = fixture(); f.gate.notifyUserTurnStarted(0); f.frames(50, 300, 0.04, 0);
  f.gate.notifyAssistantTurnCreated('first', 325); f.frames(350, 500, 0.04, 0.2);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('a first response arriving inside the initial speech attack is not mistaken for old output', () => {
  const f = fixture(); f.sample(0, 0.04, 0);
  f.gate.notifyAssistantTurnCreated('first', 25);
  f.sample(50, 0.04, 0.2); f.sample(100, 0.04, 0.2);
  assert.equal(f.gate.snapshot().localUserSpeaking, true);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('known old terminal just before native barge still requires a new observed drain', () => {
  const f = fixture(); f.gate.notifyAssistantTurnCreated('old', 0); f.sample(50, 0, 0.2);
  f.gate.notifyAssistantTurnDone('old', 60); f.gate.notifyUserTurnStarted(70);
  assert.equal(f.gate.snapshot().oldTurnTerminal, true);
  assert.equal(f.gate.snapshot().outputDrained, false);
  f.frames(100, 350, 0.04, 0); f.frames(400, 850, 0, 0.2);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('an unknown old output cannot use a duplicate pre-gate terminal as recovery', () => {
  const f = fixture(); f.sample(0, 0, 0.2);
  f.gate.notifyAssistantTurnDone('already-done', 50); f.gate.notifyUserTurnStarted(60);
  f.gate.notifyAssistantTurnDone('already-done', 70); f.frames(100, 1000);
  assert.equal(f.gate.snapshot().oldTurnTerminal, false);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
});

test('a gap in an unfinished answer remains old output when the caller starts speaking', () => {
  const f = fixture(); f.gate.notifyAssistantTurnCreated('old', 0); f.sample(0, 0, 0.2);
  f.frames(50, 650); f.frames(700, 800, 0.04, 0);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.gate.snapshot().oldTurnTerminal, false);
});

test('fully ended and drained old output does not lock a fresh caller question', () => {
  const f = fixture(); f.gate.notifyAssistantTurnCreated('old', 0); f.sample(50, 0, 0.2);
  f.gate.notifyAssistantTurnDone('old', 75); f.frames(100, 350); f.frames(400, 500, 0.04, 0);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
});

test('missing terminal evidence suggests a separate restart without timeout unmuting', () => {
  const f = fixture(); f.speak(); f.frames(150, 4550);
  assert.equal(f.gate.snapshot().recoverySuggested, false);
  assert.equal(f.sample(4600, 0, 0).recoverySuggested, true);
  assert.equal(f.gate.snapshot().localPlaybackMuted, true);
  assert.equal(f.gate.snapshot().oldTurnTerminal, false);
});

test('invalid thresholds, turns, observations and backwards timestamps reject', () => {
  for (const option of [{micStartRms: NaN}, {micEndRms: 0.02}, {remoteQuietRms: -1}, {attackMs: 0},
    {releaseMs: Infinity}, {recoveryAfterMs: 0}, {onGateChange: null}, {mode: 'unsupported'}]) assert.throws(() => createH5DuplexPlaybackGate(option));
  const f = fixture(); f.sample(100);
  assert.throws(() => f.sample(99), /monotonic/u);
  assert.throws(() => f.sample(101, NaN), /RMS/u);
  assert.throws(() => f.sample(101, 0, -0.1), /RMS/u);
  assert.throws(() => f.gate.notifyAssistantTurnCreated('', 101), /turn ID/u);
  assert.throws(() => f.gate.notifyAssistantTurnDone(null, 101), /turn ID/u);
  assert.throws(() => f.gate.notifyOutputAudioCleared(99), /monotonic/u);
});

test('native is the default and does not convert local speech or delayed user metadata into playback muting', () => {
  const changes = [];
  const gate = createH5DuplexPlaybackGate({onGateChange: value => changes.push(value)});
  assert.equal(gate.snapshot().mode, 'native');
  assert.equal(gate.snapshot().interruptionOwner, 'provider');
  gate.notifyAssistantTurnCreated('old', 0);
  for (let at = 0; at <= 100; at += 50) gate.observe({at, microphoneRms: .04, remoteRms: .2});
  gate.notifyAssistantTurnDone('old', 125);
  gate.notifyAssistantTurnCreated('next', 130);
  gate.notifyUserTurnStarted(135);
  // The stream need not contain a gap between two replies. No client gate can
  // identify which decoded PCM frames belong to which assistant turn.
  for (let at = 150; at <= 6000; at += 50) gate.observe({at, microphoneRms: .015, remoteRms: .2});
  assert.equal(gate.snapshot().localPlaybackMuted, false);
  assert.equal(gate.snapshot().localUserSpeaking, false, 'Residual RMS below speech attack is not latched forever');
  assert.equal(gate.snapshot().oldTurnTerminal, false, 'The monitor does not manufacture interrupted-turn proof');
  assert.equal(gate.snapshot().outputDrained, false, 'Continuous remote energy is not called a drain');
  assert.deepEqual(changes, []);
});

test('native keeps full-duplex observation across sustained speech and missing frames without a hidden local mute', () => {
  const f = fixture({mode: 'native'});
  f.speak(); f.frames(150, 5000, .04, .2);
  assert.equal(f.gate.snapshot().localUserSpeaking, true);
  assert.equal(f.gate.snapshot().localPlaybackMuted, false);
  f.sample(10000, 0, .2); f.frames(10050, 10500, 0, .2);
  assert.equal(f.gate.snapshot().localUserSpeaking, false);
  assert.equal(f.gate.snapshot().recoverySuggested, false);
  assert.deepEqual(f.changes, []);
});
