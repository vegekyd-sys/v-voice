// Lesson mode for the call board (experiment). Where the director draws after
// the fact from what V happened to say, a lesson is written in one piece: one
// model call produces what V will say and what appears on the page for each
// sentence, so the two cannot disagree. V then speaks the script verbatim and
// the page reveals each piece when the audio reaches the words it hangs on.
import {BOARD_INSTRUCTIONS} from './board-director.mjs';
import {applyOp, emptyScene, loose, normalizeOp} from './board-scene.mjs';

const pieces = BOARD_INSTRUCTIONS.slice(BOARD_INSTRUCTIONS.indexOf('# 区块（block.t）'), BOARD_INSTRUCTIONS.indexOf('# 怎么画'));
export const LESSON_INSTRUCTIONS = `你是 V。用户在电话里请你讲解一个东西，你要一次写出「讲稿」和「讲稿每一句对应的画面」。讲稿会由你的声音一字不差地念出来；画面在一页手账上，念到哪里，挂在那里的东西就出现在页面上。

输入是一个 JSON：topic 是要讲什么；audience 是讲给谁听；ask 是用户的原话（语音识别，可能夹着旁人的话，只取和 topic 有关的要求）；reference 是可靠的参考资料（有的话），和它冲突的不要讲；before 是这通电话里你刚讲过的一段（有的话）：这次要接着它讲新的东西，或者按用户的要求换个讲法，不要原样重复，例子、比方和最后的问题都换新的。

只输出一个 JSON 对象，不要任何别的文字：
{"title":"画面标题，不超过 12 个字","say":["第一句","第二句",…],"blocks":[区块,…]}

# 讲稿 say
- 口语，像当面讲给对方听。6 到 10 句，每句不超过 32 个字，一句只讲一件事。
- 第一句直接进入内容，不要「好的」「我来讲讲」。
- 用具体的东西讲，不用抽象的类别讲。讲的是一类看得见的东西（宝可梦、动物、车、食物、建筑）时，每个类别挑一个对方认识的代表，讲稿里叫它的名字，让它做一件看得见的事：说「杰尼龟一喷水，小火龙尾巴上的火就灭了」，不说「水属性克制火属性」。类别的名字最多带一下（「杰尼龟是水系的」）。
- 讲对、讲全。讲的是谁克谁、谁变成谁、先后顺序这类关系时，画面上每一条关系在讲稿里都要有一句明确讲到，方向不能反；画了 A 克 B、B 克 C、C 克 A 的圈，就要三条各讲一句。拿不准某个角色是什么、某条关系对不对，就换成你有把握的角色和关系；宁可少讲一条，不要讲错。不是什么都能凑成一个圈：只有每一条你都有把握时才画成圈，否则讲两三条有把握的单向关系。拿不准的数字不要写。
- 讲稿里提到的每个要点，画面上都应该有对应的东西；画面上有的东西，讲稿里都要叫到它的名字。
- 收尾只用一句：一句小结，或者一个让对方接话的问题。用问题收尾时，问题就是最后一句，问完就停，不要再加「听懂了吗」。

# 讲给小朋友（audience 里有「岁」「小朋友」「孩子」）
- 5 到 8 句，每句不超过 22 个字。只用他见过的东西打比方（石头剪刀布、浇水、吹蜡烛）。不用「属性」「克制」「机制」「倍率」这样的词，说「打得过」「怕」「赢」。
- 知道他的名字就在第一句叫他。最后让他猜一个刚讲过就能答的问题。
- 画面几乎全是图：每个东西一张图，字只写名字。

${pieces}
# 画面怎么挂到讲稿上
- 每个条目、节点、比较项都要写 q；便签和照片这样的整块也要写 q。q 是 say 里的 4 到 8 个字，一字不差，从讲稿第一次叫到这个东西的名字的地方开始抄。念到那里时这个东西出现。
- 画面出现的顺序就是讲的顺序。第一句念出来时页面上必须已经有东西：给第一句挂一张主图（photo）或第一个节点。
- 讲的东西本身有样子（一枚火箭、一种积木、一座建筑、一个角色），就用 photo 放一张它的照片作主图，query 写它最通用的名字（「猎鹰9号」「乐高积木」），挂在第一次叫到它的那一句。img 和 query 都只写能搜到图的专有名字，不写「木工坊」「注塑机」这样的泛称。
- 条目和节点的名字（h、label）就是讲稿里叫的那个具体的东西（「杰尼龟」），并写 img 配上它的图；抽象的词（「水」）只能当它的小字说明（sub 或 d）。
- 能配图的东西都配 img（角色、动物、地点、产品、食物、人物）；互相克制、循环、流向用 flow，把图放在节点上。flow 的边写成 ["起点id","终点id","两三个字的标注","q"]：标注像「打得过」「克」「变成」，第四项 q 是讲稿里讲到这条关系的那几个字，念到那里箭头才画出来。
- 便签只写一句值得记住的话。不要写还没发生的事（「你猜对了」），也不要提前写出你最后那个问题的答案。
- 字要少：h 不超过 8 个字，d 不超过 16 个字，能不写 d 就不写。整页 1 到 3 个区块。`;

// Facts the quick models get wrong often enough to matter, handed over when
// the topic calls for them. (Asked for legendary birds, one had ice beating
// fire, another made up a ring of three.)
const REFERENCES = [{match: /宝可梦|神奇宝贝|宠物小精灵|pok[eé]mon/iu, text: `宝可梦属性克制表（攻击方：打它们效果拔群）。只讲表里有的关系，表里没有就不是克制。
火：草、冰、虫、钢｜水：火、地面、岩石｜电：水、飞行｜草：水、地面、岩石｜冰：草、地面、飞行、龙｜格斗：一般、冰、岩石、恶、钢｜毒：草、妖精｜地面：火、电、毒、岩石、钢｜飞行：草、格斗、虫｜超能力：格斗、毒｜虫：草、超能力、恶｜岩石：火、冰、飞行、虫｜幽灵：超能力、幽灵｜龙：龙｜恶：超能力、幽灵｜钢：冰、岩石、妖精｜妖精：格斗、龙、恶｜一般：没有
完全无效：一般和格斗打幽灵、电打地面、地面打飞行、幽灵打一般、超能力打恶、毒打钢、龙打妖精。
先确认每只宝可梦自己的属性（有两个属性的两个都算），再查表。`}];
export const lessonReference = text => REFERENCES.filter(item => item.match.test(String(text ?? ''))).map(item => item.text).join('\n');

const sentences = value => (Array.isArray(value) ? value : []).map(line => String(line ?? '').replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, 12).map(line => Array.from(line).slice(0, 60).join(''));
const asks = line => /[？?]\s*$/u.test(line);
const targets = block => block.t === 'compare' ? block.cols : block.t === 'flow' ? block.nodes : block.items ?? [];
// 凯旋门 is 巴黎凯旋门 under a shorter name; 火 is not 小火龙.
const sameThing = (name, picture) => name.includes(picture) || name.length >= 3 && picture.includes(name);

/**
 * Tie a lesson's picture to its script by what the script really says, rather
 * than by what the model claimed: every piece hangs on the place its own name
 * is first spoken, so a thing appears as it is named and never on a sentence
 * about something else. Also puts the named thing, not its category, in the
 * heading when the model did it the other way round.
 */
export function settleLesson({say: lines, ops}) {
  const say = lines.slice();
  // One closing line: a question followed by "did you get it?" loses the second.
  while (say.length > 3 && asks(say.at(-1)) && asks(say.at(-2))) say.pop();
  // Positions are counted in the letters the page compares (no spaces or punctuation).
  const starts = [];
  let script = '';
  for (const line of say) { starts.push(script.length); script += loose(line); }
  const sentenceOf = at => { let index = 0; while (index + 1 < starts.length && starts[index + 1] <= at) index++; return index; };
  const find = (words, from = 0) => { const key = loose(String(words ?? '')); return key.length >= 2 ? script.indexOf(key, from) : -1; };
  // The words to quote for a position: long enough to be found, and starting
  // where their first four letters occur nowhere earlier (the page looks for those).
  const quoteAt = at => {
    for (const start of [at, at - 1, at - 2, at - 3]) {
      if (start < 0) break;
      if (script.indexOf(script.slice(start, start + 4)) === start) return script.slice(start, start + 8);
    }
    return script.slice(at, at + 8);
  };
  const whereOf = new Map();
  const blocks = ops.filter(op => op.op === 'put').map(op => {
    const block = structuredClone(op.block);
    const heading = block.t === 'flow' ? 'label' : 'h', small = block.t === 'flow' ? 'sub' : 'd';
    for (const item of targets(block)) {
      const name = loose(String(item[heading] ?? '')), picture = loose(String(item.img ?? ''));
      // "水 / 喷水的杰尼龟 / img 杰尼龟" becomes "杰尼龟 / 水": the page shows the thing the script names.
      if (picture && name && !sameThing(name, picture) && find(picture) >= 0 && (block.t === 'flow' || name.length <= 3)) {
        const was = item[heading], note = String(item[small] ?? '');
        item[heading] = item.img;
        item[small] = !note || loose(note).includes(picture) ? was : Array.from(`${was} · ${note}`).slice(0, 24).join('');
      }
      const named = find(item[heading]), quoted = find(item.q), pictured = find(item.img);
      const at = named >= 0 ? named : quoted >= 0 ? quoted : pictured;
      if (at >= 0) item.q = quoteAt(at); else delete item.q;
      whereOf.set(`${block.id}/${item.id}`, at);
    }
    if (block.t === 'flow') block.edges = block.edges.map(([from, to, label, said]) => {
      const after = Math.max(whereOf.get(`${block.id}/${from}`) ?? -1, whereOf.get(`${block.id}/${to}`) ?? -1, 0);
      const names = id => { const node = block.nodes.find(item => item.id === id); return [node.label, node.sub, node.img].map(value => loose(String(value ?? ''))).filter(Boolean); };
      // Its own quote when that is really in the script; else the first sentence,
      // from the one that introduces its later end, that speaks of both ends.
      let at = find(said);
      if (at < 0) for (let index = sentenceOf(after); index < say.length && at < 0; index++) {
        const line = loose(say[index]);
        const first = list => Math.min(...list.map(name => line.indexOf(name)).filter(found => found >= 0), Infinity);
        const a = first(names(from)), b = first(names(to));
        if (a < Infinity && b < Infinity && a !== b) at = starts[index] + Math.max(a, b);
      }
      return at >= 0 && at > after ? [from, to, label, quoteAt(at)] : [from, to, label];
    });
    // A whole block (photo, sticky) keeps a quote that is really there; else a
    // photo comes with the first sentence and a sticky with the closing one.
    if ('q' in block || block.t === 'photo' || block.t === 'sticky' || block.t === 'note') {
      const at = find(block.q);
      // (Not on a closing question: a note beside it reads as the answer.)
      const closing = say.findLastIndex(line => !asks(line));
      block.q = quoteAt(at >= 0 ? at : block.t === 'photo' ? 0 : starts[closing >= 0 ? closing : say.length - 1]);
    }
    return {op: 'put', block};
  });
  return {say, ops: [...ops.filter(op => op.op !== 'put'), ...blocks]};
}

/** Read the model's reply into {title, say, ops}; null when it is not a usable lesson. */
export function parseLesson(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const say = sentences(value?.say);
  const title = String(value?.title ?? '').trim();
  const ops = [normalizeOp({op: 'scene', title, lesson: true}), ...(Array.isArray(value?.blocks) ? value.blocks : []).map(block => normalizeOp({op: 'put', block}))].filter(Boolean);
  return say.length >= 2 && ops.length >= 2 ? {title, ...settleLesson({say, ops})} : null;
}

/**
 * `complete({messages, signal})` yields text chunks (the director's client).
 * `director.present(owner, ops, holdMs)` puts the lesson on the call's board.
 */
export function createLessonWriter({complete, fallback = null, director, now = Date.now, record = () => {}, attemptMs = 7000, totalMs = 12000} = {}) {
  // What each call was last told, so a second lesson builds on the first.
  const told = new Map();
  return {
    available: Boolean(complete && director),
    /** Returns the script to speak, or null when no lesson could be written. `ask` is the caller's own words. */
    async prepare({owner, topic, audience = '', ask = '', signal} = {}) {
      const started = now();
      // The director stops at once: a picture it was about to draw for the
      // same question would flash by before the lesson arrives.
      director.hold?.(owner);
      const before = told.get(owner);
      const messages = [{role: 'system', content: LESSON_INSTRUCTIONS},
        {role: 'user', content: JSON.stringify({topic: String(topic ?? '').slice(0, 400), audience: String(audience ?? '').slice(0, 80) || '成年人',
          ...(ask ? {ask: Array.from(String(ask)).slice(-300).join('')} : {}), ...(before ? {before} : {}),
          ...(lessonReference(`${topic} ${ask}`) ? {reference: lessonReference(`${topic} ${ask}`)} : {})})}];
      let lesson = null, text = '', failure = '';
      // The preferred writer first; if it gives nothing usable, the director's own model.
      // The caller is waiting in silence: one writer gets seven seconds, both
      // together twelve (a slow one once kept a call waiting for thirty-three).
      for (const write of [complete, fallback].filter(Boolean)) {
        text = ''; failure = '';
        const left = Math.min(attemptMs, totalMs - (now() - started));
        if (left < Math.min(1500, attemptMs)) break;
        const limit = new AbortController(), stop = () => limit.abort(), timer = setTimeout(stop, left);
        if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, {once: true});
        try { for await (const chunk of write({signal: limit.signal, messages})) text += chunk; } catch (error) { failure = String(error?.message ?? error).slice(0, 240); }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
        lesson = parseLesson(text);
        if (lesson) break;
        record({type: 'board.lesson-attempt', voiceSessionId: owner, ok: false, failure, chars: text.length, head: text.slice(0, 160)});
      }
      const say = lesson?.say.join('');
      record({type: 'board.lesson', voiceSessionId: owner, topic, audience, ask, ok: Boolean(lesson), durationMs: now() - started, say: lesson?.say ?? null, drawn: lesson?.ops ?? null});
      if (!lesson) { director.release?.(owner); return null; }
      told.delete(owner); told.set(owner, {title: lesson.title, say});
      while (told.size > 200) told.delete(told.keys().next().value);
      // Held for as long as the script takes to say (about five characters a second), plus a margin.
      director.present(owner, lesson.ops, Math.round(Array.from(say).length / 5 * 1000) + 8000);
      return {say, sentences: lesson.say};
    },
  };
}
export const emptyLessonScene = () => applyOp(emptyScene(), {op: 'scene', title: '', lesson: true});
