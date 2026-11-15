// The cue illustrator (VOICE_BOARD_FOLLOW=cue; research (docs/research/board-follow-by-model):
// today's streaming illustrator's instructions, with every "copy V's words (q)"
// replaced by "write the clause number this hangs on (cue)". Nothing else in
// the instructions changes, so a difference in the eval is the cue's.
import {SCRIPT_INSTRUCTIONS, STREAM_INSTRUCTIONS} from './board-lesson.mjs';
import {loose, normalizeOp} from './board-scene.mjs';

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
- cue 写 -1 是开场画面：用户刚问完、V 还在说「好，我讲讲」时就出现，让用户马上知道要讲什么，不对着空白等。只放「要讲的是什么」：那样东西的照片、一张对比表的两边（versus 的 sides，行还没有）、一张示意图的底子（地球、两条缝的挡板），不放答案、数字、结论。例：问故宫 → 故宫的照片 cue -1；问电车和油车的区别 → versus 区块 cue -1（两边 Model 3 / 卡罗拉，行各挂各的段）；问勾股定理 → 直角三角形那个图形 cue -1。能放就放一样，最多两样。
- 讲到哪画到哪：每个新东西挂在讲它的那一段，不要等到结尾总结时才一起出来；结尾的总结只用 mark 在已有的东西上落笔（打勾、圈出），或加一张便签。
- 看得见的东西用照片，不用画：地方、城市、景点、建筑、人物、角色、动物、食物、产品、作品。讲到几个这样的东西，就用一个 list（或 timeline），每一项写 img（它自己的照片），各挂在讲它的那一段；不要只放一张大照片然后用 draw 去画其余的城市和建筑。draw 只用来画原理、构造、位置关系、几何。
- 讲稿里列举了几样东西，页面上每一样都要有（一项或一张图），不能讲到后面几样时画面不动。
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

/** The lesson writer's instructions with cues: pictures for things that can be seen, and every listed thing told in full. */
const SCRIPT_MORE = `
# 列举和配图
- 讲几样东西（几个城市、几个景点、几种做法）时，每一样都讲得一样细，各一到两句，说出它最值得看、最特别的一点；讲不完就少讲几样，三样讲透好过五样后面一句带过。最后的问题之前，每一样都已经讲到。
- 看得见的东西（地方、建筑、人物、角色、动物、食物、产品、作品）的画面提示写「list 带图：加一项 布拉格（配图 查理大桥）」这样，每样配它自己的照片；不要用 draw 去画城市和建筑。`;
if (!SCRIPT_INSTRUCTIONS.includes('# 画面提示 show')) throw Error('cue script instructions: no show section');
// The script and its notes are written a line at a time, each sentence with its note, so the
// page can be started from the first lines while the rest is still being written.
const SCRIPT_LINES = [
  ['{"title":"画面标题，不超过 12 个字","say":["第一句","第二句",…],"show":["第一句的画面提示","第二句的画面提示",…]}',
    '{"title":"画面标题，不超过 12 个字","lines":[{"say":"第一句","show":"第一句的画面提示"},{"say":"第二句","show":"第二句的画面提示"},…]}\ntitle 写在最前面；lines 一句一项，每一项先写 say 再写 show。'],
  ['- show 和 say 一样长，show 的第 i 条说第 i 句念出来时屏幕上该出现什么；', '- 每一项的 show 说这一句 say 念出来时屏幕上该出现什么；'],
];
export const CUE_SCRIPT_INSTRUCTIONS = SCRIPT_LINES.reduce((text, [from, to]) => {
  if (!text.includes(from)) throw Error(`cue script instructions: missing ${from.slice(0, 30)}`);
  return text.replace(from, to);
}, SCRIPT_INSTRUCTIONS) + SCRIPT_MORE;

/** The request's conversation with V's last words numbered by clause (what the cues count). */
export const cueTurns = turns => {
  const last = turns?.findLastIndex?.(turn => turn?.role === 'assistant') ?? -1;
  return last < 0 ? turns : turns.map((turn, index) => index === last ? {...turn, text: numbered(clauses(turn.text))} : turn);
};

/**
 * The words a cue stands for, as the page finds them: the clause's own letters
 * from its start, moved forward within the clause until their head is the
 * first such in the whole text (the page looks the head up in what was heard).
 */
export function cueQuote(said, cue) {
  const parts = clauses(said);
  if (!Number.isInteger(cue) || cue < 0 || !parts.length) return '';
  const index = Math.min(cue, parts.length - 1), all = loose(said);
  const start = loose(parts.slice(0, index).join('')).length, length = loose(parts[index]).length;
  const latin = /^[\x00-\x7f]*$/u.test(all.slice(start, start + 12)), head = latin ? 10 : 4, size = latin ? 20 : 8;
  for (let at = start; at < start + Math.max(1, length - head + 1); at++) if (all.indexOf(all.slice(at, at + head)) === at) return all.slice(at, at + size);
  return all.slice(start, start + size);
}

/**
 * One streamed operation with its cues turned into the words they stand for
 * (`q`), so the page shows each piece when the voice reaches that clause. The
 * model decides where; nothing is matched by name. A piece with cue -1 (or a
 * photo before V has spoken) has no words and is shown at once.
 */
export function refineCueOp(op, {said = '', trigger = '', raw = null} = {}) {
  if (!op) return null;
  if (op.op === 'scene') return {op: 'scene', title: op.title, lesson: true, late: true, ...(op.from ? {from: op.from} : {})};
  if (op.op === 'zone' || op.op === 'none') return op;
  // The page's eye follows the voice through the cues; a fixed focus would fight it.
  if (op.op === 'focus' || op.op === 'del' || op.op === 'clear') return null;
  const quote = cue => cueQuote(said, cue);
  if (op.op === 'mark') { const q = trigger === 'user' ? '' : quote(raw?.cue); return q ? normalizeOp({...raw, q}) : null; }
  if (op.op !== 'put' || !raw?.block) return op;
  // Before V has spoken: the print of the thing asked about, nothing else.
  if (trigger === 'user') return op.block.t === 'photo' ? {op: 'put', block: (({q, ...block}) => block)(op.block)} : null;
  const source = raw.block, own = Number.isInteger(source.cue) ? source.cue : null;
  const hang = (item, inherit = own) => {
    const {cue, q, ...rest} = item ?? {};
    const at = Number.isInteger(cue) ? cue : inherit;
    const words = at === null ? '' : quote(at);
    return words ? {...rest, q: words} : rest;
  };
  const block = hang(source, null);
  for (const key of ['items', 'nodes', 'cols']) if (Array.isArray(source[key])) block[key] = source[key].map(item => hang(item));
  for (const key of ['a', 'b', 'both']) if (source[key] && typeof source[key] === 'object') block[key] = hang(source[key]);
  if (Array.isArray(source.edges)) block.edges = source.edges.map(edge => Array.isArray(edge) ? [edge[0], edge[1], edge[2] ?? '', ...(Number.isInteger(edge[3]) && quote(edge[3]) ? [quote(edge[3])] : [])] : edge);
  return normalizeOp({op: 'put', block});
}
