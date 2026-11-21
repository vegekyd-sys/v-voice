// The script a video is made from, rewritten before it is submitted. The voice
// model answers in speech and writes a video prompt the way it talks: one line
// of what the caller asked for ("让他们激烈地打起来"). A video model given that
// makes a picture that barely moves. This is the director's pass: a text model
// (optionally shown the reference pictures) turns the caller's request and the
// voice model's draft into a shot script in the form Makaron's own writer uses
// (ai-image-editor src/lib/prompts/animate.md, condensed to what one short
// reference video needs). Nothing but the script's words changes: the pictures,
// the model, the duration and the caller's request are as they were. If the
// writer is slow, says nothing usable or drops a picture, the draft is used.

export const VIDEO_SCRIPT_GUIDE = `你是专业的视频导演，给 AI 视频模型写脚本。用户在电话里向 V 要一段短视频，V 写了一句草稿（draft）。你把它写成一份能拍出好片子的分镜脚本。

# 输入
JSON：ask 是用户的原话（以它为准）；draft 是 V 的草稿；seconds 是成片秒数；media 是参考图，按顺序对应 <<<media_1>>>、<<<media_2>>>…，每张有名字和画面里实际有什么。附带图片时，以你看到的图为准。

# 输出
只输出脚本正文，不要标题、解释、代码块。用用户说话的语言写；\`Shot N (Xs):\`、\`Style:\` 和 \`<<<media_N>>>\` 这三种写法保持原样。

# 怎么写
1. 开头一句先交代每张参考图是谁：「<<<media_1>>>（尼卡路飞）」。每个 <<<media_N>>> 后面都跟角色名或名词，不要直接接动词。media 里的每一张都要用到；只有一张、而它本身就是完整的画面时，写「角色、场景和画风以 <<<media_1>>>（这张海报）为准」，并说清图里左边是谁、右边是谁。
   参考图常常已经是一个定格的动作瞬间（出拳、对撞、摆好的姿势）。成片不能停在这个姿势上：第一镜可以从它的构图起，但不到一秒动作就要继续下去（拳头打出去、对方被击退或闪开、人物走动），后面的镜头换到图里没有的角度和景别（拳头特写、低角度仰拍、俯拍全景、绕到背后、脸部特写）。整段看下来像同一张图在抖，就是失败。
2. 写接下来发生什么，不要复述图里已经有的静态内容。最差的片子是一张几乎不动的图：不要整段只有缓慢推镜头，不要写「画面动起来」「氛围感十足」这种空话。每个镜头里主体都要做一件看得见的事。
3. 时长：
   - 5 秒以内：安静的内容（让一张照片活起来、人物回头一笑、风吹过）用一个连续镜头，一条完整的动作弧线——起势（约 1 秒）→ 一个明确的动作（约 3 秒）→ 收住（约 1 秒）。打斗、追逐、舞蹈、广告这类要节奏的内容，5 秒也切 2 到 3 个镜头（比如 2s + 2s + 1s）。
   - 6 到 15 秒：分镜，用 \`Shot N (Xs):\`。6–10 秒写 3 到 5 个镜头，11–15 秒写 5 到 7 个；每个镜头 2 到 3 秒，所有镜头的秒数加起来必须正好等于 seconds（写完自己加一遍）。
4. 每个镜头：先写景别和一种运镜（远景/中景/近景/特写；推、拉、摇、环绕、跟拍、俯拍、低角度——一个镜头只用一种运镜），再写一个主要动作。相邻两个镜头至少换一样：景别、角度、动作或强度。
5. 第一个镜头就是最抓人的画面，不要用平淡的全景开场。动作要有因果：谁出招、打中哪里、对方怎么反应。最后一个镜头给结果：谁占上风、定格、产品或标题亮相。
   打斗要有来回，一镜一招：甲进攻 → 乙闪开或挡住 → 乙反击 → 甲中招或化解 → 双方大招对撞 → 分出结果。不要每一镜都是两个人站在原地互相放招。
6. 两个以上角色同框时，写死各自的位置和外貌特征（「左侧白发缠着火焰的路飞」「右侧黑色巨人般的基格尔德」），整段保持不变，免得模型把两人画混。角色的造型以参考图为准，不要另外描述出一套不同的样子。
7. 每个镜头末尾可加一句声音：\`Sound: 雷声炸响，低频鼓点。\` 要台词时写成「角色（语气）：“台词”」。广告片最后一个镜头给产品特写和一句口号。
8. 最后一行写 \`Style:\`，一句话定风格、光线和节奏。
9. 用户提的要求（时长、谁赢、多切镜头、很激烈、要搞笑、广告感……）一条都不能丢；用户没提的品牌、角色、文字不要自己加。全文不超过 900 字。`;

const bounded = (value, limit) => Array.from(String(value ?? '').replace(/\s+/gu, ' ').trim()).slice(0, limit).join('');

/**
 * A rewritten script made fit to submit: no fence or preamble, one line, and
 * its shots' seconds adding up to the film's. A writer's arithmetic is often
 * one second out over six or seven shots (call of 11/21: a fifteen-second
 * script was refused for it and the one-line draft was filmed instead), so the
 * shots are re-timed in proportion rather than the script thrown away. A
 * picture named that was not given is unnamed. Returns {script, mended} or
 * {script: '', why} when it cannot be used; `missing` lists pictures given and not named.
 */
export function fitScript(text, {media = 0, seconds = 0} = {}) {
  let script = String(text ?? '').replace(/^```[a-z]*\n?|```\s*$/gu, '').trim();
  if (script.length < 20) return {script: '', why: 'empty'};
  if (script.length > 2400 || /[\0]/u.test(script)) return {script: '', why: 'long'};
  const mended = [];
  script = script.replace(/<<<media_(\d+)>>>/gu, (whole, number) => { if (Number(number) >= 1 && Number(number) <= media) return whole; mended.push('marker'); return ''; });
  const used = new Set([...script.matchAll(/<<<media_(\d+)>>>/gu)].map(match => Number(match[1])));
  const missing = Array.from({length: media}, (_, index) => index + 1).filter(n => !used.has(n));
  const shots = [...script.matchAll(/Shot \d+ \((\d+(?:\.\d+)?)s\):/gu)].map(match => Number(match[1]));
  const total = shots.reduce((sum, value) => sum + value, 0);
  if (shots.length && seconds && Math.abs(total - seconds) > 0.01) {
    if (shots.length > seconds) return {script: '', why: `shots ${shots.length} in ${seconds}s`};
    // In proportion, whole seconds, at least one each; what is left over goes to (or comes off) the longest.
    const timed = shots.map(value => Math.max(1, Math.round(value * seconds / total)));
    for (let left = seconds - timed.reduce((sum, value) => sum + value, 0), guard = 0; left !== 0 && guard < 60; guard++) {
      const at = left > 0 ? timed.indexOf(Math.max(...timed)) : timed.findIndex(value => value === Math.max(...timed) && value > 1);
      if (at < 0) break;
      timed[at] += Math.sign(left); left -= Math.sign(left);
    }
    if (timed.reduce((sum, value) => sum + value, 0) !== seconds) return {script: '', why: `shots ${total}s of ${seconds}s`};
    let index = 0;
    script = script.replace(/(Shot \d+ \()(\d+(?:\.\d+)?)(s\):)/gu, (whole, lead, old, tail) => `${lead}${timed[index++]}${tail}`);
    mended.push(`timing ${total}→${seconds}`);
  }
  // (One line: the command it goes into is a single line.)
  script = script.replace(/\s*\n+\s*/gu, ' ').replace(/\s{2,}/gu, ' ').trim();
  return {script, mended, missing};
}
/** The script alone, or '' (a picture given and not named is a script that cannot be used as it is). */
export function usableScript(text, options = {}) { const fit = fitScript(text, options); return fit.script && !fit.missing.length ? fit.script : ''; }

/**
 * `complete({messages, signal})` yields text. `vision`: the reference pictures
 * are shown to the writer (`look(url)` resolves a data URL, or '' when the
 * picture cannot be had in time).
 * `write({ask, draft, seconds, media: [{name, see, url}]})` resolves the script, or '' to keep the draft.
 */
export function createVideoScriptWriter({complete, vision = false, look = null, timeoutMs = 9000, guide = VIDEO_SCRIPT_GUIDE, audit = () => {}, now = Date.now} = {}) {
  if (!complete) return null;
  return {
    vision: Boolean(vision && look),
    async write({ask = '', draft = '', seconds = 5, media = [], signal} = {}) {
      const started = now(), controller = new AbortController(), abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
      const timer = setTimeout(abort, timeoutMs);
      let script = '', why = '', mended = '';
      try {
        const request = JSON.stringify({ask: bounded(ask, 400), draft: bounded(draft.replace(/<<<media_\d+>>>/gu, match => match), 600), seconds,
          media: media.map((item, index) => ({n: index + 1, name: bounded(item.name, 30) || `图 ${index + 1}`, ...(item.see ? {shows: bounded(item.see, 160)} : {})}))});
        const pictures = vision && look ? (await Promise.all(media.slice(0, 4).map(item => item.url ? look(item.url, controller.signal).catch(() => '') : ''))).map((url, index) => url ? [{type: 'text', text: `<<<media_${index + 1}>>>：`}, {type: 'image_url', image_url: {url}}] : []).flat() : [];
        let text = '';
        for await (const chunk of complete({messages: [{role: 'system', content: guide}, {role: 'user', content: pictures.length ? [...pictures, {type: 'text', text: request}] : request}], signal: controller.signal})) text += chunk;
        const fit = fitScript(text, {media: media.length, seconds});
        script = fit.script;
        // (A picture the writer left out is still part of what was asked for: it is named at the head.)
        if (script && fit.missing.length) { script = `${fit.missing.map(n => `<<<media_${n}>>>（${bounded(media[n - 1]?.name, 20) || '参考图'}）`).join('、')}也要出现在画面里。 ${script}`; fit.mended.push('unnamed'); }
        if (!script) why = fit.why ?? 'empty'; else if (fit.mended.length) mended = fit.mended.join(', ');
      } catch (error) { why = controller.signal.aborted ? 'timeout' : 'failed'; }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      audit({type: 'media.script', ok: Boolean(script), ...(why ? {why} : {}), ...(mended ? {mended} : {}), vision: Boolean(vision && look), media: media.length, seconds, chars: script.length, durationMs: now() - started});
      return script;
    },
  };
}

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
/**
 * A `makaron video create` command with its script replaced. `argv` is the
 * command as the executor reads it (without "makaron"). Returns the command, or
 * null when it is not a video creation with a script.
 */
export function withScript(argv, script) {
  const at = argv.indexOf('--script');
  if (argv[0] !== 'video' || argv[1] !== 'create' || at < 0 || !argv[at + 1]) return null;
  const next = argv.slice(); next[at + 1] = script;
  return 'makaron ' + next.map(quote).join(' ');
}
/** The parts of a video creation the writer needs: its draft script and its length in seconds. */
export function scriptOf(argv) {
  const value = name => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] ?? '' : ''; };
  return argv[0] === 'video' && argv[1] === 'create' && value('script') ? {draft: value('script'), seconds: Number(value('duration')) || 5, images: argv.filter((item, index) => argv[index - 1] === '--image')} : null;
}
