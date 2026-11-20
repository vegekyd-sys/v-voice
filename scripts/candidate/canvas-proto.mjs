// Prototype data (docs/research/board-canvas, round 2): seven questions people actually asked V, each
// with a script and a base (one photo, a few photos, a pitch, or blank paper). DeepSeek Flash, no
// thinking, sees the photos and V's words cut into numbered clauses and writes the page as a few kinds
// of steps, each hung on a clause: ring/point at a part of a photo, a chip (a name placed on the pitch or
// paper), an arrow between two things, a note. Rings on photos are then checked once on a zoomed-in crop
// (pointer-eval.mjs's refine). Writes everything with timings as JSON for canvas-proto-page.mjs.
//
//   DEEPSEEK_API_KEY=… node scripts/candidate/canvas-proto.mjs photos/ out.json [topic ids…]
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {createChatCompletionStream} from '../../lab/gpt-live-h5/board-director.mjs';
import {clauses, numbered} from '../../lab/gpt-live-h5/board-cue.mjs';
import {refineMarks} from './pointer-eval.mjs';

export const PROTO_INSTRUCTIONS = `你是 V 的讲解画面。V 正在电话里讲一样东西，用户看着手机上的一块画布听。画布的底图已经摆好（照片、几张照片、球场或一张白纸），V 要念的话已经按标点切成编号小段「[0]…[1]…」。
你来决定：每一段念出来的时候，画布上发生什么。画布上有一个指针，像坐在用户旁边的老师，讲到哪里就指到哪里。

只输出一个 JSON 对象，不要任何别的文字：
{"title":"不超过 10 个字","steps":[步骤,…]}

步骤（每个都写 cue = 挂在第几段，念到那一段时发生；一段可以有一两个步骤）：
- {"cue":段号,"do":"ring","on":"A","where":"它在这张照片里的位置","box":[x1,y1,x2,y2],"label":"不超过 6 个字"}
  指针飞到照片 A 上的这个部位，画一个圈，贴上名字。where 先用一句话说清它在照片哪一块、挨着什么，box 再照着写：box 是照片 A 上的位置，左上角 [0,0]，右下角 [1000,1000]，紧贴着那个部位。
- {"cue":段号,"do":"point","on":"A","where":"…","box":[…],"label":"…"}
  指针停在那里不画圈：讲整张照片、整只宝可梦、或很大的东西时用。
- {"cue":段号,"do":"chip","id":"英文小写","text":"不超过 6 个字","sub":"不超过 6 个字，可省","at":[x,y]}
  在球场或白纸上放一个名字牌（球员、步骤、角色），at 是它在画布上的位置。指针会飞到它那里。只有底图是球场或白纸时用。
- {"cue":段号,"do":"ring","on":"名字牌的 id"}  圈出一个已经放好的名字牌，讲到它是重点时用。
- {"cue":段号,"do":"arrow","from":"A 或名字牌 id","to":"B 或名字牌 id","label":"不超过 5 个字"}
  从一样东西画箭头到另一样：进化、相克、流程的下一步。
- {"cue":段号,"do":"note","text":"不超过 16 个字"}  画布下方手写一行字：最后的结论、口诀、阵型。整页最多一个。

怎么画好：
- 讲到哪就指到哪：每一段讲到一个看得见的东西，就让指针去那里；不要一段指好几处，也不要提前指还没讲到的。
- 开场、提问这样不指具体东西的段可以不写步骤。
- 照片上看不到的东西不要圈，不要猜位置；改成 point 停在整只/整个东西上，或者不写。
- 球场：竖着放，下边是自己的球门，上边是对方球门；at 的 x 从左边线 0 到右边线 1000，y 从对方球门线 0 到自己球门线 1000。球员按 V 说的位置摆，左路就在左边。
- 白纸：宽 1000、高 750，名字牌之间留出距离，按讲的顺序从左到右或从上到下摆，箭头连起来。
- 名字牌、圈、箭头加起来 12 个以内；少而准比多更好。`;

const BASES = {
  photo: '底图：一张照片（图A）。',
  row: count => `底图：${count} 张照片从左到右排成一行（${'ABC'.slice(0, count).split('').map(id => `图${id}`).join('、')}）。`,
  triangle: '底图：三张照片摆成三角形：图A 在上，图B 在右下，图C 在左下。',
  pitch: '底图：一块竖着放的足球场（白纸上画的线），下边是自己的球门。',
  sketch: '底图：一张白纸（宽 1000、高 750）。',
};

export const TOPICS = {
  mewtwo: {ask: '超梦长什么样？', base: 'photo', photos: [['mewtwo', '超梦']],
    say: '这就是超梦，是科学家用梦幻的基因造出来的宝可梦。你看它的脑袋后面，有一根管子连到后背。它的尾巴又粗又长，从身后绕上来，是紫色的。它的手只有三根圆圆的手指。它最厉害的是念力，不用碰就能把东西举起来。'},
  froakie: {ask: '泡沫蛙是怎么进化的？', base: 'row', photos: [['froakie', '呱呱泡蛙'], ['frogadier', '呱头蛙'], ['greninja', '甲贺忍蛙']],
    say: '泡沫蛙一家要进化两次。第一只是呱呱泡蛙，脖子上围着一圈白白的泡泡。到了十六级，它进化成呱头蛙，身子变得又细又长。再到三十六级，就进化成甲贺忍蛙。这时候围在脖子上的，其实是它的长舌头。它的手能把水压成手里剑，扔出去像飞镖。'},
  types: {ask: '宝可梦的属性相克是怎么回事？（给 5 岁孩子讲）', base: 'triangle', photos: [['squirtle', '杰尼龟'], ['charmander', '小火龙'], ['bulbasaur', '妙蛙种子']],
    say: '宝可梦的属性就像石头剪刀布。杰尼龟是水系，小火龙是火系，妙蛙种子是草系。水能浇灭火，所以杰尼龟打小火龙很厉害。火能烧掉草，所以小火龙打妙蛙种子很厉害。草能把水吸干，所以妙蛙种子打杰尼龟很厉害。三个转一圈，谁也不能通吃。你猜，皮卡丘的电打杰尼龟，谁会赢？'},
  taihe: {ask: '故宫的太和殿有什么好看的？', base: 'row', photos: [['taihe', '太和殿全景'], ['roofbeasts', '太和殿屋檐角上的屋脊兽（近景）']],
    say: '这是太和殿，故宫里最大的一座殿。它的屋顶有两层，叫重檐庑殿顶，是古代最高等级的屋顶。屋檐下面正中间，挂着一块匾。整座殿坐在三层汉白玉台基上。再凑近看屋檐的角上，排着一串小兽。最前面骑着凤的是仙人，后面跟着龙、凤、狮子。小兽越多等级越高，太和殿有十只，全国只有它一个。'},
  cars: {ask: '电车和油车有什么区别？', base: 'row', photos: [['corolla', '丰田卡罗拉（油车）'], ['model3', '特斯拉 Model 3（电车）']],
    say: '我们把两台车放在一起看。左边是丰田卡罗拉，烧油的；右边是特斯拉 Model 3，用电的。先看车头，油车这一大块进气格栅，是给发动机散热的。电车的车头是封住的，因为没有发动机要散热。电车的轮毂做得很平，是为了少点风阻、多跑点路。补能上，油车加油五分钟就满，电车在家充一晚上，每公里的电费只有油费的三分之一左右。所以能在家充电、主要在市区开，选电车更省钱。'},
  psg: {ask: '把巴黎圣日耳曼今年的阵容按位置排给我看。', base: 'pitch', photos: [],
    say: '先看门将，站在最里面的是舍瓦利耶。他身前四个人排成一条线，从左到右是努诺·门德斯、扎巴尔尼、马尔基尼奥斯、阿什拉夫。马尔基尼奥斯居中，扎巴尔尼在他右边，两人一起守中路。门德斯和阿什拉夫站两边，往前压上去就是边路。中间三个人，维蒂尼亚拖在后面接球。法比安·鲁伊斯在他左边，扎伊尔-埃梅里在右边。最前面三个人，登贝莱顶在中间。克瓦拉茨赫利亚在左路，杜埃在右路。这就是一套 4-3-3，后场四人、中场三人、前场三人。'},
  nightshift: {ask: '我们的夜班模式是怎么回事？', base: 'sketch', photos: [],
    say: '夜班模式就是：白天人来判断，晚上 V 接着干，早上人来验收。白天，你和 V 一起把要做的事定好，写进 Base。晚上，V 只看 Base 里的任务，一件一件往前推。每一件都一样：先查条件够不够，够了就做，做完自己质检，再写回 Base。条件不够，就停在那里，等人来补。早上你打开 Base 看成果，再定下一轮。'},
};

const TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};
const parse = text => { const s = text.indexOf('{'), e = text.lastIndexOf('}'); try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; } };

if (process.argv[1]?.endsWith('canvas-proto.mjs')) {
  const [dir = 'photos', out = 'canvas-proto.json', ...only] = process.argv.slice(2);
  const key = process.env.VOICE_BOARD_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  const call = maxTokens => createChatCompletionStream({apiKey: key, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash',
    maxTokens, timeoutMs: 60000, extra: {thinking: {type: 'disabled'}}});
  const files = await readdir(dir), results = {};
  await Promise.all(Object.entries(TOPICS).filter(([id]) => !only.length || only.includes(id)).map(async ([id, topic]) => {
    const parts = clauses(topic.say);
    const photos = topic.photos.map(([name, caption], index) => ({id: 'ABC'[index], name, caption, file: files.find(file => file.startsWith(name + '.'))}));
    const content = [];
    for (const photo of photos) content.push({type: 'text', text: `图${photo.id}：${photo.caption}`}, {type: 'image_url', image_url: {url: `data:${TYPES[extname(photo.file)]};base64,${(await readFile(join(dir, photo.file))).toString('base64')}`}});
    const base = typeof BASES[topic.base] === 'function' ? BASES[topic.base](photos.length) : BASES[topic.base];
    content.push({type: 'text', text: `用户问：${topic.ask}\n${base}\nV 要念的话：${numbered(parts)}`});
    const started = Date.now(); let text = '', first = 0, error = '';
    try { for await (const chunk of call(3000)({messages: [{role: 'system', content: PROTO_INSTRUCTIONS}, {role: 'user', content: photos.length ? content : content.at(-1).text}]})) { first ||= Date.now() - started; text += chunk; } }
    catch (e) { error = String(e?.message ?? e).slice(0, 300); }
    const page = parse(text), directMs = Date.now() - started;
    let steps = Array.isArray(page?.steps) ? page.steps : [];
    // Each photo's rings are refined against that photo, all at once, and put back in their places.
    await Promise.all(photos.map(async photo => {
      const at = steps.map((step, index) => step.do === 'ring' && step.on === photo.id && Array.isArray(step.box) ? index : -1).filter(index => index >= 0);
      const better = await refineMarks(at.map(index => steps[index]), join(dir, photo.file), call(300));
      at.forEach((index, n) => { steps[index] = better[n]; });
    }));
    results[id] = {ask: topic.ask, base: topic.base, photos, clauses: parts, title: page?.title ?? '', steps, firstMs: first, directMs, totalMs: Date.now() - started, error, raw: page ? undefined : text.slice(0, 500)};
    console.log(id, 'first', first, 'direct', directMs, 'total', Date.now() - started, 'ms', steps.length, 'steps', error);
  }));
  await writeFile(out, JSON.stringify(results, null, 1));
}
