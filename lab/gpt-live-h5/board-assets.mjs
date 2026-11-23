// The call's shelf of things that can be seen: every picture or video V made
// (itself, or through its backend) in a call, each with a short id ("a1"), what
// it was made from, how far along it is and what is in it. One shelf per
// service; one row per call. It has three readers:
//   - the page, which shows a made thing on the board the moment it is asked
//     for (a sketch while it is being made, the picture when it is, the video
//     in the picture's own frame when the picture is made to move);
//   - the voice model, which is told in a few lines what is on the caller's
//     screen and may name a thing by its id instead of copying a link;
//   - the board's illustrator, which may put a made thing on a lesson's page
//     and may ask for one to be made.
// Nothing here decides what V does: the shelf records what the call's own
// tools did and tells the same facts to everyone who needs them.
import {mediaReferences} from './media-references.mjs';
import {scenePictures} from './board-scene.mjs';

const OWNER_TTL_MS = 30 * 60000, MAX_ASSETS = 24;
export const ASSET_ID = /^a[1-9]\d{0,2}$/u;
// A photograph found for the board ("p3"): on the shelf so that V can name it as the picture to work from.
export const SHELF_ID = /^[ap][1-9]\d{0,2}$/u;
const MAX_PHOTOS = 16;
// A picture the call always has ("v": V's own image).
export const STANDING_ID = /^[b-oq-z]$/u;
/**
 * V's own image as the shelf holds it: the avatar V's identity names as its canonical reference
 * (V's workspace, assets/v-avatar.jpg; chosen by Tianyi 2026-10-07, sha256 ffee37c8…; a copy is
 * kept in assets/). `see`: what is in the picture, for the voice model and the script writer.
 */
export const SELF_IMAGE_FILE = 'v-avatar.jpg';
export const SELF_IMAGE = {id: 'v', name: 'V 自己的形象', query: 'standing:v', aliases: ['V', '你自己', '你的形象', '自己的形象', 'V的形象', '你的头像', 'V的头像'],
  see: '银白长发、齐刘海、黑色发圈扎的低马尾，灰蓝色大眼睛，冰蓝色无袖立领上衣，衣领上别着一只橙色小龙虾，3D 动画角色'};
const bounded = (value, limit) => Array.from(String(value ?? '').replace(/\s+/gu, ' ').trim()).slice(0, limit).join('');
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };

// What the voice model is told once, wherever a shelf exists for the call.
export const ASSET_POLICY = '屏幕素材：用户屏幕的画面上摆着本通话生成的图片和视频，每个有编号（a1、a2…）。下面「屏幕素材现状」会随时更新，里面写的是图里真实看得到的东西。现状里列出的作品都已经做好、用户已经在屏幕上看到了，不用再查询进度或说“我看看好了没”；写着“正在做”的才是还没好的。用户说“这张”“它”“刚才那张”“那个视频”，指用户正点着的那个；没有点着的就是最新的那个；仍然分不清再问。用户问图里有什么、谁在哪边，按现状里的描述回答，不编造没写的细节。屏幕上搜到的照片也可以当参考图，现状里列着它们的编号和名字（p1「名字」…）。用户说“把那张海报改成 Q 版”“照这张画一个”，指的是搜到的照片时就用它；写的时候对着名字选，也可以直接写名字（--ref "基格尔德 完全体形态"），不要凭印象写编号。标着“搜错了”的照片不是那样东西，不能当参考：告诉用户这张搜得不对，换一张或者重新找。要改图、换风格、让图动起来、拿它当参考时，创作命令里 --image 和 --ref 直接写编号（例如 --image a1 或 --image p2），系统会换成真实链接；不要抄写、朗读或编造链接。编号只写在命令和交给后台的 context 里：对用户说话、写给用户的消息里不说编号，说它的名字，或者“第一张”“刚才那个视频”。交给后台处理屏幕上的东西时，在 context 里写清它的编号。两个以上的角色或东西同框时，每一个都带上它自己的参考图：出图用 --image 写主图、其余每张各写一个 --ref；做视频最稳的是先出一张同框的图，用户认可后让这张图动起来（--image 写这张图），也可以带多个 --image，脚本里用 <<<media_1>>>、<<<media_2>>> 分别指它们。用户认可了一张图后说“做成视频”“动起来”，就是让这张图动：--image 写它。用户说造型不像、不对，就换上或加上屏幕上那张对的照片当参考重做，不要只改文字描述；屏幕上没有对的照片就先找。做视频时 --script 只写一两句话：谁、要发生什么、什么风格、结果如何。不要写分镜、秒数、镜头和运镜，导演会按用户的要求补写成分镜；你写得越长，用户等得越久。completionLine 是事先写的，只说做好了，不说“样子对了”“造型全对”这类你还没看到的话。生成中的东西已经显示在画面上，做好会自己显影，不用另外展示。';
export const ASSET_CONTEXT_EMPTY = '屏幕素材现状：画面上还没有生成的图片或视频。';
// What the illustrator is told (appended to its instructions by the service).
export const ASSET_NOTES = `
# 生成的作品（work）
- 屏幕上的 work 区块是用户让 V 生成的图片或视频（{"id","t":"work","asset":"a1"}），它自己会显影、会动。原样保留：不重画、不改写、不删除，也不要再为同一样东西去找照片。
- 用户这一句是在要 V 画一张、生成一张、做个视频、改图、让图动起来时：输出 none。作品会自己上画面，不要为它开新页、配照片或写「生成中」。
- request 里 workshop 为 true：用户和 V 正在这一页上做作品。他们商量做什么、做哪几张、怎么改、什么风格，V 说「正在弄」「接着做下一张」时，都输出 none：不开新页，不把要做的东西列成清单，不为它们找照片。只有用户明显换了话题、去问一件别的事时才 scene 开新页。
- V 介绍一张作品时（「左边是…，右边是…」），可以在同一页加一个区块写它讲到的要点，挂在讲到的那一段上；不要把作品换成别的图。
- request 里的 assets 列出了本通话已有的作品（编号、名字、画面里有什么）。讲解正好要用到其中一张、而它还不在任何一页上时，可以把它放上来：{"id":"w1","t":"work","asset":"a1"}，像照片一样挂在讲到它的那一段。只能写 assets 里有的编号。它已经在 canvas 的某一页上时，用户再问起它，就用 zone 回到那一页接着画，不要再放一遍。`;
export const ASSET_MAKE_NOTES = `
- request 里 make 为 true（这是一段讲解的讲稿，并且 notes 里有一句的画面提示写了「现画：…」）时，照那条提示请 V 现画一张图：{"id":"w1","t":"work","make":"要画的画面，一两句话写清主体、动作、构图和风格","caption":"不超过 10 个字"}。只用在拍不到、搜不到的画面上：想象的场景、比喻、故事里的一幕、两个不同作品的角色同框、给小朋友看的示意画。真实存在的东西（地方、人物、产品、角色本人）仍然用照片。
- 现画一张要十秒左右：把它挂在第三段以后才讲到的内容上，前面几段先用别的东西。一页最多一张，一次回答最多一张；可画可不画时不画。`;

// What the lesson's script writer is told (appended to its instructions by the service).
export const ASSET_SCRIPT_NOTES = `
# 现画的图和已有的作品
- 输入里 make 为 true 时，可以请 V 现画一张图：那一句的画面提示写「现画：要画的画面」，写清主体、动作、构图和风格。只用在拍不到、搜不到的画面上：想象的场景、比喻、故事里的一幕、两个不同作品的角色同框、给小朋友看的示意画；真实存在的东西仍然用照片。现画一张要十秒左右，所以放在第三句以后；一次讲解最多一张，可画可不画时不画。讲稿里只说这幅画要表达的意思，不描述图里的细节（你看不到它最后画成什么样）。
- 输入里的 assets 是这通电话里已经生成的作品（编号、名字、画面里有什么）。用户要你讲这张作品、或者讲解正好用得上它时，画面提示写「作品 a1」把它放上来，并按 see 里写的讲它画了什么；不要为它另外找照片。`;

/**
 * The caller only asked for pictures to be found ("找几张皮卡丘和路飞的图片"): nothing is drawn for
 * that. Call of 11/21: the script for such a request added a drawn picture of the two together,
 * which the caller had not asked for and which is paid for.
 */
export const asksOnlyToFind = text => { const said = String(text ?? ''); return /找|搜|查|来几张|看看有没有|有没有|看(?:一?下|看|一看)|给我看|看几张/u.test(said) && /图|照片|相片|海报|壁纸|截图/u.test(said) && !/画|生成|做一|做个|做张|设计|创作|合成|同框|讲|介绍|解释|为什么|怎么/u.test(said); };

/** What a photograph on the board is called there: its caption, or the words of the item it stands beside. */
export function pictureName(pages, query) {
  const plain = item => String(item.h ?? item.label ?? item.img).replaceAll('*', '');
  const pictures = block => [...(block.items ?? []), ...(block.nodes ?? []), ...(block.cols ?? []), ...(block.sides ?? [])].filter(item => item?.img);
  for (const page of pages ?? []) for (const block of page?.blocks ?? []) {
    if (block.t === 'photo' && block.query === query) return block.caption ?? query;
    for (const item of pictures(block)) if (item.img === query) {
      const name = plain(item);
      // (Two rows each with an "官方立绘": the row's own heading tells them apart — 11/21, 皮卡丘 and 路飞.)
      const twin = (pages ?? []).some(other => (other?.blocks ?? []).some(row => pictures(row).some(peer => peer.img !== query && plain(peer) === name)));
      const head = String(block.h ?? '').replaceAll('*', '').trim();
      return twin && head && !name.includes(head) ? `${head} ${name}` : name;
    }
  }
  return query;
}

const parseOutput = result => {
  if (result == null || result?.cancelled === true || typeof result?.error === 'string') return '';
  if (typeof result === 'string') return result;
  const blocks = Array.isArray(result?.output?.content) ? result.output.content : Array.isArray(result?.content) ? result.content : null;
  if (blocks) return blocks.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n');
  if (typeof result?.result === 'string') return result.result;
  return '';
};

/**
 * What a creation command asks for, read without running anything: the kind
 * of thing, the words it is made from and the reference it starts from.
 * `null` for a command that makes nothing new (a status query, a save).
 */
export function readCreation(command) {
  const text = String(command ?? '');
  const video = /^\s*makaron\s+video\s+create(?:\s|$)/u.test(text), image = /^\s*makaron\s+edit(?:\s|$)/u.test(text);
  if (!video && !image) return null;
  const tokens = [];
  // (Quotes only; the executor's own parser refuses anything a shell would act on.)
  for (const match of text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(\S+)/gu)) tokens.push({text: match[1] ?? match[2] ?? match[3], quoted: match[3] === undefined});
  const flag = name => { const at = tokens.findIndex(token => !token.quoted && token.text === '--' + name); return at >= 0 ? tokens[at + 1]?.text ?? '' : ''; };
  const flagged = new Set();
  tokens.forEach((token, index) => { if (!token.quoted && token.text.startsWith('--')) { flagged.add(index); flagged.add(index + 1); } });
  const positional = tokens.filter((token, index) => index >= (video ? 3 : 2) && !flagged.has(index)).map(token => token.text).join(' ');
  const words = video ? flag('script').replace(/<<<media_\d+>>>/gu, '').trim() : positional;
  const aspect = /^\d{1,2}:\d{1,2}$/u.test(flag('aspect')) ? flag('aspect') : '';
  return {kind: video ? 'video' : 'image', prompt: bounded(words, 300), reference: flag('image') || flag('ref'), ...(aspect ? {aspect} : {})};
}

// (`parts`: where things are in the picture, for a pointer to go round them. Asked for only where
// something draws them (the canvas's stage): in the call of 11/21 five boxes made the look take
// four to five seconds, and V had announced the picture before it had been seen.)
const lookInstructions = parts => `你是 V 的眼睛。V 正在和用户通话，下面这张图刚刚出现在用户的屏幕上。你替 V 看一眼，让 V 之后能说出图里真实有什么。
只输出一个 JSON 对象，不要任何别的文字，先写 name 再写 see：
{"name":"这张图的名字，不超过 10 个字","see":"两句话：画面里有什么、谁在左谁在右、各自在做什么、什么风格；有文字就抄下来"${parts ? ',"parts":[{"h":"部位或角色的名字，不超过 6 个字","box":[x1,y1,x2,y2]},…]' : ''}}
- 只写看得见的。认不出是谁就按样子说（「橙色衣服的金发少年」），不要猜画面外的事。${parts ? '\n- parts 是图里最值得指给用户看的 2 到 5 处（每个角色、最显眼的道具或文字）。box 是它在图上的位置：左上角 [0,0]，右下角 [1000,1000]，按图的宽和高各自换算成千分比，紧贴着它的边。' : ''}
- name 像给作品起的名字（「鸣人大战路飞海报」「雪夜角楼」），不带标点。`;

// A found photograph, checked: the board asked for it by name and nobody has looked at what came back
// (call of 11/21: "柴犬全身" was a photograph of a rubber stamp, and V gave it as the picture of the dog).
const CHECK_INSTRUCTIONS = `你替 V 核对一张搜来的图。V 按一个名字去搜图，搜回来的图没有人看过，可能根本不是那样东西。
只输出一个 JSON 对象，不要任何别的文字：
{"see":"图里实际是什么，一句话，不超过 30 个字","fits":true 或 false}
- fits：图里的主体就是名字说的那样东西（那个角色、那种动物、那个地方、那件产品）时为 true。是别的东西、只是相关的周边（印章、玩具、文字截图、别的角色）、主体小到看不清、是另一个形态或版本而名字写明了形态时，为 false。
- 认不出具体是谁时，按样子描述，fits 按你能判断的写；拿不准时写 true。`;

const json = text => {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};
const box = value => Array.isArray(value) && value.length === 4 && value.every(number => Number.isFinite(Number(number)))
  ? (([x1, y1, x2, y2]) => [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)])(value.map(number => Math.round(Math.max(0, Math.min(1000, Number(number)))))) : null;

/**
 * The shelf's eye: one text-and-image call, no thinking, on the board's own
 * model (the same call the canvas's pointer makes, board-eye.mjs: the two are
 * one look at one picture and can share a call when both are on).
 * `see({url, prompt, signal})` resolves {name, see, parts} or null.
 */
export function createAssetEye({complete, fetchImpl = fetch, maxBytes = 4 * 1024 * 1024, timeoutMs = 12000, parts: wanted = false} = {}) {
  if (!complete) return null;
  // `check`: a photograph the board found under a name ({name, query}). The answer is short: what is
  // really in it, and whether that is the thing it is named for. `bytes`/`type`: the picture itself, when held.
  return async function see({url = '', bytes = null, type = '', prompt = '', check = null, signal} = {}) {
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, timeoutMs);
    try {
      // The picture is read here and handed over as bytes: the model's host may not reach the media host quickly.
      let image = url;
      if (bytes?.length && bytes.length <= maxBytes && /^image\/(png|jpe?g|webp|gif)$/u.test(type)) image = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
      else if (url) try {
        const response = await fetchImpl(url, {signal: controller.signal, redirect: 'follow'});
        const kind = String(response.headers?.get?.('content-type') ?? '').split(';')[0].trim();
        if (response.ok && /^image\/(png|jpe?g|webp|gif)$/u.test(kind)) {
          const body = Buffer.from(await response.arrayBuffer());
          if (body.length && body.length <= maxBytes) image = `data:${kind};base64,${body.toString('base64')}`;
        }
      } catch { /* The link itself is still worth a try. */ }
      if (!image) return null;
      if (check) {
        let answer = '';
        for await (const chunk of complete({messages: [{role: 'system', content: CHECK_INSTRUCTIONS}, {role: 'user', content: [{type: 'image_url', image_url: {url: image}},
          {type: 'text', text: `这张图是按「${bounded(check.query, 60)}」搜到的，页面上叫它「${bounded(check.name, 24)}」。`}]}], signal: controller.signal})) answer += chunk;
        const told = json(answer), shows = bounded(told?.see, 40);
        return shows ? {see: shows, fits: told.fits !== false} : null;
      }
      const content = [{type: 'image_url', image_url: {url: image}},
        {type: 'text', text: prompt ? `这张图是按这段要求生成的（图里实际画成什么样，以你看到的为准）：${bounded(prompt, 300)}` : '这张图是 V 的后台刚做出来的。'}];
      let text = '';
      for await (const chunk of complete({messages: [{role: 'system', content: lookInstructions(wanted)}, {role: 'user', content}], signal: controller.signal})) text += chunk;
      const value = json(text);
      const name = bounded(value?.name, 14).replace(/[，。！？、；：,.!?;:"'“”‘’《》]/gu, ''), seen = bounded(value?.see, 220);
      if (!seen) return null;
      const parts = (Array.isArray(value.parts) ? value.parts : []).slice(0, 5).map(part => ({h: bounded(part?.h, 8), box: box(part?.box)})).filter(part => part.h && part.box);
      return {name, see: seen, parts};
    } catch { return null; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}

// The pictures a creation command names after --image / --ref, as written.
const REFERENCE = /(--(?:image|ref)\s+)(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(\S+))/gu;
const plainName = value => String(value ?? '').replace(/[\s，。！？、；：,.!?;:"'“”‘’（）()\-—*·「」《》]/gu, '').toLowerCase();
// How well a name written in a command fits the name a picture goes by: one within the other, or shared pairs of characters.
function nameFit(wanted, name) {
  const want = plainName(wanted), have = plainName(name);
  if (want.length < 2 || !have) return 0;
  if (have.includes(want) || want.includes(have)) return 1 + Math.min(want.length, have.length) / 100;
  const pairs = text => new Set(Array.from({length: text.length - 1}, (_, index) => text.slice(index, index + 2)));
  const a = pairs(want), b = pairs(have);
  let both = 0;
  for (const pair of a) if (b.has(pair)) both++;
  return a.size ? both / a.size : 0;
}

/**
 * `director`: the board (board-director.mjs), asked to hang a made thing on
 * the call's canvas. `see`: createAssetEye. `watch`ers are told whenever what
 * the voice model should know has changed.
 */
export function createAssetShelf({director = null, see = null, now = Date.now, audit = () => {}, maxOwners = 64, lookWaitMs = 0, makeLimit = 3, setTimer = setTimeout, standing = []} = {}) {
  const owners = new Map();
  // A call whose connection was lost goes on under another session (`adopt`): what was begun under the
  // first finishes on the shelf where the call is now.
  const heirs = new Map(), heirOf = id => { let at = id; for (let step = 0; step < 8 && heirs.has(at); step++) at = heirs.get(at); return at; };
  // Pictures every call has at hand from its first moment (V's own image): named in a command like a
  // found photograph ("--image v"), lent out the same way, never crowded off the shelf.
  const kept = (Array.isArray(standing) ? standing : []).filter(item => STANDING_ID.test(item?.id ?? '') && item.name).slice(0, 4);
  const pictures = value => [...value.standing, ...value.photos];
  const row = id => {
    let value = owners.get(id);
    if (!value) {
      for (const [key, old] of owners) if (now() - old.touched >= OWNER_TTL_MS) owners.delete(key);
      while (owners.size >= maxOwners) owners.delete(owners.keys().next().value);
      value = {standing: kept.map(item => ({id: item.id, kind: 'image', state: 'ready', query: item.query ?? `standing:${item.id}`, name: bounded(item.name, 24), aliases: item.aliases ?? [], see: bounded(item.see, 160), url: '', source: 'search', standing: true})), assets: [], photos: [], shots: 0, checks: 0, lanes: [Promise.resolve(), Promise.resolve()], count: 0, picked: '', watchers: new Set(), turns: new Map(), maker: null, made: 0, making: Promise.resolve(), touched: now(), stamp: 0};
      owners.set(id, value);
    }
    value.touched = now();
    return value;
  };
  const changed = (owner, value, {quiet = false} = {}) => {
    value.stamp++;
    if (!quiet) for (const watcher of value.watchers) { try { watcher(); } catch { /* A reader's failure is its own. */ } }
  };
  const find = (value, ref) => {
    const text = String(ref ?? '').trim().replace(/^@/u, '');
    if (STANDING_ID.test(text.toLowerCase())) return value.standing.find(item => item.id === text.toLowerCase()) ?? null;
    if (SHELF_ID.test(text)) return value.assets.find(asset => asset.id === text) ?? value.photos.find(photo => photo.id === text) ?? null;
    const url = https(text);
    return url ? value.assets.find(asset => asset.url === url) ?? pictures(value).find(photo => photo.url === url) ?? null : null;
  };
  const add = (value, asset) => {
    value.assets.push(asset);
    // The oldest finished things make room; one still on a page of the canvas is only forgotten by the shelf.
    while (value.assets.length > MAX_ASSETS) value.assets.splice(value.assets.findIndex(item => item.state !== 'making') >= 0 ? value.assets.findIndex(item => item.state !== 'making') : 0, 1);
    return asset;
  };
  const fresh = (value, fields) => ({id: `a${++value.count}`, kind: 'image', state: 'ready', url: '', name: '', prompt: '', from: '', refs: [], source: 'made', see: '', parts: [], shown: false, at: now(), readyAt: 0, ...fields});
  // What the page shows of a thing.
  const card = asset => ({id: asset.id, kind: asset.kind, state: asset.state, ...(asset.url ? {url: asset.url} : {}), ...(asset.name ? {name: asset.name} : {}),
    ...(asset.prompt ? {prompt: bounded(asset.prompt, 80)} : {}), ...(asset.from ? {from: asset.from} : {}), ...(asset.refs?.length ? {refs: asset.refs} : {}), source: asset.source, ...(asset.aspect ? {aspect: asset.aspect} : {}), at: asset.at});
  const look = (owner, value, asset) => {
    if (!see || asset.kind !== 'image' || !asset.url) return Promise.resolve(null);
    const started = now();
    asset.looking = Promise.resolve().then(() => see({url: asset.url, prompt: asset.prompt})).then(found => {
      asset.looking = null;
      audit({type: 'board.asset-look', voiceSessionId: owner, asset: asset.id, found: Boolean(found), parts: found?.parts.length ?? 0, durationMs: now() - started});
      owner = heirOf(owner);
      if (!found || !owners.get(owner)?.assets.includes(asset)) return null;
      asset.see = found.see; asset.parts = found.parts;
      if (found.name && !asset.named) { asset.name = found.name; director?.retitle?.(owner, asset.id, found.name); }
      changed(owner, value);
      return found;
    }, () => { asset.looking = null; return null; });
    return asset.looking;
  };
  const wait = (promise, ms) => new Promise(resolve => { const timer = setTimer(() => resolve(null), ms); Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); }); });
  // Every version of one thing (a picture, the same picture changed, the video made of it) shares a frame on the board.
  const family = (value, asset) => {
    let root = asset;
    for (let step = 0; step < 12 && root.from; step++) { const parent = value.assets.find(item => item.id === root.from); if (!parent) break; root = parent; }
    const ids = [root.id];
    for (let grew = true; grew;) { grew = false; for (const item of value.assets) if (item.from && ids.includes(item.from) && !ids.includes(item.id)) { ids.push(item.id); grew = true; } }
    return ids.filter(id => id !== asset.id);
  };
  // (`gone`: things that were not made. Their empty frames leave the page when the next thing goes up.)
  const place = (owner, asset, extra = {}) => { try { director?.place?.(owner, {asset: asset.id, family: family(owners.get(owner), asset), title: asset.name, gone: owners.get(owner).assets.filter(item => item.state === 'failed').map(item => item.id), ...extra}); } catch { /* The shelf still holds it. */ } };
  const describe = asset => {
    const kind = asset.kind === 'video' ? '视频' : '图片', origin = asset.from ? `，由 ${asset.from} 做成` : '';
    const what = asset.see || (asset.prompt ? `按这段要求生成：${bounded(asset.prompt, 90)}` : '');
    return `${asset.id} ${kind}${asset.name ? `「${asset.name}」` : ''}${origin}${asset.source === 'backend' ? '（后台做的）' : ''}${what ? `：${what}` : ''}`;
  };
  // The picture the caller's words point at: "那个烤鸡的图片", "这张…". By the name it goes by, or the one picked.
  const pointedAt = (value, said) => {
    const words = String(said ?? '');
    if (!words || /(?:不用|不要|别用|不需要)[^，。,.]{0,6}(?:图|照片)|重新(?:画|生成|做)一张|另外/u.test(words)) return null;
    const usable = item => item.fits !== false && (item.kind === 'image' && item.state === 'ready');
    const here = [...value.photos, ...value.assets].filter(usable);
    if (/(?:你自己|你的|小何的|V的)(?:的)?(?:形象|头像|照片|图片)/iu.test(words)) return value.standing.find(item=>item.id==='v') ?? null;
    if (/(?:我(?:刚刚?|刚才)?上传的[^，。]{0,6}(?:图|照片)|我自己的(?:照片|图片)|我的(?:照片|图片))/u.test(words)) return here.filter(item=>item.source==='upload').at(-1) ?? null;
    for (const match of words.matchAll(/[那这]\s*(?:个|张|幅|只|份)?\s*([^，。,.！？!?、那这]{2,12}?)的?\s*(?:那张|这张)?\s*(?:图片|照片|图|海报)/gu)) {
      const named = here.filter(item => nameFit(match[1], item.name) >= 1 || item.query && nameFit(match[1], item.query) >= 1).at(-1);
      if (named) return named;
    }
    if (/这张|这个图|这幅/u.test(words) && value.picked) return here.find(item => item.id === value.picked) ?? null;
    return null;
  };
  // The photographs found for the board lately, as V is told of them (by name, in the order they went up).
  // Which thing on the shelf a picture named in a command is: by its id, or by the name it goes by
  // on the board ("基格尔德 完全体形态"). A name is what V means; an id is easily the wrong one (call of
  // 11/21: "after p10's Zygarde", and p10 was a photograph of Luffy). `link`: already an address.
  const meant = (value, token) => {
    const text = String(token ?? '').trim().replace(/^@/u, '');
    if (https(text)) return {link: true};
    if (STANDING_ID.test(text.toLowerCase())) return {id: text.toLowerCase(), item: value.standing.find(item => item.id === text.toLowerCase()) ?? null};
    if (SHELF_ID.test(text)) return {id: text, item: value.assets.find(item => item.id === text) ?? value.photos.find(item => item.id === text) ?? null};
    let best = null, fit = 0;
    for (const item of [...value.standing, ...value.photos, ...value.assets.filter(asset => asset.kind === 'image' && asset.state === 'ready')]) {
      const score = Math.max(nameFit(text, item.name), item.query && !item.standing ? nameFit(text, item.query) : 0, ...(item.aliases ?? []).map(alias => plainName(alias) === plainName(text) ? 2 : 0));
      // (Of two that fit alike, the later one: the one last put before the caller.)
      if (score >= fit && score > 0) { best = item; fit = score; }
    }
    return {name: text, item: fit >= .5 ? best : null};
  };
  // Those on the page V is on come first and in the order they stand there, so "the second one" is the
  // second in the line (ids go by when each photograph arrived, which is no order the caller can see).
  const photosLine = (value, owner) => {
    if (!value.photos.length) return '';
    let here = [];
    try { const scene = director?.state?.(owner)?.scene; here = scene ? [...scenePictures(scene)].map(query => value.photos.find(photo => photo.query === query)).filter(Boolean) : []; } catch { here = []; }
    // (One that is not what it was searched for is said to be so, with what it really shows: not a picture to work from.)
    const others = value.photos.filter(photo => !here.includes(photo)).slice(-Math.max(0, 8 - here.length)), say = photo => `${photo.id}「${photo.name}」${photo.fits === false ? `（搜错了，图里其实是：${photo.see}）` : ''}`;
    return here.length
      ? `这一页上搜到的照片（按画面上的先后，可当参考图）：${here.map(say).join('、')}。${others.length ? `之前页上的：${others.map(say).join('、')}。` : ''}`
      : `搜到的照片（可当参考图）：${others.map(say).join('、')}。`;
  };
  const api = {
    available: true,
    canLook: Boolean(see),
    /**
     * Lends a found photograph out under a private address for a while (set by the service: it
     * holds the pictures). `share(query)` resolves the address, or '' where none can be given.
     */
    share: null,
    /** The picture itself, for looking at (set by the service): `picture(query)` resolves {bytes, type} or null. */
    picture: null,
    /** The page has been given a photograph the board asked for: it is something V can now work from. */
    found(owner, {query, name = ''} = {}) {
      const value = row(owner), key = bounded(query, 60);
      if (!key || value.photos.some(photo => photo.query === key)) return;
      const photo = {id: `p${++value.shots}`, kind: 'image', state: 'ready', query: key, name: bounded(name || key, 24), url: '', source: 'search'};
      value.photos.push(photo);
      while (value.photos.length > MAX_PHOTOS) value.photos.shift();
      changed(owner, value);
      // Looked at once, two at a time: V is told when what came back is not the thing it was searched for.
      if (see && api.picture && value.checks < 40) {
        const lane = value.checks++ % 2, started = now();
        const check = async () => {
          let found = null;
          try { const picture = await api.picture(key); if (picture?.bytes?.length) found = await see({bytes: picture.bytes, type: picture.type, check: {query: key, name: photo.name}}); } catch { found = null; }
          audit({type: 'board.photo-check', voiceSessionId: owner, photo: photo.id, checked: Boolean(found), fits: found?.fits ?? null, durationMs: now() - started});
          owner = heirOf(owner);
          if (!found || !owners.get(owner)?.photos.includes(photo)) return;
          photo.see = found.see; photo.fits = found.fits;
          if (!found.fits) changed(owner, value);
        };
        photo.checking = value.lanes[lane] = value.lanes[lane].then(check, check);
      }
    },
    /**
     * Before a creation command is read: the photographs it names (or, with no command, the latest
     * few, for V's backend) are given addresses a generator can fetch them from.
     */
    bindUserReference(owner, command, words) {
      if (!/^\s*makaron\s+edit\s/u.test(command) || /不用|不要用|别用/u.test(words)) return command;
      const value = row(owner);
      const own = /(?:你自己|你的|小何的|V的)(?:的)?(?:形象|头像|照片|图片)/iu.test(words);
      const uploaded = /我(?:刚刚?|刚才)?上传的|我自己的(?:图片|照片)|我的(?:图片|照片)/u.test(words);
      if (!own && !uploaded) return command;
      const ref = own ? value.standing.find(item=>item.id==='v') :
        value.assets.find(item=>item.id===value.picked && item.source==='upload') ?? value.assets.filter(item=>item.source==='upload').at(-1);
      if (!ref) throw Error(own ? '当前通话没有 V 的形象参考图' : '请先点添加参考图，选一张你自己的图片');
      const refs = [...command.matchAll(REFERENCE)];
      if (refs.some(match=>meant(value,match[2]??match[3]??match[4]).item?.id===ref.id)) return command;
      if (refs.length===1 && !meant(value,refs[0][2]??refs[0][3]??refs[0][4]).item) {
        return command.replace(REFERENCE,(_match,flag)=>flag+ref.id);
      }
      return command.replace(/^([\s]*makaron\s+edit)\b/u,'$1 '+(refs.length?'--ref ':'--image ')+ref.id);
    },
    async lend(owner, command = null) {
      const value = owners.get(owner);
      if (!value || !api.share) return;
      const named = command === null ? value.photos.slice(-6) : [...new Set([...String(command).matchAll(REFERENCE)].map(match => meant(value, match[2] ?? match[3] ?? match[4]).item).filter(item => item && pictures(value).includes(item)))];
      await Promise.all(named.filter(photo => !photo.url || photo.until < now()).map(async photo => {
        let ok = false;
        try { const lent = await api.share(photo.query); if (lent?.url) { photo.url = lent.url; photo.until = lent.until ?? Infinity; ok = true; } } catch { /* It stays without an address. */ }
        audit({type: 'board.asset-lend', voiceSessionId: owner, photo: photo.id, ok});
      }));
    },
    /** A creation command is about to run. Ids in it become links; a new thing gets its place on the board. */
    begin(owner, {command, turn = null} = {}) {
      const value = row(owner), text = String(command ?? '');
      // (--image a1 / --ref p3 / --ref '基格尔德 完全体形态': something on the shelf, by id or by name.)
      let missing = null;
      const used = [];
      const resolved = text.replace(REFERENCE, (whole, lead, single, double, bare) => {
        const found = meant(value, single ?? double ?? bare);
        if (found.link) return whole;
        // A video is not a reference picture; the picture it was made from is.
        const source = found.item?.kind === 'video' && found.item.from ? value.assets.find(item => item.id === found.item.from) : found.item;
        if (source?.fits === false) { missing ??= {...found, wrong: source}; return whole; }
        if (!source?.url || source.kind !== 'image' || source.until !== undefined && source.until < now()) { missing ??= {...found, held: Boolean(source)}; return whole; }
        if (!used.includes(source.id)) used.push(source.id);
        return `${lead}'${source.url}'`;
      });
      if (missing) {
        const have = [...value.photos.filter(photo => photo.fits !== false).slice(-8), ...value.assets.filter(asset => asset.kind === 'image' && asset.state === 'ready').slice(-4)].map(item => `${item.id}「${item.name || item.id}」`).join('、');
        // (Looked at, and not the thing it is named for: used as the reference it would make the thing wrong again.)
        if (missing.wrong) return {command: text, error: `「${missing.wrong.name}」这张搜到的图不对：图里其实是${missing.wrong.see}。本次没有提交。换一张对的当参考；屏幕上没有对的就重新找一张，或者告诉用户后只按文字来画。${have ? `现有：${have}。` : ''}`};
        return {command: text, error: missing.held
          ? `「${missing.item.name || missing.id}」这张这次没能取到，不能当参考图；本次没有提交。可以换一张，或者告诉用户后只按文字来画。`
          : `屏幕上没有${missing.name ? `叫「${bounded(missing.name, 20)}」的图片` : `可用的图片 ${missing.id}`}；本次没有提交。${have ? `现有：${have}。` : ''}用户指的是其中一张就对着名字重写命令；用户要的那张本来就不在屏幕上（他以前发的照片、文件里的图、以前做的作品），就用 delegate_to_v 交后台，不要换一张顶替。`};
      }
      const creation = readCreation(resolved);
      if (!creation) return {command: resolved};
      // The caller pointed at a picture that is here ("那个烤鸡的图片，做个视频") and the command works from
      // none: what would be made is another thing (call of 11/22 01:53: a roast chicken made from words).
      if (!used.length && !/--(?:image|ref)\s/u.test(resolved)) {
        const pointed = pointedAt(value, turn?.text);
        if (pointed) return {command: text, error: `用户指的是画面上的 ${pointed.id}「${pointed.name || pointed.id}」，这条命令没有用它；本次没有提交、未扣费。带上 --image ${pointed.id}${creation.kind === 'video' ? '，并在 --script 里用 <<<media_1>>> 指它' : ''}，重写命令再提交。`};
      }
      // One request of the caller's makes one thing of a kind (the executor answers a repeat with
      // the first submission's result): the repeat shares the first one's place on the board.
      const key = turn ?? value, kinds = value.turns.get(key) ?? {};
      const known = kinds[creation.kind] && value.assets.find(asset => asset.id === kinds[creation.kind]);
      // (A command refused before it was submitted and written again starts the same thing anew.)
      if (known) { if (known.state === 'failed') { known.state = 'making'; known.prompt = creation.prompt; known.refs = used; known.at = now(); changed(owner, value, {quiet: true}); } return {command: resolved, id: known.id}; }
      const origin = find(value, creation.reference);
      const parent = origin ? (origin.kind === 'video' && origin.from ? value.assets.find(item => item.id === origin.from) ?? origin : origin) : null;
      // (A version goes by the name its picture was given: "the video of X", not a nameless video.)
      const asset = add(value, fresh(value, {kind: creation.kind, state: 'making', prompt: creation.prompt, from: parent?.id ?? '', refs: used, ...(parent?.name && creation.kind === 'video' ? {name: parent.name, named: true} : {}), ...(creation.aspect ? {aspect: creation.aspect} : parent?.aspect ? {aspect: parent.aspect} : {})}));
      value.turns.set(key, {...kinds, [creation.kind]: asset.id});
      if (value.turns.size > 64) value.turns.delete(value.turns.keys().next().value);
      audit({type: 'board.asset', voiceSessionId: owner, asset: asset.id, kind: asset.kind, state: 'making', from: asset.from || null, ...(used.length ? {refs: used} : {})});
      // (`turn`: asked for by the caller just now. The turn's picture is this thing.)
      place(owner, asset, {turn: true});
      changed(owner, value, {quiet: true});
      return {command: resolved, id: asset.id};
    },
    /**
     * The command has finished. Resolves what the voice model is told about the
     * thing: its id, and (when the eye is quick enough) what is in the picture.
     */
    async finish(owner, id, output) {
      owner = heirOf(owner);
      const value = owners.get(owner);
      const media = output?.media && !output.isError ? output.media : null, url = https(media?.url);
      if (!value) return url ? api.add(owner, {kind: media.kind, url, source: 'made'}) : null;
      // (No id: a question about a task already submitted. Its answer belongs to the thing still being made.)
      const asset = value.assets.find(item => item.id === id) ?? (url ? value.assets.find(item => item.url === url) ?? value.assets.find(item => item.state === 'making' && item.kind === (media.kind === 'video' ? 'video' : 'image')) : null);
      if (!asset) return url ? api.add(owner, {kind: media.kind, url, source: 'made'}) : null;
      // (A wait that ended with the video still rendering leaves its place as it is: the same task is asked about again.)
      if (!url) {
        if (output?.details?.status === 'pending' || asset.state !== 'making') return null;
        // (Why, in the executor's own words without any address: a refusal by the generator and a command written wrongly are different things to fix.)
        const said = output?.why ?? (output?.isError ? parseOutput(output) || output?.error : '');
        asset.state = 'failed'; audit({type: 'board.asset', voiceSessionId: owner, asset: asset.id, kind: asset.kind, state: 'failed', ...(said ? {why: bounded(String(said).replace(/https?:\/\/\S+/gu, '<链接>'), 240)} : {})});
        changed(owner, value, {quiet: true});
        return null;
      }
      if (asset.state === 'ready' && asset.url === url) { await wait(asset.looking, lookWaitMs); return api.facts(owner, asset.id); }
      asset.state = 'ready'; asset.url = url; asset.kind = media.kind === 'video' ? 'video' : 'image'; asset.readyAt = now();
      if (asset.kind === 'image' && value.picked && asset.refs?.includes(value.picked)) value.picked = asset.id;
      audit({type: 'board.asset', voiceSessionId: owner, asset: asset.id, kind: asset.kind, state: 'ready', madeMs: asset.readyAt - asset.at});
      changed(owner, value);
      await wait(look(owner, value, asset), lookWaitMs);
      return api.facts(owner, asset.id);
    },
    /** A finished thing from elsewhere (V's backend): on the shelf and on the board as it is. */
    add(owner, {kind = 'image', url, name = '', source = 'backend', from = ''} = {}) {
      const value = row(owner), link = https(url);
      if (!link) return null;
      const known = value.assets.find(asset => asset.url === link);
      if (known) return api.facts(owner, known.id);
      const asset = add(value, fresh(value, {kind: kind === 'video' ? 'video' : 'image', url: link, name: bounded(name, 14), named: Boolean(name), source, from: find(value, from)?.id ?? '', readyAt: now()}));
      audit({type: 'board.asset', voiceSessionId: owner, asset: asset.id, kind: asset.kind, state: 'ready', source});
      place(owner, asset);
      changed(owner, value);
      void look(owner, value, asset);
      return api.facts(owner, asset.id);
    },
    /** Tap on the service audit stream: what V's backend made comes back as links in its result. */
    observe(event) {
      if (event?.type !== 'tool.delivered' || event.name !== 'delegate_to_v' || typeof event.voiceSessionId !== 'string') return;
      const text = parseOutput(event.result);
      if (!text) return;
      // (Not the media host's own page links or avatars: only files that are pictures or videos.)
      for (const item of mediaReferences(text).slice(0, 4)) api.add(event.voiceSessionId, {kind: item.kind, url: item.url, name: /^(图片|视频|生成图片|生成视频)$/u.test(item.title) ? '' : item.title, source: 'backend'});
    },
    /**
     * What the pictures a command is made from are, in the command's order, for whoever writes its
     * script (media-script.mjs): [{name, see, url}]. A link the shelf does not know is only its link.
     */
    sources(owner, urls) {
      const value = owners.get(owner);
      return (Array.isArray(urls) ? urls : []).slice(0, 9).map(url => { const item = value ? find(value, url) : null; return {url, name: item?.name ?? '', see: item?.see ?? ''}; });
    },
    /** The script a video was really made from (the director's pass over the voice model's draft). */
    scripted(owner, id, {draft = '', script = ''} = {}) {
      const asset = owners.get(owner)?.assets.find(item => item.id === id);
      if (!asset || !script) return;
      asset.prompt = bounded(script.replace(/<<<media_\d+>>>/gu, ''), 300);
      audit({type: 'board.asset-script', voiceSessionId: owner, asset: asset.id, draft: bounded(draft, 240), script: bounded(script, 1200)});
    },
    /** What the voice model is given back with a tool result. */
    facts(owner, id) {
      const asset = owners.get(owner)?.assets.find(item => item.id === id);
      const value = owners.get(owner), called = id => { const item = value.assets.find(other => other.id === id) ?? value.photos.find(other => other.id === id); return item?.name || id; };
      // (`references`: what it was really made from, by name, so a wrong picture is noticed and not repeated.)
      return asset ? {id: asset.id, kind: asset.kind, ...(asset.name ? {name: asset.name} : {}), ...(asset.from ? {from: asset.from} : {}), ...(asset.refs?.length ? {references: asset.refs.map(called)} : {}), ...(asset.see ? {see: asset.see} : {}), onBoard: Boolean(director)} : null;
    },
    /** The few lines the voice model keeps about the caller's screen. */
    /**
     * What the call always has at hand, said once beside the policy (not with every change of the
     * screen: said with each, "…不在画面上" was read as nothing being on the screen).
     */
    standingNote() {
      return kept.length ? `常驻素材（一直在你手上，随时可当参考图）：${kept.map(item => `${item.id}「${item.name}」${item.see ? `（${bounded(item.see, 60)}）` : ''}`).join('、')}。用户说“用你的形象”“你自己”“把你放进去”，创作命令里写 --image v（要它和别的图一起出现就写 --ref v）。` : '';
    },
    context(owner) {
      const value = owners.get(owner), ready = (value?.assets ?? []).filter(asset => asset.state === 'ready').slice(-8);
      const coming = (value?.assets ?? []).filter(asset => asset.state === 'making').map(asset => `${asset.kind === 'video' ? '视频' : '图片'}${asset.from ? `（由 ${asset.from} 做成）` : ''}`);
      const making = coming.length ? `正在做、还没好：${coming.join('、')}。` : '';
      const photo = value?.photos.find(item => item.id === value.picked);
      if (!ready.length) return value?.photos.length || making ? `屏幕素材现状：还没有做好的图片或视频。${making}${photo ? `用户正点着 ${photo.id}「${photo.name}」。` : ''}${photosLine(value, owner)}` : ASSET_CONTEXT_EMPTY;
      const picked = ready.find(asset => asset.id === value.picked);
      return `屏幕素材现状：${ready.map(describe).join('；')}。${making}${picked ? `用户正点着 ${picked.id}。` : photo ? `用户正点着 ${photo.id}「${photo.name}」。` : `最新的是 ${ready.at(-1).id}。`}${photosLine(value, owner)}`;
    },
    /** What V has at hand to make things from, by name: what was made, what was found, what it always has. */
    names(owner) {
      const value = owners.get(owner);
      return [...kept.map(item => item.name), ...(value?.assets ?? []).filter(asset => asset.state === 'ready').slice(-8).map(asset => `${asset.name || (asset.kind === 'video' ? '视频' : '图片')}（${asset.kind === 'video' ? '做好的视频' : '做好的图'}）`), ...(value?.photos ?? []).filter(photo => photo.fits !== false).slice(-8).map(photo => `${photo.name}（搜到的照片）`)];
    },
    /** For V's backend: the same things with their links (it has no screen to look at). */
    backendContext(owner) {
      const ready = (owners.get(owner)?.assets ?? []).filter(asset => asset.state === 'ready').slice(-6);
      const lent = (owners.get(owner)?.photos ?? []).filter(photo => photo.url && photo.until >= now()).slice(-6);
      const made = ready.length ? `通话屏幕上的素材（用户用编号或“这张”指它们）：${ready.map(asset => `${describe(asset)} 链接 ${asset.url}`).join('；')}。${owners.get(owner).picked ? `用户正点着 ${owners.get(owner).picked}。` : ''}` : '';
      const found = lent.length ? `屏幕上搜到的照片（用户说“那张海报”“第二张”可能指它们，可当参考图，链接半小时内有效）：${lent.map(photo => `${photo.id}「${photo.name}」 链接 ${photo.url}`).join('；')}。` : '';
      return made || found ? `\n${made}${found}` : '';
    },
    /** What the illustrator is told is there to use. */
    digest(owner) {
      return (owners.get(owner)?.assets ?? []).filter(asset => asset.state !== 'failed').slice(-8).map(asset => ({id: asset.id, kind: asset.kind, ...(asset.name ? {name: asset.name} : {}), ...(asset.see ? {see: bounded(asset.see, 100)} : asset.prompt ? {asked: bounded(asset.prompt, 60)} : {}), ...(asset.state === 'making' ? {making: true} : {})}));
    },
    /** Whether something the caller asked for is still being made. */
    busy(owner) { return Boolean(owners.get(owner)?.assets.some(asset => asset.state === 'making' && asset.source === 'made')); },
    has(owner, id) { return Boolean(owners.get(owner)?.assets.some(asset => asset.id === id && asset.state !== 'failed')); },
    get(owner, id) { return owners.get(owner)?.assets.find(asset => asset.id === id) ?? null; },
    /** The page's view: every thing, the one picked, and whether anything is still coming. */
    page(owner) {
      const value = owners.get(owner);
      // (`call`: which session's shelf this is, so a page whose call went on as another takes it anew.)
      if (!value) return {call: String(owner).slice(0, 8), assets: [], photos: [], picked: '', busy: false, stamp: 0};
      // (With the found photographs things were made from, so a frame can show what it is being made of.)
      const sources = pictures(value).filter(photo => photo.url && value.assets.some(asset => asset.from === photo.id || asset.refs?.includes(photo.id))).map(photo => ({id: photo.id, kind: 'image', state: 'ready', url: photo.url, name: photo.name, source: 'search', at: 0}));
      // (`photos`: every found photograph by what the board calls for it, so the page can say which one was tapped.)
      return {call: String(owner).slice(0, 8), assets: [...sources, ...value.assets.map(card)], photos: value.photos.map(photo => ({id: photo.id, query: photo.query, name: photo.name})), picked: value.picked, busy: value.assets.some(asset => asset.state === 'making'), stamp: value.stamp};
    },
    /** The caller tapped a thing: "this one" is that one until another is tapped. */
    pick(owner, id) {
      const value = owners.get(owner);
      if (!value || id !== '' && !value.assets.some(asset => asset.id === id && asset.state === 'ready') && !value.photos.some(photo => photo.id === id) || value.picked === id) return false;
      value.picked = id; changed(owner, value);
      return true;
    },
    async openingImage(owner, reference, words) {
      const value = owners.get(owner);
      if (!value) return '';
      const item = reference === 'current'
        ? pointedAt(value, words) ?? (value.picked ? find(value, value.picked) : value.assets.filter(item => item.state === 'ready').at(-1))
        : [...pictures(value), ...value.assets].find(item => item.id === reference);
      if (item?.kind !== 'image' || item.state !== 'ready' || item.fits === false) return '';
      return https(await api.address(owner, item.id));
    },
    /** Where a thing can be fetched from outside the call (to save it): a made thing's own link, a found photograph lent out. */
    async address(owner, id) {
      const value = owners.get(owner), asset = value?.assets.find(item => item.id === id && item.state === 'ready');
      if (asset) return asset.url;
      if (!value || !pictures(value).some(photo => photo.id === id)) return '';
      await api.lend(owner, `--image ${id}`);
      const photo = pictures(value).find(item => item.id === id);
      return photo?.url && photo.until >= now() ? photo.url : '';
    },
    /** The page has the thing on screen (its picture loaded). */
    seen(owner, ids) {
      const value = owners.get(owner);
      for (const id of Array.isArray(ids) ? ids.slice(0, 12) : []) { const asset = value?.assets.find(item => item.id === id); if (asset && asset.state === 'ready') asset.shown = true; }
    },
    shown(owner, id) { return owners.get(owner)?.assets.find(asset => asset.id === id)?.shown === true; },
    watch(owner, watcher) { const value = row(owner); value.watchers.add(watcher); return () => value.watchers.delete(watcher); },
    /** The call's own way of making a picture (its creation executor), offered to lessons. */
    attach(owner, maker) { row(owner).maker = typeof maker === 'function' ? maker : null; },
    canMake(owner) { const value = owners.get(owner); return Boolean(value?.maker) && value.made < makeLimit; },
    /**
     * A lesson asks for a picture to be drawn. The place is on the shelf at once
     * (the caller sees the sketch); the picture arrives when the executor has it.
     * Returns the new id, or '' when this call may not make one.
     */
    make(owner, {prompt, caption = '', aspect = '4:3'} = {}) {
      const value = owners.get(owner), words = bounded(prompt, 300);
      if (!value?.maker || value.made >= makeLimit || !words) return '';
      value.made++;
      const asset = add(value, fresh(value, {state: 'making', prompt: words, name: bounded(caption, 14), named: Boolean(caption), source: 'lesson', aspect}));
      audit({type: 'board.asset', voiceSessionId: owner, asset: asset.id, kind: 'image', state: 'making', source: 'lesson'});
      changed(owner, value, {quiet: true});
      const maker = value.maker;
      // One at a time: the executor answers a second picture asked for meanwhile with the first.
      value.making = value.making.then(() => maker({prompt: words, aspect})).then(output => api.finish(owner, asset.id, output), () => api.finish(owner, asset.id, {isError: true})).catch(() => {});
      return asset.id;
    },
    /**
     * The call of session `from` goes on as session `to`: its shelf with it, the things still being made
     * included. Not when the new session already has things of its own. True when it was carried over.
     */
    adopt(to, from) {
      const old = owners.get(from), fresh = owners.get(to);
      if (!old || to === from || fresh && (fresh.assets.length || fresh.photos.length)) return false;
      old.watchers = fresh?.watchers ?? new Set(); old.maker = fresh?.maker ?? null; old.turns = new Map(); old.touched = now();
      owners.delete(from); owners.set(to, old);
      heirs.set(from, to);
      while (heirs.size > 64) heirs.delete(heirs.keys().next().value);
      changed(to, old);
      return true;
    },
    /** The session a call goes on as (itself, where it was not lost). */
    heir: heirOf,
    forget(owner) { owners.delete(owner); },
  };
  return api;
}
