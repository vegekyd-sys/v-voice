// Lesson mode for the call board (experiment). Where the director draws after
// the fact from what V happened to say, a lesson is written in one piece: one
// model call produces what V will say and what appears on the page for each
// sentence, so the two cannot disagree. V then speaks the script verbatim and
// the page reveals each piece when the audio reaches the sentence it hangs on.
import {BOARD_INSTRUCTIONS} from './board-director.mjs';
import {applyOp, emptyScene, normalizeOp} from './board-scene.mjs';

const pieces = BOARD_INSTRUCTIONS.slice(BOARD_INSTRUCTIONS.indexOf('# 区块（block.t）'), BOARD_INSTRUCTIONS.indexOf('# 怎么画'));
export const LESSON_INSTRUCTIONS = `你是 V。用户在电话里请你讲解一个东西，你要一次写出「讲稿」和「讲稿每一句对应的画面」。讲稿会由你的声音一字不差地念出来；画面在一页手账上，念到哪一句，那一句挂着的东西就出现在页面上。

只输出一个 JSON 对象，不要任何别的文字：
{"title":"画面标题，不超过 12 个字","say":["第一句","第二句",…],"blocks":[区块,…]}

# 讲稿 say
- 口语，像当面讲给对方听。6 到 10 句，每句不超过 32 个字，一句只讲一件事。
- 按 audience 调整：给小朋友讲就用他认识的东西打比方，句子更短，不用术语。
- 第一句直接进入内容，不要「好的」「我来讲讲」。最后一句收个尾，可以问一句听懂没有。
- 讲稿里提到的每个要点，画面上都应该有对应的东西；画面上有的东西，讲稿里都要讲到。

${pieces}
# 画面怎么挂到讲稿上
- 每个条目、节点、比较项都要写 q；便签和照片这样的整块也要写 q。q 是 say 里某一句开头的 4 到 8 个字，一字不差。念到那一句时这个东西出现。
- 画面出现的顺序就是讲的顺序。第一句就要有东西出现（通常是主图或第一个条目）。
- 讲的是一类看得见的东西（宝可梦、动物、车、食物）时，用具体的、对方认识的代表来讲：讲稿里叫它的名字（「杰尼龟喷水」而不是「水属性」），画面上的条目或节点就是它，并写 img 配上它的图。抽象的词只能当它的小字说明（sub 或 d）。
- 能配图的东西都配 img（角色、动物、地点、产品、食物）；互相克制、循环、流向用 flow，把图放在节点上。
- 第一句念出来时页面上必须已经有东西：给第一句挂一张主图（photo）或一张便签。
- 字要少：h 不超过 8 个字，d 不超过 16 个字，能不写 d 就不写。整页 1 到 3 个区块。
- 具体事实只写你有把握的；拿不准的数字不要写。`;

const sentences = value => (Array.isArray(value) ? value : []).map(line => String(line ?? '').replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, 12).map(line => Array.from(line).slice(0, 60).join(''));
/** Read the model's reply into {title, say, ops}; null when it is not a usable lesson. */
export function parseLesson(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const say = sentences(value?.say);
  const ops = [normalizeOp({op: 'scene', title: value?.title, lesson: true}), ...(Array.isArray(value?.blocks) ? value.blocks : []).map(block => normalizeOp({op: 'put', block}))].filter(Boolean);
  return say.length >= 2 && ops.length >= 2 ? {say, ops} : null;
}

/**
 * `complete({messages, signal})` yields text chunks (the director's client).
 * `director.present(owner, ops, holdMs)` puts the lesson on the call's board.
 */
export function createLessonWriter({complete, fallback = null, director, now = Date.now, record = () => {}} = {}) {
  return {
    available: Boolean(complete && director),
    /** Returns the script to speak, or null when no lesson could be written. */
    async prepare({owner, topic, audience = '', signal} = {}) {
      const started = now();
      const messages = [{role: 'system', content: LESSON_INSTRUCTIONS},
        {role: 'user', content: JSON.stringify({topic: String(topic ?? '').slice(0, 200), audience: String(audience ?? '').slice(0, 80) || '成年人'})}];
      let lesson = null, text = '', failure = '';
      // The preferred writer first; if it gives nothing usable, the director's own model.
      for (const write of [complete, fallback].filter(Boolean)) {
        text = '';
        try { for await (const chunk of write({signal, messages})) text += chunk; } catch (error) { failure = String(error?.message ?? error).slice(0, 120); }
        lesson = parseLesson(text);
        if (lesson) break;
        record({type: 'board.lesson-attempt', voiceSessionId: owner, ok: false, failure, chars: text.length, head: text.slice(0, 160)});
      }
      const say = lesson?.say.join('');
      record({type: 'board.lesson', voiceSessionId: owner, topic, audience, ok: Boolean(lesson), durationMs: now() - started, say: lesson?.say ?? null, drawn: lesson?.ops ?? null});
      if (!lesson) return null;
      // Held for as long as the script takes to say (about five characters a second), plus a margin.
      director.present(owner, lesson.ops, Math.round(Array.from(say).length / 5 * 1000) + 8000);
      return {say, sentences: lesson.say};
    },
  };
}
export const emptyLessonScene = () => applyOp(emptyScene(), {op: 'scene', title: '', lesson: true});
