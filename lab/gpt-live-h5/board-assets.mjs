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

const OWNER_TTL_MS = 30 * 60000, MAX_ASSETS = 24;
export const ASSET_ID = /^a[1-9]\d{0,2}$/u;
const bounded = (value, limit) => Array.from(String(value ?? '').replace(/\s+/gu, ' ').trim()).slice(0, limit).join('');
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };

// What the voice model is told once, wherever a shelf exists for the call.
export const ASSET_POLICY = '屏幕素材：用户屏幕的画面上摆着本通话生成的图片和视频，每个有编号（a1、a2…）。下面「屏幕素材现状」会随时更新，里面写的是图里真实看得到的东西。用户说“这张”“它”“刚才那张”“那个视频”，指用户正点着的那个；没有点着的就是最新的那个；仍然分不清再问。用户问图里有什么、谁在哪边，按现状里的描述回答，不编造没写的细节。要改图、换风格、让图动起来、拿它当参考时，创作命令里 --image 和 --ref 直接写编号（例如 --image a1），系统会换成真实链接；不要抄写、朗读或编造链接。交给后台处理屏幕上的东西时，在 context 里写清它的编号。生成中的东西已经显示在画面上，做好会自己显影，不用另外展示。';
export const ASSET_CONTEXT_EMPTY = '屏幕素材现状：画面上还没有生成的图片或视频。';
// What the illustrator is told (appended to its instructions by the service).
export const ASSET_NOTES = `
# 生成的作品（work）
- 屏幕上的 work 区块是用户让 V 生成的图片或视频（{"id","t":"work","asset":"a1"}），它自己会显影、会动。原样保留：不重画、不改写、不删除，也不要再为同一样东西去找照片。
- 用户这一句是在要 V 画一张、生成一张、做个视频、改图、让图动起来时：输出 none。作品会自己上画面，不要为它开新页、配照片或写「生成中」。
- V 介绍一张作品时（「左边是…，右边是…」），可以在同一页加一个区块写它讲到的要点，挂在讲到的那一段上；不要把作品换成别的图。
- request 里的 assets 列出了本通话已有的作品（编号、名字、画面里有什么）。讲解正好要用到其中一张、而它还不在任何一页上时，可以把它放上来：{"id":"w1","t":"work","asset":"a1"}，像照片一样挂在讲到它的那一段。只能写 assets 里有的编号。它已经在 canvas 的某一页上时，用户再问起它，就用 zone 回到那一页接着画，不要再放一遍。`;
export const ASSET_MAKE_NOTES = `
- request 里 make 为 true 时，你可以请 V 现画一张图：{"id":"w1","t":"work","make":"要画的画面，一两句话写清主体、动作、构图和风格","caption":"不超过 10 个字"}。只用在拍不到、搜不到的画面上：想象的场景、比喻、故事里的一幕、两个不同作品的角色同框、给小朋友看的示意画。真实存在的东西（地方、人物、产品、角色本人）仍然用照片。
- 现画一张要十秒左右：把它挂在第三段以后才讲到的内容上，前面几段先用别的东西。一页最多一张，一次回答最多一张；可画可不画时不画。`;

// What the lesson's script writer is told (appended to its instructions by the service).
export const ASSET_SCRIPT_NOTES = `
# 现画的图和已有的作品
- 输入里 make 为 true 时，可以请 V 现画一张图：那一句的画面提示写「现画：要画的画面」，写清主体、动作、构图和风格。只用在拍不到、搜不到的画面上：想象的场景、比喻、故事里的一幕、两个不同作品的角色同框、给小朋友看的示意画；真实存在的东西仍然用照片。现画一张要十秒左右，所以放在第三句以后；一次讲解最多一张，可画可不画时不画。讲稿里只说这幅画要表达的意思，不描述图里的细节（你看不到它最后画成什么样）。
- 输入里的 assets 是这通电话里已经生成的作品（编号、名字、画面里有什么）。用户要你讲这张作品、或者讲解正好用得上它时，画面提示写「作品 a1」把它放上来，并按 see 里写的讲它画了什么；不要为它另外找照片。`;

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

const LOOK_INSTRUCTIONS = `你是 V 的眼睛。V 正在和用户通话，下面这张图刚刚出现在用户的屏幕上。你替 V 看一眼，让 V 之后能说出图里真实有什么。
只输出一个 JSON 对象，不要任何别的文字：
{"name":"这张图的名字，不超过 10 个字","see":"两到三句话：画面里有什么、谁在左谁在右、各自在做什么、什么风格和色调、有没有文字（有就抄下来）","parts":[{"h":"部位或角色的名字，不超过 6 个字","box":[x1,y1,x2,y2]},…]}
- 只写看得见的。认不出是谁就按样子说（「橙色衣服的金发少年」），不要猜画面外的事。
- parts 是图里最值得指给用户看的 2 到 5 处（每个角色、最显眼的道具或文字）。box 是它在图上的位置：左上角 [0,0]，右下角 [1000,1000]，按图的宽和高各自换算成千分比，紧贴着它的边。
- name 像给作品起的名字（「鸣人大战路飞海报」「雪夜角楼」），不带标点。`;

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
export function createAssetEye({complete, fetchImpl = fetch, maxBytes = 4 * 1024 * 1024, timeoutMs = 12000} = {}) {
  if (!complete) return null;
  return async function see({url, prompt = '', signal} = {}) {
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, timeoutMs);
    try {
      // The picture is read here and handed over as bytes: the model's host may not reach the media host quickly.
      let image = url;
      try {
        const response = await fetchImpl(url, {signal: controller.signal, redirect: 'follow'});
        const type = String(response.headers?.get?.('content-type') ?? '').split(';')[0].trim();
        if (response.ok && /^image\/(png|jpe?g|webp|gif)$/u.test(type)) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length && bytes.length <= maxBytes) image = `data:${type};base64,${bytes.toString('base64')}`;
        }
      } catch { /* The link itself is still worth a try. */ }
      const content = [{type: 'image_url', image_url: {url: image}},
        {type: 'text', text: prompt ? `这张图是按这段要求生成的（图里实际画成什么样，以你看到的为准）：${bounded(prompt, 300)}` : '这张图是 V 的后台刚做出来的。'}];
      let text = '';
      for await (const chunk of complete({messages: [{role: 'system', content: LOOK_INSTRUCTIONS}, {role: 'user', content}], signal: controller.signal})) text += chunk;
      const value = json(text);
      const name = bounded(value?.name, 14).replace(/[，。！？、；：,.!?;:"'“”‘’《》]/gu, ''), seen = bounded(value?.see, 220);
      if (!seen) return null;
      const parts = (Array.isArray(value.parts) ? value.parts : []).slice(0, 5).map(part => ({h: bounded(part?.h, 8), box: box(part?.box)})).filter(part => part.h && part.box);
      return {name, see: seen, parts};
    } catch { return null; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}

/**
 * `director`: the board (board-director.mjs), asked to hang a made thing on
 * the call's canvas. `see`: createAssetEye. `watch`ers are told whenever what
 * the voice model should know has changed.
 */
export function createAssetShelf({director = null, see = null, now = Date.now, audit = () => {}, maxOwners = 64, lookWaitMs = 2500, makeLimit = 3, setTimer = setTimeout} = {}) {
  const owners = new Map();
  const row = id => {
    let value = owners.get(id);
    if (!value) {
      for (const [key, old] of owners) if (now() - old.touched >= OWNER_TTL_MS) owners.delete(key);
      while (owners.size >= maxOwners) owners.delete(owners.keys().next().value);
      value = {assets: [], count: 0, picked: '', watchers: new Set(), turns: new Map(), maker: null, made: 0, making: Promise.resolve(), touched: now(), stamp: 0};
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
    if (ASSET_ID.test(text)) return value.assets.find(asset => asset.id === text) ?? null;
    const url = https(text);
    return url ? value.assets.find(asset => asset.url === url) ?? null : null;
  };
  const add = (value, asset) => {
    value.assets.push(asset);
    // The oldest finished things make room; one still on a page of the canvas is only forgotten by the shelf.
    while (value.assets.length > MAX_ASSETS) value.assets.splice(value.assets.findIndex(item => item.state !== 'making') >= 0 ? value.assets.findIndex(item => item.state !== 'making') : 0, 1);
    return asset;
  };
  const fresh = (value, fields) => ({id: `a${++value.count}`, kind: 'image', state: 'ready', url: '', name: '', prompt: '', from: '', source: 'made', see: '', parts: [], shown: false, at: now(), readyAt: 0, ...fields});
  // What the page shows of a thing.
  const card = asset => ({id: asset.id, kind: asset.kind, state: asset.state, ...(asset.url ? {url: asset.url} : {}), ...(asset.name ? {name: asset.name} : {}),
    ...(asset.prompt ? {prompt: bounded(asset.prompt, 80)} : {}), ...(asset.from ? {from: asset.from} : {}), source: asset.source, ...(asset.aspect ? {aspect: asset.aspect} : {}), at: asset.at});
  const look = (owner, value, asset) => {
    if (!see || asset.kind !== 'image' || !asset.url) return Promise.resolve(null);
    const started = now();
    asset.looking = Promise.resolve().then(() => see({url: asset.url, prompt: asset.prompt})).then(found => {
      asset.looking = null;
      audit({type: 'board.asset-look', voiceSessionId: owner, asset: asset.id, found: Boolean(found), parts: found?.parts.length ?? 0, durationMs: now() - started});
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
  const place = (owner, asset, extra = {}) => { try { director?.place?.(owner, {asset: asset.id, family: family(owners.get(owner), asset), title: asset.name, ...extra}); } catch { /* The shelf still holds it. */ } };
  const describe = asset => {
    const kind = asset.kind === 'video' ? '视频' : '图片', origin = asset.from ? `，由 ${asset.from} 做成` : '';
    const what = asset.see || (asset.prompt ? `按这段要求生成：${bounded(asset.prompt, 90)}` : '');
    return `${asset.id} ${kind}${asset.name ? `「${asset.name}」` : ''}${origin}${asset.source === 'backend' ? '（后台做的）' : ''}${what ? `：${what}` : ''}`;
  };
  const api = {
    available: true,
    canLook: Boolean(see),
    /** A creation command is about to run. Ids in it become links; a new thing gets its place on the board. */
    begin(owner, {command, turn = null} = {}) {
      const value = row(owner), text = String(command ?? '');
      // (--image a1 / --ref 'a1' / --image @a1: the id of something on the shelf.)
      let missing = '';
      const resolved = text.replace(/(--(?:image|ref)\s+)(['"]?)@?(a[1-9]\d{0,2})\2(?=\s|$)/gu, (whole, lead, quote, id) => {
        const asset = value.assets.find(item => item.id === id);
        // A video is not a reference picture; the picture it was made from is.
        const source = asset?.kind === 'video' && asset.from ? value.assets.find(item => item.id === asset.from) : asset;
        if (!source?.url || source.kind !== 'image') { missing ||= id; return whole; }
        return `${lead}'${source.url}'`;
      });
      if (missing) return {command: text, error: `屏幕素材里没有可用的图片 ${missing}；本次没有提交。请按「屏幕素材现状」里的编号重写命令。`};
      const creation = readCreation(resolved);
      if (!creation) return {command: resolved};
      // One request of the caller's makes one thing of a kind (the executor answers a repeat with
      // the first submission's result): the repeat shares the first one's place on the board.
      const key = turn ?? value, kinds = value.turns.get(key) ?? {};
      const known = kinds[creation.kind] && value.assets.find(asset => asset.id === kinds[creation.kind]);
      // (A command refused before it was submitted and written again starts the same thing anew.)
      if (known) { if (known.state === 'failed') { known.state = 'making'; known.prompt = creation.prompt; known.at = now(); changed(owner, value, {quiet: true}); } return {command: resolved, id: known.id}; }
      const origin = find(value, creation.reference);
      const parent = origin ? (origin.kind === 'video' && origin.from ? value.assets.find(item => item.id === origin.from) ?? origin : origin) : null;
      // (A version goes by the name its picture was given: "the video of X", not a nameless video.)
      const asset = add(value, fresh(value, {kind: creation.kind, state: 'making', prompt: creation.prompt, from: parent?.id ?? '', ...(parent?.name ? {name: parent.name, named: creation.kind === 'video'} : {}), ...(creation.aspect ? {aspect: creation.aspect} : parent?.aspect ? {aspect: parent.aspect} : {})}));
      value.turns.set(key, {...kinds, [creation.kind]: asset.id});
      if (value.turns.size > 64) value.turns.delete(value.turns.keys().next().value);
      audit({type: 'board.asset', voiceSessionId: owner, asset: asset.id, kind: asset.kind, state: 'making', from: asset.from || null});
      place(owner, asset);
      changed(owner, value, {quiet: true});
      return {command: resolved, id: asset.id};
    },
    /**
     * The command has finished. Resolves what the voice model is told about the
     * thing: its id, and (when the eye is quick enough) what is in the picture.
     */
    async finish(owner, id, output) {
      const value = owners.get(owner);
      const media = output?.media && !output.isError ? output.media : null, url = https(media?.url);
      if (!value) return url ? api.add(owner, {kind: media.kind, url, source: 'made'}) : null;
      // (No id: a question about a task already submitted. Its answer belongs to the thing still being made.)
      const asset = value.assets.find(item => item.id === id) ?? (url ? value.assets.find(item => item.url === url) ?? value.assets.find(item => item.state === 'making' && item.kind === (media.kind === 'video' ? 'video' : 'image')) : null);
      if (!asset) return url ? api.add(owner, {kind: media.kind, url, source: 'made'}) : null;
      // (A wait that ended with the video still rendering leaves its place as it is: the same task is asked about again.)
      if (!url) {
        if (output?.details?.status === 'pending' || asset.state !== 'making') return null;
        asset.state = 'failed'; audit({type: 'board.asset', voiceSessionId: owner, asset: asset.id, kind: asset.kind, state: 'failed'});
        changed(owner, value, {quiet: true});
        return null;
      }
      if (asset.state === 'ready' && asset.url === url) { await wait(asset.looking, lookWaitMs); return api.facts(owner, asset.id); }
      asset.state = 'ready'; asset.url = url; asset.kind = media.kind === 'video' ? 'video' : 'image'; asset.readyAt = now();
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
    /** What the voice model is given back with a tool result. */
    facts(owner, id) {
      const asset = owners.get(owner)?.assets.find(item => item.id === id);
      return asset ? {id: asset.id, kind: asset.kind, ...(asset.name ? {name: asset.name} : {}), ...(asset.from ? {from: asset.from} : {}), ...(asset.see ? {see: asset.see} : {}), onBoard: Boolean(director)} : null;
    },
    /** The few lines the voice model keeps about the caller's screen. */
    context(owner) {
      const value = owners.get(owner), ready = (value?.assets ?? []).filter(asset => asset.state === 'ready').slice(-8);
      if (!ready.length) return ASSET_CONTEXT_EMPTY;
      const picked = ready.find(asset => asset.id === value.picked);
      return `屏幕素材现状：${ready.map(describe).join('；')}。${picked ? `用户正点着 ${picked.id}。` : `最新的是 ${ready.at(-1).id}。`}`;
    },
    /** For V's backend: the same things with their links (it has no screen to look at). */
    backendContext(owner) {
      const ready = (owners.get(owner)?.assets ?? []).filter(asset => asset.state === 'ready').slice(-6);
      return ready.length ? `\n通话屏幕上的素材（用户用编号或“这张”指它们）：${ready.map(asset => `${describe(asset)} 链接 ${asset.url}`).join('；')}。${owners.get(owner).picked ? `用户正点着 ${owners.get(owner).picked}。` : ''}` : '';
    },
    /** What the illustrator is told is there to use. */
    digest(owner) {
      return (owners.get(owner)?.assets ?? []).filter(asset => asset.state !== 'failed').slice(-8).map(asset => ({id: asset.id, kind: asset.kind, ...(asset.name ? {name: asset.name} : {}), ...(asset.see ? {see: bounded(asset.see, 100)} : asset.prompt ? {asked: bounded(asset.prompt, 60)} : {}), ...(asset.state === 'making' ? {making: true} : {})}));
    },
    has(owner, id) { return Boolean(owners.get(owner)?.assets.some(asset => asset.id === id && asset.state !== 'failed')); },
    get(owner, id) { return owners.get(owner)?.assets.find(asset => asset.id === id) ?? null; },
    /** The page's view: every thing, the one picked, and whether anything is still coming. */
    page(owner) {
      const value = owners.get(owner);
      if (!value) return {assets: [], picked: '', busy: false, stamp: 0};
      return {assets: value.assets.map(card), picked: value.picked, busy: value.assets.some(asset => asset.state === 'making'), stamp: value.stamp};
    },
    /** The caller tapped a thing: "this one" is that one until another is tapped. */
    pick(owner, id) {
      const value = owners.get(owner);
      if (!value || id !== '' && !value.assets.some(asset => asset.id === id && asset.state === 'ready') || value.picked === id) return false;
      value.picked = id; changed(owner, value);
      return true;
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
    forget(owner) { owners.delete(owner); },
  };
  return api;
}
