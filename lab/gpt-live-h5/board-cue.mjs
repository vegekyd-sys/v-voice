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
export function refineCueOp(op, {said = '', trigger = '', raw = null} = {}) {
  if (!op) return null;
  if (op.op === 'scene') return {op: 'scene', title: op.title, lesson: true, late: true, ...(op.from ? {from: op.from} : {})};
  if (op.op === 'zone' || op.op === 'none') return op;
  // The page's eye follows the voice through the cues; a fixed focus would fight it.
  if (op.op === 'focus' || op.op === 'del' || op.op === 'clear') return null;
  const quote = cue => cueQuote(said, cue);
  if (op.op === 'mark') { const q = trigger === 'user' ? '' : quote(raw?.cue); return q ? normalizeOp({...raw, q}) : null; }
  if (op.op !== 'put' || !raw?.block) return op;
  // Before V has spoken: the print of the thing asked about, nothing else (on a stage: its photographs).
  if (trigger === 'user') {
    if (op.block.t === 'photo') return {op: 'put', block: (({q, ...block}) => block)(op.block)};
    const pics = op.block.t === 'stage' ? op.block.items.filter(item => item.k === 'pic').map(({q, ...item}) => item) : [];
    return pics.length ? normalizeOp({op: 'put', block: {id: op.block.id, t: 'stage', base: op.block.base, items: pics, edges: []}}) : null;
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

// The canvas (VOICE_BOARD_CANVAS=1; docs/research/board-canvas): what can be seen goes up large on a
// stage - photographs, or a pitch - and V's pointer goes round it; what cannot be seen is written in the
// blocks above. The illustrator only chooses the photographs: the places on them are ringed later by a
// model that has seen them (board-eye.mjs).
const STAGE = `# 画布 stage：看得见的东西放大，指针在上面走
页面上有一个指针，像坐在用户旁边的老师：V 讲到哪里，它就飞到哪里。讲到文字条目，它停在那一条上；讲到看得见的东西，它飞到画布上那样东西的大照片上，把讲到的部位圈出来，讲过的圈自己消失。所以只要 V 讲的东西看得见，就给它一块画布。
stage     {"id":"s","t":"stage","base":"photo|tour|row|triangle|pitch","cue":-1,"items":[…],"edges":[["起点id","终点id","两三个字",cue],…]}
  照片：{"id":"a","k":"pic","img":"搜索词","h":"名字，不超过 8 个字","d":"一句看点，不超过 12 个字，可省","cue":段号}
  名字牌（只在球场上用）：{"id":"英文小写","k":"chip","h":"名字，不超过 6 个字","d":"位置，可省","at":[x,y],"cue":段号}
- 照片上的部位你不用写，也不要写：照片找到后，会有一双看得见照片的眼睛按 V 的话把讲到的部位一处处圈出来。你要做的是选对照片：img 写能清楚拍到要讲的那样东西的照片（「超梦 全身 官方立绘」「太和殿 正面 全景」「翠玉白菜 台北故宫 特写」「圣母百花大教堂 圆顶」「特斯拉 Model 3 正面」），每张的搜索词各不相同。
- base tour（最常用）：V 一样一样讲几样看得见的东西：几件展品、几个景点、几座建筑、几个角色、几位球员或人物、几道菜、几款产品。两到六样，每样一张照片，按讲的顺序写。屏幕上正在讲的那一张放大，指针在上面圈，讲过的排成一排小图。每张的 cue 写 V **开始讲这样东西**的那一段；d 写它最值得看的一点（「只有 18 厘米高」「红色大圆顶」）。V 提到了但没有展开讲的，不放。介绍一个大地方（故宫、一座城市、一个博物馆、一个国家）时，V 讲到里面几处具体的殿、馆、景点、展品，就是 tour：每处一张自己的照片，不要只放这个大地方的一张总图。
- base photo：从头到尾只讲一样东西长什么样、有哪些部位（一只宝可梦、一座殿、一辆车、一个产品），没有讲到别的看得见的东西。一张照片，cue -1。
- base row：两三样东西放在一起比外观，或者进化、前后变化：V 会在几张之间来回讲。按顺序从左到右，cue -1；进化、先后用 edges 箭头（「16级」「变成」）。
- base triangle：三样东西互相克制、转一圈。三张，第一张在上、第二张右下、第三张左下，edges 三条箭头。
- base pitch：只用于足球：V 按位置讲一套首发阵型（门将、后卫、中场、前锋各站哪）。不放照片，每个球员一个 chip，各挂在讲到他的那一段。球场竖着放，下边是自己的球门：x 从左边线 0 到右边线 1000，y 从对方球门线 0 到自己球门线 1000，按 V 说的位置摆（左路就在左边）。篮球等其他运动、不分位置的大名单、排名、数据榜，不用 pitch：讲到几位球员就用 tour 放他们的照片，名单和数字写成文字区块。
- screen 里已经有一块只放了一张总图的 stage（用户刚问完时先贴上去的），而 V 接着讲到几处具体的东西：把这块 stage 重写成 tour（同一个 id，总图可以留作第一张，cue -1），每处一张照片。
- 一页最多一个 stage，放在最前面。有 stage 的页面不再放 photo 区块，其他区块的条目不写 img，也不放 draw。
- 画布和文字怎么分：看得见的（长相、部位、外观、展品、景点、站位）交给 stage；看不见的（年代、来历、步骤、路线、规则、原因、数字、价格、对比的结论、提醒）写成 steps、timeline、list、versus、stats、sticky 里的条目，各挂在讲它的那一段。同一样东西只出现在一个地方：已经是画布上一张照片的东西（它的名字和看点已经在照片下面），文字区块里不再列一遍；文字区块只写照片上没有的；不要再建一个区块把每张照片的看点逐条写一遍。stage 之外最多再放 2 个区块，每块 2 到 5 条。
- 例：「介绍台北故宫」，V 先讲它在哪、什么时候建的，再讲翠玉白菜、肉形石、毛公鼎 → stage tour 三张（翠玉白菜、肉形石、毛公鼎，各挂在讲它的那一段），加一个 list 写「在外双溪」「1965 年落成」「藏品来自北京故宫」。
- 例：「介绍故宫」，V 讲了哪年建的、中轴线，再讲太和殿、中和殿、保和殿、珍宝馆、九龙壁 → stage tour 五张（每处一张），加一个 timeline 写「1406 开工」「1420 建成」，一张便签写「提前预约，周一闭馆」。
- 例：「佛罗伦萨怎么玩」，V 讲了大教堂、钟楼、领主广场、米开朗琪罗广场、乌菲兹 → stage tour 五张，加一个 steps 或 timeline 只写「第一天 / 第二天」怎么排，不把景点名再列一遍。
- 看不见实物的话题（流程、制度、原理、日程、新闻事件的经过、排名、建议）不要 stage，照旧只用文字区块，指针会在条目之间走。用户明说要看几张图（「多来几张图」「找几张图给我」）照旧用 list gallery。`;
const STAGE_SWAP = ['- 看得见的东西用照片，不用画：地方、城市、景点、建筑、人物、角色、动物、食物、产品、作品。讲到几个这样的东西，就用一个 list（或 timeline），每一项写 img（它自己的照片），各挂在讲它的那一段；不要只放一张大照片然后用 draw 去画其余的城市和建筑。',
  '- 看得见的东西用照片，不用画：地方、城市、景点、建筑、人物、角色、动物、食物、产品、作品。讲到一样或几样（最多六样）这样的东西，用 stage 给它们大照片（见「画布 stage」），不要用带 img 的 list 把它们缩成小图；超过六样才用 list（每一项写 img）。不要用 draw 去画城市和建筑。draw 只用来画照片拍不出来的：原理、几何、位置关系、内部结构（剖面）。'];
if (!CUE_INSTRUCTIONS.includes(STAGE_SWAP[0])) throw Error('canvas instructions: no photo rule to replace');
export const CANVAS_CUE_INSTRUCTIONS = CUE_INSTRUCTIONS.replace(STAGE_SWAP[0], STAGE_SWAP[1]).replace('- 形状、装置、光路、位置、构造，要画出来才看得懂 → draw', '- 装置、光路、位置关系、内部结构，照片拍不出来、要画出来才看得懂 → draw').replace('\n输出：每行一个 JSON 操作', `\n${STAGE}\n\n输出：每行一个 JSON 操作`);
if (CANVAS_CUE_INSTRUCTIONS === CUE_INSTRUCTIONS || !CANVAS_CUE_INSTRUCTIONS.includes('# 画布 stage')) throw Error('canvas instructions: not placed');

/** The lesson writer's instructions for a canvas: a script that goes round what can be seen, a part at a time. */
const SCRIPT_STAGE = `
# 画布
- 屏幕上有一个指针跟着你的话走。讲看得见的东西时，屏幕上会放它的大照片，指针在照片上把你讲到的地方圈出来。
- 讲一样东西长什么样：一句讲一个照片上看得见的部位（「你看它脑袋后面，有一根管子连到后背」「它的尾巴又粗又长，是紫色的」），从显眼的讲到细节。画面提示写「画布：超梦 全身照，圈 脑后的管子」。
- 讲几样东西（几件展品、几个景点、几座建筑、几位球员）：一样一样讲，每样两三句连着讲完再讲下一样，不要穿插；每样至少有一句说它看起来什么样、照片上该看哪里（「菜叶上停着两只小虫」「红色的大圆顶」「广场是斜的，像一只贝壳」）。画面提示写「画布：换到 肉形石 的照片，圈 一层层的纹路」。最多六样。
- 看不见的东西（年代、来历、路线、数字、提醒）照常讲，画面提示写成文字条目。`;
export const CANVAS_SCRIPT_INSTRUCTIONS = CUE_SCRIPT_INSTRUCTIONS + SCRIPT_STAGE;
