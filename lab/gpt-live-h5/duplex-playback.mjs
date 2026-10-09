/**
 * Native owns turn taking on the single WebRTC audio stream. Local RMS and
 * turn metadata cannot associate individual RTP frames with an assistant turn.
 * Defaulting to local suppression can therefore hide the next answer forever.
 * The strict-local mode is retained for diagnostic comparisons only. It never
 * interrupts the model or cancels work, and still requires a real output drain.
 */
export function createH5DuplexPlaybackGate({
  mode = 'native',
  onGateChange = () => {},
  micStartRms = 0.02,
  micEndRms = 0.01,
  remoteQuietRms = 0.008,
  attackMs = 100,
  releaseMs = 450,
  remoteGapMs = 250,
  maxFrameGapMs = 150,
  recoveryAfterMs = 4000,
} = {}) {
  if (!['native', 'strict-local'].includes(mode)) throw new RangeError('Unknown duplex playback mode');
  if (typeof onGateChange !== 'function') throw new TypeError('Playback gate callback must be a function');
  for (const [name, value] of Object.entries({micStartRms, micEndRms, remoteQuietRms}))
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a nonnegative finite RMS`);
  if (micStartRms <= micEndRms) throw new RangeError('Microphone attack threshold must exceed release threshold');
  for (const [name, value] of Object.entries({attackMs, releaseMs, remoteGapMs, maxFrameGapMs, recoveryAfterMs}))
    if (!Number.isFinite(value) || value < 1) throw new RangeError(`${name} must be a positive finite duration`);

  let lastAt = null, lastFrameAt = null, voicedSince = null, voicedFrames = 0, micQuietSince = null;
  let localUserSpeaking = false, localPlaybackMuted = false, disposed = false;
  let outputOutstanding = false, outputQuietSince = null, outputTerminal = false;
  let assistantTurnId = null;
  let outputAtSpeechStart = false, turnAtSpeechStart = null;
  const completedTurns = new Set();
  let blockedTurnId = null, gateAt = null, oldTurnTerminal = false, drainQuietSince = null, outputDrained = false;
  let waitingSince = null;
  const snapshot = () => ({
    mode, interruptionOwner: mode === 'native' ? 'provider' : 'local-playback-only',
    localUserSpeaking, localPlaybackMuted, disposed, oldTurnTerminal, outputDrained,
    recoverySuggested: waitingSince !== null && lastAt - waitingSince >= recoveryAfterMs,
    phase: disposed ? 'disposed' : !localPlaybackMuted ? 'open' : localUserSpeaking ? 'user-speaking'
      : !oldTurnTerminal ? 'waiting-assistant-terminal' : !outputDrained ? 'waiting-output-drain' : 'waiting-microphone-release',
  });
  const timestamp = at => {
    if (!Number.isFinite(at) || at < 0 || (lastAt !== null && at < lastAt))
      throw new RangeError('Duplex timestamps must be monotonic and nonnegative');
    lastAt = at;
  };
  const validTurnId = id => {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Assistant turn ID must be a nonempty string');
  };
  const gate = (muted, reason, at) => {
    if (localPlaybackMuted === muted) return;
    localPlaybackMuted = muted;
    onGateChange({...snapshot(), reason, at});
  };
  const freezeOutput = (reason, at, previousOutput = outputOutstanding, previousTurnId = assistantTurnId) => {
    if (mode === 'native') return;
    // Initial speech with no previous audio is not a barge-in. In particular,
    // it must not lock the first reply waiting for that reply's own turn.done.
    if (!previousOutput || (localPlaybackMuted && !outputDrained)) return;
    blockedTurnId = previousTurnId;
    gateAt = at;
    oldTurnTerminal = blockedTurnId !== null && completedTurns.has(blockedTurnId);
    drainQuietSince = null;
    outputDrained = false;
    waitingSince = null;
    gate(true, reason, at);
  };
  const recordTerminal = () => {
    if (oldTurnTerminal) return;
    oldTurnTerminal = true;
    // A pause before the terminal event cannot prove that queued audio drained
    // after termination. Require fresh, continuously observed RTP silence.
    drainQuietSince = null;
    outputDrained = false;
    waitingSince = null;
  };
  return {
    snapshot,
    notifyAssistantTurnCreated(id, at) {
      if (disposed) return snapshot();
      validTurnId(id); timestamp(at);
      if (!completedTurns.has(id)) {
        assistantTurnId = id;
        outputTerminal = false;
        outputQuietSince = null;
      }
      // Created metadata can arrive late; it never unlocks an existing gate.
      return snapshot();
    },
    notifyAssistantTurnDone(id, at) {
      if (disposed) return snapshot();
      validTurnId(id); timestamp(at);
      const duplicate = completedTurns.has(id);
      completedTurns.add(id);
      if (completedTurns.size > 64) completedTurns.delete(completedTurns.values().next().value);
      if (assistantTurnId === id || assistantTurnId === null) {
        outputTerminal = true;
        outputQuietSince = null;
      }
      if (localPlaybackMuted && (blockedTurnId === id ||
          (blockedTurnId === null && !duplicate && at >= gateAt))) recordTerminal();
      return snapshot();
    },
    notifyOutputAudioCleared(at) {
      if (disposed) return snapshot();
      timestamp(at);
      outputTerminal = true;
      outputQuietSince = null;
      if (localPlaybackMuted) recordTerminal();
      return snapshot();
    },
    notifyUserTurnStarted(at) {
      if (disposed) return snapshot();
      timestamp(at);
      const alreadySpeaking = localUserSpeaking;
      localUserSpeaking = true;
      if (!alreadySpeaking) freezeOutput('provider-user-turn-start', at);
      micQuietSince = null;
      voicedSince = at;
      voicedFrames = 0;
      waitingSince = null;
      return snapshot();
    },
    observe({at, microphoneRms, remoteRms}) {
      if (disposed) return snapshot();
      if (![microphoneRms, remoteRms].every(value => Number.isFinite(value) && value >= 0))
        throw new RangeError('Duplex observations require nonnegative finite RMS values');
      timestamp(at);
      if (lastFrameAt !== null && at - lastFrameAt > maxFrameGapMs) {
        // Missing/backgrounded samples cannot prove continuous silence. An
        // already observed post-terminal drain remains a historical fact.
        voicedSince = micQuietSince = drainQuietSince = outputQuietSince = null;
        voicedFrames = 0;
        waitingSince = null;
      }
      lastFrameAt = at;
      if (remoteRms > remoteQuietRms) {
        if (!outputOutstanding) {
          outputTerminal = false;
          if (completedTurns.has(assistantTurnId)) assistantTurnId = null;
        }
        outputOutstanding = true;
        outputQuietSince = drainQuietSince = null;
      } else {
        if (outputTerminal) {
          outputQuietSince ??= at;
          if (at - outputQuietSince >= remoteGapMs) outputOutstanding = false;
        }
        if (localPlaybackMuted && oldTurnTerminal && !outputDrained) {
          drainQuietSince ??= at;
          if (at - drainQuietSince >= remoteGapMs) outputDrained = true;
        }
      }
      // Native mode observes speech but never latches the lower release RMS
      // into playback. A residual room/echo level is not a local mute command.
      const voiced = mode === 'strict-local' && localUserSpeaking ? microphoneRms > micEndRms : microphoneRms >= micStartRms;
      if (voiced) {
        micQuietSince = waitingSince = null;
        if (voicedSince === null) {
          voicedSince = at;
          outputAtSpeechStart = outputOutstanding;
          turnAtSpeechStart = assistantTurnId;
        }
        voicedFrames++;
        if (!localUserSpeaking && voicedFrames >= 2 && at - voicedSince >= attackMs) {
          localUserSpeaking = true;
          freezeOutput('local-user-speech', at, outputAtSpeechStart, turnAtSpeechStart);
        }
      } else {
        voicedSince = null;
        voicedFrames = 0;
        if (micQuietSince === null) micQuietSince = at;
        if (localUserSpeaking && at - micQuietSince >= releaseMs) localUserSpeaking = false;
      }
      if (localPlaybackMuted && !voiced && !localUserSpeaking && micQuietSince !== null &&
          at - micQuietSince >= releaseMs) {
        if (oldTurnTerminal && outputDrained) {
          waitingSince = null;
          gate(false, 'assistant-terminal-and-output-drained', at);
        } else waitingSince ??= at;
      }
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      localUserSpeaking = false;
      voicedSince = micQuietSince = drainQuietSince = outputQuietSince = waitingSince = null;
      voicedFrames = 0;
      completedTurns.clear();
      assistantTurnId = blockedTurnId = null;
      gate(false, 'disposed', lastAt);
    },
  };
}
