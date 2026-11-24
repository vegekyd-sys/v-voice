// The cue illustrator (VOICE_BOARD_FOLLOW=cue; research (docs/research/board-follow-by-model):
// today's streaming illustrator's instructions, with every "copy V's words (q)"
// replaced by "write the clause number this hangs on (cue)". Nothing else in
// the instructions changes, so a difference in the eval is the cue's.
import {SCRIPT_INSTRUCTIONS, STREAM_INSTRUCTIONS} from './board-lesson.mjs';
import {loose, normalizeOp} from './board-scene.mjs';
import {clauses, numbered} from './board-clause.mjs';

export {clauseOf, clauses, numbered} from './board-clause.mjs';

const CUE = `# 画面怎么跟着声音走
conversation 最后一条 assistant 的话已经按标点切成编号小段：「[0]…[1]…[2]…」。编号只是给你看的，V 念的时候没有编号。页面上的东西不会一下子全出来：每样东西在声音念到它挂的那一段时才出现，没念到的不显示。所以每样东西挂在哪一段，由你决定。
- cue：挂在第几段（整数）。每个条目、节点、比较项、每一格、每一行、每个图形要写 cue；照片、便签这样的整块也写 cue；flow 的每条边第四项写 cue；每个 mark、每个 focus 也写 cue。
- 每一项都要有自己的 cue，不能只给整个区块写一个：式子的每一段（数字、符号）、示意图的每个图形、对比的每一行、时间线的每一项，各自挂在讲到它的那一段。整块写 cue 只管这个区块的框和标题。
- cue 写**第一次真正讲到这样东西**的那一段：念到那一段，用户刚好听到它，眼睛也刚好看到它。不要挂在后面总结时再点一遍名的那段（「一句话：A、B、C…」），那样它要等到最后才出现；也不要挂在还没讲到它的段，那样画面就剧透了。
- cue 写 -1 是开场画面：用户刚问完、V 还在说「好，我讲讲」时就出现，让用户马上知道要讲什么，不对着空白等。只放「要讲的是什么」：那样东西的照片、一张对比表的两边（versus 的 sides，行还没有）、一张示意图的底子（地球、两条缝的挡板），不放答案、数字、结论。例：问故宫 → 故宫的照片 cue -1；问电车和油车的区别 → versus 区块 cue -1（两边 Model 3 / 卡罗拉，行各挂各的段）；问勾股定理 → 直角三角形那个图形 cue -1。能放就放一样，最多两样。
- 讲到哪画到哪：每个新东西挂在讲它的那一段，不要等到结尾总结时才一起出来；结尾的总结只用 mark 在已有的东西上落笔（打勾、圈出），或加一张便签。
- 看得见的东西用照片，不用画：地方、城市、景点、建筑、人物、角色、动物、食物、产品、作品。讲到几个这样的东西，就用一个 list（或 timeline），每一项写 img（它自己的照片），各挂在讲它的那一段；不要只放一张大照片然后用 draw 去画其余的城市和建筑。draw 只用来画原理、构造、位置关系、几何。
- 讲稿里列举了几样东西，页面上每一样都要有（一项或一张图），不能讲到后面几样时画面不动。
- 用户要看图（「找几张图给我」「给我看看图」「多来几张」「要战斗的」）：这一页就是图集。用一个 list，写 "look":"gallery"，4 到 6 项；每项 img 写一个具体的搜索词：名字加上画面内容和「截图」「实拍」「海报」这类词（「影之刃零 雨夜剑客 战斗截图」「故宫 角楼 雪景 实拍」），每项的搜索词各不相同；h 写 2 到 6 个字说这张是什么；各挂在讲到它的那一段。这一页不画 draw，也不另放大照片。
- 第 0 段念出来时页面上就该有东西，不要让用户对着空白听好几句。
- {"op":"focus","id":"区块id/条目id","cue":段号}：声音念到这一段时，目光（荧光笔）移到这一条。V 从一项讲到下一项、或回头又讲某一项时写一个；一段最多一个。`;

// What a page drawn from V's own words is made of. A voice model that explains by itself has no
// author's picture hints (a lesson's `notes`), and the rules above were then read as "one photo
// for the topic": on a call of 11/23 an answer about a palace's halls and the kinds of things in
// its collection came out as seven lists of words, two of seventeen items pictured, no gallery.
// So the illustrator first judges what the answer is about; nothing in code does (no word lists).
// Which things, how many and under what search words is also where the image search's allowance
// goes (about one request a second), hence the count and the "written once" rule.
export const OPENING_PICTURES = 4;
const SUBJECT = `# 先看题材：这一页以照片为主，还是以图示为主
这一节只管没有 notes 的回答（V 用自己的话讲）。request 里有 notes 时跳过这一节，照 notes 点名的图示画：notes 写「list 带图」就是普通的 list，写「图集」才是 gallery。
没有 notes 时，先判断这段回答的题材，它决定整页长什么样：
- 题材是一组看得见的东西：一个景点或一座城市怎么逛、有什么可看（讲的是里面的几处地方和建筑）、一家博物馆的藏品和藏品的门类、一个菜系的几道菜、一个牌子的几款车、几种动物、几件作品、几位公众人物。这一页以照片为主：用一个 list 写 "look":"gallery"，一样东西一项，h 只写它的名字，img 写它的搜索词，d 写 V 说的它最值得看的一点（不超过 12 个字，可省）。V 每讲到一样就加一项，挂在开始讲它的那一段；讲了几样就有几项，不要只给其中一两样配图，也不要等 V 全讲完才画。屏幕上已经有一张 photo 也一样用图集。
  例：V 说「[0]西安头一个要看的是兵马俑，[1]几千个陶俑每张脸都不一样。[2]第二个是大雁塔，[3]傍晚有音乐喷泉。」→ {"op":"put","block":{"id":"g","t":"list","look":"gallery","items":[{"id":"a","h":"兵马俑","d":"每张脸都不一样","img":"西安 兵马俑 一号坑","cue":0},{"id":"b","h":"大雁塔","d":"傍晚有音乐喷泉","img":"西安 大雁塔","cue":2}]}}
- 图集里只放东西，不放话。路线、顺序、建议、特点、评价（「从南门进」「先坐缆车上山」「口味偏甜」「这两处最不能错过」）不是东西，不单独成项，也不另拆成 steps：说的是哪一处就写进那一处的 d，总的一句留到最后写成便签。一样东西的年代、来历、细节（「建于唐代」「高六十多米」）是它那一项的 d，不另起一项。V 刚开口、还只说了总的安排，没点到具体哪一样时，这一步输出 none，等它讲到第一样再画。
- 一类东西也看得见（藏品的门类、菜的类别、一个车系）：img 写「谁的 + 哪一类」（「苏州博物馆 瓷器」「粤菜 点心」「保时捷 911」）。单写类名搜不准，带上是谁的就搜得准，不要因为它是统称就不配图。
- 题材是两三样东西的比较：versus，sides 配图，逐项比的行不配图。
- 题材是看不见的道理（为什么、原理、怎么起作用、怎么算、规则、办法、来龙去脉）：用图示（draw、steps、flow、formula、stack…），整页不放照片，开场也不放：第 0 段要有东西，就放图示的第一样。话题里的名词拍得出照片也一样（问「高铁为什么这么快」「胃是怎么消化食物的」，不放高铁和胃的照片：照片讲不了道理）。讲道理时顺口提到的东西（讲通货膨胀时说到的超市，讲地震成因时说到的房子）也不配图。
- 一页的照片（主图、各项的图、比较两边的图）加起来最多 6 张，多出来的不会显示。V 讲的东西超过 6 样：先讲到的 6 样进图集，其余的写进另一个不带图的 list。
- 照片是按 img 的字去搜的，同样的字只搜一次。一样东西的 img 写定就不改：重发屏幕上已有的区块时，已有各项的 id、h、img 一个字都不动，只在后面加新讲到的项，给刚讲到的项补上 cue 和 d。
- request 里有 "unscripted":true（trigger 是 user，V 马上要用自己的话讲）而用户问的正是这样一组看得见的东西（「卢浮宫有什么必看的」「第一次去西湖怎么逛」「广州早茶有哪些点心」「保时捷有哪些车」）：scene 之后直接放开场图集，让用户在 V 开口前就看到要讲的东西。它就是上面那个 gallery：3 到 ${OPENING_PICTURES} 项，只放这个题材里最出名、你有十足把握属于它的东西，每项只写 id、h、img，不写 cue、d 和数字；这时不再放 photo。拿不准具体有哪几样，或者问的是最新的、要现查的事：只开页，或放一张这个题材整体的 photo（不要拿其中一样东西的照片当主图）。V 开口以后，讲到图集里已有的一样，就在那一项上补 cue 和 d；讲到没有的，接在后面。`;

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
  text = text.replace('\n输出：每行一个 JSON 操作', `\n${CUE}\n\n${SUBJECT}\n\n输出：每行一个 JSON 操作`);
  const left = text.split('\n').filter(line => /(^|[^A-Za-z])q([^A-Za-z]|$)/u.test(line));
  if (left.length) throw Error(`cue instructions: q left in ${left.map(line => line.slice(0, 40)).join(' | ')}`);
  return text;
}
export const CUE_INSTRUCTIONS = build();

/** The lesson writer's instructions with cues: pictures for things that can be seen, and every listed thing told in full. */
const SCRIPT_MORE = `
# 列举和配图
- 讲几样东西（几个城市、几个景点、几种做法）时，每一样都讲得一样细，各一到两句，说出它最值得看、最特别的一点；讲不完就少讲几样，三样讲透好过五样后面一句带过。最后的问题之前，每一样都已经讲到。
- 看得见的东西（地方、建筑、人物、角色、动物、食物、产品、作品）的画面提示写「list 带图：加一项 布拉格（配图 查理大桥）」这样，每样配它自己的照片；不要用 draw 去画城市和建筑。
- 用户要看图（「找几张图」「给我看看」「多来几张」）时，这次就是给他看图，不是教他去哪里找图、怎么搜：讲稿 4 到 6 句，一句介绍一张图。图是按搜索词现找的，你看不到它们：每句只说这张图是关于什么的、为什么值得看（「这张是主角魂的角色立绘」「这张是和 Boss 交手的场面」），不要描述画面里的颜色、天气、动作、血迹，也不要保证它是实机画面、官方图或高清；不要说「去 Steam 找」「搜的时候加关键词」。画面提示写「图集：加一张 X（搜 具体搜索词）」。`;
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
export function refineCueOp(op, {said = '', trigger = '', raw = null, unscripted = false} = {}) {
  if (!op) return null;
  if (op.op === 'scene') return {op: 'scene', title: op.title, lesson: true, late: true, ...(op.from ? {from: op.from} : {})};
  if (op.op === 'zone' || op.op === 'none' || op.op === 'title') return op;
  // The page's eye follows the voice through the cues; a fixed focus would fight it.
  if (op.op === 'focus' || op.op === 'del' || op.op === 'clear') return null;
  const quote = cue => cueQuote(said, cue);
  if (op.op === 'mark') { const q = trigger === 'user' ? '' : quote(raw?.cue); return q ? normalizeOp({...raw, q}) : null; }
  if (op.op !== 'put' || !raw?.block) return op;
  // Before V has spoken: the print of the thing asked about. Where V explains in its own words
  // (`unscripted`: no lesson is coming whose page this would get in the way of), also a page of
  // pictures of the things asked about. Their names and photographs only: nothing V may put
  // otherwise (no notes, no figures) and nothing that waits for the voice.
  if (trigger === 'user') {
    if (op.block.t === 'photo') return {op: 'put', block: (({q, ...block}) => block)(op.block)};
    if (!unscripted || op.block.t !== 'list' || op.block.look !== 'gallery') return null;
    const opening = normalizeOp({op: 'put', block: {id: op.block.id, t: 'list', look: 'gallery', items: op.block.items.filter(item => item.img).slice(0, OPENING_PICTURES).map(({id, h, img}) => ({id, h, img}))}});
    return opening?.block.look === 'gallery' ? opening : null;
  }
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

// The canvas (VOICE_BOARD_CANVAS=1; docs/research/board-canvas). Not another kind of page: the same
// blocks, with a pointer laid over them. The pointer goes to the written item V is on; a picture on the
// page (a print, the picture of a list's item, the two things of a comparison) grows when V gets to it,
// and the places V talks about are ringed on it by a model that has seen it (board-eye.mjs). So the
// illustrator's instructions stay today's, with a section on choosing pictures worth pointing at, and
// one more shape: a pitch with names placed on it.
const POINTER = `# 指针：讲到哪，指到哪
页面上有一个指针，像坐在用户旁边的老师。V 讲到一条文字，它停在那一条上；V 讲到一样有照片的东西，那张照片会在原地放大，指针飞上去，把讲到的部位圈出来（圈的位置由一双看得见照片的眼睛来定，你不用写，也不要写），讲过的圈自己消失，讲到下一样时这张缩回去、下一张放大。你照常用上面这些区块，只需要做对三件事：
- 讲到看得见的东西，就给它照片：一样东西（一只宝可梦、一座殿、一辆车）用 photo；几样东西一样一样讲（几件展品、几个景点、几座建筑、几个角色、几道菜）用一个 list 或 steps，每一项写 img，挂在 V **开始讲这一样**的那一段，d 写它最值得看的一点；两三样东西比外观用 versus，sides 写 img。不要只放一张总图就把里面的几样东西写成纯文字：介绍故宫讲到太和殿、中和殿、九龙壁，每处一项、每项一张自己的照片。
- 照片要拍得到 V 讲的部位：img、query 写具体的搜索词（「翠玉白菜 台北故宫 特写」「太和殿 正面 全景」「圣母百花大教堂 圆顶」「特斯拉 Model 3 正面」「超梦 全身 官方立绘」），每张各不相同。
- 带照片的条目只列 V 展开讲了的那几样（最多六样）；只是顺口提到的名字，不必配图。

pitch     {"id":"s","t":"stage","items":[{"id":"英文小写","h":"名字，不超过 6 个字","d":"位置，可省","at":[x,y],"cue":段号},…]}
只用于足球：V 按位置讲一套首发阵型（门将、后卫、中场、前锋各站哪）。每个球员一项，各挂在讲到他的那一段。球场竖着放，下边是自己的球门：x 从左边线 0 到右边线 1000，y 从对方球门线 0 到自己球门线 1000，按 V 说的位置摆（左路就在左边）。篮球等其他运动、不分位置的大名单、排名、数据榜不用它。`;
// (Before the section on what the answer is about, which is then the last thing read before the output's form.)
export const CANVAS_CUE_INSTRUCTIONS = CUE_INSTRUCTIONS.replace(`\n${SUBJECT}`, `\n${POINTER}\n\n${SUBJECT}`);
if (CANVAS_CUE_INSTRUCTIONS === CUE_INSTRUCTIONS || !CANVAS_CUE_INSTRUCTIONS.includes('# 指针：讲到哪，指到哪')) throw Error('canvas instructions: not placed');

/** The lesson writer's instructions for a canvas: a script that goes round what can be seen, a part at a time. */
const SCRIPT_STAGE = `
# 指针
- 屏幕上有一个指针跟着你的话走。讲到一样有照片的东西，它的照片会放大，指针在上面把你讲到的地方圈出来。
- 讲一样东西长什么样：一句讲一个照片上看得见的部位（「你看它脑袋后面，有一根管子连到后背」「它的尾巴又粗又长，是紫色的」），从显眼的讲到细节。画面提示写「照片：超梦 全身照」。
- 讲几样东西（几件展品、几个景点、几座建筑）：一样一样讲，每样两三句连着讲完再讲下一样，不要穿插；每样至少有一句说它看起来什么样、照片上该看哪里（「菜叶上停着两只小虫」「红色的大圆顶」「广场是斜的，像一只贝壳」）。画面提示写「list 带图：加一项 肉形石（配图 肉形石 特写）」。最多六样。
- 看不见的东西（年代、来历、路线、数字、提醒）照常讲，画面提示写成文字条目。`;
export const CANVAS_SCRIPT_INSTRUCTIONS = CUE_SCRIPT_INSTRUCTIONS + SCRIPT_STAGE;
