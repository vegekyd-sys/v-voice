// Whether something said while V's speech still plays on the phone is said to V.
//
// SeedDuplex generates a board lesson two to three times faster than it plays (playback-position.mjs),
// so when someone in the room speaks the model believes V has finished, and answers nearly anything it
// recognises: in replays of the 11/24–25 calls it cut the lesson for 21 of 24 side remarks, backchannels
// and apologies (production code), and telling it that it was still speaking did not change that (22 of
// 24). This asks a fast text model the one question the voice model gets wrong here, with what V was
// saying, what it says next and what was just said. It is a judgement of meaning, made by a model: no
// word list decides anything. A judge that is slow, fails or answers something else leaves the voice
// model's own answer to go through, as before.
//
// Preferred transport: OpenAI's Decisions API through voice-decision-router.mjs createJevEvaluator
// (OpenRouter alpha endpoint), which answers one predicate with a probability in ~0.3-0.5 s. The
// chat-completion judge below stays as the fallback when that route is not configured.
import {createJevEvaluator} from '../voice-decision-router.mjs';

export const FLOOR_JUDGE_INSTRUCTIONS = `你在帮语音助手 V 判断一件事。V 正在给大家讲一段内容，房间里可能有好几个人。V 讲的过程中，麦克风听到有人说了一句话（语音识别结果，可能有错字）。
判断这句话是不是在对 V 说、需要 V 停下来回应：对 V 提出新的问题或请求、纠正 V、让 V 换个讲法或改做别的事、让 V 停下或重来，都是“是”。听众说没听懂、问自己能不能听懂、问 V 为什么这样讲、要求讲简单点或讲慢点，也是在向 V 提要求，是“是”。直接用“你”对正在讲话的人提要求（再说一遍、按顺序拆、接着讲、先别讲），即使没叫 V 的名字，也是“是”。
在场的人互相说话、回应或附和别人、议论 V、感叹、自言自语、向别人道歉或解释，都是“否”，V 会接着讲完。一句话里夹着闲聊时，只看其中有没有对 V 的要求；有就是“是”。
拿不准时，看这句话是不是在对 V 讲话、要 V 有所回应。只回答一个字：是，或者否。`;

/** The message for one judgement: what V was saying, what it says next, and what was heard. */
export function floorJudgeMessages({said = '', ahead = '', heard, recent = []}) {
  const lines = [
    recent.length ? `通话里前面几句：\n${recent.map(turn => `${turn.role === 'user' ? '有人' : 'V'}：${turn.text}`).join('\n')}` : '',
    `V 正在讲，刚讲到：“…${said}”`,
    ahead ? `V 接下来要讲：“${ahead}…”` : '',
    `这时听到有人说：“${heard}”`,
    '这句话是在对 V 说、需要 V 停下来回应吗？只回答：是，或者否。',
  ].filter(Boolean);
  return [{role: 'system', content: FLOOR_JUDGE_INSTRUCTIONS}, {role: 'user', content: lines.join('\n')}];
}

/**
 * `complete`: a chat completion stream (board-director createChatCompletionStream). Resolves to
 * {toV: true|false|null, ms, answer}; null when there is no clear answer in `timeoutMs`.
 */
export function createFloorJudge({complete, timeoutMs = 2500, now = () => performance.now()}) {
  return async function judge(input) {
    const started = now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let answer = '';
    try {
      for await (const delta of complete({messages: floorJudgeMessages(input), signal: controller.signal})) {
        answer += delta;
        if (answer.replace(/[\p{P}\s]+/gu, '')) break;
      }
    } catch { /* timed out or failed: no judgement */ } finally { clearTimeout(timer); controller.abort(); }
    // The answer is its first word; one that begins with anything else is not an answer.
    const first = answer.trim().replace(/^[\p{P}\s]+/u, '')[0];
    return {toV: first === '是' ? true : first === '否' ? false : null, ms: Math.round(now() - started), answer: answer.trim().slice(0, 24)};
  };
}

/** The predicate for the Decisions API: one question, answered with a probability. */
export const FLOOR_DECISION_INSTRUCTIONS = `state.heard 是房间里有人说的原话（语音识别，可能有错字）。state.speaker 是已知的说话人，未知时为 null；state.saidNow 是 V 正在讲的一句，state.saidAhead 是 V 接下来要讲的一句；state.recent 是通话里前面的几句。
判断：这句话是不是在对 V 说，并且要 V 现在就停下来或改变正在讲的内容，或者回答它？
是：向 V 提问、请求、纠正 V；让 V 换个讲法、讲简单点、讲慢点、重来、停下或先别讲；插话补充新的要求或话题；听众说没听懂、问自己能不能听懂、问 V 为什么这样讲；直接用“你”对正在讲话的人提要求，即使没叫 V 的名字。
否：在场的人互相说话、回应或附和别人、向别人道歉或解释、议论 V、感叹、自言自语；一句话夹着闲聊时，只看其中有没有对 V 的要求，没有就是否。
拿不准时，看这句话是不是在对 V 讲话、要 V 有回应。`;

/** What the decision model sees: the judgement task, the utterance, and what V is saying around it. */
export function floorDecisionState({said = '', ahead = '', heard, recent = [], speaker = null} = {}) {
  return {
    purpose: '判断 V 讲解时房间里有人说的这句话，是不是在对 V 说、要 V 停下或改变正在讲的内容。只做判断，不生成回复，不执行任何操作。',
    speaker: speaker == null ? null : String(speaker).slice(0, 40),
    saidNow: String(said).slice(0, 300),
    saidAhead: String(ahead).slice(0, 200),
    heard: String(heard ?? '').slice(0, 300),
    recent: recent.slice(-4).map(turn => ({role: turn.role === 'user' ? '有人' : 'V', text: String(turn.text).slice(0, 160)})),
  };
}

export function floorDecisionQuestions() {
  return {addressedNow: {type: 'noul', instructions: FLOOR_DECISION_INSTRUCTIONS}};
}

/**
 * `evaluate`: a Decisions evaluator (createJevEvaluator). Resolves to
 * {toV, probability, ms, answer}; toV is null when there is no usable probability.
 * `threshold` is the probability above which the utterance counts as said to V.
 */
export function createDecisionJudge({evaluate, threshold = 0.5, timeoutMs = 1200, now = () => performance.now()} = {}) {
  if (typeof evaluate !== 'function') throw Error('a decision evaluator is required');
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw Error('invalid threshold');
  return async function judge(input) {
    const started = now();
    let probability = null;
    try {
      const raw = await evaluate(floorDecisionState(input), floorDecisionQuestions(), AbortSignal.timeout(timeoutMs));
      const answer = raw?.answers?.addressedNow;
      if (answer?.type === 'noul' && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1) probability = answer.noul;
    } catch { /* timed out or failed: no judgement */ }
    return {toV: probability == null ? null : probability >= threshold, probability, ms: Math.round(now() - started), answer: probability == null ? '' : probability.toFixed(2)};
  };
}

/**
 * The judge the service uses: the Decisions API when the router's credentials are present
 * (VOICE_JEV_API_KEY, else OPENROUTER_API_KEY; model VOICE_OPENAI_DECISIONS_MODEL), null when
 * VOICE_FLOOR_JUDGE=0 or when neither is configured. Callers fall back to createFloorJudge.
 */
export function floorJudgeFromEnv(env = process.env, {evaluate = null, fetchImpl = null} = {}) {
  if (env.VOICE_FLOOR_JUDGE === '0') return null;
  const timeoutMs = Number(env.VOICE_FLOOR_JUDGE_TIMEOUT_MS ?? 1200);
  const threshold = Number(env.VOICE_FLOOR_JUDGE_THRESHOLD ?? 0.5);
  if (evaluate) return createDecisionJudge({evaluate, threshold, timeoutMs});
  const apiKey = env.VOICE_JEV_API_KEY ?? env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return createDecisionJudge({
    evaluate: createJevEvaluator({apiKey, model: env.VOICE_OPENAI_DECISIONS_MODEL ?? 'openai/gpt-6-luna-decisions', timeoutMs, ...(fetchImpl ? {fetchImpl} : {})}),
    threshold,
    timeoutMs,
  });
}
