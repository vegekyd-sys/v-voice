// What the caller types, said aloud for a voice model that takes no typed turn.
//
// Doubao (Seeduplex) answers only speech: its documented events can add text to the conversation's
// history, but nothing written makes it answer (probed 11/27: `conversation.item.create` alone is never
// answered and `response.create` is an unknown event that ends the session). So a typed message is
// spoken in a voice that is not V's and handed to the model as the caller's own turn; the model then
// answers it the way it answers anything the caller says, with all of the call's tools. The exact words
// go along as text, so what speech recognition hears differently (a link, a name, a number) is not lost.

import {randomUUID} from 'node:crypto';

const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
// The speech model the realtime key also serves (`seed-tts-1.0` refuses these speakers).
const RESOURCE = 'seed-tts-2.0';
// The caller's words in a voice V never speaks with, so they are never taken for V's own echo.
const CALLER_SPEAKERS = Object.freeze(['zh_male_m191_uranus_bigtts', 'zh_female_vv_uranus_bigtts']);
// About half a minute of speech. A longer message is said up to here; the whole of it goes as text.
export const TYPED_SPOKEN_CHARS = 160;

/** The speaker for the caller's typed words: one that is not V's. */
export function callerSpeaker(vSpeaker) {
  return CALLER_SPEAKERS.find(speaker => speaker !== vSpeaker) ?? CALLER_SPEAKERS[0];
}

/** What is said of a typed message: all of it, or its first sentences and a word that more was written. */
export function spokenPart(text, limit = TYPED_SPOKEN_CHARS) {
  const words = String(text ?? '').replace(/\s+/gu, ' ').trim();
  if (Array.from(words).length <= limit) return {text: words, whole: true};
  const head = Array.from(words).slice(0, limit).join('');
  const cut = Math.max(...['。', '！', '？', '!', '?', '；', '\n'].map(mark => head.lastIndexOf(mark)));
  return {text: `${cut > limit / 3 ? head.slice(0, cut + 1) : head}……后面还有，我打字发给你了。`, whole: false};
}

/**
 * `createTypedSpeech({apiKey})` → `speak(text, {speaker, signal})`, resolving 16 kHz mono PCM16LE.
 * One HTTP request per message; the answer streams JSON lines, each with a piece of audio.
 */
export function createTypedSpeech({apiKey, fetchImpl = fetch, timeoutMs = 8000, sampleRate = 16000, randomId = randomUUID} = {}) {
  if (!apiKey) return null;
  return async function speak(text, {speaker = CALLER_SPEAKERS[0], signal} = {}) {
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(ENDPOINT, {method: 'POST', signal: controller.signal,
        headers: {'X-Api-Key': apiKey, 'X-Api-Resource-Id': RESOURCE, 'X-Api-Request-Id': randomId(), 'Content-Type': 'application/json'},
        body: JSON.stringify({user: {uid: 'v-voice-typed'}, req_params: {text, speaker, audio_params: {format: 'pcm', sample_rate: sampleRate}}})});
      if (!response.ok) throw Error(`语音合成没有完成（${response.status}）`);
      const pieces = [];
      for (const line of (await response.text()).split('\n')) {
        if (!line.trim()) continue;
        let event; try { event = JSON.parse(line); } catch { throw Error('语音合成返回无效'); }
        if (typeof event.data === 'string' && event.data) pieces.push(Buffer.from(event.data, 'base64'));
        // 20000000 is the end of a successful answer; any other code is a refusal.
        else if (event.code && event.code !== 20000000) throw Error(`语音合成没有完成（${event.code}）`);
      }
      const audio = Buffer.concat(pieces);
      if (audio.length < 2) throw Error('语音合成没有声音');
      return audio.length % 2 ? audio.subarray(0, audio.length - 1) : audio;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}
