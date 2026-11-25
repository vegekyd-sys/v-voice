// A phone on loudspeaker at high volume in a quiet room can leak a little of V's own voice
// past its echo canceller. The duplex model has long finished generating that reply (it
// arrives several times faster than it plays), so it takes the leak for a new utterance and
// answers it, and V cuts itself off after almost every sentence (11/21, iOS: the
// interrupting "utterances" were two to four characters of what V was saying right then).
//
// Recognised echo is a scrap of the reply being played: very short, and most of its
// characters are in that reply. A real interruption is longer, unrelated, or an explicit
// request to stop, which always interrupts. A bare acknowledgement is kept the same way
// (playbackBackchannelLike below).

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

// A listener's acknowledgement while V is still speaking ("嗯", "对对", "好的", "可以啊") is a
// backchannel, not a new turn (NATIVE_DUPLEX_POLICY: 普通"嗯、对"是附和，保留原回答). The model
// cannot apply that rule to a board lesson: it generated the lesson in seconds and believes it
// has finished, while the phone still plays twenty more seconds of it, so it answers the "可以啊"
// and its answer replaced the lesson (11/25, iOS: 21 s of a 勾股定理 lesson lost). Only bare
// acknowledgement words qualify; a question, a request, a refusal or anything else still interrupts.
const ACKNOWLEDGEMENT = /^(?:嗯哼|嗯|啊|哦|噢|喔|唔|呃|哈|呀|哇|对|好的|好|是的|是|可以|没错|明白|懂|行|继续|okay|ok|yeah|yes|yep|mhm)+$/u;

export const PLAYBACK_BACKCHANNEL_MAX_UNITS = 6;

/** True when `heard`, said while V is still speaking, is only an acknowledgement. */
export function playbackBackchannelLike(heard, {maxUnits = PLAYBACK_BACKCHANNEL_MAX_UNITS} = {}) {
  const text = String(heard ?? ''), said = units(text);
  if (!said.length || said.length > maxUnits || /[?？]/u.test(text) || EXPLICIT_INTERRUPTION.test(text)) return false;
  return ACKNOWLEDGEMENT.test(said.join(''));
}

// Lesson guard (VOICE_LESSON_GUARD=1, off by default). In a room of several people, side talk
// during a board lesson paused it at the first syllable and, once recognised, the model's
// answer replaced it (11/25 demos: 15–27 s of a lesson lost to "…不好意思，打断你了" or a remark
// about V). While a lesson still plays, only a stop word or speech that addresses V takes the
// floor; everything else is kept out of the conversation like echo.
const LESSON_STOP = /别讲|不要讲|不用讲|听我说|先别/u;
// "V" as its own word anywhere, V's name, or "维/B/LV" (how ASR has heard "V") opening the utterance.
const ADDRESSES_V = /(?<![a-z])v(?![a-z])|艾维|艾薇|小v|阿v|小维|阿维|^[\s，,。.、!！]*(?:维|薇|b|lv)(?=$|[\s，,。.、!！?？])/iu;

/** True when `heard` may interrupt a board lesson that is still playing. */
export function interruptsLesson(heard) {
  const text = String(heard ?? '');
  return EXPLICIT_INTERRUPTION.test(text) || LESSON_STOP.test(text) || ADDRESSES_V.test(text);
}

/** What V is saying now: a reply as it streams, or the whole caption of speech the service
 * speaks for us (a board lesson, a progress line), which comes with a source and no response id. */
export function createPlaybackText() {
  let current = {responseId: undefined, text: ''};
  return {
    observe(text, {final = false, source, responseId} = {}) {
      if (typeof text !== 'string' || !final && source) return;
      if (source || current.responseId !== responseId) current = {responseId, text: ''};
      current.text = final ? text : (current.text + text).slice(-8000);
    },
    get text() { return current.text; },
  };
}
