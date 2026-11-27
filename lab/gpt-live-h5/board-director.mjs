// The board director: a text model that watches a call and keeps a picture of
// it on the caller's screen. It runs beside the voice model, never in its
// audio path, and has no tools, permissions or say in what V does. Its output
// is validated line by line (board-scene.mjs) before anything reaches a page.
import {BOARD_LIMITS, applyOp, createLineParser, emptyScene, heroPhoto, loose, normalizeOp, pictureSubjects, sceneDigest, scenePictures, zoneDigest, zoneId} from './board-scene.mjs';
import {clauseOf, clauses} from './board-clause.mjs';
import {appendFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export const BOARD_TRIGGERS = Object.freeze(['user', 'assistant_progress', 'assistant_end', 'evidence']);
// Results of these lookups are facts the picture may show. Command output,
// device calls and control tools are not evidence.
const EVIDENCE_TOOLS = new Set(['web_search', 'web_fetch', 'memory_search', 'feishu_calendar', 'lark_read', 'delegate_to_v', 'current_time']);
const MAX_EVIDENCE = 4, EVIDENCE_CHARS = 3000, MAX_OPS = 24, OWNER_TTL_MS = 30 * 60000;
// The photographs of one page drawn from V's own words. Each is a search (about one a second, a
// monthly allowance), and a phone's page has no room for more.
export const PAGE_PICTURES = 6;

export const BOARD_INSTRUCTIONS = `你是 V 的「画面导演」。V 正在和用户语音通话，用户的耳朵在听 V，眼睛看着通话屏幕上的一页手账：V 一边讲，一边在上面写字、贴便签、贴照片，用笔圈重点。你不说话，只负责决定这一页上此刻放什么，让用户比只听更快看懂，也看得有意思。

# 输出
每行一个 JSON 对象（JSON Lines）。不要输出任何别的文字、解释或代码块标记。前面的行会先显示出来，所以先写最重要的。

{"op":"none"} 这一刻不改画面。寒暄、确认、闲聊、一句话就能说清的回答、还没有实际内容时，都只输出这一行。
{"op":"scene","title":"…"} 开一张新画面。只有话题换了才用；同一话题继续补充、修改、追问时不要重开，也不要为了改内容把同一张重画一遍。旧画面会留到新画面的第一个区块出现为止，所以 scene 后面要紧跟 put；内容还没到就先不要 scene。title 不超过 14 个字。
{"op":"put","block":{…}} 放入一个区块；block.id 已存在就是替换它。
{"op":"title","title":"…"} 把当前这张画面的标题重写一遍，内容不动。只在标题的语言和 V 说话的语言不一样时用。
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

条目是 {"id","h","d"?,"icon"?,"img"?,"mark"?,"q"?}。compare 的每个选项和 flow 的每个节点也可以带 img。

img：这一条讲的那个东西的图。写它的通用名称（如「皮卡丘」「杰尼龟」「iPhone 17」「故宫」），系统会去找一张它的图贴在这一条旁边。讲的是看得见、叫得出名字的东西时就配：角色、动物、地点、人物（公众人物）、产品、食物、作品。一张画面里几个东西各配各的图，最多 6 张。有 img 就不用再写 icon。

icon：一个贴切的 emoji，放在条目前面。具体的事物、动作、类别适合配；配不出贴切的就不写，不要拿 ✅📌💡 这类万能符号凑数。
mark：V 的笔在这一条上留下的记号。ring 圈出最关键的那一个（结论、最大的数字、推荐的选项）；underline 划重点；check 表示对的、推荐的、已完成的；cross 表示错的、不推荐的、没完成的；star 特别值得注意。一张画面里 mark 最多 3 个，圈得多就没有重点了。
tone：给区块换一张彩色纸，butter、peach、sky、lilac、blush 之一。sticky 默认是 butter。
q：条目的「讲到这里」标记。从 V 的原话里原样抄 4 到 10 个连续的字，取 V 开始讲这一条的那几个字。V 的声音播到这几个字时，这一条会从铅笔变成墨水，笔迹也在这时画上去。只有 V 确实讲到的条目才写 q，必须一字不差地抄自 conversation 里 V 的话；V 还没讲到的条目先不写，等讲到了再用 put 补上。

photo 是整张画面的主图：话题就是某一个看得见的东西（一座塔、一种动物、一个角色）时贴一张，query 写它的通用名称。抽象概念、流程、用户身边的人和私事不要配图。

给小朋友讲、或者用户说「看不懂」「配点图」的时候，少写字、多配图：每条 h 只留名字或三五个字，d 能省就省，能配 img 的都配上；互相克制、循环、谁赢谁这类关系用 flow，把每个东西的图放在节点上。

# 语言
请求里的 language 是 V 说话的语言；没有 language 时，看 conversation 里最后一段 V 的话是什么语言（V 还没说过话，就看用户的话）。用户刚要求了换一种语言讲（「用英语说」），就用他要的那种。这一次你写的每一个字——标题、条目的 h 和 d、便签、标注、图上的字——都用这种语言：V 说法语就写法语，说英语就写英语，说中文就写中文。
别的都不算数：画面上已经有的字、更早的对话、别的页、查到的资料（evidence）是什么语言，都不决定你写什么语言。电话里的人会中途换语言（刚才说法语，现在说中文），画面要马上跟着换；资料是中文、V 用法语讲，画面就写法语。
画面上已有的字如果不是这种语言，这一次就换过来：标题用 title 重写，区块用同一个 id 整块改写成这种语言（意思不变，只换语言），再接着补新的内容。不要留着两种语言，更不要因为画面上是另一种语言就接着用那种语言写。
人名、店名、作品名这类专有名词照 V 说的写，不翻译。照片的搜索词（img、query）不受这一条限制，写最容易搜到图的说法。下面的字数限制是对中文说的，别的语言按差不多的长短来。

# 怎么画
1. 画面是给眼睛的，要像 V 随手记在本子上的：有重点，有一点俏皮，不是汇报材料。用词和短语，不抄 V 说的话。h 不超过 12 个字，d 不超过 30 个字。一张画面 1 到 3 个区块，条目加起来不超过 12 条；追问展开时超出了，就 del 掉已经讲完、不再需要的区块。
2. 选最贴合内容形状的区块：有先后的过程用 steps，取舍用 compare，数字用 stats 或 bars；flow 只用于有分叉、汇合或回路的关系，一条直线的顺序用 steps。不要什么都用 list。主区块之外，常常值得再贴一张 sticky 写结论。用户问「哪个更好」「选哪个」「A 还是 B」，而 V 讲了两边各自的理由时，新开一张 compare，V 倾向的一边加 tag。
3. 具体事实（日程、数字、人名、状态、搜索到的信息）只能来自对话、evidence 和 V 说出的话，没有依据就不画，绝不编造。事实还没到就输出 none，不要画「查询中」「稍等」这类占位。讲通用知识（原理、概念）时，可以用你自己的知识搭结构。V 的看法、建议和取舍理由以 V 说的为准，不要替 V 补它没说过的理由。
4. 同一话题里优先小改：用 put 同一个 id 改写区块，用 focus 跟着 V 讲到的位置走，不要每次重画。用户说「第二步」「左边那个」「这个」时，对应到画面上已有的 id。
5. id 用短的英文或数字，如 "s1"、"a"，一张画面内不重复。
6. trigger 说明你为什么被叫起来：
   user：用户刚说完，V 还没开口。只有问的是通用知识的讲解（原理、流程、概念、某个有名的事物），才可以先把骨架搭好：标题、照片、条目的名称。这时不要写具体的数字、年份、数量——V 说的可能和你记的不一样，画面和声音对不上最糟糕；数字等 V 说出来再按 V 的填。问 V 的看法、建议、怎么选，或者问的是用户自己的事（日程、项目、状态），一律 none，等 V 说了再画，不要替 V 先下结论。
   assistant_progress：V 正在讲，话还不完整（文字比声音先到）。画面空着就按 V 已经讲出的内容搭；已有画面就只修正当前这张的条目、补上 q。这时不要 scene 换画面：V 可能只是顺口举了个例子。
   assistant_end：V 的话已经完整。核对画面和 V 实际说的是否一致，有出入就改成 V 说的。这时画面上每个 V 讲到的条目都应该带 q，缺的用 put 整块补上；内容和 q 都对就 none。
   evidence：工具结果或后台结果刚到，把里面值得看的事实放上去。

屏幕上如果已经有 tiles、formula、timeline、versus、overlap、stack、scale、draw 这几种区块，那是讲解时留下的图示：原样保留，不要重画、改写或删除它们；要补充就另加一个你会用的区块。`;

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
/** A lesson's script that asks for a picture to be drawn (a line's hint reads「现画：…」). */
const drawsInNotes = notes => (notes?.lines ?? []).some(line => /现画/u.test(String(line?.show ?? '')));
/** A lesson's script that shows photographs: a line's hint names a photo, a pictured item or a page of pictures
 * (the words of the hint vocabulary the writer is given, SCRIPT_INSTRUCTIONS). */
const photosInNotes = notes => (notes?.lines ?? []).some(line => /^\s*(?:photo|照片)\s*[：:]|配图|带图|图集|gallery/iu.test(String(line?.show ?? '')));
/**
 * Whether a picture may be drawn for this lesson's page now. Only for a lesson that has nothing to show:
 * a drawn picture next to the lesson's photographs is one more than the page needs, and paid for
 * (11/21–27: nine of the ten drawn for the owner's lessons went up beside one to six photographs).
 * The lesson's photographs are those its script asks for and those put up since it arrived; a print
 * put up on the caller's question before there was a script is not one (a bedtime story drawn line by
 * line was otherwise left with that print alone, 11/28). Not for a page already full either: the
 * picture was made and never shown (11/24, 11/25). Once per answer.
 */
const lessonPhotos = row => [...scenePictures(row.scene)].filter(query => !row.opening?.has(query)).length;
const mayDraw = (row, scripted, shelf, id) => scripted && drawsInNotes(row.notes) && !photosInNotes(row.notes) && lessonPhotos(row) === 0
  && row.scene.blocks.length < 4 && Boolean(shelf?.canMake?.(id)) && row.madeFor !== (row.turnNo ?? 0);
/** A lesson's script that asks for a page of pictures (a line's hint reads「图集：…」). */
const galleryInNotes = notes => (notes?.lines ?? []).some(line => /图集|gallery/iu.test(String(line?.show ?? '')));

/**
 * The language V is speaking, named by the board's own model from V's words.
 * A director told only "write in the language of V's last words" went on in the language of the page
 * that was up: a call that came back after a French conversation had its pages written in French for
 * two minutes while V and the caller spoke Chinese (11/24). Asked with the language's name in the
 * request, it rewrote such a page in nine of ten.
 */
export const LANGUAGE_INSTRUCTIONS = '下面是电话里一个人说的一段话（语音转写，可能夹着别的语言的词）。它主要是用哪种语言说的？只输出这种语言的名字：用这种语言自己的叫法，后面括号里写中文名，例如「français（法语）」「English（英语）」「日本語（日语）」；中文就写「中文」。不要输出别的。';
export async function nameLanguage({complete, words, signal}) {
  let out = '';
  for await (const chunk of complete({messages: [{role: 'system', content: LANGUAGE_INSTRUCTIONS}, {role: 'user', content: Array.from(String(words)).slice(0, 120).join('')}], signal})) out += chunk;
  const name = out.trim().split('\n')[0].replace(/^[「"'『]+|[」"'』。.]+$/gu, '').trim();
  return name && Array.from(name).length <= 30 ? name : '';
}

export function boardRequest({trigger, scene, turns, evidence, notes = null, recent = [], canvas = [], page = null, assets = [], make = false, unscripted = false, language = ''}) {
  return JSON.stringify({
    trigger,
    ...(unscripted ? {unscripted: true} : {}),
    ...(assets.length ? {assets} : {}),
    ...(make ? {make: true} : {}),
    ...(page ? {page} : {}),
    ...(canvas.length ? {canvas} : {}),
    ...(notes ? {notes} : {}),
    ...(recent.length ? {recent} : {}),
    screen: sceneDigest(scene) ?? '（画面现在是空的）',
    ...(evidence.length ? {evidence: evidence.map(item => ({tool: item.name, result: item.text}))} : {}),
    conversation: turns,
    // (Last, next to the words it is the language of: a page already up in another language was otherwise carried on in that language.)
    ...(language ? {language} : {}),
  });
}

/**
 * One director per service. `complete({messages, signal})` yields text chunks.
 * Each owner (a voice session) has its own scene; a new run for the same owner
 * retires the one still writing.
 */
const itemsOf = block => block.t === 'compare' ? block.cols : block.t === 'flow' ? block.nodes : block.items ?? [];
// Whether `next` is `old` with more on it: same kind, same photograph, the same items in the same order first.
const growsFrom = (old, next) => old.t === next.t && (old.t !== 'photo' || old.query === next.query)
  && itemsOf(old).every((item, index) => itemsOf(next)[index]?.id === item.id);
// `block` without pictures the page already shows (another block's, or its own twice); a second large print is dropped (null).
// `most`: how many pictures the page may hold in all; an item past that keeps its words and loses its picture.
function picturedOnce(block, scene, most = Infinity) {
  const others = scene.blocks.filter(other => other.id !== block.id), used = new Set();
  for (const other of others) { if (other.t === 'photo') used.add(other.query); for (const item of [...itemsOf(other), ...(other.sides ?? [])]) if (item.img) used.add(item.img); }
  // (A made thing is the page's large print: no photograph is hung beside it.)
  if (block.t === 'photo') return used.has(block.query) || used.size >= most || others.some(other => other.t === 'photo' || other.t === 'work') ? null : block;
  // (Made things may share a page: a set of pictures made one after another. Four at most.)
  if (block.t === 'work') return others.filter(other => other.t === 'work').length >= 4 ? null : block;
  // (A thing written twice in one list, its second picture the first one's or none: once is enough.
  // Only a list: elsewhere an item is a step, a node an arrow ends at, one of a fixed three.)
  const mine = new Set();
  const once = item => {
    if (block.t === 'list' && mine.has(item.h) && (!item.img || used.has(item.img))) return null;
    if (!item.img) return item;
    if (used.has(item.img) || used.size >= most) { const {img, ...rest} = item; return rest; }
    used.add(item.img); mine.add(item.h);
    return item;
  };
  const next = {...block};
  // (The two or three things a comparison is between keep their pictures: a header with one picture missing reads as broken.)
  for (const side of next.sides ?? []) if (side.img) used.add(side.img);
  for (const key of ['cols', 'nodes', 'items']) if (Array.isArray(next[key])) next[key] = next[key].map(once).filter(Boolean);
  return next;
}
// `next` with the pictures `old` already has for the same things (same id, same name). A picture is
// searched for by its words, and the illustrator, asked again every couple of seconds while V
// speaks, may word the same thing anew ("钟楼", then "老城 钟楼 全景"): the page would search
// twice and the picture change under the caller's eyes.
function samePictures(old, next) {
  const out = {...next}, name = item => item.h ?? item.label ?? '';
  for (const key of ['cols', 'nodes', 'items']) if (Array.isArray(next[key]) && Array.isArray(old[key])) {
    const had = new Map(old[key].filter(item => item.img).map(item => [item.id, item]));
    out[key] = next[key].map(item => { const was = had.get(item.id); return was && name(was) === name(item) && item.img !== was.img ? {...item, img: was.img} : item; });
  }
  if (Array.isArray(next.sides) && Array.isArray(old.sides)) out.sides = next.sides.map((side, index) => { const was = old.sides[index]; return was?.img && was.h === side.h && side.img !== was.img ? {...side, img: was.img} : side; });
  return out;
}
/**
 * The list on the page (`old`) with what `next`, the same list written again, adds to it: null when
 * the two share no item (then `next` is another list). The illustrator is asked again as V goes on
 * and often leaves out what V has not come to, or numbers the items anew; that used to make a
 * second and a third list of the same things beside the first (three of one page's four blocks).
 * What is on the page stays, in its order; an item written again (the same name) takes the new
 * wording and keeps what the new one leaves out; new names follow. The rows of a comparison
 * between the same things likewise.
 */
function grownList(old, next) {
  if (old.t !== next.t || !['list', 'steps', 'timeline', 'versus'].includes(old.t)) return null;
  if (old.t === 'versus' && old.sides.map(side => side.h).join('|') !== next.sides.map(side => side.h).join('|')) return null;
  const again = new Map(next.items.map(item => [item.h, item]));
  if (!old.items.some(item => again.has(item.h))) return null;
  const taken = new Set(old.items.map(item => item.id)), names = new Set(old.items.map(item => item.h));
  const added = next.items.filter(item => !names.has(item.h)).map(item => {
    let id = item.id;
    for (let number = 2; taken.has(id); number++) id = `${item.id}${number}`.slice(-24);
    taken.add(id);
    return id === item.id ? item : {...item, id};
  });
  return {...next, ...(old.look ? {look: old.look} : {}), items: [...old.items.map(item => again.has(item.h) ? {...item, ...again.get(item.h), id: item.id} : item), ...added].slice(0, BOARD_LIMITS.items)};
}
/**
 * `block` (a list about to go on `scene`) without the pictures V has not come to, where the page
 * would otherwise hold more than `most`. A page of pictures put up on the caller's question is a
 * guess at what V will tell: when V tells other things, a guess still hanging on none of V's words
 * (`heard`: what V has said, loosely) gives up its place rather than the thing V is telling.
 */
function guessesYield(block, scene, most, heard) {
  if (!Array.isArray(block.items) || !Number.isFinite(most)) return block;
  const shown = new Set();
  for (const other of scene.blocks) if (other.id !== block.id) { if (other.t === 'photo') shown.add(other.query); for (const item of [...itemsOf(other), ...(other.sides ?? [])]) if (item.img) shown.add(item.img); }
  for (const item of block.items) if (item.img) shown.add(item.img);
  const over = shown.size - most;
  if (over <= 0) return block;
  const untold = block.items.filter(item => item.img && !item.q && !(loose(item.h).length >= 2 && heard.includes(loose(item.h)))).slice(-over).map(item => item.id);
  return untold.length ? {...block, items: block.items.filter(item => !untold.includes(item.id))} : block;
}
// An answer worth a picture: a few sentences, or anything that follows a lookup.
const worthDrawing = (said, looked) => { const length = Array.from(said.replace(/\s+/gu, /[A-Za-z]{4}/u.test(said) ? ' ' : '')).length, latin = /^[\x00-\x7f]*$/u.test(said.slice(0, 40)); return length >= (looked ? 16 : latin ? 150 : 56); };
// Words that usually bring a lesson (board-lesson.mjs) rather than a picture drawn after the fact.
export const mayAskForLesson = text => /讲解|解释|讲讲|讲一|科普|再讲|再说一遍|搞不懂|听不懂|没听懂|没懂|给我看|\bexplain\b/iu.test(String(text ?? ''));
/** `defers(text)`: the caller's words for which the first guess is left to someone else (lesson mode). */
/**
 * `illustrate({owner, asked, said, evidence, screen, signal})`: with it the
 * board has one way of drawing (board-lesson.mjs). The line-by-line director
 * below is not used: once V's answer is complete as text (seconds before its
 * audio ends) the answer is illustrated in the lesson's own vocabulary, and
 * shown as V's voice reaches each piece. Returns {ops, add} or null.
 */
/**
 * `stream: {instructions, refine(op, {said, trigger})}`: the streaming
 * illustrator (board-lesson.mjs). The same line-by-line loop as below, but in
 * the lesson's vocabulary, hung on V's real words, and shown as the voice
 * reaches each piece. Takes precedence over `illustrate` (its one-shot form).
 */
/**
 * The model's reply, or a second request's when the first has said nothing
 * within `afterMs` (one answer in a call took 9.5 s to start while the caller
 * looked at an empty page). Whichever speaks first is used; the other is dropped.
 */
export async function* hedged(complete, {messages, signal}, afterMs = 2500, setTimer = setTimeout, clearTimer = clearTimeout) {
  const runs = [];
  const start = () => {
    const controller = new AbortController(), stop = () => controller.abort();
    if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, {once: true});
    const iterator = complete({messages, signal: controller.signal})[Symbol.asyncIterator]();
    const run = {controller, iterator};
    run.first = iterator.next().then(result => ({run, result}), error => ({run, error}));
    runs.push(run);
  };
  start();
  let timer = null;
  const late = new Promise(resolve => { timer = setTimer(() => resolve(null), afterMs); });
  let won = await Promise.race([runs[0].first, late]);
  if (!won && !signal?.aborted) {
    start();
    won = await Promise.race(runs.map(run => run.first));
    if (won.error) won = await runs.find(run => run !== won.run).first;
  } else if (!won) won = await runs[0].first;
  clearTimer(timer);
  for (const run of runs) if (run !== won.run) { run.controller.abort(); Promise.resolve(run.iterator.return?.()).catch(() => {}); }
  if (won.error) throw won.error;
  let result = won.result;
  while (!result.done) { yield result.value; result = await won.run.iterator.next(); }
}

/**
 * `eye: {find(query), see({shots, said, signal, from, to})}` (board-eye.mjs): after a streamed run the
 * page's pictures are looked at and the places V talks about are pinned on them (scene.pins).
 */
export function createBoardDirector({complete, now = Date.now, audit = () => {}, record = () => {}, maxOwners = 64, defers = () => false, illustrate = null, stream = null, prefetch = null, hedgeMs = 2500, eye = null, hear = null} = {}) {
  // The call's shelf of made things (board-assets.mjs), set by the service once both exist.
  let shelf = null;
  // Pictures a page will need are asked for the moment the page knows of them, not when the page gets round to showing them.
  const wanted = new Set();
  const fetchAhead = scene => { if (!prefetch) return; for (const query of scenePictures(scene)) if (!wanted.has(query)) { wanted.add(query); if (wanted.size > 400) wanted.delete(wanted.values().next().value); Promise.resolve().then(() => prefetch(query)).catch(() => {}); } };
  // How a page drawn by the stream follows the voice (cues the model wrote) and whether it has the canvas's pointer.
  const flags = {...(stream?.cue ? {cue: true} : {}), ...(stream?.canvas ? {canvas: true} : {})};
  const owners = new Map();
  const owner = id => {
    let row = owners.get(id);
    if (!row) {
      const drop = key => { owners.get(key).controller?.abort(); owners.delete(key); };
      for (const [key, old] of owners) if (now() - old.touched >= OWNER_TTL_MS) drop(key);
      while (owners.size >= maxOwners) drop(owners.keys().next().value);
      row = {scene: emptyScene(), evidence: [], controller: null, window: now(), count: 0, touched: now(), heldUntil: 0, heldAt: 0};
      owners.set(id, row);
    }
    row.touched = now();
    return row;
  };
  // Every page of a call's canvas, oldest first, and the one V is on.
  const canvasOf = row => ({zones: [...(row.zones ?? []).filter(zone => zone.serial !== row.scene.serial), row.scene].sort((a, b) => a.serial - b.serial), active: zoneId(row.scene)});
  const stateOf = row => ({scene: row.scene, ...(stream || row.zones?.length ? {canvas: canvasOf(row)} : {})});
  // A page with something on it goes onto the canvas beside the others when V moves to another.
  const shelvePage = row => { row.zones ??= []; if (row.scene.blocks.length) row.zones = [...row.zones.filter(zone => zone.serial !== row.scene.serial), row.scene].sort((a, b) => a.serial - b.serial).slice(-7); };
  const lessonPage = scene => ({...scene, lesson: true, late: true, ...(stream?.cue ? {cue: true} : {})});
  const api = {
    available: Boolean(complete),
    log: record,
    /** The call's shelf of made things: the illustrator may hang them, and may ask for one to be made. */
    set shelf(value) { shelf = value ?? null; },
    /**
     * Hang a made thing (board-assets.mjs) on the call's canvas, whoever asked for it and whatever
     * the illustrator is doing. A new version of a thing already up (a picture changed, or made to
     * move) takes that thing's frame; otherwise it gets the page opened for this very request, or one of its own.
     */
    place(id, {asset, family = [], title = '', turn = false, gone = []} = {}) {
      if (typeof asset !== 'string' || !/^a[1-9]\d{0,2}$/u.test(asset)) return false;
      const row = owner(id);
      // `turn`: the caller has just asked for this very thing. The turn's picture is then the made
      // thing and nothing else: whatever the illustrator drew for the turn so far (a page opened
      // under the request's words, a photograph of its subject, a list of V's "on it") is taken
      // back, and it draws no more this turn. In call of 11/21 each request left two pages, one
      // drawn and one made, and the view went back and forth between them. (A lesson told in the
      // same turn keeps its page: it has its own script.)
      if (turn && row.turn && row.turn.no === row.turnNo && row.lessonTurn !== row.turnNo) {
        row.controller?.abort();
        if (row.scene !== row.turn.scene) { row.zones = row.turn.zones; row.scene = {...row.turn.scene, rev: row.scene.rev + 1}; }
        row.makingTurn = row.turnNo;
      }
      // The frame of a thing that was not made (call of 11/21: an edit the provider refused) has said so
      // long enough: it leaves the page V is on as the next thing goes up. A thing left alone has the width again.
      if (gone.length && row.scene.blocks.some(block => block.t === 'work' && gone.includes(block.asset))) {
        const kept = row.scene.blocks.filter(block => !(block.t === 'work' && gone.includes(block.asset)));
        const alone = kept.filter(block => block.t === 'work').length < 2;
        row.scene = {...row.scene, blocks: kept.map(block => { if (block.t !== 'work' || !alone || !block.w) return block; const {w, ...rest} = block; return rest; }), rev: row.scene.rev + 1};
      }
      const pages = [row.scene, ...(row.zones ?? []).filter(zone => zone.serial !== row.scene.serial)];
      const holds = (page, which) => page.blocks.some(block => block.t === 'work' && which.includes(block.asset));
      if (pages.some(page => holds(page, [asset]))) return false;
      // (`family`: the other versions of the same thing. Whichever of them is up gives its frame to the new one.)
      const home = family.length ? pages.find(page => holds(page, family)) : null;
      const block = {id: `w${asset.slice(1)}`, t: 'work', asset};
      let how = 'page';
      if (home) {
        const blocks = home.blocks.map(other => other.t === 'work' && family.includes(other.asset) ? {...other, asset} : other);
        if (home !== row.scene) { shelvePage(row); row.zones = row.zones.filter(zone => zone.serial !== home.serial); }
        row.scene = {...home, blocks, rev: Math.max(home.rev, row.scene.rev) + 1, focus: ''};
        how = 'version';
      } else if (row.scene.blocks.some(other => other.t === 'work') && row.scene.blocks.filter(other => other.t === 'work').length < 4 && row.scene.blocks.length < BOARD_LIMITS.blocks) {
        // The page V is on already holds made things: the next one joins them (a set of pictures
        // made one after another is one page, not a page each). Side by side from the second on.
        const blocks = [...row.scene.blocks, block].map(other => other.t === 'work' ? {...other, w: 'half'} : other);
        row.scene = lessonPage({...row.scene, blocks, pending: null, focus: '', rev: row.scene.rev + 1});
        how = 'joined';
      } else if (!row.scene.blocks.length) {
        // Nothing on the page V is on (the start of a call, or a page only just named): the thing takes it.
        row.pages = Math.max(row.pages ?? 0, row.scene.serial, ...(row.zones ?? []).map(zone => zone.serial));
        const serial = row.scene.serial || ++row.pages;
        row.scene = lessonPage({...row.scene, serial, title: row.scene.title || Array.from(String(title ?? '')).slice(0, 14).join(''), blocks: [block], pending: null, focus: '', rev: row.scene.rev + 1});
        row.openedAt = now();
      } else {
        // A page of its own, beside the one V was on and further on from it: the view only ever moves forward.
        const before = row.scene.title ? {from: zoneId(row.scene)} : {};
        shelvePage(row);
        row.pages = Math.max(row.pages ?? 0, row.scene.serial, ...(row.zones ?? []).map(zone => zone.serial)) + 1;
        row.scene = lessonPage({...emptyScene(), rev: row.scene.rev + 1, serial: row.pages, title: Array.from(String(title ?? '')).slice(0, 14).join(''), blocks: [block], ...before});
        row.openedAt = now();
      }
      row.workTurn = row.turnNo;
      record({type: 'board.place', voiceSessionId: id, asset, how, page: zoneId(row.scene), rev: row.scene.rev});
      return true;
    },
    /** A made thing has been looked at and named: its page, if it has no title yet, takes the name. */
    retitle(id, asset, title) {
      const row = owners.get(id), name = Array.from(String(title ?? '').trim()).slice(0, 14).join('');
      if (!row || !name) return false;
      const holds = page => !page.title && page.blocks.some(block => block.t === 'work' && block.asset === asset);
      if (holds(row.scene)) { row.scene = {...row.scene, title: name, rev: row.scene.rev + 1}; return true; }
      const zone = (row.zones ?? []).find(holds);
      if (!zone) return false;
      row.zones = row.zones.map(page => page === zone ? {...zone, title: name, rev: zone.rev + 1} : page);
      row.scene = {...row.scene, rev: row.scene.rev + 1};
      return true;
    },
    /** A page's whole view of the call's board, for a page that asks outside a run. */
    state(id) { const row = owners.get(id); return row ? stateOf(row) : {scene: emptyScene()}; },
    /** The whole canvas of a call (see board-scene.mjs normalizeCanvas). */
    canvas(id) { const row = owners.get(id); return row ? canvasOf(row) : {zones: [], active: ''}; },
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
    /** Whether pages are drawn by the streaming illustrator (then a lesson is a script with notes, not a page). */
    streams: Boolean(stream),
    /** The author's notes for a script V is about to speak: {title, script, lines: [{say, show}]}. */
    note(id, notes) {
      const row = owner(id);
      // (The pictures up before this lesson's script: the page opened on the caller's question. They are not the
      // lesson's own pictures, so they do not stand in the way of the one it may draw: see mayDraw.)
      if (!row.notes || row.lessonTurn !== (row.turnNo ?? 0)) row.opening = new Set(scenePictures(row.scene));
      row.notes = notes; row.expectUntil = 0; row.lessonTurn = row.turnNo ?? 0;
      // The script is known before V has said a word of it: its page is started now,
      // not when the caller's screen comes back to ask (about a second and a half later).
      // Its first lines (`partial`) start the page while the rest is written; the whole
      // script then adds to that page, after the first run has finished, never cutting it off.
      if (!(stream && complete && notes?.script)) return;
      const draw = () => api.run({owner: id, trigger: notes.partial ? 'assistant_progress' : 'assistant_end', ahead: true, clientRev: row.scene.rev,
        turns: [...(notes.ask ? [{role: 'user', text: String(notes.ask)}] : []), {role: 'assistant', text: notes.script}]}).catch(() => {});
      const chain = row.aheadChain = (row.aheadChain ?? Promise.resolve()).then(draw).finally(() => { if (row.aheadChain === chain) row.aheadChain = null; });
    },
    /** A script is being written for the caller's question: what V says meanwhile is not the answer. */
    expect(id, ms = 20000) {
      const row = owner(id); row.expectUntil = ms > 0 ? now() + ms : 0;
      if (ms > 0) row.lessonTurn = row.turnNo ?? 0;
      // (A page being drawn from V's "let me think how to put it" is dropped: that line is not the answer.
      // The title and print drawn for the caller's question are kept: in call b101ecc7 the lesson
      // tool arrived while they were being drawn, and two of five questions got no title at all.)
      if (ms > 0 && !row.ahead && row.controllerTrigger !== 'user') row.controller?.abort();
    },
    /**
     * A lesson is being written for this call: stop drawing (a run in flight
     * is dropped) until it is presented or released. What is on the page stays.
     */
    hold(id, holdMs = 20000) {
      const row = owner(id);
      row.controller?.abort();
      row.heldUntil = now() + holdMs; row.heldAt = now();
    },
    release(id) { const row = owners.get(id); if (row) row.heldUntil = 0; },
    /** Put a prepared picture (a lesson) on a call's board and keep the director's hands off it for `holdMs`. */
    gallery(id,title,items){
      const row=owner(id);row.controller?.abort();shelvePage(row);
      row.pages=Math.max(row.pages??0,row.scene.serial,...(row.zones??[]).map(z=>z.serial))+1;
      const block=normalizeOp({op:'put',block:{id:'photos',t:'list',look:'gallery',items:items.map(p=>({h:p.name,img:p.query}))}}).block;
      row.scene={...emptyScene(),serial:row.pages,rev:row.scene.rev+1,title,blocks:[block]};
      row.heldAt=now();row.heldUntil=row.heldAt+12000;row.makingTurn=row.turnNo;
    },
    present(id, ops, holdMs = 0) {
      const row = owner(id);
      row.controller?.abort();
      // A lesson replaces whatever is up at once: its first piece is already there.
      row.scene = {...row.scene, blocks: [], pending: null, title: ''};
      for (const op of ops) row.scene = applyOp(row.scene, op);
      row.heldUntil = now() + holdMs; row.heldAt = now();
    },
    /**
     * Run the director once. `onOp` receives each applied operation with the
     * scene revision it produced; a page whose revision differs from the
     * service's first receives the whole scene.
     * `unscripted`: in this call V explains in its own words and is never handed a lesson's script,
     * so a page of pictures may be opened on the caller's question alone (see board-cue.mjs).
     */
    async run({owner: id, trigger, turns, clientRev = 0, onOp = () => {}, signal, ahead = false, quiet = false, unscripted = false} = {}) {
      const started = now(), row = owner(id);
      // (`quiet`: not the owner's call. Its words and its picture are not kept.)
      if (quiet) row.quiet = true;
      // (A script's runs share their watchers: a screen that joined the first lines' run sees the whole script's too.)
      const listeners = ahead ? (row.watchers ??= new Set()) : new Set(), out = onOp;
      onOp = value => { out(value); for (const listener of listeners) listener(value); };
      const drawn = [];
      const report = (reason, extra = {}) => {
        const result = {reason, durationMs: now() - started, ...extra};
        audit({type: 'board.run', voiceSessionId: id, trigger, ...result});
        // What was asked and what was drawn, for looking back at a call. Private; not the call log.
        record({type: 'board.run', voiceSessionId: id, trigger, ...result, ...(row.quiet ? {shapes: drawn.map(op => op.op === 'put' ? 'put:' + op.block.t : op.op)} : {heard: turns?.at(-1) ?? null, drawn})});
        return result;
      };
      if (!complete) return report('unavailable');
      if (now() - row.window > 15 * 60000) { row.window = now(); row.count = 0; }
      if (++row.count > 400) return report('rate_limited');
      // A script's page is already being drawn (see `note`): the caller's screen watches that
      // run instead of starting another. Only the caller speaking again ends it.
      const script = text => String(text ?? '').replace(/\s+/gu, '').slice(0, 24);
      // V is reading the script: from its first words, or (a reading that was interrupted and picks up
      // again, a voice whose captions arrive a clause at a time) from somewhere inside it.
      const letters = text => String(text ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
      const reads = (heard, written) => { const said = letters(heard).slice(0, 24), script = letters(written); return said.length >= 6 ? script.includes(said) : said.length >= 2 && script.startsWith(said); };
      if (!ahead && trigger !== 'user' && (row.aheadChain || row.aheadFor)) {
        const latest = turns?.findLast?.(turn => turn?.role === 'assistant');
        const same = row.notes?.script && reads(latest?.text ?? latest, row.notes.script);
        if (row.aheadChain) {
          if (clientRev !== row.scene.rev) out({op: 'sync', scene: row.scene, canvas: canvasOf(row)});
          (row.watchers ??= new Set()).add(out);
          try { while (row.aheadChain) await row.aheadChain; } finally { row.watchers.delete(out); }
          return report('joined', {rev: row.scene.rev});
        }
        if (same && row.aheadFor === script(row.notes.script)) {
          if (clientRev !== row.scene.rev) out({op: 'sync', scene: row.scene, canvas: canvasOf(row)});
          return report('same', {rev: row.scene.rev});
        }
      }
      // (A caller's turn that turns out to draw nothing, a cough or "嗯", leaves the script's page the
      // script's: put back in `report` below. Otherwise the rest of the reading was drawn as a new page.)
      const scriptPage = row.aheadFor;
      // (The board as it stood when the caller spoke: what a made thing takes the turn back to, see `place`.)
      // (Turns are counted: a made thing, a lesson and a drawn picture each belong to the turn they were asked in.)
      if (trigger === 'user') { row.aheadFor = ''; row.turnNo = (row.turnNo ?? 0) + 1; row.turn = {no: row.turnNo, scene: row.scene, zones: row.zones ?? []}; }
      row.controller?.abort();
      // Lookups answer one question. What was found for the last one must not
      // be drawn again as if it answered this one.
      if (trigger === 'user') row.evidence = [];
      // A request to explain is usually answered with a prepared lesson within
      // a few seconds; a picture guessed now would only flash by before it. If
      // no lesson comes, V's own words bring the picture as usual.
      const last = turns?.at(-1);
      if (trigger === 'user' && defers(typeof last === 'string' ? last : last?.text)) { row.aheadFor ||= scriptPage; return report('deferred'); }
      // During a lesson the page only needs the prepared picture. The caller
      // speaking again (after the lesson has started) ends the hold.
      if (row.heldUntil > now()) {
        if (trigger === 'user' && now() - row.heldAt > 4000) row.heldUntil = 0;
        else { if (clientRev !== row.scene.rev) onOp({op: 'sync', scene: row.scene}); return report('lesson', {rev: row.scene.rev}); }
      }
      // While a thing is being made (asked for this turn, or earlier and not yet done) the made
      // thing is the picture: V's words about making it are not drawn, and no page is opened
      // beside it. A lesson is still drawn (it has its script; `ahead` runs are the script's own).
      if (stream && !ahead && row.lessonTurn !== (row.turnNo ?? 0) && (row.makingTurn !== undefined && row.makingTurn === row.turnNo || shelf?.busy?.(id))) {
        if (clientRev !== row.scene.rev) onOp({op: 'sync', scene: row.scene, canvas: canvasOf(row)});
        return report('making', {rev: row.scene.rev});
      }
      const controller = row.controller = new AbortController();
      row.controllerTrigger = trigger;
      const abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
      if (clientRev !== row.scene.rev) onOp({op: 'sync', ...stateOf(row)});
      if (illustrate && !stream) {
        try {
          // Nothing is guessed before V has answered, and nothing is redrawn mid-sentence.
          if (trigger !== 'assistant_end') return report('waiting', {rev: row.scene.rev});
          const text = turn => typeof turn === 'string' ? turn : String(turn?.text ?? '');
          const said = text(turns?.findLast(turn => turn?.role === 'assistant')), asked = text(turns?.findLast(turn => turn?.role === 'user'));
          // A short reply (a greeting, "let me look") leaves the page as it is, unless a lookup just answered.
          if (!worthDrawing(said, row.evidence.length > 0)) return report('none', {rev: row.scene.rev});
          if (row.illustrated === said) return report('same', {rev: row.scene.rev});
          const made = await illustrate({owner: id, asked, said, evidence: row.evidence, screen: sceneDigest(row.scene), signal: controller.signal});
          if (controller.signal.aborted) return report('superseded');
          if (!made?.ops?.length) return report('none', {rev: row.scene.rev});
          row.illustrated = said;
          // A new page, or more pieces on the page already up (which then follows V's voice like the rest).
          row.scene = made.add ? {...row.scene, lesson: true, late: true, rev: row.scene.rev + 1} : {...row.scene, blocks: [], pending: null, title: ''};
          for (const op of made.ops) { const next = applyOp(row.scene, op); if (next !== row.scene) { row.scene = next; drawn.push(op); } }
          onOp({op: 'sync', scene: row.scene});
          return report('drawn', {ops: drawn.length, rev: row.scene.rev, writer: made.writer});
        } catch (error) { return report(controller.signal.aborted ? 'superseded' : 'error', {error: String(error?.message ?? error).slice(0, 120)}); }
        finally { signal?.removeEventListener('abort', abort); if (row.controller === controller) row.controller = null; }
      }
      const words = turn => typeof turn === 'string' ? turn : String(turn?.text ?? '');
      const said = stream && turns?.at(-1)?.role === 'assistant' ? words(turns.at(-1)) : '';
      // Whether what is being drawn is a lesson's script (its author's notes go with it; only a script may ask for a picture to be drawn).
      // (A voice that says the script in its own first words still reads it: `reads` finds what was said inside the script.)
      const scripted = Boolean(stream && row.notes && said && reads(said, row.notes.script));
      // The language V speaks is asked for once for each of V's replies, beside this run and not before it:
      // this run goes with the language of V's reply before (a caller and V seldom change it), the answer
      // is there for the next run two seconds on, which rewrites the page if V has changed.
      if (stream && hear && said) {
        const head = Array.from(said).slice(0, 12).join('');
        if (Array.from(said).length >= 8 && row.languageOf !== head) {
          row.languageOf = head;
          const asked = row.languageAsk = Promise.resolve().then(() => hear(said)).then(name => { if (row.languageAsk === asked && name) row.language = name; }).catch(() => {});
        }
      }
      if (stream) {
        // Lookup results alone draw nothing: V's words about them do.
        // Nor do a few words ("好，我想想怎么讲"), nor anything said while a script is being written for this very question.
        const expecting = (row.expectUntil ?? 0) > now();
        if (trigger === 'evidence' || trigger !== 'user' && (expecting || Array.from(said).length < (/^[\x00-\x7f]*$/u.test(said.slice(0, 40)) ? 40 : 14) && !row.notes?.script.startsWith(said.slice(0, 12)))) { signal?.removeEventListener('abort', abort); if (row.controller === controller) row.controller = null; return report('waiting', {rev: row.scene.rev}); }
      }
      let ops = 0, firstOpMs = null, none = false, retired = false;
      // The page's pictures looked at with V's words (see `eye`), and the places V talks about pinned on
      // them; the run's screens get the pins as they come. Each picture is looked at by itself, with the
      // clauses from where V gets to its thing up to where V gets to the next pictured thing, all at once:
      // a place is on the picture of the thing being told, and six pictures take no longer than one. The
      // two or three of a comparison are looked at together (V goes back and forth between them).
      // Nothing is looked at twice for the same words.
      const look = async () => {
        // Only the pictures these words are about: a page keeps its pictures over several answers, and a
        // short reply about one thing had every picture of the page looked at with it (eleven, 11/21).
        // A picture belongs to these words when its item hangs on them, or they name it (the caller asks
        // about one of the things on the page, and V says more of it); one that is up from the start (the
        // page's print) or the head of a comparison, when the page was drawn for them or is about them.
        const heard = loose(said), hangs = q => Boolean(q) && heard.includes(loose(q));
        const about = block => block.q ? hangs(block.q) : (block.items ?? []).some(item => hangs(item.q));
        const fresh = drawn.some(op => op.op === 'put' || op.op === 'scene');
        const named = subject => loose(String(subject.name ?? '')).length >= 2 && heard.includes(loose(subject.name));
        // (An item's picture that hangs on no words - one of a page of pictures opened on the caller's
        // question - is looked at once V names it, with V's words from there on, not with the opening lines.)
        const print = heroPhoto(row.scene)?.query;
        const subjects = pictureSubjects(row.scene).filter(subject => subject.group ? about(row.scene.blocks.find(block => block.id === subject.group) ?? {})
          : subject.q ? hangs(subject.q) || named(subject) : subject.img === print ? fresh || row.scene.blocks.some(about) : named(subject));
        if (!subjects.length) return null;
        const begun = now(), serial = row.scene.serial, parts = clauses(said);
        const put = (img, places) => {
          if (controller.signal.aborted || row.scene.serial !== serial || !scenePictures(row.scene).has(img)) return 0;
          const op = normalizeOp({op: 'pin', img, items: places}), next = op ? applyOp(row.scene, op) : row.scene;
          if (next !== row.scene) { row.scene = next; drawn.push(op); onOp({op: 'sync', scene: row.scene, canvas: canvasOf(row)}); }
          return op?.items.length ?? 0;
        };
        const shot = async (subject, id) => { const found = await eye.find(subject.img); return found?.bytes ? {id, img: subject.img, h: subject.name, bytes: found.bytes, type: found.type} : null; };
        row.eyes ??= new Map();
        if (row.eyes.size > 80) row.eyes.clear();
        const alone = subjects.filter(subject => !subject.group), starts = alone.map(subject => !subject.q && subject.img === print ? 0 : clauseOf(said, subject.q && hangs(subject.q) ? subject.q : subject.name));
        const groups = [...new Set(subjects.filter(subject => subject.group).map(subject => subject.group))];
        const seen = await Promise.all([
          ...alone.map(async (subject, index) => {
            const from = starts[index], later = starts.filter(start => start > from), to = later.length ? Math.min(...later) : parts.length;
            const words = parts.slice(from, to).join(''), key = `${serial}:${subject.img}`;
            if (!words || row.eyes.get(key) === words) return null;
            row.eyes.set(key, words);
            try {
              const found = await shot(subject, 'a');
              const places = found && !controller.signal.aborted ? await eye.see({shots: [found], said, from, to, language: row.language, signal: controller.signal}) : null;
              if (controller.signal.aborted) { row.eyes.delete(key); return null; }
              return {shots: found ? 1 : 0, pins: places ? put(subject.img, places.slice(0, alone.length > 1 ? 3 : 8)) : 0};
            } catch { row.eyes.delete(key); return {shots: 0, pins: 0, failed: 1}; }
          }),
          ...groups.map(async group => {
            const members = subjects.filter(subject => subject.group === group), key = `${serial}:${members.map(member => member.img).join('|')}`;
            if (row.eyes.get(key) === said || row.eyes.has(key) && trigger !== 'assistant_end') return null;
            row.eyes.set(key, said);
            try {
              const shots = (await Promise.all(members.map((member, index) => shot(member, 'abc'[index])))).filter(Boolean);
              const places = shots.length && !controller.signal.aborted ? await eye.see({shots, said, language: row.language, signal: controller.signal}) : null;
              if (controller.signal.aborted) { row.eyes.delete(key); return null; }
              return {shots: shots.length, pins: places ? shots.reduce((sum, item) => sum + put(item.img, places.filter(place => place.on === item.id).slice(0, 4)), 0) : 0};
            } catch { row.eyes.delete(key); return {shots: 0, pins: 0, failed: 1}; }
          }),
        ]);
        const done = seen.filter(Boolean);
        return done.length ? {pins: done.reduce((sum, item) => sum + item.pins, 0), shots: done.reduce((sum, item) => sum + item.shots, 0), ...(done.some(item => item.failed) ? {failed: done.filter(item => item.failed).length} : {}), ms: now() - begun} : null;
      };
      const parser = createLineParser(raw => {
        if (controller.signal.aborted || ops >= MAX_OPS) return;
        let op = stream ? stream.refine(normalizeOp(raw), {said, trigger, raw, unscripted}) : normalizeOp(raw);
        if (!op || retired) return;
        if (stream && op.op === 'put' && op.block.t === 'versus' && row.scene.pending === null) {
          // The same two things compared further is the same table growing, not a second table
          // (three tables with the same two headers came of one answer about cars).
          const sides = block => block.sides.map(side => side.h).join('|');
          const table = row.scene.blocks.find(block => block.t === 'versus' && block.id !== op.block.id && sides(block) === sides(op.block));
          if (table) {
            const have = new Set(table.items.map(item => item.h));
            const more = op.block.items.filter(item => !have.has(item.h)).map((item, index) => ({...item, id: `${op.block.id}-${item.id}`.slice(0, 24) || `m${index}`}));
            if (!more.length) return;
            op = {op: 'put', block: {...table, items: [...table.items, ...more].slice(0, 8)}};
          }
        }
        if (stream && op.op !== 'none') {
          // The canvas: pages are kept, not replaced. `row.scene` is the page V is on;
          // `row.zones` the others. A new topic opens a page beside them, and V can go back to one.
          row.zones ??= [];
          const shelve = () => { if (row.scene.blocks.length) { row.zones = [...row.zones.filter(zone => zone.serial !== row.scene.serial), row.scene].sort((a, b) => a.serial - b.serial).slice(-7); } };
          if (op.op === 'zone') {
            const back = row.zones.find(zone => zoneId(zone) === op.id);
            if (!back || back.serial === row.scene.serial) return;
            shelve();
            row.zones = row.zones.filter(zone => zone !== back);
            row.scene = {...back, rev: Math.max(back.rev, row.scene.rev) + 1, focus: ''};
          } else if (op.op === 'scene') {
            // The page a made thing was hung on for this very request is this request's page: it takes
            // the title, and no second page is opened beside it.
            if (row.workTurn !== undefined && row.workTurn === row.turnNo && row.scene.blocks.some(block => block.t === 'work')) {
              if (row.scene.title || !op.title) return;
              row.scene = {...row.scene, title: op.title, rev: row.scene.rev + 1};
              ops++; firstOpMs ??= now() - started; drawn.push(op);
              onOp({op: 'sync', scene: row.scene, canvas: canvasOf(row)});
              return;
            }
            // (The page already up under this title is the page; one opened a moment ago and still empty is only renamed.)
            if (row.scene.title === op.title && row.scene.blocks.length) return;
            // A page of this title already on the canvas (two runs for one answer, 11/14): go back to it, not a second one.
            const same = (row.zones ?? []).find(zone => zone.serial !== row.scene.serial && zone.title === op.title && zone.blocks.length);
            if (same) { shelve(); row.zones = row.zones.filter(zone => zone !== same); row.scene = {...same, rev: Math.max(same.rev, row.scene.rev) + 1, focus: ''}; ops++; firstOpMs ??= now() - started; drawn.push({op: 'zone', id: zoneId(same)}); fetchAhead(row.scene); onOp({op: 'sync', scene: row.scene, canvas: canvasOf(row)}); return; }
            if (!row.scene.blocks.length && row.scene.serial > 0) {
              if (row.scene.title === op.title && (row.scene.from ?? '') === (op.from ?? '')) return;
              row.scene = {...row.scene, title: op.title, ...(op.from && op.from !== zoneId(row.scene) ? {from: op.from} : {}), rev: row.scene.rev + 1};
              ops++; firstOpMs ??= now() - started; drawn.push(op);
              onOp({op: 'sync', scene: row.scene, canvas: canvasOf(row)});
              return;
            }
            // What kinds of picture the last pages were made of, so the next can differ.
            if (row.scene.blocks.length) row.recent = [...(row.recent ?? []), ...new Set(row.scene.blocks.map(block => block.t).filter(type => !['photo', 'sticky', 'note'].includes(type)))].slice(-6);
            shelve();
            row.pages = Math.max(row.pages ?? 0, row.scene.serial, ...row.zones.map(zone => zone.serial)) + 1;
            // (`from` must be a page that is on the canvas.)
            const origin = op.from && [...row.zones, row.scene].some(zone => zoneId(zone) === op.from) ? {from: op.from} : {};
            row.scene = {...emptyScene(), rev: row.scene.rev + 1, serial: row.pages, title: op.title, lesson: true, late: true, ...flags, ...origin};
            row.openedAt = now();
          } else {
            // (The names a full page of pictures has no photograph for: see below.)
            let rest = null;
            if (op.op === 'put' && op.block.t === 'work') {
              // A made thing on a page is one the call's shelf holds. Asked for anew (`make`), it is
              // made by the call's own executor, once per answer and only where the call has one;
              // the same block written again (the illustrator is called as V's words arrive) keeps its picture.
              const held = row.scene.blocks.find(block => block.id === op.block.id && block.t === 'work');
              const {make, ...rest} = op.block;
              if (held) op = {op: 'put', block: {...rest, asset: held.asset}};
              else if (make) {
                // (Only a lesson's script asks: in call of 11/21 the illustrator asked for the very picture the
                // caller had asked V for, a moment before V's own command, and the two were made as one.)
                // (And only where the script itself says so, on a page with no photographs and room for it: see mayDraw.)
                if (!mayDraw(row, scripted, shelf, id)) return;
                const made = shelf.make(id, {prompt: make, caption: rest.caption});
                if (!made) return;
                row.madeFor = row.turnNo ?? 0;
                op = {op: 'put', block: {...rest, asset: made}};
              } else {
                // (Nor twice on one page under another block's id.)
                if (!shelf?.has?.(id, op.block.asset) || row.scene.blocks.some(block => block.t === 'work' && block.asset === op.block.asset)) return;
                // A thing hangs once on the canvas. Asked for on a page just opened and still empty, the
                // page it is on is gone back to instead (the caller asked about that very thing); on a
                // page that already has something, it is simply not hung again.
                const home = (row.zones ?? []).find(zone => zone.serial !== row.scene.serial && zone.blocks.some(block => block.t === 'work' && block.asset === op.block.asset));
                if (home) {
                  if (row.scene.blocks.length) return;
                  row.zones = row.zones.filter(zone => zone !== home);
                  row.scene = {...home, rev: Math.max(home.rev, row.scene.rev) + 1, focus: ''};
                  ops++; firstOpMs ??= now() - started; drawn.push({op: 'zone', id: zoneId(home)});
                  onOp({op: 'sync', scene: row.scene, canvas: canvasOf(row)});
                  return;
                }
              }
            }
            if (op.op === 'put') {
              // A block may grow; it may not become something else. One that would replace what is
              // on the page (another type, another photograph, other items) is a new block instead.
              const old = row.scene.blocks.find(block => block.id === op.block.id);
              // Written again within the same answer, a list is the same list and a thing keeps the
              // picture it has. (Not across the caller's turns: "show me more" redraws a gallery under the same ids.)
              const again = Boolean(old) && row.drawn?.no === (row.turnNo ?? 0) && row.drawn.keys.has(`${row.scene.serial}:${old.id}`);
              // (Also where the ids are the page's but an id now names another thing: items are often numbered anew.)
              const renamed = () => itemsOf(old).some((item, index) => (item.h ?? item.label) !== (itemsOf(op.block)[index]?.h ?? itemsOf(op.block)[index]?.label));
              const grown = again && (!growsFrom(old, op.block) || renamed()) ? grownList(old, op.block) : null;
              if (grown) op = {op: 'put', block: grown};
              if (old && !grown && !growsFrom(old, op.block)) op = {op: 'put', block: {...op.block, id: `${op.block.id}${row.scene.blocks.length + 1}`.slice(-24)}};
              else if (again) op = {op: 'put', block: samePictures(old, op.block)};
              // Each thing is pictured once on a page, and a page has one large print. A page drawn
              // from V's own words holds PAGE_PICTURES photographs at most (a script's page is its author's).
              const most = scripted ? Infinity : PAGE_PICTURES, asked = guessesYield(op.block, row.scene, most, loose(said));
              op = {op: 'put', block: picturedOnce(asked, row.scene, most)};
              if (!op.block) return;
              // A page of pictures shows only what is pictured. The things V tells after its last
              // photograph keep their names on the page, in a list beside the pictures.
              if (op.block.look === 'gallery' && Number.isFinite(most)) {
                const wanted = new Set(asked.items.filter(item => item.img).map(item => item.id)), past = op.block.items.filter(item => !item.img && wanted.has(item.id));
                if (past.length) {
                  rest = normalizeOp({op: 'put', block: {id: `${op.block.id}-rest`.slice(-24), t: 'list', items: past}});
                  op = {op: 'put', block: {...op.block, items: op.block.items.filter(item => !past.includes(item))}};
                }
              }
              // A script's list is drawn as a page of pictures only where its author asked for one:
              // the illustrator's own judgement of what an answer is about is for V's own words.
              if (scripted && op.block.look === 'gallery' && !galleryInNotes(row.notes)) { const {look, ...plain} = op.block; op = {op: 'put', block: plain}; }
            }
            // One screen: a page holds four blocks. More would only shrink it or make it scroll.
            if (op.op === 'put' && row.scene.blocks.length >= 4 && !row.scene.blocks.some(block => block.id === op.block.id)) return;
            // A page that was never opened by name (the first thing drawn in a call) is opened by its first block.
            if (op.op === 'put' && row.scene.serial === 0) { row.pages = (row.pages ?? 0) + 1; row.scene = {...row.scene, serial: row.pages}; row.openedAt = now(); }
            let next = applyOp({...row.scene, pending: null}, op);
            if (next === row.scene) return;
            if (rest && (next.blocks.length < 4 || next.blocks.some(block => block.id === rest.block.id))) next = applyOp(next, rest);
            // The page is a lesson's page whoever opened it: pieces wait for the voice.
            row.scene = {...next, lesson: true, late: true, ...flags};
            if (op.op === 'put') { if (row.drawn?.no !== (row.turnNo ?? 0)) row.drawn = {no: row.turnNo ?? 0, keys: new Set()}; for (const put of [op, ...(rest ? [rest] : [])]) row.drawn.keys.add(`${row.scene.serial}:${put.block.id}`); }
          }
          // (The places pinned on a picture go when the picture does.)
          if (row.scene.pins?.length) { const shown = scenePictures(row.scene), kept = row.scene.pins.filter(item => shown.has(item.img)); if (kept.length !== row.scene.pins.length) row.scene = {...row.scene, pins: kept}; }
          ops++; firstOpMs ??= now() - started; drawn.push(op);
          fetchAhead(row.scene);
          onOp({op: 'sync', scene: row.scene, canvas: canvasOf(row)});
          return;
        }
        if (op.op === 'none') { none = true; return; }
        // A half-finished sentence is not grounds for replacing the picture;
        // whatever the model meant to draw on the new one is dropped with it.
        if (trigger === 'assistant_progress' && op.op === 'scene' && row.scene.blocks.length && op.title !== row.scene.title) { retired = true; none = true; return; }
        const next = applyOp(row.scene, op);
        if (next === row.scene) return;
        row.scene = next; ops++; firstOpMs ??= now() - started; drawn.push(op);
        onOp({...op, rev: next.rev});
      });
      let finish = () => {};
      if (ahead) row.ahead = {listeners, done: new Promise(resolve => { finish = resolve; })};
      try {
        const messages = [{role: 'system', content: stream?.instructions ?? BOARD_INSTRUCTIONS},
          {role: 'user', content: boardRequest({trigger, scene: row.scene, turns: stream?.turns ? stream.turns(turns) : turns, evidence: row.evidence,
            // (Said only where it changes what may be drawn: before V has spoken.)
            unscripted: Boolean(stream && unscripted && trigger === 'user'),
            ...(stream && row.language ? {language: row.language} : {}),
            // The author's notes go with the script they were written for, and with nothing else.
            ...(scripted ? {notes: {title: row.notes.title, lines: row.notes.lines}} : {}),
            ...(stream && shelf ? {assets: shelf.digest(id), ...(mayDraw(row, scripted, shelf, id) ? {make: true} : {}), ...(row.scene.blocks.some(block => block.t === 'work') ? {workshop: true} : {})} : {}),
            ...(stream ? {recent: row.recent ?? [], page: {id: zoneId(row.scene), room: Math.max(0, 4 - row.scene.blocks.length)}, canvas: (row.zones ?? []).filter(zone => zone.serial !== row.scene.serial).map(zoneDigest)} : {})})}];
        for await (const chunk of (stream ? hedged(complete, {messages, signal: controller.signal}, hedgeMs) : complete({messages, signal: controller.signal}))) {
          if (controller.signal.aborted) break;
          parser.feed(chunk);
        }
        if (!controller.signal.aborted) parser.end();
        if (ahead && !controller.signal.aborted && ops) row.aheadFor = script(row.notes?.script);
        if (trigger === 'user' && !ops && !controller.signal.aborted && !row.aheadFor) row.aheadFor = scriptPage;
        const looked = eye && stream && said && !controller.signal.aborted ? await look() : null;
        return report(controller.signal.aborted ? 'superseded' : ops || looked?.pins ? 'drawn' : none ? 'none' : 'empty', {ops, firstOpMs, rev: row.scene.rev, ...(looked ? {eye: looked} : {})});
      } catch {
        return report(controller.signal.aborted ? 'superseded' : 'provider_failed', {ops, firstOpMs, rev: row.scene.rev});
      } finally {
        signal?.removeEventListener('abort', abort);
        if (row.controller === controller) row.controller = null;
        if (row.ahead?.listeners === listeners) row.ahead = null;
        finish();
      }
    },
    /** The call of session `from` goes on as session `to` (its connection was lost): its pages with it. */
    adopt(to, from) {
      const old = owners.get(from), fresh = owners.get(to);
      if (!old || to === from || fresh?.scene.blocks.length) return false;
      old.controller?.abort(); old.controller = null; old.evidence = []; old.ahead = null; old.notes = null; old.touched = now();
      owners.delete(from); owners.set(to, old);
      shelf?.adopt?.(to, from);
      return true;
    },
    forget(id) { owners.get(id)?.controller?.abort(); owners.delete(id); shelf?.forget?.(id); },
  };
  return api;
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
      // The provider's reason goes to the private log only (a refused parameter is otherwise a mystery).
      if (!response.ok || !response.body) throw Error(`board model HTTP ${response.status} ${String(await Promise.resolve(response.text?.()).catch(() => '') ?? '').replace(/\s+/gu, ' ').slice(0, 200)}`.trim());
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
        model: env.VOICE_BOARD_MODEL ?? 'deepseek/deepseek-v4.1-flash',
        // Thinking is off for speed; a writer that may take longer names an effort (some models refuse to run without).
        extra: {reasoning: ['low', 'medium', 'high'].includes(env.VOICE_BOARD_REASONING) ? {effort: env.VOICE_BOARD_REASONING} : {enabled: false}}}
      : null;
  return provider ? createChatCompletionStream({...provider, fetchImpl, ...(Number(env.VOICE_BOARD_MAX_TOKENS) > 0 ? {maxTokens: Number(env.VOICE_BOARD_MAX_TOKENS)} : {})}) : null;
}
export function boardDirectorFromEnv(env = process.env, {audit, fetchImpl, illustrate = null, stream = null, defer = true, prefetch = null, eye = null} = {}) {
  const complete = boardCompletionFromEnv(env, {fetchImpl});
  // A private day file beside the Candidate's own call records, when it has such a directory.
  const directory = env.VOICE_BOARD_LOG_DIR ?? env.RTC_H5_TRANSCRIPT_DIR;
  const record = directory ? event => {
    const at = new Date(), file = join(directory, `board-${at.toISOString().slice(0, 10)}.jsonl`);
    void mkdir(directory, {recursive: true, mode: 0o700}).then(() => appendFile(file, JSON.stringify({at: at.toISOString(), ...event}) + '\n', {mode: 0o600})).catch(() => {});
  } : undefined;
  return complete ? createBoardDirector({audit, complete, record, hear: words => nameLanguage({complete, words}), ...(prefetch ? {prefetch} : {}), ...(eye && stream ? {eye: eye(complete)} : {}), ...(env.VOICE_BOARD_LESSON === '1' ? {...(defer ? {defers: mayAskForLesson} : {}), ...(illustrate ? {illustrate} : {}), ...(stream ? {stream} : {})} : {})}) : null;
}
