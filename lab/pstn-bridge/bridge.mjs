import {randomUUID} from 'node:crypto';
import {connectVoiceDevice} from './device-link.mjs';
import {createDownsampler24to8,createUpsampler8to16,rms,PHONE_FRAME_BYTES,PHONE_FRAME_MS} from './audio.mjs';

// One outbound phone call, end to end:
//   policy.admit -> dialer.originate (carrier/SIP trunk) -> callee answers ->
//   Asterisk AudioSocket leg -> Voice native device call -> hang up -> outcome.
// Every attempt dials at most once. A busy line, no answer, carrier error or a
// Voice failure ends the attempt with an outcome for the person who started
// it; nothing here schedules another dial.

export function createPstnBridge({policy, dialer, media, voice, fallbackPcm8k = null, now = Date.now,
  ringTimeoutMs = 45000, legTimeoutMs = 5000, maxCallMs = 600000, preReadyBufferMs = 3000,
  bargeInRms = 900, bargeInMs = 200, replyTailMs = 600, audit = () => {}}) {
  const waiting = new Map();  // uuid -> resolve(leg)
  media.on('leg', (leg, uuid) => {
    const resolve = waiting.get(uuid);
    // Only a leg we dialed may reach Voice. Anything else is hung up unheard.
    if (!resolve) {audit({type:'pstn.leg-unexpected'});return leg.hangup('unknown-leg');}
    waiting.delete(uuid);resolve(leg);
  });

  async function call({initiator, to, callerId}) {
    const admitted = policy.admit({initiator, to, callerId});
    if (!admitted.ok) {audit({type:'pstn.refused', reason:admitted.reason});return {status:'refused', reason:admitted.reason, dials:0};}
    const uuid = randomUUID(), started = now();
    const outcome = extra => ({attemptId:uuid, dials:1, redial:false, ...extra, durationMs:now() - started});
    audit({type:'pstn.dial', attemptId:uuid});
    let leg;
    try {
      const legArrived = new Promise(resolve => waiting.set(uuid, resolve));
      const ringing = Promise.race([dialer.originate({to, uuid}),
        new Promise(resolve => setTimeout(() => resolve({answered:false, reason:'no-answer', timeout:true}), ringTimeoutMs).unref?.())]);
      const answer = await Promise.race([ringing, legArrived.then(l => ({answered:true, leg:l}))]);
      if (!answer.answered) {
        if (answer.timeout) await dialer.cancel?.(uuid).catch(() => {});
        audit({type:'pstn.not-answered', attemptId:uuid, reason:answer.reason});
        return outcome({status:'not-answered', reason:answer.reason ?? 'failed'});
      }
      leg = answer.leg ?? await Promise.race([legArrived, new Promise(resolve => setTimeout(() => resolve(null), legTimeoutMs).unref?.())]);
      if (!leg) {audit({type:'pstn.no-media', attemptId:uuid});return outcome({status:'failed', reason:'no-media-leg'});}
      return await converse(leg, uuid, outcome);
    } finally {
      waiting.delete(uuid);
      policy.release(admitted.attempt);
    }
  }

  // The callee is on the line. Connect Voice; if it cannot take the call, the
  // callee hears the fallback line and the call ends instead of hanging silent.
  function converse(leg, uuid, outcome) {
    return new Promise(resolve => {
      const answeredAt = now();
      const up = createUpsampler8to16(), down = createDownsampler24to8();
      let queue = Buffer.alloc(0), speaking = false, replyDone = false, lastDownAt = 0, loudMs = 0, bargedThisReply = false;
      let early = [], earlyBytes = 0, finished = false, voiceSessionId = null, hangupBy = null;
      const link = connectVoiceDevice(voice);
      const finish = extra => {
        if (finished) return;finished = true;
        clearInterval(pacer);clearTimeout(cap);
        audit({type:'pstn.ended', attemptId:uuid, ...extra, talkMs:now() - answeredAt});
        resolve(outcome({voiceSessionId, ...extra, talkMs:now() - answeredAt}));
      };
      const setSpeaking = value => {if (speaking === value) return;speaking = value;link.playback(value);if (value) {bargedThisReply = false;loudMs = 0;}};
      // Real-time playout: one 20 ms frame per tick, exactly what the phone plays.
      const pacer = setInterval(() => {
        if (queue.length >= PHONE_FRAME_BYTES) {
          leg.sendAudio(queue.subarray(0, PHONE_FRAME_BYTES));queue = queue.subarray(PHONE_FRAME_BYTES);setSpeaking(true);return;
        }
        if (speaking && (replyDone || now() - lastDownAt > replyTailMs)) {
          if (queue.length) {const tail = Buffer.alloc(PHONE_FRAME_BYTES);queue.copy(tail);leg.sendAudio(tail);queue = Buffer.alloc(0);}
          setSpeaking(false);
        }
      }, PHONE_FRAME_MS);pacer.unref?.();
      const cap = setTimeout(() => {hangupBy = 'max-duration';link.end();leg.hangup('max-duration');}, maxCallMs);cap.unref?.();

      link.on('ready', ready => {
        voiceSessionId = ready.voiceSessionId;
        audit({type:'pstn.voice-ready', attemptId:uuid, voiceSessionId, latencyMs:now() - answeredAt});
        // "喂？" said while Voice was connecting is still the callee's first turn.
        for (const pcm of early) link.sendAudio(pcm);early = [];earlyBytes = 0;
      });
      link.on('audio', pcm24 => {
        const pcm8 = down(pcm24);lastDownAt = now();replyDone = false;
        queue = queue.length ? Buffer.concat([queue, pcm8]) : pcm8;
      });
      link.on('reply-done', () => {replyDone = true;});
      // Voice decided the reply is over (barge-in, replacement): drop what the
      // callee has not heard yet. The bridge never makes that decision itself.
      link.on('clear', () => {queue = Buffer.alloc(0);setSpeaking(false);});
      link.on('closed', ({reason, message, normal, wasReady}) => {
        if (finished) return;
        if (normal) {hangupBy ??= reason === 'device' ? 'callee' : 'voice';leg.hangup('voice-ended');return finish({status:'completed', reason, endedBy:hangupBy});}
        // Voice failed before or during the call: say so on the line, then hang up.
        audit({type:'pstn.voice-failed', attemptId:uuid, reason, wasReady});
        queue = Buffer.alloc(0);
        const fallback = fallbackPcm8k ?? Buffer.alloc(0);
        let offset = 0;
        clearInterval(pacer);
        const play = setInterval(() => {
          if (leg.ended || offset >= fallback.length) {clearInterval(play);leg.hangup('fallback');return finish({status:'voice-unavailable', reason, wasReady, fallbackPlayed:fallback.length > 0});}
          leg.sendAudio(fallback.subarray(offset, offset + PHONE_FRAME_BYTES));offset += PHONE_FRAME_BYTES;
        }, PHONE_FRAME_MS);play.unref?.();
        void message;
      });

      leg.on('audio', pcm8 => {
        const pcm16 = up(pcm8);
        if (!link.ready) {
          early.push(pcm16);earlyBytes += pcm16.length;
          while (earlyBytes > preReadyBufferMs * 32) earlyBytes -= early.shift().length;
          return;
        }
        link.sendAudio(pcm16);
        // Talking over V: tell Voice once per reply. Voice decides whether to stop.
        if (speaking && !bargedThisReply) {
          loudMs = rms(pcm8) >= bargeInRms ? loudMs + pcm8.length / 16 : 0;
          if (loudMs >= bargeInMs) {bargedThisReply = true;audit({type:'pstn.barge-in', attemptId:uuid});link.bargeIn();}
        }
      });
      leg.on('dtmf', () => {});  // no keypad features in the prototype
      leg.on('hangup', reason => {
        if (finished) return;
        if (reason === 'remote-hangup' || reason === 'socket-closed' || reason === 'remote-error') {
          hangupBy ??= 'callee';
          if (link.ready) link.end();else {link.end();finish({status:'completed', reason, endedBy:'callee', voiceSessionId});}
          // Wait for Voice to confirm the close (normal 'device' close finishes above).
          setTimeout(() => finish({status:'completed', reason, endedBy:'callee'}), 3000).unref?.();
        }
      });
    });
  }

  return {call, pending:() => waiting.size};
}
