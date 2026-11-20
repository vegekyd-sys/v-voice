// The canvas's eye (VOICE_BOARD_CANVAS=1; docs/research/board-canvas): the illustrator chooses the
// photographs of a stage without seeing them; once they are found, this looks at them with V's words
// cut into numbered clauses, and says which place on which photograph each clause talks about. Each
// place becomes a `pin` on the stage, hung on that clause's words, so the page's pointer goes to it and
// rings it as the voice gets there. One text-and-image call, no thinking (about 1.5 s in the research).
import {cueQuote} from './board-cue.mjs';
import {clauses} from './board-clause.mjs';

export const EYE_INSTRUCTIONS = `你是 V 的指针。V 正在电话里讲解，用户看着屏幕上的几张照片听。每张照片前面写了它的 id 和名字。V 要念的话已经按标点切成编号小段：「[0]…[1]…」。
你的任务：在照片上标出每一段讲到的那个地方，让用户的眼睛跟着声音走——讲到尾巴，指针就停在尾巴上、把它圈出来。

只输出一个 JSON 对象，不要任何别的文字：
{"pins":[{"cue":段号,"on":"照片 id","where":"它在照片里的位置","kind":"ring","box":[x1,y1,x2,y2],"label":"不超过 6 个字"},…]}
- where 先用一句话说清这个东西在照片的哪一块、挨着什么（「画面右下，身体后面垂下来的那条」「左边那辆车的车头正中」），box 再照着它写。
- box 是 on 那张照片上的位置：左上角 [0,0]，右下角 [1000,1000]（按照片的宽和高各自换算成千分比），紧贴着那个东西的边。指针停在框的中心，圈画在框上。
- kind：ring（圈出一个部位，最常用）；point（只停住不圈：讲整只、整个、很大的东西时）。
- label 写这个部位的名字（「尾巴」「进气格栅」「屋脊兽」），贴在圈旁边。
- 每一段最多一个；没有讲到照片上具体地方的段（开场、能力、来历、数字、总结、提问）不标。
- 照片上看不到 V 讲的东西就不标，不要猜一个位置（照片里没有充电口，就不要圈「充电口」）。V 说某样东西「没有」（没有格栅、没有排气管）时也不标。
- 人物照片（球员、明星）：V 只是提到这个人、讲他的数据或经历时不标；只有讲到他身上看得见的东西（球衣号码、发型、动作）才标。
- label 写 V 讲的那个东西的名字，不要写「天空」「背景」这类 V 没讲的。
- 最多 8 个，少而准。`;

const json = text => {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};

/**
 * Look at a stage's photographs (`shots`: [{id, h, bytes, type}]) with what V says (`said`) and
 * return its pins, each hung on the words of the clause it talks about. `complete` is the board's
 * own streaming completion (thinking off). Pins on a photograph not given, without a box, or on a
 * clause V has not said are dropped.
 * With `from` and `to` only those clauses are given and pinned (a tour: the clauses about this photograph).
 */
export async function lookAt({complete, shots, said, signal, from = 0, to = Infinity}) {
  const parts = clauses(said), last = Math.min(to, parts.length);
  if (!shots.length || last <= from) return [];
  const content = [];
  for (const shot of shots) content.push({type: 'text', text: `照片 ${shot.id}：${shot.h || shot.img}`}, {type: 'image_url', image_url: {url: `data:${shot.type};base64,${Buffer.from(shot.bytes).toString('base64')}`}});
  content.push({type: 'text', text: `${from > 0 || last < parts.length ? 'V 讲这张照片的话' : 'V 要念的话'}：${parts.slice(from, last).map((part, index) => `[${from + index}]${part}`).join('')}`});
  let text = '';
  for await (const chunk of complete({messages: [{role: 'system', content: EYE_INSTRUCTIONS}, {role: 'user', content}], signal})) text += chunk;
  const known = new Set(shots.map(shot => shot.id)), seen = new Set();
  return (json(text)?.pins ?? []).slice(0, 8).map((pin, index) => {
    const cue = Number(pin?.cue), q = Number.isInteger(cue) && cue >= from && cue < last ? cueQuote(said, cue) : '';
    // ("无", "没有排气管": what is not there is not pointed at.)
    if (!q || !known.has(pin.on) || seen.has(cue) || /^(无|没有|不)/u.test(String(pin.label ?? '').trim())) return null;
    seen.add(cue);
    return {id: `n${index + 1}`, k: 'pin', on: pin.on, box: pin.box, kind: pin.kind === 'point' ? 'point' : 'ring', h: pin.label, q};
  }).filter(Boolean);
}


/**
 * The eye the director uses: `see({shots, said, signal})`. `find(query)` is the board's photo finder
 * (shared with the page's own pictures, so a photograph is fetched once).
 */
// (A photograph may take a while to find when several are asked for at once; one told later in the answer is still worth looking at.)
export function createBoardEye({complete, find, timeoutMs = 20000}) {
  return {
    find: query => Promise.race([Promise.resolve(find(query)).catch(() => null), new Promise(resolve => setTimeout(resolve, timeoutMs, null))]),
    see: ({shots, said, signal, from, to}) => lookAt({complete, shots, said, signal, from, to}),
  };
}
