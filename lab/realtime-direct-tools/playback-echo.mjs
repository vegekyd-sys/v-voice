// A phone on loudspeaker at high volume in a quiet room can leak a little of V's own voice
// past its echo canceller. The duplex model has long finished generating that reply (it
// arrives several times faster than it plays), so it takes the leak for a new utterance and
// answers it, and V cuts itself off after almost every sentence (11/21, iOS: the
// interrupting "utterances" were two to four characters of what V was saying right then).
//
// Recognised echo is a scrap of the reply being played: very short, and most of its
// characters are in that reply. A real interruption is longer, unrelated, or an explicit
// request to stop, which always interrupts.

/** Units: each CJK character on its own, other letters/digits as words. */
function units(text) {
  return String(text ?? '').toLowerCase().match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) ?? [];
}

const EXPLICIT_INTERRUPTION = /停|等等|等一下|等会|别说|不对|不是|暂停|闭嘴|打住|够了|行了|算了|不用了|\bstop\b|\bwait\b|hold on/iu;

export const PLAYBACK_ECHO_MAX_UNITS = 4;

/** True when `heard` looks like V's own `playing` reply picked up again by the microphone. */
export function playbackEchoLike(heard, playing, {maxUnits = PLAYBACK_ECHO_MAX_UNITS, minShare = 0.5} = {}) {
  const said = units(heard);
  if (!said.length || said.length > maxUnits || EXPLICIT_INTERRUPTION.test(String(heard))) return false;
  const reply = new Set(units(playing));
  if (!reply.size) return false;
  return said.filter(unit => reply.has(unit)).length / said.length >= minShare;
}
