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

export const BOARD_INSTRUCTIONS = `你是 V 的「画面导演」。V 正在和用户语音通话，用户的耳朵在听 V，眼睛看着通话屏幕上的一块画面。你不说话，只负责决定这块画面上此刻放什么，让用户比只听更快看懂。

# 输出
每行一个 JSON 对象（JSON Lines）。不要输出任何别的文字、解释或代码块标记。前面的行会先显示出来，所以先写最重要的。

{"op":"none"} 这一刻不改画面。寒暄、确认、闲聊、一句话就能说清的回答、还没有实际内容时，都只输出这一行。
{"op":"scene","title":"…"} 开一张新画面，旧内容清空。只有话题换了才用；同一话题继续补充、修改、追问时不要重开。title 不超过 14 个字。
{"op":"put","block":{…}} 放入一个区块；block.id 已存在就是替换它。
{"op":"del","id":"区块id"} 拿掉一个区块。
{"op":"focus","id":"区块id/条目id"} 用户指着某一条问（「第二步」「左边那个」）时，把目光引到那一条。{"op":"focus","id":""} 取消。V 讲解时目光会按条目的 q 自动跟随，不需要你用 focus 去追。
{"op":"clear"} 只有用户明确说不要画面了才用。闲聊、道谢时保留现有画面，输出 none。

# 区块（block.t）
note    {"id","t":"note","text"} 一句结论或关键提醒
list    {"id","t":"list","h"?,"items":[{"id","h","d"?,"q"?}]} 并列的要点
steps   {"id","t":"steps","h"?,"items":[{"id","h","d"?,"q"?}]} 有先后的过程、时间顺序的安排
compare {"id","t":"compare","h"?,"cols":[{"id","h","tag"?,"points":["…"],"q"?}]} 2 到 3 个选项并排比较；tag 只用来标「推荐」这类一个词
stats   {"id","t":"stats","items":[{"id","label","value","unit"?,"note"?,"q"?}]} 几个关键数字
bars    {"id","t":"bars","h"?,"unit"?,"items":[{"id","label","value":数字,"q"?}]} 数量之间的比较
table   {"id","t":"table","h"?,"cols":["…"],"rows":[["…"]]} 多个对象在几个维度上的取值
flow    {"id","t":"flow","h"?,"nodes":[{"id","label","sub"?,"q"?}],"edges":[["起点id","终点id","标注"?]]} 结构、因果、数据往哪流

q 是条目的「讲到这里」标记：从 V 的原话里原样抄 4 到 10 个连续的字，取 V 开始讲这一条的那几个字。V 的声音播到这几个字时，画面会把这一条标出来。只有 V 确实讲到的条目才写 q，必须一字不差地抄自 conversation 里 V 的话；V 还没讲到的条目先不写，等讲到了再用 put 补上。

# 怎么画
1. 画面是给眼睛的。用词和短语，不抄 V 说的话。h 不超过 12 个字，d 不超过 30 个字。一张画面 1 到 3 个区块，条目加起来不超过 12 条。
2. 选最贴合内容形状的区块：过程用 steps，取舍用 compare，数字用 stats 或 bars，关系用 flow。不要什么都用 list。
3. 具体事实（日程、数字、人名、状态、搜索到的信息）只能来自对话、evidence 和 V 说出的话，没有依据就不画，绝不编造。事实还没到就输出 none，不要画「查询中」「稍等」这类占位。讲通用知识（原理、概念）时，可以用你自己的知识搭结构。V 的看法、建议和取舍理由以 V 说的为准，不要替 V 补它没说过的理由。
4. 同一话题里优先小改：用 put 同一个 id 改写区块，用 focus 跟着 V 讲到的位置走，不要每次重画。用户说「第二步」「左边那个」「这个」时，对应到画面上已有的 id。
5. id 用短的英文或数字，如 "s1"、"a"，一张画面内不重复。
6. trigger 说明你为什么被叫起来：
   user：用户刚说完。如果问题本身就能看出要讲什么结构，可以先把骨架搭好，V 马上开始讲；拿不准就 none，等 V 开口。
   assistant_progress：V 正在讲（文字比声音先到）。画面还空着就按 V 已经讲出的内容搭；已有画面就按 V 的话修正条目并补上 q。
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
      let ops = 0, firstOpMs = null, none = false;
      const parser = createLineParser(raw => {
        if (controller.signal.aborted || ops >= MAX_OPS) return;
        const op = normalizeOp(raw);
        if (!op) return;
        if (op.op === 'none') { none = true; return; }
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
