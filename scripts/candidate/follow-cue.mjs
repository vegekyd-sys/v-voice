// The cue illustrator for the follow research (docs/research/board-follow-by-model):
// today's streaming illustrator's instructions, with every "copy V's words (q)"
// replaced by "write the clause number this hangs on (cue)". Nothing else in
// the instructions changes, so a difference in the eval is the cue's.
import {STREAM_INSTRUCTIONS} from '../../lab/gpt-live-h5/board-lesson.mjs';

/** V's words cut at punctuation into clauses; joined they are the words again. Very short clauses join the next. */
export function clauses(words) {
  const raw = String(words ?? '').match(/[^，。！？；：,.!?;:\n]+[，。！？；：,.!?;:\n]*|[，。！？；：,.!?;:\n]+/gu) ?? [];
  const parts = [];
  let carry = '';
  for (const piece of raw) {
    // ("但是，" is not a clause of its own: it goes with what follows.)
    if ((carry + piece).replace(/[^\p{L}\p{N}]/gu, '').length < 4) { carry += piece; continue; }
    parts.push(carry + piece); carry = '';
  }
  if (carry) { if (parts.length) parts[parts.length - 1] += carry; else parts.push(carry); }
  return parts;
}
export const numbered = parts => parts.map((part, index) => `[${index}]${part}`).join('');

const CUE = `# 画面怎么跟着声音走
conversation 最后一条 assistant 的话已经按标点切成编号小段：「[0]…[1]…[2]…」。编号只是给你看的，V 念的时候没有编号。页面上的东西不会一下子全出来：每样东西在声音念到它挂的那一段时才出现，没念到的不显示。所以每样东西挂在哪一段，由你决定。
- cue：挂在第几段（整数）。每个条目、节点、比较项、每一格、每一行、每个图形要写 cue；照片、便签这样的整块也写 cue；flow 的每条边第四项写 cue；每个 mark、每个 focus 也写 cue。
- 每一项都要有自己的 cue，不能只给整个区块写一个：式子的每一段（数字、符号）、示意图的每个图形、对比的每一行、时间线的每一项，各自挂在讲到它的那一段。整块写 cue 只管这个区块的框和标题。
- cue 写**第一次真正讲到这样东西**的那一段：念到那一段，用户刚好听到它，眼睛也刚好看到它。不要挂在后面总结时再点一遍名的那段（「一句话：A、B、C…」），那样它要等到最后才出现；也不要挂在还没讲到它的段，那样画面就剧透了。
- cue 写 -1 是开场画面：V 刚开口、还没讲到正题时就出现。只放让人知道「要讲什么」的东西，比如要讲的那样东西的照片；不放答案、数字、结论。可以没有开场画面。
- 第 0 段念出来时页面上就该有东西，不要让用户对着空白听好几句。
- {"op":"focus","id":"区块id/条目id","cue":段号}：声音念到这一段时，目光（荧光笔）移到这一条。V 从一项讲到下一项、或回头又讲某一项时写一个；一段最多一个。`;

const swaps = [
  ['每样东西仍然挂在它那一句 say 的字上。', '每样东西仍然挂在它真正被讲到的那一段上。'],
  ['{"op":"mark","id":"区块id/条目id","kind":"ring","q":"V 的原话里的几个字"}', '{"op":"mark","id":"区块id/条目id","kind":"ring","cue":段号}'],
  ['V 念到 q 的那一刻才画上去。', '声音念到那一段时才画上去。'],
  ['- 每一项的 q 抄 V **第一次讲到这一项**的那句话里的字（有 notes 时就是对应那一行 say 的开头），不要抄结尾那句把所有项再点一遍名的总结（「一句话：A、B、C…」）：那样整页要等到最后才出现。', '- 每一项的 cue 写 V **第一次讲到这一项**的那一段（有 notes 时，一行 say 可能被切成好几段，挂在这一项真正被讲到的那一段）。'],
  ['q 抄那句结论里的字。', 'cue 写那句结论所在的段。'],
  ['每个图形带自己的 q：V 讲到它时它才被画出来', '每个图形带自己的 cue：V 讲到它时它才被画出来'],
];
const lines = [
  // The paragraph explaining q in the everyday blocks, and the lesson's rule for q.
  [/^q：条目的「讲到这里」标记。.*$/mu, 'cue：条目挂在第几段（见「画面怎么跟着声音走」）。'],
  [/^- 每个条目、节点、比较项、每一格、每一行都要写 q；.*$/mu, '- 每个条目、节点、比较项、每一格、每一行都要写 cue；便签和照片这样的整块也要写 cue。'],
  [/flow 的边写成 \["起点id","终点id","两三个字的标注","q"\]：标注像「打得过」「克」「变成」，第四项 q 是.*?念到那里箭头才画出来。/u, 'flow 的边写成 ["起点id","终点id","两三个字的标注",cue]：标注像「打得过」「克」「变成」，第四项是讲到这条关系的那一段，念到那里箭头才画出来。'],
];

function build() {
  let text = STREAM_INSTRUCTIONS;
  for (const [from, to] of swaps) { if (!text.includes(from)) throw Error(`cue instructions: missing ${from.slice(0, 30)}`); text = text.replaceAll(from, to); }
  for (const [from, to] of lines) { if (!from.test(text)) throw Error(`cue instructions: missing ${from}`); text = text.replace(from, to); }
  text = text.replaceAll(',"q"?}', ',"cue"?}').replaceAll(',"q"}', ',"cue"}');
  // The focus operation was the director's to make by itself; here it is written like the rest.
  text = text.replace('{"op":"none"}                            这次没有要画的。', '{"op":"focus","id":"区块id/条目id","cue":段号}  声音念到那一段时目光移到这一条。\n{"op":"none"}                            这次没有要画的。');
  // Today's "everything appears when the voice reaches its words" becomes the cue section, ahead of the rules.
  text = text.replace('\n输出：每行一个 JSON 操作', `\n${CUE}\n\n输出：每行一个 JSON 操作`);
  const left = text.split('\n').filter(line => /(^|[^A-Za-z])q([^A-Za-z]|$)/u.test(line));
  if (left.length) throw Error(`cue instructions: q left in ${left.map(line => line.slice(0, 40)).join(' | ')}`);
  return text;
}
export const CUE_INSTRUCTIONS = build();
