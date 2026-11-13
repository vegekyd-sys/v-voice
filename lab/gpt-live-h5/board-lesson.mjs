// Lesson mode for the call board (experiment). Where the director draws after
// the fact from what V happened to say, a lesson is written in one piece: one
// model call produces what V will say and what appears on the page for each
// sentence, so the two cannot disagree. V then speaks the script verbatim and
// the page reveals each piece when the audio reaches the words it hangs on.
import {BOARD_INSTRUCTIONS} from './board-director.mjs';
import {applyOp, emptyScene, loose, normalizeOp} from './board-scene.mjs';

const pieces = BOARD_INSTRUCTIONS.slice(BOARD_INSTRUCTIONS.indexOf('# 区块（block.t）'), BOARD_INSTRUCTIONS.indexOf('# 怎么画'));
// The diagram kit (board-scene.mjs): the shapes a lesson is built from, beyond
// the director's everyday blocks. Only the lesson writer is told about them.
const KIT = `# 图示组件（讲解专用，优先用它们）
先想清楚这件事是什么「形状」，再挑组件；一页用 2 到 3 个组件互相配合（一个讲结构，一个摆例子或数字，再加一张便签），不要整页都是 steps 或 list。
tiles     {"id","t":"tiles","h"?,"items":[{"id","rows","cols","h"?,"icon"?,"tone"?,"lit"?,"q"}]} 数得清的东西摆成几排几列：4×4 的积木、12 个苹果分 3 堆。也可以只写 "n"（总数）和 "per"（一排几个）。icon 写一个表情就用它当每一格（🍎）；lit 是其中涂上色的个数（分数、一部分），lit:0 是空格子（留给对方猜）。讲数量、乘法、平方、分数、比例时，摆出来比写出来好懂。
formula   {"id","t":"formula","h"?,"items":[{"id","h","d"?,"tone"?,"mark"?,"q"}]} 一行式子（一个 formula 只写一条，两条式子就用两个 formula），一段一段念：["x","×","x","=","9"]、["售价","=","成本","+","利润"]。h 是一小段（不超过 6 个字，符号单独一段），d 是它下面的小字解释，tone 给关键的一段涂色。讲公式、换算、句子结构、「A 加 B 等于 C」时用。
timeline  {"id","t":"timeline","h"?,"items":[{"id","when","h","d"?,"img"?,"icon"?,"mark"?,"q"}]} 按时间排的几件事，when 写年份或时段（「1958」「上午」「第 2 天」）。讲来历、发展史、一天的行程用它，不要用 steps。
versus    {"id","t":"versus","h"?,"sides":[{"h","img"?},{"h","img"?}],"items":[{"id","h","cells":["甲这一项","乙这一项"],"win"?,"icon"?,"q"}]} 两三样东西一项一项比：h 是比的那一项（「补能」「价格」，不超过 5 个字），cells 按 sides 的顺序各写几个字，win 是这一项占优的那边（从 0 数），没有明显优劣就不写。讲「A 和 B 的区别」「选哪个」时用它，一行对应讲稿里的一句。
overlap   {"id","t":"overlap","h"?,"a":{"h","points":[…],"img"?,"q"},"b":{"h","points":[…],"img"?,"q"},"both":{"h"?,"points":[…],"q"}} 两个圈和它们重叠的部分：a、b 各有什么，both 是两边共有的。讲「A 和 B 是什么关系」「有什么相同不同」时用。每边 points 不超过 3 条，每条不超过 8 个字。
stack     {"id","t":"stack","h"?,"shape"?,"items":[{"id","h","d"?,"icon"?,"img"?,"tone"?,"q"}]} 一层压一层，从上往下写，最后一个是最底下托着大家的那层。讲「谁是谁的基础」、分层的系统、大气层、金字塔式的结构（"shape":"pyramid" 上窄下宽）时用。
scale     {"id","t":"scale","h"?,"unit"?,"dir"?,"items":[{"id","at","h","d"?,"icon"?,"img"?,"q"}]} 按一个数排在一条线上：at 是数值（只写数字），unit 是单位。高度、深度用 "dir":"up" 竖着排。讲多高、多远、多贵、多大、谁先谁后差多少时用，2 到 6 个。数字只写有把握的。

任何区块都可以写 "w":"half" 或 "w":"third"：相邻的两个 half（或三个 third）会并排放。三天行程就是三个并排的 timeline；一边数轴一边分层就是两个 half。

怎么挑：
- 是什么样子、有多少、怎么分 → tiles（配一个 formula 把算式写出来）
- 一个式子、一条规则 → formula
- 怎么一步步变成现在这样、什么时候做什么 → timeline
- A 和 B 有什么区别、选哪个 → versus
- A 和 B 是什么关系、有什么共同点 → overlap，或者 stack（一个托着另一个）
- 多高多大多贵、差多少 → scale
- 谁克谁、谁影响谁、循环 → flow（把图放在节点上）
- 一个流程的先后步骤 → steps；几个并列的东西 → list（带 img）
- 最后那句要记住的话 → sticky；这件东西长什么样 → photo
`;
const HANGING = `# 画面怎么挂到讲稿上
- 每个条目、节点、比较项、每一格、每一行都要写 q；便签和照片这样的整块也要写 q。q 是 say 里的 4 到 8 个字，一字不差，从讲稿第一次叫到这个东西的名字的地方开始抄。念到那里时这个东西出现。
- 画面出现的顺序就是讲的顺序。第一句念出来时页面上必须已经有东西：给第一句挂一张主图（photo）或第一个节点。
- 讲的东西本身有样子（一枚火箭、一种积木、一座建筑、一个角色），就用 photo 放一张它的照片作主图，query 写它最通用的名字（「猎鹰9号」「乐高积木」），挂在第一次叫到它的那一句。img 和 query 写最具体、一搜就是它的名字：型号、人名、地名、角色名（「特斯拉 Model 3」「丰田卡罗拉」「太和殿」「黄仁勋」）。一类东西的统称不要写（「电车」会搜出有轨电车，「相机」「油车」「木工坊」搜出来的图和你说的不是一回事）：换成一个对方认识的具体代表；想不出具体代表就不配图，改用 icon。同一样东西一页只配一次图。
- 条目和节点的名字（h、label）就是讲稿里叫的那个具体的东西（「杰尼龟」），并写 img 配上它的图；抽象的词（「水」）只能当它的小字说明（sub 或 d）。
- 能配图的东西都配 img（角色、动物、地点、产品、食物、人物）；互相克制、循环、流向用 flow，把图放在节点上。flow 的边写成 ["起点id","终点id","两三个字的标注","q"]：标注像「打得过」「克」「变成」，第四项 q 是讲稿里讲到这条关系的那几个字，念到那里箭头才画出来。
- 便签只写一句值得记住的话。不要写还没发生的事（「你猜对了」），也不要提前写出你最后那个问题的答案。
- 强调重点：这一页最要紧的一两个数字、名字或结论，用 mark（ring 圈出、underline 划线、star 打星）标出来；一句话里最关键的几个字用 **两个星号** 包起来（「充电要 **半小时**」），页面会用荧光笔涂上。一页最多强调三处，处处强调等于没强调。
- 一屏放得下：整页 2 到 3 个区块（最多 4 个），所有条目加起来不超过 12 个。h 不超过 8 个字，d 不超过 16 个字，能不写 d 就不写。内容多就挑最要紧的，或者用 "w":"half" 把两个区块并排。`;
/** For an answer V has already given in its own words: the same page, drawn to fit those words. */
export const ILLUSTRATE_INSTRUCTIONS = `你是 V 的画面作者。V 在电话里刚回答了用户，你要给这段回答配一页手账画面。V 的声音正在念这段话，画面上的每样东西会在念到对应的字时出现。

输入是一个 JSON：asked 是用户的话（语音识别，可能夹着旁人的话）；said 是 V 的回答，一个字都不能改，也不由你来写；evidence 是 V 回答前查到的资料（有的话），画面上的事实以 said 和 evidence 为准，不要添 V 没说、资料里也没有的事实和数字；screen 是屏幕上现在的画面（可能为空）。

只输出一个 JSON 对象，不要任何别的文字：
{"mode":"new","title":"画面标题，不超过 12 个字","blocks":[区块,…]}
- mode 一般是 "new"（换一页）。只有当 said 是在接着讲 screen 上那一页的同一件事、而且那一页不超过 2 个区块时，才用 "add"：这时只写要添上的 1 到 2 个新区块（id 不要和屏幕上的重复），不写 title。
- said 只是寒暄、确认、反问、说正在查、或者一两句话就完的回答，没有值得画的东西：输出 {"none":true}。
- 画面是 said 的图解，不是 said 的抄写：把结构画出来（谁和谁比、先后、数量、关系），字只留关键词。
- 画面上的字用 said 的语言。

${pieces}
${KIT}
${HANGING.replaceAll('讲稿', 'said').replaceAll('say 里', 'said 里')}`;

export const LESSON_INSTRUCTIONS = `你是 V。用户在电话里请你讲解一个东西，你要一次写出「讲稿」和「讲稿每一句对应的画面」。讲稿会由你的声音一字不差地念出来；画面在一页手账上，念到哪里，挂在那里的东西就出现在页面上。

输入是一个 JSON：topic 是要讲什么；audience 是讲给谁听；ask 是用户的原话（语音识别，可能夹着旁人的话，只取和 topic 有关的要求）；reference 是可靠的参考资料（有的话），和它冲突的不要讲；before 是这通电话里你刚讲过的一段（有的话）：这次要接着它讲新的东西，或者按用户的要求换个讲法，不要原样重复，例子、比方和最后的问题都换新的。

只输出一个 JSON 对象，不要任何别的文字：
{"title":"画面标题，不超过 12 个字","say":["第一句","第二句",…],"blocks":[区块,…]}

# 语言
用户用什么语言问、要求用什么语言讲，讲稿和画面上所有的字（title、say、h、d、标注、便签）就都用那种语言。ask 或 topic 是英文，或者用户说了要英文，就全部写英文：英文每句不超过 16 个词，q 抄 3 到 5 个连续的词。下面的字数限制是对中文说的，英文按差不多的长短来。

# 讲稿 say
- 口语，像当面讲给对方听。6 到 10 句，每句不超过 32 个字，一句只讲一件事。
- 第一句直接进入内容，不要「好的」「我来讲讲」。
- 用具体的东西讲，不用抽象的类别讲。讲的是一类看得见的东西（宝可梦、动物、车、食物、建筑）时，每个类别挑一个对方认识的代表，讲稿里叫它的名字，让它做一件看得见的事：说「杰尼龟一喷水，小火龙尾巴上的火就灭了」，不说「水属性克制火属性」。类别的名字最多带一下（「杰尼龟是水系的」）。
- 讲对、讲全。讲的是谁克谁、谁变成谁、先后顺序这类关系时，画面上每一条关系在讲稿里都要有一句明确讲到，方向不能反；画了 A 克 B、B 克 C、C 克 A 的圈，就要三条各讲一句。拿不准某个角色是什么、某条关系对不对，就换成你有把握的角色和关系；宁可少讲一条，不要讲错。不是什么都能凑成一个圈：只有每一条你都有把握时才画成圈，否则讲两三条有把握的单向关系。拿不准的数字不要写。
- 讲稿里提到的每个要点，画面上都应该有对应的东西；画面上有的东西，讲稿里都要叫到它的名字。
- 收尾只用一句：一句小结，或者一个让对方接话的问题。用问题收尾时，问题就是最后一句，问完就停，不要再加「听懂了吗」。

# 讲给小朋友（audience 里有「岁」「小朋友」「孩子」）
- 5 到 8 句，每句不超过 22 个字。只用他见过的东西打比方（石头剪刀布、浇水、吹蜡烛、积木、糖果）。不用「属性」「克制」「机制」「倍率」「方程」这样的词，说「打得过」「怕」「赢」「猜数字」。
- 知道他的名字就在第一句叫他。最后让他猜一个刚讲过就能答的问题。
- 画面几乎全是图和摆出来的东西：每个东西一张图，数量用 tiles 摆出来，字只写名字和数字。对方说「摆给我看」「画给我看」时，一定要用 tiles 或 formula 真的摆出来，不要用文字描述怎么摆。

${pieces}
${KIT}
${HANGING}`;

// What the author of a script writes when the page is drawn by the one
// illustrator: what V says, and for each sentence a note on what to show.
const speaking = LESSON_INSTRUCTIONS.slice(LESSON_INSTRUCTIONS.indexOf('# 语言'), LESSON_INSTRUCTIONS.indexOf('# 区块（block.t）'));
export const SCRIPT_INSTRUCTIONS = `你是 V。用户在电话里请你讲解一个东西。你写「讲稿」，并给每一句配一条「画面提示」。讲稿会由你的声音一字不差地念出来；屏幕上有一页手账，由画面作者按你的讲稿和提示来画，念到哪一句，那一句的东西就出现。

输入是一个 JSON：topic 是要讲什么；audience 是讲给谁听；ask 是用户的原话（语音识别，可能夹着旁人的话，只取和 topic 有关的要求）；reference 是可靠的参考资料（有的话），和它冲突的不要讲；before 是这通电话里你刚讲过的一段（有的话）：这次要接着它讲新的东西，或者按用户的要求换个讲法，不要原样重复，例子、比方和最后的问题都换新的。

只输出一个 JSON 对象，不要任何别的文字：
{"title":"画面标题，不超过 12 个字","say":["第一句","第二句",…],"show":["第一句的画面提示","第二句的画面提示",…]}

${speaking}# 画面提示 show
- show 和 say 一样长，show 的第 i 条说第 i 句念出来时屏幕上该出现什么；这一句不需要新东西就写空字符串 ""。
- 用一句大白话写清楚「用哪种图示、放什么」，不用写 JSON。可以用的图示：照片 photo、方块阵列 tiles（数得清的东西摆成几排几列）、式子 formula（一段一段的算式或「A = B + C」）、时间线 timeline、逐项对比 versus（两三样东西一项一项比）、两圈重叠 overlap（各有什么、共有什么）、分层 stack（谁托着谁）、数轴 scale（按数值排在一条线上）、关系图 flow（谁克谁、谁影响谁，节点可带图）、步骤 steps、带图列表 list、大数字 stats、柱状 bars、便签 sticky。
- 例子：「photo：猎鹰9号」「versus：电车/油车，加一行“补能”：家里慢充 / 三分钟加满，油车占优」「tiles：4 排每排 4 个方块，标“16 个”」「formula：4 × 4 = 16」「timeline：加一项 1958，凸点定型」「flow：加节点 小火龙（配图），箭头 杰尼龟→小火龙 标“打得过”」「sticky：先看有没有充电桩」。
- 先想清楚这件事的形状再挑图示，整页 2 到 3 种图示互相配合，不要全是步骤和列表。同一个图示可以跨好几句一点点长出来（每句加一行、一个节点、一组方块）。
- 画面只能往上加东西，已经出现的不会再变。所以不要写「把空格子涂上色」「把便签换成…」「盒子打开」这种改动；要表现变化，就并排再放一组（先一组 3×3，再一组 4×4），或者在式子后面接着写。
- 提示里的名字、数字要和这一句讲稿里说的一样；讲稿没说的东西不要让画面出现。照片只给真能拍到的东西，一页最多两张。要配图的东西写它最具体的名字（型号、人名、地名、角色名：「特斯拉 Model 3」而不是「电车」），讲稿里也直接叫这个名字。
- 第一句就要有东西：给它配一张照片或第一个图示。最要紧的一两处写明「圈出」「打星」或「荧光笔标出某几个字」。
- 一屏放得下：整页最多 3 个图示加一张便签。`;

/** Read a script and its notes: {title, say, show}; null when unusable. */
export function parseScript(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const raw = Array.isArray(value?.say) ? value.say : [], say = sentences(raw);
  if (say.length < 2) return null;
  // Notes stay beside the sentence they belong to, even where a sentence was dropped as empty.
  const show = raw.map((line, index) => String(line ?? '').trim() ? String((Array.isArray(value?.show) ? value.show : [])[index] ?? '').replace(/\s+/gu, ' ').trim().slice(0, 200) : null).filter(note => note !== null).slice(0, say.length);
  while (!fixedClose(say)) say.pop();
  return {title: String(value?.title ?? '').replace(/\s+/gu, ' ').trim().slice(0, 40), say, show: say.map((_, index) => show[index] ?? '')};
}
// One closing line: a question followed by "did you get it?" loses the second.
const fixedClose = say => !(say.length > 3 && asks(say.at(-1)) && asks(say.at(-2)));

// Facts the quick models get wrong often enough to matter, handed over when
// the topic calls for them. (Asked for legendary birds, one had ice beating
// fire, another made up a ring of three.)
const REFERENCES = [{match: /宝可梦|神奇宝贝|宠物小精灵|pok[eé]mon/iu, text: `宝可梦属性克制表（攻击方：打它们效果拔群）。只讲表里有的关系，表里没有就不是克制。
火：草、冰、虫、钢｜水：火、地面、岩石｜电：水、飞行｜草：水、地面、岩石｜冰：草、地面、飞行、龙｜格斗：一般、冰、岩石、恶、钢｜毒：草、妖精｜地面：火、电、毒、岩石、钢｜飞行：草、格斗、虫｜超能力：格斗、毒｜虫：草、超能力、恶｜岩石：火、冰、飞行、虫｜幽灵：超能力、幽灵｜龙：龙｜恶：超能力、幽灵｜钢：冰、岩石、妖精｜妖精：格斗、龙、恶｜一般：没有
完全无效：一般和格斗打幽灵、电打地面、地面打飞行、幽灵打一般、超能力打恶、毒打钢、龙打妖精。
先确认每只宝可梦自己的属性（有两个属性的两个都算），再查表。`}];
export const lessonReference = text => REFERENCES.filter(item => item.match.test(String(text ?? ''))).map(item => item.text).join('\n');

const latin = text => { const letters = text.replace(/[^\p{L}]/gu, ''); return letters.length > 0 && letters.replace(/[^A-Za-z]/gu, '').length / letters.length > .6; };
// A sentence is cut at 60 characters, or 200 where it is written in Latin letters.
// (What is said aloud carries no highlighter marks: V's backend once wrote **几分钱** into the script.)
const sentences = value => (Array.isArray(value) ? value : []).map(line => String(line ?? '').replaceAll('*', '').replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, 12).map(line => Array.from(line).slice(0, latin(line) ? 200 : 60).join(''));
/** The script as V is given it: sentences in Latin letters need a space between them. */
export const spokenScript = lines => lines.reduce((all, line) => all + (all && /[A-Za-z0-9.,!?'")]$/u.test(all) && /^[A-Za-z0-9"'(]/u.test(line) ? ' ' : '') + line, '');
const asks = line => /[？?]\s*$/u.test(line);
const DIAGRAMS = new Set(['tiles', 'formula', 'timeline', 'versus', 'overlap', 'stack', 'scale']);
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
export function settleLesson({say: lines, ops}, {fixed = false, strict = false} = {}) {
  const say = lines.slice();
  // One closing line: a question followed by "did you get it?" loses the second.
  // (Not when the words are V's own, already spoken: `fixed`.)
  while (!fixed && say.length > 3 && asks(say.at(-1)) && asks(say.at(-2))) say.pop();
  // Positions are counted in the letters the page compares (no spaces or punctuation).
  const starts = [];
  let script = '';
  for (const line of say) { starts.push(script.length); script += loose(line); }
  const sentenceOf = at => { let index = 0; while (index + 1 < starts.length && starts[index + 1] <= at) index++; return index; };
  const find = (words, from = 0) => { const key = loose(String(words ?? '')); return key.length >= 2 ? script.indexOf(key, from) : -1; };
  // The words to quote for a position: long enough to be found, and starting
  // where their first four letters occur nowhere earlier (the page looks for those).
  const quoteAt = at => {
    // Latin letters need a longer run to be distinctive (see quoteHead).
    const plain = /^[\x00-\x7f]*$/u.test(script.slice(at, at + 12)), head = plain ? 10 : 4, length = plain ? 20 : 8;
    for (const start of [at, at - 1, at - 2, at - 3]) {
      if (start < 0) break;
      if (script.indexOf(script.slice(start, start + head)) === start) return script.slice(start, start + length);
    }
    return script.slice(at, at + length);
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
      // A character appears when it is first named. A row, a term or a mark
      // of a diagram appears where the writer put it (its words may well
      // have been said earlier in passing), if that place is real.
      const at = DIAGRAMS.has(block.t) && quoted >= 0 ? quoted : named >= 0 ? named : quoted >= 0 ? quoted : pictured;
      if (at >= 0) item.q = quoteAt(at); else delete item.q;
      whereOf.set(`${block.id}/${item.id}`, at);
    }
    // Drawn while V speaks (`strict`): what V has not said is not on the page.
    // (A formula's signs take their neighbour's place just below, so they are judged after that.)
    const unsaid = item => strict && !item.q;
    // A sign between two terms ("×", "=") has no words of its own: it comes
    // with the term before it (or, at the very start, the one after).
    if (block.t === 'formula') {
      let last = block.items.find(item => item.q)?.q;
      for (const item of block.items) { if (item.q) last = item.q; else if (last) item.q = last; }
    }
    if (strict) {
      const key = block.t === 'compare' ? 'cols' : block.t === 'flow' ? 'nodes' : 'items';
      if (Array.isArray(block[key]) && block.t !== 'overlap') {
        block[key] = block[key].filter(item => !unsaid(item));
        if (block.t === 'flow') { const kept = new Set(block.nodes.map(node => node.id)); block.edges = block.edges.filter(([from, to]) => kept.has(from) && kept.has(to)); }
      }
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
 * The illustrator, streaming (the one way a page is drawn for words that
 * already exist). It writes one operation a line and is asked again as V's
 * answer grows, so the page is built while V is still speaking: a title and a
 * print as soon as the caller has asked, then each piece as V's text reaches
 * it (the text runs seconds ahead of the audio), then the finished page.
 */
export const STREAM_INSTRUCTIONS = `你是 V 的画面作者。V 正在电话里回答用户，你给这段回答配一页手账画面。V 的回答文字是一段一段到的，比声音先到几秒；你会被反复叫到，每次看到更长的回答，把新说到的东西画上去。画面上的每样东西会在声音念到对应的字时才显示出来。

输入是一个 JSON：trigger 说明现在是哪一步；conversation 是最近的对话，最后一条 assistant 是 V 目前已经说出的话（一个字都不能改）；evidence 是 V 回答前查到的资料（有的话）；screen 是屏幕上现在的画面（没有就是空的）；notes 是这段话的作者留的画面提示（有的话）：每条是一句话（say）和这句话该配的画面（show）。有 notes 就照着画：用它点名的图示类型和内容，标题用 notes 的 title；每样东西仍然挂在它那一句 say 的字上。recent 是这通电话前几页用过的图示类型（有的话）：两种图示都合适时，挑最近没用过的那种，不要每一页都长一个样。

画面是一块画布，上面有好几页，每个话题一页，页不会消失：screen 是 V 现在所在的这一页，canvas 列出画布上之前的页（id、标题、上面有什么）。

输出：每行一个 JSON 操作，不要任何别的文字。
{"op":"scene","title":"不超过 12 个字"}   在画布上开一页新的（换了话题时）。之前的页还留在画布上。
{"op":"zone","id":"z2"}                  回到画布上之前的某一页（用户回头问那一页上的东西时），之后的 put 加在那一页上。
{"op":"put","block":{区块}}              放一个区块；id 和屏幕上已有的相同就是更新那一个。
{"op":"none"}                            这次没有要画的。

# 按 trigger 做事
- 先判断这句话落在哪：接着 screen 这一页的话题往下讲 → 不开新页，直接往这一页加（这一页已经有 4 个区块了就开新页）；换了话题 → scene 开新页；回头问 canvas 里某一页上的东西（「刚才那个第二点」「回到故宫」「再说说前面那个对比」）→ 那一页还有空位（room 大于 0）就 zone 回到那一页再加；没有空位了（room 是 0）就 scene 开一页新的，标题带上出处（「故宫 · 珍宝馆」）。zone 和 scene 只选一个，不要两个都发。
- user：用户刚说完，V 还没开口。回头问之前某一页、而那一页还有空位时，这一步就可以先 zone 回去。只有当用户明显在问一件新的、具体的东西（一个地方、一个人、一件产品、一个概念）时，输出 scene（标题）；如果问的是一件拍得出照片的具体东西（一个地方、一栋建筑、一个人、一个角色、一件产品、一种动物或食物），再加一个 photo 区块，query 写它的名字。抽象的概念、数学、规则、天气、「A 和 B 的区别」这类问题不放 photo，只开页。不写任何条目、数字、结论，那些等 V 说了再画。闲聊、应答、接着当前这页追问、看不出要讲什么：none。
- assistant_progress：V 说到一半。把 V 已经说出来的内容画上去。屏幕是空的或者是别的话题：先 scene 再 put。屏幕就是这个话题：只 put。可以先放一个只有头两项的区块，下次再把同一个 id 的区块整块重发、在后面接着加。V 这次没有说出新的可画的东西：none。
- assistant_end：V 的话到齐了。把整页补全：补上没画到的条目，需要的话加一张便签（V 的结论或提醒）。
- 一页只有一屏：整页最多 3 个区块，外加一张便签。V 讲得多，就把内容归进这几个区块里（同一类的并成一个区块、每个区块挑最要紧的 3 到 5 项），不要 V 每讲一段就新开一个区块。照片算一个区块。
- 快一点让第一样东西上屏：一个区块会有 3 项以上时，先发只含头两项的版本，紧接着再发一行完整的（同一个 id）。
- 更新已有区块时，已经在屏幕上的条目不许改：id、顺序、文字都保持原样，只能在后面追加。也不要删除或挪动已有的区块。画面只能长，不能变。

# 画什么
- 只画 V 说了的。V 没说的条目、数字、结论一律不写（evidence 只用来核对写法，比如名字和数字的准确写法）。
- 画面是这段话的图解，不是抄写：把结构画出来（谁和谁比、先后、数量、关系），字只留关键词。
- V 只是寒暄、确认、反问、说正在查：none。
- 画面上的字用 V 说话的语言。

${pieces}
${KIT}
${HANGING.replaceAll('讲稿', 'V 的话').replaceAll('say 里', 'V 的话里')}`;
/** Fit one streamed operation to what V has said so far: anchors on V's real words, nothing V has not said. */
export function refineStreamOp(op, {said = '', trigger = ''} = {}) {
  if (!op) return null;
  if (op.op === 'scene') return {op: 'scene', title: op.title, lesson: true, late: true};
  if (op.op === 'zone') return op;
  if (op.op !== 'put') return op;
  // Before V has spoken there is nothing to hang a fact on: a print of the thing asked about, nothing else.
  if (trigger === 'user') return op.block.t === 'photo' ? {op: 'put', block: (({q, ...block}) => block)(op.block)} : null;
  const say = spokenSentences(said);
  if (!say.length) return null;
  const [settled] = settleLesson({say, ops: [op]}, {fixed: true, strict: true}).ops;
  // What is left must still be a block (a list needs an item, a comparison two sides).
  return normalizeOp(settled);
}

/** V's own answer as the sentences a picture can hang on. */
const spokenSentences = said => (String(said ?? '').match(/[^。！？!?\n]+[。！？!?]*|[。！？!?]+/gu) ?? []).map(line => line.trim()).filter(Boolean).slice(0, 60);
/**
 * Read an illustration of words V has already said: {ops, add} or null.
 * `taken` are the block ids on the page it may be added to.
 */
export function parseIllustration(text, said, taken = []) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (value?.none === true) return {ops: [], add: false, none: true};
  const add = value?.mode === 'add' && taken.length > 0 && taken.length <= 2, used = new Set(add ? taken : []);
  const puts = (Array.isArray(value?.blocks) ? value.blocks : []).slice(0, add ? 2 : 4).map((block, index) => {
    // A piece added to a page must not replace one that is there.
    let id = typeof block?.id === 'string' ? block.id : '';
    if (!id || used.has(id)) id = `x${taken.length + index + 1}`;
    used.add(id);
    return normalizeOp({op: 'put', block: {...block, id}});
  }).filter(Boolean);
  if (!puts.length) return null;
  const title = String(value?.title ?? '').trim();
  const settled = settleLesson({say: spokenSentences(said), ops: [...(add ? [] : [normalizeOp({op: 'scene', title, lesson: true, late: true})]), ...puts]}, {fixed: true});
  return {ops: settled.ops, add};
}

/**
 * `complete({messages, signal})` yields text chunks (the director's client).
 * `director.present(owner, ops, holdMs)` puts the lesson on the call's board.
 */
export function createLessonWriter({complete, fallback = null, director, now = Date.now, record = () => {}, preferMs = 8000, totalMs = 13000} = {}) {
  // What each call was last told, so a second lesson builds on the first.
  const told = new Map();
  // The caller is waiting, so both writers start at once. The first one's
  // work is used if it arrives within `preferMs`; after that whichever has
  // something usable. Nothing by `totalMs`: nothing.
  async function race({owner, messages, signal, started, first: one, second: two, parse, preferMs: prefer, totalMs: total, kind = 'board.lesson-attempt'}) {
    const limit = new AbortController(), stop = () => limit.abort();
    if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, {once: true});
    const attempt = (write, name) => (async () => {
      let text = '', failure = '';
      try { for await (const chunk of write({signal: limit.signal, messages})) text += chunk; } catch (error) { failure = String(error?.message ?? error).slice(0, 240); }
      const made = parse(text);
      if (!made && !limit.signal.aborted) record({type: kind, voiceSessionId: owner, writer: name, ok: false, failure, chars: text.length, head: text.slice(0, 160)});
      return made ? {...made, writer: name} : null;
    })();
    const after = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms, null); limit.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(null); }, {once: true}); });
    const first = attempt(one, 'preferred'), second = two ? attempt(two, 'fallback') : Promise.resolve(null);
    const either = Promise.race([first.then(found => found ?? second), second.then(found => found ?? first)]);
    let made = await Promise.race([first.then(found => found ?? second), after(prefer)]);
    made ??= await Promise.race([either, after(Math.max(0, total - (now() - started)))]);
    stop(); signal?.removeEventListener('abort', stop);
    return made;
  }
  return {
    available: Boolean(complete && director),
    /** Returns the script to speak, or null when no lesson could be written. `ask` is the caller's own words. */
    async prepare({owner, topic, audience = '', ask = '', reference = '', signal} = {}) {
      const started = now();
      // With the streaming illustrator the writer only writes the script and
      // its notes; the page is the illustrator's, as for any answer of V's.
      const scripted = director.streams === true;
      // (Otherwise the director stops at once: a picture it was about to draw
      // for the same question would flash by before the lesson arrives.)
      if (!scripted) director.hold?.(owner); else director.expect?.(owner);
      const before = told.get(owner);
      const messages = [{role: 'system', content: scripted ? SCRIPT_INSTRUCTIONS : LESSON_INSTRUCTIONS},
        {role: 'user', content: JSON.stringify({topic: String(topic ?? '').slice(0, 400), audience: String(audience ?? '').slice(0, 80) || '成年人',
          ...(ask ? {ask: Array.from(String(ask)).slice(-300).join('')} : {}), ...(before ? {before} : {}),
          // What was looked up for this lesson (a search, V's memory), then the standing references.
          ...([reference && Array.from(String(reference)).slice(0, 6000).join(''), lessonReference(`${topic} ${ask}`)].filter(Boolean).length ? {reference: [reference && Array.from(String(reference)).slice(0, 6000).join(''), lessonReference(`${topic} ${ask}`)].filter(Boolean).join('\n\n')} : {})})}];
      const lesson = await race({owner, messages, signal, started, first: complete, second: fallback, parse: scripted ? parseScript : parseLesson, preferMs, totalMs});
      const say = lesson ? spokenScript(lesson.say) : '';
      if (scripted) {
        record({type: 'board.lesson', voiceSessionId: owner, topic, audience, ask, ok: Boolean(lesson), writer: lesson?.writer ?? null, scripted: true, durationMs: now() - started, say: lesson?.say ?? null, show: lesson?.show ?? null});
        if (!lesson) { director.expect?.(owner, 0); return null; }
        told.delete(owner); told.set(owner, {title: lesson.title, say});
        while (told.size > 200) told.delete(told.keys().next().value);
        director.note(owner, {title: lesson.title, script: say, lines: lesson.say.map((line, index) => ({say: line, show: lesson.show[index]}))});
        return {say, sentences: lesson.say};
      }
      record({type: 'board.lesson', voiceSessionId: owner, topic, audience, ask, ok: Boolean(lesson), writer: lesson?.writer ?? null, durationMs: now() - started, say: lesson?.say ?? null, drawn: lesson?.ops ?? null});
      if (!lesson) { director.release?.(owner); return null; }
      told.delete(owner); told.set(owner, {title: lesson.title, say});
      while (told.size > 200) told.delete(told.keys().next().value);
      // Held for as long as the script takes to say (about five characters a second), plus a margin.
      director.present(owner, lesson.ops, Math.round(Array.from(say).length / (latin(say) ? 13 : 5) * 1000) + 8000);
      return {say, sentences: lesson.say};
    },
    /**
     * The other way to write a lesson (experiment): V's own backend agent, with
     * its memory and tools, is handed the writer's instructions as a brief and
     * answers with the lesson. `brief` is what to ask it; `accept` takes its reply.
     */
    brief({owner, topic, audience = '', ask = ''} = {}) {
      if (owner && director.streams === true) director.expect?.(owner, 60000);
      return `电话里用户请你讲解一件事，屏幕上有一页手账画面会跟着你的讲解出现。需要今天的信息、用户自己的项目或记录时，先用你自己的工具查清楚（查不到就如实少讲），再按下面的规范写。你的最终回复只能是规范里的那个 JSON 对象本身，前后不要任何别的文字，也不要另写口头摘要。\n\n这次的输入：${JSON.stringify({topic: String(topic ?? '').slice(0, 400), audience: String(audience ?? '').slice(0, 80) || '成年人', ...(ask ? {ask: Array.from(String(ask)).slice(-300).join('')} : {}), ...(lessonReference(`${topic} ${ask}`) ? {reference: lessonReference(`${topic} ${ask}`)} : {})})}\n\n===== 规范 =====\n${director.streams === true ? SCRIPT_INSTRUCTIONS : LESSON_INSTRUCTIONS}`;
    },
    accept({owner, text, topic, audience = '', ask = '', startedAt = now()} = {}) {
      if (director.streams === true) {
        const script = parseScript(String(text ?? '')), words = script ? spokenScript(script.say) : '';
        record({type: 'board.lesson', voiceSessionId: owner, topic, audience, ask, ok: Boolean(script), writer: 'backend', scripted: true, durationMs: now() - startedAt, say: script?.say ?? null, show: script?.show ?? null, ...(script ? {} : {head: String(text ?? '').slice(0, 200)})});
        if (!script) { director.expect?.(owner, 0); return null; }
        told.delete(owner); told.set(owner, {title: script.title, say: words});
        director.note(owner, {title: script.title, script: words, lines: script.say.map((line, index) => ({say: line, show: script.show[index]}))});
        return {say: words, sentences: script.say};
      }
      const lesson = parseLesson(String(text ?? ''));
      const say = lesson ? spokenScript(lesson.say) : '';
      record({type: 'board.lesson', voiceSessionId: owner, topic, audience, ask, ok: Boolean(lesson), writer: 'backend', durationMs: now() - startedAt, say: lesson?.say ?? null, drawn: lesson?.ops ?? null, ...(lesson ? {} : {head: String(text ?? '').slice(0, 200)})});
      if (!lesson) { director.release?.(owner); return null; }
      told.delete(owner); told.set(owner, {title: lesson.title, say});
      director.present(owner, lesson.ops, Math.round(Array.from(say).length / (latin(say) ? 13 : 5) * 1000) + 8000);
      return {say, sentences: lesson.say};
    },
    /**
     * A page for an answer V gave in its own words (after a search, from
     * memory, or simply unprompted). The quick writer goes first: V is
     * already speaking. Returns {ops, add, writer} or null.
     */
    async illustrate({owner, asked = '', said = '', evidence = [], screen = null, signal} = {}) {
      const started = now();
      const taken = (screen?.blocks ?? []).map(block => block.id);
      const looked = evidence.map(item => `【${item.name}】${item.text}`).join('\n').slice(0, 5000);
      const messages = [{role: 'system', content: ILLUSTRATE_INSTRUCTIONS},
        {role: 'user', content: JSON.stringify({asked: Array.from(String(asked)).slice(-300).join(''), said: Array.from(String(said)).slice(0, 2400).join(''),
          ...(looked ? {evidence: looked} : {}), ...(lessonReference(`${asked} ${said}`) ? {reference: lessonReference(`${asked} ${said}`)} : {}),
          screen: screen ? {title: screen.title, blocks: screen.blocks.map(block => ({id: block.id, t: block.t, ...(block.h ? {h: block.h} : {})}))} : null})}];
      const parse = text => parseIllustration(text, said, taken), quick = fallback ?? complete;
      let made = await race({owner, messages, signal, started, first: quick, second: fallback ? complete : null, parse, preferMs: 5000, totalMs: fallback ? 10000 : 5000, kind: 'board.illustrate-attempt'});
      // With a single writer, one that has not answered in five seconds is asked once more
      // (it usually answers in three; twice it hung for the whole ten and no page came).
      if (!made && !fallback && !signal?.aborted) made = await race({owner, messages, signal, started: now(), first: quick, second: null, parse, preferMs: 6000, totalMs: 6000, kind: 'board.illustrate-attempt'});
      record({type: 'board.illustrate', voiceSessionId: owner, ok: Boolean(made?.ops.length), none: made?.none === true, add: made?.add === true, writer: made?.writer ?? null, durationMs: now() - started, asked, said: Array.from(String(said)).slice(0, 400).join(''), drawn: made?.ops ?? null});
      return made?.ops.length ? made : null;
    },
  };
}
export const emptyLessonScene = () => applyOp(emptyScene(), {op: 'scene', title: '', lesson: true});
