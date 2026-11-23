// Before a creation is paid for: does the caller's request name a picture, file or
// earlier work that the voice model does not have at hand? The voice model makes
// what it is asked from words when it lacks the thing asked for ("use your own
// image", "the family photo I sent you last week"), and does not know it lacks
// it: no tool refuses, a picture is made, and it is the wrong one. This looks at
// the caller's own words and at what is at hand, and says what is missing; the
// request then goes to V's backend, which can fetch it. Most requests name
// nothing of the kind and are not looked at at all (no time added).

// Words that point at something that exists somewhere: mine, ours, yours, earlier, sent, in a file.
const POINTS = /我的|我家|我们|咱们|公司|品牌|你的|你自己|上次|上周|上个月|昨天|前天|之前|以前|早上|刚才发|发你|发给你|发过|给过你|存的|相册|文档里|文件里|群里|飞书里|聊天记录|那个视频|那张照片|那张合影|全家福|头像|logo|LOGO|商标/u;
/** Whether the request points at something that may not be at hand (only then is it looked at). */
export const pointsAtMaterial = text => POINTS.test(String(text ?? ''));

export const MATERIAL_CHECK_GUIDE = `用户在电话里让 V 做一张图或一段视频。V 手上只有 have 里列的图（屏幕上的作品、搜到的照片、常驻素材），加上用户说的话。
判断：用户这句话里有没有点名一样**已经存在的**具体素材（他发过的某张照片、某个文件或文档里的图、以前做过的某个作品、某个人或公司的头像、logo、品牌规范），而它不在 have 里？
- 有：只输出 {"missing":"用几个字说是哪样东西"}
- 没有：只输出 {"missing":""}
从严判断，拿不准就算没有：
- 用户只是描述想要的画面（“画一只我喜欢的柴犬”“做个我们一家人去海边的卡通画”）、提到风格或心情，不算点名素材。
- “这张”“它”“刚才那张”“那张海报”指的是 have 里的图，不算缺。
- “你自己”“你的形象”在 have 里有 V 的形象时不算缺。
- 用户说的东西 have 里有名字对得上的，不算缺。
只输出这一行 JSON。`;

/**
 * `complete({messages, signal})` yields text (the board's quick text model).
 * `check({ask, have: [name…]})` resolves the name of what is missing, or '' (also when the check
 * is slow or fails: a request is never held back by the check itself).
 */
export function createMaterialCheck({complete, timeoutMs = 2500, audit = () => {}, now = Date.now} = {}) {
  if (!complete) return null;
  return {
    async check({ask = '', have = [], signal} = {}) {
      if (!pointsAtMaterial(ask)) return '';
      const started = now(), controller = new AbortController(), abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
      const timer = setTimeout(abort, timeoutMs);
      let missing = '', why = '';
      try {
        let text = '';
        for await (const chunk of complete({messages: [{role: 'system', content: MATERIAL_CHECK_GUIDE}, {role: 'user', content: JSON.stringify({ask: String(ask).slice(0, 400), have: have.slice(0, 16).map(name => String(name).slice(0, 40))})}], signal: controller.signal})) text += chunk;
        const found = JSON.parse(text.match(/\{[^{}]*\}/u)?.[0] ?? '{}').missing;
        missing = typeof found === 'string' ? found.trim().slice(0, 30) : '';
      } catch { why = controller.signal.aborted ? 'timeout' : 'failed'; }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      audit({type: 'media.material-check', missing: Boolean(missing), ...(why ? {why} : {}), durationMs: now() - started});
      return missing;
    },
  };
}
