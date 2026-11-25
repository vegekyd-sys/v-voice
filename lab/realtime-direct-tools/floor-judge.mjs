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
