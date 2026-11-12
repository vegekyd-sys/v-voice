// The board director: a text model that watches a call and keeps a picture of
// it on the caller's screen. It runs beside the voice model, never in its
// audio path, and has no tools, permissions or say in what V does. Its output
// is validated line by line (board-scene.mjs) before anything reaches a page.
import {applyOp, createLineParser, emptyScene, normalizeOp, sceneDigest} from './board-scene.mjs';

export const BOARD_TRIGGERS = Object.freeze(['user', 'assistant_progress', 'assistant_end', 'evidence']);
// Results of these lookups are facts the picture may show. Command output,
// device calls and control tools are not evidence.
const EVIDENCE_TOOLS = new Set(['web_search', 'web_fetch', 'memory_search', 'feishu_calendar', 'lark_read', 'delegate_to_v', 'current_time']);
const MAX_EVIDENCE = 4, EVIDENCE_CHARS = 3000, MAX_OPS = 24, OWNER_TTL_MS = 30 * 60000;

export const BOARD_INSTRUCTIONS = `你是 V 的「画面导演」。V 正在和用户语音通话，用户的耳朵在听 V，眼睛看着通话屏幕上的一页手账：V 一边讲，一边在上面写字、贴便签、贴照片，用笔圈重点。你不说话，只负责决定这一页上此刻放什么，让用户比只听更快看懂，也看得有意思。

# 输出
每行一个 JSON 对象（JSON Lines）。不要输出任何别的文字、解释或代码块标记。前面的行会先显示出来，所以先写最重要的。

{"op":"none"} 这一刻不改画面。寒暄、确认、闲聊、一句话就能说清的回答、还没有实际内容时，都只输出这一行。
{"op":"scene","title":"…"} 开一张新画面。只有话题换了才用；同一话题继续补充、修改、追问时不要重开，也不要为了改内容把同一张重画一遍。旧画面会留到新画面的第一个区块出现为止，所以 scene 后面要紧跟 put；内容还没到就先不要 scene。title 不超过 14 个字。
{"op":"put","block":{…}} 放入一个区块；block.id 已存在就是替换它。
{"op":"del","id":"区块id"} 拿掉一个区块。
{"op":"focus","id":"区块id/条目id"} 用户指着某一条问（「第二步」「左边那个」）时，把目光引到那一条。{"op":"focus","id":""} 取消。V 讲解时目光会按条目的 q 自动跟随，不需要你用 focus 去追。
{"op":"clear"} 只有用户明确说不要画面了才用。闲聊、道谢时保留现有画面，输出 none。

# 区块（block.t）
steps   {"id","t":"steps","h"?,"items":[条目]} 有先后的过程、时间顺序的安排
list    {"id","t":"list","h"?,"items":[条目]} 并列的要点
compare {"id","t":"compare","h"?,"cols":[{"id","h","tag"?,"points":["…"],"icon"?,"mark"?,"q"?}]} 2 到 3 个选项，每个一张纸并排；tag 是盖在上面的一个词，如「推荐」
stats   {"id","t":"stats","items":[{"id","label","value","unit"?,"note"?,"mark"?,"q"?}]} 几个关键数字，写得很大
bars    {"id","t":"bars","h"?,"unit"?,"items":[{"id","label","value":数字,"q"?}]} 数量之间的比较
table   {"id","t":"table","h"?,"cols":["…"],"rows":[["…"]]} 多个对象在几个维度上的取值
flow    {"id","t":"flow","h"?,"nodes":[{"id","label","sub"?,"icon"?,"q"?}],"edges":[["起点id","终点id","标注"?]]} 有分叉、汇合或回路的关系
sticky  {"id","t":"sticky","text","tone"?} 贴在页边的便签：一句结论、提醒，或 V 的一句小评语，不超过 30 个字
photo   {"id","t":"photo","query","caption"?} 一张真实照片，贴在页边

条目是 {"id","h","d"?,"icon"?,"mark"?,"q"?}。

icon：一个贴切的 emoji，放在条目前面。具体的事物、动作、类别适合配；配不出贴切的就不写，不要拿 ✅📌💡 这类万能符号凑数。
mark：V 的笔在这一条上留下的记号。ring 圈出最关键的那一个（结论、最大的数字、推荐的选项）；underline 划重点；check 表示对的、推荐的、已完成的；cross 表示错的、不推荐的、没完成的；star 特别值得注意。一张画面里 mark 最多 3 个，圈得多就没有重点了。
tone：给区块换一张彩色纸，butter、peach、sky、lilac、blush 之一。sticky 默认是 butter。
q：条目的「讲到这里」标记。从 V 的原话里原样抄 4 到 10 个连续的字，取 V 开始讲这一条的那几个字。V 的声音播到这几个字时，这一条会从铅笔变成墨水，笔迹也在这时画上去。只有 V 确实讲到的条目才写 q，必须一字不差地抄自 conversation 里 V 的话；V 还没讲到的条目先不写，等讲到了再用 put 补上。

photo 只用于大家都认识、百科里查得到的具体事物：地标、城市、公众人物、动物、名画、产品、历史事件。query 写它的通用名称（如「埃菲尔铁塔」「大熊猫」）。抽象概念、流程、软件里的东西、用户身边的人和私事不要配照片。一张画面最多一张，话题就是这个事物时才配。

# 怎么画
1. 画面是给眼睛的，要像 V 随手记在本子上的：有重点，有一点俏皮，不是汇报材料。用词和短语，不抄 V 说的话。h 不超过 12 个字，d 不超过 30 个字。一张画面 1 到 3 个区块，条目加起来不超过 12 条；追问展开时超出了，就 del 掉已经讲完、不再需要的区块。
2. 选最贴合内容形状的区块：有先后的过程用 steps，取舍用 compare，数字用 stats 或 bars；flow 只用于有分叉、汇合或回路的关系，一条直线的顺序用 steps。不要什么都用 list。主区块之外，常常值得再贴一张 sticky 写结论。用户问「哪个更好」「选哪个」「A 还是 B」，而 V 讲了两边各自的理由时，新开一张 compare，V 倾向的一边加 tag。
3. 具体事实（日程、数字、人名、状态、搜索到的信息）只能来自对话、evidence 和 V 说出的话，没有依据就不画，绝不编造。事实还没到就输出 none，不要画「查询中」「稍等」这类占位。讲通用知识（原理、概念）时，可以用你自己的知识搭结构。V 的看法、建议和取舍理由以 V 说的为准，不要替 V 补它没说过的理由。
4. 同一话题里优先小改：用 put 同一个 id 改写区块，用 focus 跟着 V 讲到的位置走，不要每次重画。用户说「第二步」「左边那个」「这个」时，对应到画面上已有的 id。
5. id 用短的英文或数字，如 "s1"、"a"，一张画面内不重复。
6. trigger 说明你为什么被叫起来：
   user：用户刚说完，V 还没开口。只有问的是通用知识的讲解（原理、流程、概念），才可以先把骨架搭好。问 V 的看法、建议、怎么选，或者问的是用户自己的事（日程、项目、状态），一律 none，等 V 说了再画，不要替 V 先下结论。
   assistant_progress：V 正在讲，话还不完整（文字比声音先到）。画面空着就按 V 已经讲出的内容搭；已有画面就只修正当前这张的条目、补上 q。这时不要 scene 换画面：V 可能只是顺口举了个例子。
   assistant_end：V 的话已经完整。核对画面和 V 实际说的是否一致，有出入就改成 V 说的，给讲到的条目补齐 q；都对就 none。
   evidence：工具结果或后台结果刚到，把里面值得看的事实放上去。`;

const bounded = (value, limit) => Array.from(String(value ?? '')).slice(-limit).join('');
const evidenceText = result => {
  if (result == null || result?.cancelled === true || typeof result?.error === 'string') return '';
  if (typeof result === 'string') return result;
  const blocks = Array.isArray(result?.output?.content) ? result.output.content : Array.isArray(result?.content) ? result.content : null;
  if (blocks) return blocks.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n');
  if (typeof result?.result === 'string') return result.result;
  try { return JSON.stringify(result); } catch { return ''; }
};

/** Build the user message for one run. Everything in it is conversation data. */
export function boardRequest({trigger, scene, turns, evidence}) {
  return JSON.stringify({
    trigger,
    screen: sceneDigest(scene) ?? '（画面现在是空的）',
    ...(evidence.length ? {evidence: evidence.map(item => ({tool: item.name, result: item.text}))} : {}),
    conversation: turns,
  });
}

/**
 * One director per service. `complete({messages, signal})` yields text chunks.
 * Each owner (a voice session) has its own scene; a new run for the same owner
 * retires the one still writing.
 */
export function createBoardDirector({complete, now = Date.now, audit = () => {}, maxOwners = 64} = {}) {
  const owners = new Map();
  const owner = id => {
    let row = owners.get(id);
    if (!row) {
      const drop = key => { owners.get(key).controller?.abort(); owners.delete(key); };
      for (const [key, old] of owners) if (now() - old.touched >= OWNER_TTL_MS) drop(key);
      while (owners.size >= maxOwners) drop(owners.keys().next().value);
      row = {scene: emptyScene(), evidence: [], controller: null, window: now(), count: 0, touched: now()};
      owners.set(id, row);
    }
    row.touched = now();
    return row;
  };
  return {
    available: Boolean(complete),
    /** Tap on the service audit stream; keeps the latest lookup results per call. */
    observe(event) {
      if (event?.type !== 'tool.delivered' || !EVIDENCE_TOOLS.has(event.name) || typeof event.voiceSessionId !== 'string') return;
      const value = evidenceText(event.result).trim();
      if (!value) return;
      const row = owner(event.voiceSessionId);
      row.evidence.push({name: event.name, text: Array.from(value).slice(0, EVIDENCE_CHARS).join(''), at: now()});
      while (row.evidence.length > MAX_EVIDENCE) row.evidence.shift();
    },
    scene(id) { return owners.get(id)?.scene ?? emptyScene(); },
    /**
     * Run the director once. `onOp` receives each applied operation with the
     * scene revision it produced; a page whose revision differs from the
     * service's first receives the whole scene.
     */
    async run({owner: id, trigger, turns, clientRev = 0, onOp = () => {}, signal} = {}) {
      const started = now(), row = owner(id);
      const report = (reason, extra = {}) => { const result = {reason, durationMs: now() - started, ...extra}; audit({type: 'board.run', voiceSessionId: id, trigger, ...result}); return result; };
      if (!complete) return report('unavailable');
      if (now() - row.window > 15 * 60000) { row.window = now(); row.count = 0; }
      if (++row.count > 400) return report('rate_limited');
      row.controller?.abort();
      const controller = row.controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
      if (clientRev !== row.scene.rev) onOp({op: 'sync', scene: row.scene});
      let ops = 0, firstOpMs = null, none = false, retired = false;
      const parser = createLineParser(raw => {
        if (controller.signal.aborted || ops >= MAX_OPS) return;
        const op = normalizeOp(raw);
        if (!op || retired) return;
        if (op.op === 'none') { none = true; return; }
        // A half-finished sentence is not grounds for replacing the picture;
        // whatever the model meant to draw on the new one is dropped with it.
        if (trigger === 'assistant_progress' && op.op === 'scene' && row.scene.blocks.length && op.title !== row.scene.title) { retired = true; none = true; return; }
        const next = applyOp(row.scene, op);
        if (next === row.scene) return;
        row.scene = next; ops++; firstOpMs ??= now() - started;
        onOp({...op, rev: next.rev});
      });
      try {
        const messages = [{role: 'system', content: BOARD_INSTRUCTIONS},
          {role: 'user', content: boardRequest({trigger, scene: row.scene, turns, evidence: row.evidence})}];
        for await (const chunk of complete({messages, signal: controller.signal})) {
          if (controller.signal.aborted) break;
          parser.feed(chunk);
        }
        if (!controller.signal.aborted) parser.end();
        return report(controller.signal.aborted ? 'superseded' : ops ? 'drawn' : none ? 'none' : 'empty', {ops, firstOpMs, rev: row.scene.rev});
      } catch {
        return report(controller.signal.aborted ? 'superseded' : 'provider_failed', {ops, firstOpMs, rev: row.scene.rev});
      } finally {
        signal?.removeEventListener('abort', abort);
        if (row.controller === controller) row.controller = null;
      }
    },
    forget(id) { owners.get(id)?.controller?.abort(); owners.delete(id); },
  };
}

/** Validate a page's board request. Returns bounded context or null. */
export function boundedBoardRequest(params) {
  if (!BOARD_TRIGGERS.includes(params?.trigger) || !Number.isSafeInteger(params.rev) || params.rev < 0
    || !Array.isArray(params.turns) || !params.turns.length || params.turns.length > 8) return null;
  const turns = [];
  for (const turn of params.turns) {
    if (!['user', 'assistant', 'document'].includes(turn?.role) || typeof turn.text !== 'string' || !turn.text.trim() || turn.text.length > 2000) return null;
    turns.push({role: turn.role, text: bounded(turn.text.trim(), turn.role === 'document' ? 2000 : 800)});
  }
  return {trigger: params.trigger, clientRev: params.rev, turns};
}

/** Streaming OpenAI-compatible chat completion; yields text deltas. */
export function createChatCompletionStream({apiKey, model, endpoint, extra = {}, fetchImpl = fetch, timeoutMs = 20000, maxTokens = 900}) {
  return async function* complete({messages, signal}) {
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {method: 'POST', signal: controller.signal,
        headers: {authorization: `Bearer ${apiKey}`, 'content-type': 'application/json'},
        body: JSON.stringify({model, messages, stream: true, temperature: 0.3, max_tokens: maxTokens, ...extra})});
      if (!response.ok || !response.body) throw Error('board model HTTP ' + response.status);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, {stream: true});
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          let delta;
          try { delta = JSON.parse(data)?.choices?.[0]?.delta?.content; } catch { continue; }
          if (typeof delta === 'string' && delta) yield delta;
        }
      }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}

/**
 * Off unless VOICE_BOARD=1 and a model credential is provisioned. A DeepSeek
 * key talks to DeepSeek directly; otherwise the service's existing OpenRouter
 * key is used. Either way the director must answer without a thinking phase:
 * the picture has about a second to appear.
 */
export function boardCompletionFromEnv(env = process.env, {fetchImpl} = {}) {
  if (env.VOICE_BOARD !== '1') return null;
  const direct = env.VOICE_BOARD_API_KEY ?? env.DEEPSEEK_API_KEY;
  const provider = direct
    ? {apiKey: direct, endpoint: env.VOICE_BOARD_ENDPOINT ?? 'https://api.deepseek.com/chat/completions',
      model: env.VOICE_BOARD_MODEL ?? 'deepseek-flash', extra: {thinking: {type: 'disabled'}}}
    : env.OPENROUTER_API_KEY
      ? {apiKey: env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: env.VOICE_BOARD_MODEL ?? 'deepseek/deepseek-v4.1-flash', extra: {reasoning: {enabled: false}}}
      : null;
  return provider ? createChatCompletionStream({...provider, fetchImpl}) : null;
}
export function boardDirectorFromEnv(env = process.env, {audit, fetchImpl} = {}) {
  const complete = boardCompletionFromEnv(env, {fetchImpl});
  return complete ? createBoardDirector({audit, complete}) : null;
}
