// Experiment (docs/research/board-canvas, round 2): can the board's model point at the parts of a real
// photo while V talks about them - Mewtwo's tail, the beasts on the roof ridge, the Model 3's missing
// grille? DeepSeek Flash takes images, so it gets the photo and V's words cut into numbered clauses and
// writes one mark per clause it can see. "blind" gets the same words without the photo, as a baseline.
// Text completions only; no call, page or Gateway. Writes the marks and timings as JSON.
//
//   DEEPSEEK_API_KEY=… node scripts/candidate/pointer-eval.mjs photos/ out.json [case ids…]
import {readFile, writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {createChatCompletionStream} from '../../lab/gpt-live-h5/board-director.mjs';
import {clauses, numbered} from '../../lab/gpt-live-h5/board-cue.mjs';

export const POINTER_INSTRUCTIONS = `你是 V 的指针。V 正在电话里讲解一张照片，用户看着这张照片听。V 要念的话已经按标点切成编号小段：「[0]…[1]…」。
你的任务：在照片上标出每一段讲到的那个地方，让用户的眼睛跟着声音走——讲到尾巴，指针就停在尾巴上。

只输出一个 JSON 对象，不要任何别的文字：
{"marks":[{"cue":段号,"kind":"ring","box":[x1,y1,x2,y2],"label":"不超过 6 个字"},…]}
- 坐标是照片上的位置，左上角 [0,0]，右下角 [1000,1000]（按照片的宽和高各自换算成千分比）。
- box 框住讲到的那个东西本身，紧贴着它的边；指针会停在框的中心，圈画在框上。
- kind：ring（圈出一个部位，最常用）、point（只停住不圈，用于讲整体或很大的东西）、arrow（东西很小或很细时，从旁边指过去）。
- label 写这个部位的名字（「尾巴」「电气袋」「屋脊兽」），会贴在圈旁边。
- 每一段最多一个 mark；没有讲到照片上具体地方的段（开场、总结、提问）不标。照片上看不到 V 讲的东西就不标，不要猜一个位置。`;

export const CASES = {
  mewtwo: {photo: 'mewtwo', topic: '超梦长什么样', say: '这就是超梦，是用梦幻的基因造出来的宝可梦。你看它脑袋后面，有一根管子一直连到后背。它的尾巴又粗又长，是紫色的。手只有三根圆圆的手指。它最厉害的不是力气，是念力。'},
  xerneas: {photo: 'xerneas', topic: '哲尔尼亚斯长什么样', say: '哲尔尼亚斯长得像一只蓝色的大鹿。它头上的角是彩虹色的，像树枝一样分叉。四条腿又细又长，蹄子是黑色的。它代表生命，传说能让森林重新长出来。'},
  pikachu: {photo: 'pikachu', topic: '皮卡丘的电从哪来', say: '皮卡丘的电从哪来？看它脸上这两个红红的圆，叫电气袋，电就存在这里。它的尾巴是闪电的形状。耳朵尖尖是黑色的。生气的时候，电气袋会噼里啪啦冒火花。'},
  greninja: {photo: 'greninja', topic: '甲贺忍蛙', say: '甲贺忍蛙是水系加恶系。它脖子上绕着的不是围巾，是它自己的舌头。它的手能把水压成手里剑，扔出去像飞镖。所以它又快又会偷袭。'},
  taihe: {photo: 'taihe', topic: '太和殿', say: '这是太和殿，故宫里最大的一座殿。它的屋顶有两层，叫重檐庑殿顶，是最高等级的屋顶。屋檐下面正中间挂着一块匾。整座殿坐在三层汉白玉台基上。皇帝登基就在这里。'},
  roofbeasts: {photo: 'roofbeasts', topic: '太和殿屋脊兽', say: '你看屋檐的角上，排着一串小兽。最前面骑着凤的，是仙人。后面跟着一个个小兽，龙、凤、狮子。小兽越多，建筑等级越高，太和殿有十个，全国独一份。'},
  model3: {photo: 'model3', topic: '电车和油车的区别：电车', say: '先看电车。它的车头没有大进气格栅，因为没有发动机要散热。车顶是一整块玻璃。轮毂做得很平，是为了少点风阻、多跑点路。'},
  corolla: {photo: 'corolla', topic: '电车和油车的区别：油车', say: '再看油车。车头这一大块进气格栅，是给发动机散热用的。大灯和格栅连在一起。底下这个进气口也是给发动机吸气的。'},
  eiffel: {photo: 'eiffel', topic: '埃菲尔铁塔', say: '埃菲尔铁塔有三层观景台。第一层最宽，像一个大平台。最顶上一层最高，能看见整个巴黎。塔脚是四根大铁柱，分开站在地上。'},
  colosseum: {photo: 'colosseum', topic: '罗马斗兽场', say: '罗马斗兽场原来是一整圈。外墙一层层的拱门叠上去，一共四层。有一边塌掉了，所以看起来像缺了一块。当年在里面看角斗，能坐五万人。'},
  'pbz-boss': {photo: 'pbz-boss', topic: '影之刃零的 Boss 战', say: '这是影之刃零里的一场 Boss 战。空中往下劈的，是主角魂。对面那个大块头，是独眼巨人 Boss。这游戏的看点就是这种近身的快节奏对砍。'},
};

const parse = text => { const s = text.indexOf('{'), e = text.lastIndexOf('}'); try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; } };
const TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};

if (process.argv[1]?.endsWith('pointer-eval.mjs')) {
  const [dir = 'photos', out = 'pointer-eval.json', ...only] = process.argv.slice(2);
  const key = process.env.VOICE_BOARD_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  const call = (thinking, maxTokens) => createChatCompletionStream({apiKey: key, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash',
    maxTokens, timeoutMs: thinking ? 180000 : 60000, extra: {thinking: {type: thinking ? 'enabled' : 'disabled'}}});
  const variants = {see: call(false, 1500), blind: call(false, 1500), think: call(true, 12000)};
  const files = (await import('node:fs')).readdirSync(dir);
  const results = [];
  await Promise.all(Object.entries(CASES).filter(([id]) => !only.length || only.includes(id)).map(async ([id, item]) => {
    const file = files.find(name => name.startsWith(item.photo + '.'));
    const url = `data:${TYPES[extname(file)] ?? 'image/jpeg'};base64,${(await readFile(join(dir, file))).toString('base64')}`;
    const parts = clauses(item.say), words = numbered(parts);
    await Promise.all(Object.entries(variants).map(async ([variant, complete]) => {
      const text = `主题：${item.topic}\nV 要念的话：${words}`;
      const content = variant === 'blind' ? `${text}\n（你看不到照片，只能按这类照片通常的构图估计位置。）` : [{type: 'image_url', image_url: {url}}, {type: 'text', text}];
      const started = Date.now(); let out = '', error = '', first = 0;
      try { for await (const chunk of complete({messages: [{role: 'system', content: POINTER_INSTRUCTIONS}, {role: 'user', content}]})) { first ||= Date.now() - started; out += chunk; } }
      catch (e) { error = String(e?.message ?? e).slice(0, 300); }
      const result = parse(out);
      results.push({id, variant, file, clauses: parts, ms: Date.now() - started, firstMs: first, ok: Array.isArray(result?.marks), error, marks: result?.marks ?? null, raw: result ? undefined : out.slice(0, 400)});
      console.log(variant, id, Date.now() - started, 'ms', result?.marks?.length ?? 0, 'marks', error);
    }));
  }));
  await writeFile(out, JSON.stringify(results, null, 1));
}
