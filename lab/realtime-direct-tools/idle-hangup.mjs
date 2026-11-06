// Server-side call hang-up shared by every client (web, iOS, devices): the
// host says goodbye and closes through the normal end-after-playback flow, so
// no client needs its own silence timer.
export const IDLE_HANGUP_DEFAULTS = Object.freeze({idleMs: 120_000, maxCallMs: 3_600_000});
export const IDLE_FAREWELL = Object.freeze({
  silence: '好像没人在说话了，我先挂了，有事再叫我。',
  'max-duration': '这通电话聊了快一个小时了，我先挂了，有事再打给我。',
});

// One place to tune every client: VOICE_IDLE_HANGUP_MS / VOICE_MAX_CALL_MS
// (milliseconds, 0 disables that rule; anything invalid keeps the default).
export function idleHangupFromEnv(env = {}) {
  const ms = (value, fallback) => /^\d+$/u.test(String(value ?? '')) ? Number(value) : fallback;
  return {idleMs: ms(env.VOICE_IDLE_HANGUP_MS, IDLE_HANGUP_DEFAULTS.idleMs), maxCallMs: ms(env.VOICE_MAX_CALL_MS, IDLE_HANGUP_DEFAULTS.maxCallMs)};
}

// A meeting is a long listen by design; it is never ended for silence.
export const idleHangupExempt = surface => surface === 'meeting';

// Returns why the call should end now, or null. `busy` means someone is
// talking or V is still working (reply, tool, background task), which counts
// as activity rather than silence. `speaking` (user or V mid-utterance) also
// delays the max-duration end so nobody is cut off mid-sentence.
export function idleHangupDue({now, startedAt, activityAt, busy, speaking, ending, exempt}, {idleMs = IDLE_HANGUP_DEFAULTS.idleMs, maxCallMs = IDLE_HANGUP_DEFAULTS.maxCallMs} = {}) {
  if (ending || exempt || !startedAt) return null;
  if (maxCallMs > 0 && now - startedAt >= maxCallMs) return speaking ? null : 'max-duration';
  if (busy || !(idleMs > 0)) return null;
  return now - activityAt >= idleMs ? 'silence' : null;
}
