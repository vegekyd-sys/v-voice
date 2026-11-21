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
1. 开头一句先交代每张参考图是谁：「<<<media_1>>>（尼卡路飞）」。每个 <<<media_N>>> 后面都跟角色名或名词，不要直接接动词。media 里的每一张都要用到；只有一张、而它本身就是完整的画面时，写「以 <<<media_1>>>（这张海报）的画面为开场」。
2. 写接下来发生什么，不要复述图里已经有的静态内容。最差的片子是一张几乎不动的图：不要整段只有缓慢推镜头，不要写「画面动起来」「氛围感十足」这种空话。每个镜头里主体都要做一件看得见的事。
3. 时长：
   - 5 秒以内：一个连续镜头，一条完整的动作弧线——起势（约 1 秒）→ 一个明确的动作（约 3 秒）→ 收住（约 1 秒）。
   - 6 到 15 秒：分镜，用 \`Shot N (Xs):\`。6–10 秒写 3 到 5 个镜头，11–15 秒写 4 到 6 个；每个镜头 2 到 4 秒，所有镜头的秒数加起来必须正好等于 seconds。
4. 每个镜头：先写景别和一种运镜（远景/中景/近景/特写；推、拉、摇、环绕、跟拍、俯拍、低角度——一个镜头只用一种运镜），再写一个主要动作。相邻两个镜头至少换一样：景别、角度、动作或强度。
5. 第一个镜头就是最抓人的画面，不要用平淡的全景开场。动作要有因果：谁出招、打中哪里、对方怎么反应。最后一个镜头给结果：谁占上风、定格、产品或标题亮相。
6. 两个以上角色同框时，写死各自的位置和外貌特征（「左侧白发缠着火焰的路飞」「右侧黑色巨人般的基格尔德」），整段保持不变，免得模型把两人画混。角色的造型以参考图为准，不要另外描述出一套不同的样子。
7. 每个镜头末尾可加一句声音：\`Sound: 雷声炸响，低频鼓点。\` 要台词时写成「角色（语气）：“台词”」。广告片最后一个镜头给产品特写和一句口号。
8. 最后一行写 \`Style:\`，一句话定风格、光线和节奏。
9. 用户提的要求（时长、谁赢、多切镜头、很激烈、要搞笑、广告感……）一条都不能丢；用户没提的品牌、角色、文字不要自己加。全文不超过 900 字。`;

const bounded = (value, limit) => Array.from(String(value ?? '').replace(/\s+/gu, ' ').trim()).slice(0, limit).join('');

/**
 * What a rewritten script must still be: every picture named, the shots'
 * seconds adding up to the film's, no fence or preamble, a sane length.
 * Returns the cleaned script, or '' when it cannot be used.
 */
export function usableScript(text, {media = 0, seconds = 0} = {}) {
  let script = String(text ?? '').replace(/^```[a-z]*\n?|```\s*$/gu, '').trim();
  if (script.length < 20 || script.length > 2400 || /[\0]/u.test(script)) return '';
  const used = new Set([...script.matchAll(/<<<media_(\d+)>>>/gu)].map(match => Number(match[1])));
  if ([...used].some(n => n < 1 || n > media)) return '';
  for (let n = 1; n <= media; n++) if (!used.has(n)) return '';
  const shots = [...script.matchAll(/^Shot \d+ \((\d+(?:\.\d+)?)s\):/gmu)].map(match => Number(match[1]));
  if (shots.length && seconds && Math.abs(shots.reduce((sum, value) => sum + value, 0) - seconds) > 0.01) return '';
  // (One line: the command it goes into is a single line.)
  script = script.replace(/\s*\n+\s*/gu, ' ').replace(/\s{2,}/gu, ' ');
  return script;
}

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
      let script = '', why = '';
      try {
        const request = JSON.stringify({ask: bounded(ask, 400), draft: bounded(draft.replace(/<<<media_\d+>>>/gu, match => match), 600), seconds,
          media: media.map((item, index) => ({n: index + 1, name: bounded(item.name, 30) || `图 ${index + 1}`, ...(item.see ? {shows: bounded(item.see, 160)} : {})}))});
        const pictures = vision && look ? (await Promise.all(media.slice(0, 4).map(item => item.url ? look(item.url, controller.signal).catch(() => '') : ''))).map((url, index) => url ? [{type: 'text', text: `<<<media_${index + 1}>>>：`}, {type: 'image_url', image_url: {url}}] : []).flat() : [];
        let text = '';
        for await (const chunk of complete({messages: [{role: 'system', content: guide}, {role: 'user', content: pictures.length ? [...pictures, {type: 'text', text: request}] : request}], signal: controller.signal})) text += chunk;
        script = usableScript(text, {media: media.length, seconds});
        if (!script) why = text ? 'unusable' : 'empty';
      } catch (error) { why = controller.signal.aborted ? 'timeout' : 'failed'; }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      audit({type: 'media.script', ok: Boolean(script), ...(why ? {why} : {}), vision: Boolean(vision && look), media: media.length, seconds, chars: script.length, durationMs: now() - started});
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
