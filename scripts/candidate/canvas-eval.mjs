// Experiment (docs/research/board-canvas): can the board's model draw a thing well enough to
// teach with it - a jet engine, a heart - as named parts made of curves, on one canvas?
// Text completions only; no call, page or Gateway. Writes the drawings and timings as JSON.
//
//   VOICE_BOARD=1 DEEPSEEK_API_KEY=… node scripts/candidate/canvas-eval.mjs out.json
import {writeFile} from 'node:fs/promises';
import {createChatCompletionStream} from '../../lab/gpt-live-h5/board-director.mjs';

export const CANVAS_INSTRUCTIONS = `你是 V 的画手。用户在电话里请 V 讲解一个东西，你要在一块 400 宽、300 高的画布上把它画出来：画出它真实的样子和内部构造，让人一眼认出这是什么，然后 V 会一边讲一边用指针指着各个部件。

只输出一个 JSON 对象，不要任何别的文字：
{"title":"不超过 10 个字","parts":[部件,…],"flows":[流动,…]}

部件：{"id":"英文小写","label":"部件名，不超过 6 个字","note":"一句话说它干什么，不超过 14 个字","anchor":[x,y],"shapes":[图形,…]}
- 一个部件是一个真实存在的部分（「压气机」「燃烧室」「左心室」「岩浆房」），由几个图形组成。整张图 4 到 8 个部件，先画外形和最大的部件，再画里面的。
- anchor 是这个部件上适合让指针停住的点，要落在这个部件自己的图形里面。
图形：
- {"k":"path","d":"SVG 路径","fill":颜色,"line":线} d 只用 M L C Q Z 这几个命令和绝对坐标，用曲线（C、Q）画出真实的轮廓：机身的流线、心脏的弧形、山的坡度，不要只用直线和方框拼。
- {"k":"circle","c":[x,y,r],"fill":…,"line":…}
- {"k":"ellipse","c":[x,y,rx,ry],"fill":…,"line":…}
- {"k":"rect","c":[x,y,宽,高,圆角],"fill":…,"line":…}
颜色 fill 只能是：paper（白）、lilac（淡紫）、butter（奶黄）、sky（淡蓝）、peach（橙粉）、rose（玫红）、ink（深紫，少用）、none（不填）。不要绿色。
线 line 只能是 "ink"（实线）、"soft"（浅色）或 "dash"（虚线，看不见的内部结构）。
流动：{"label":"不超过 6 个字","d":"SVG 路径，同上"} 沿路径流动的东西：气流、血流、电流、水流、光线。0 到 3 条，路径方向就是流动方向。

怎么画得像：
- 先想这个东西在课本插图里通常怎么画（剖面图、侧视图），照那个视角画；整张图占满画布，四边各留 20 左右。
- 外形用一个大的 path 勾出来，内部部件放在外形里面；部件之间不要互相乱叠。
- 每个部件 3 个图形以内就够，宁可简洁、比例对，也不要细碎。`;

const TOPICS = ['喷气式飞机的发动机是怎么工作的', '心脏是怎么泵血的', '火山是怎么喷发的', '相机是怎么成像的', '马桶冲水的原理',
  '自行车的变速是怎么回事', '日食是怎么形成的', '光合作用在叶子里是怎么进行的', '冰箱为什么能制冷', '拱桥为什么不容易塌'];

const parse = text => { const s = text.indexOf('{'), e = text.lastIndexOf('}'); try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; } };
const key = process.env.VOICE_BOARD_API_KEY ?? process.env.DEEPSEEK_API_KEY;
const variants = {
  flash: createChatCompletionStream({apiKey: key, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', maxTokens: 4000, timeoutMs: 60000, extra: {thinking: {type: 'disabled'}}}),
  thinking: createChatCompletionStream({apiKey: key, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', maxTokens: 12000, timeoutMs: 180000, extra: {thinking: {type: 'enabled'}}}),
};
const out = process.argv[2] ?? 'canvas-eval.json', results = [];
await Promise.all(TOPICS.map(async topic => {
  for (const [name, complete] of Object.entries(variants)) {
    const started = Date.now(); let text = '', error = '';
    try { for await (const chunk of complete({messages: [{role: 'system', content: CANVAS_INSTRUCTIONS}, {role: 'user', content: JSON.stringify({topic})}]})) text += chunk; }
    catch (e) { error = String(e?.message ?? e).slice(0, 200); }
    const drawing = parse(text);
    results.push({topic, variant: name, ms: Date.now() - started, chars: text.length, ok: Boolean(drawing?.parts?.length), error, drawing});
    console.log(name, topic, Date.now() - started, 'ms', drawing?.parts?.length ?? 0, 'parts', error);
  }
}));
await writeFile(out, JSON.stringify(results, null, 1));
