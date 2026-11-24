// Replays answers a voice model gives in its own words (no lesson script) through the board as
// a call does: the page's own client (board-client.mjs) decides when to ask, from a caption
// that grows at speaking pace, and the real illustrator (the Candidate's instructions and
// model) draws. Prints, for every case, how many of the things told got a picture, whether a
// page became a gallery, how many photographs would have been searched for, and how long the
// caller looked at a page with nothing new on it. No call, Gateway, page or image search is
// involved; the cost is the illustrator's text completions (about fifteen a case).
// A case of kind "script" is a lesson's script with its author's notes instead: it goes the
// way a lesson does (the question, the lesson announced, the script with its notes), to see
// that such a page is still what its author asked for.
// `--photos` (with VOICE_BOARD_BRAVE_KEY) then looks every picture of the pages up as the service
// would, one after another: whether the illustrator's search words find anything. Each is a
// request to the image search, which has a monthly allowance: name the cases, and do it rarely.
//
//   VOICE_BOARD=1 VOICE_BOARD_API_KEY=… node scripts/candidate/board-speech-eval.mjs [--json] [--speed 1] [--lesson-tool] [--photos] [cases.json] [case names…]
//
// The cases (fixtures/board-speech-cases.json) are invented, not call records. The caption
// grows the way GPT Live 1.1's did on its Candidate (timing only was measured, 11/23): a
// character or two about every 0.2 s, more than a quarter of the gaps longer than the page's
// settle time, about five characters a second, from `THINK_MS` after the question. The same
// case always arrives the same way (a seeded sequence), so two runs differ only by the model.
// `--speed 2` runs the clock twice as fast (the model does not get faster: use 1 for timings).
import {readFileSync} from 'node:fs';
import {boardCompletionFromEnv, boundedBoardRequest, createBoardDirector} from '../../lab/gpt-live-h5/board-director.mjs';
import {CANVAS_CUE_INSTRUCTIONS, cueTurns, refineCueOp} from '../../lab/gpt-live-h5/board-cue.mjs';
import {ASSET_MAKE_NOTES, ASSET_NOTES} from '../../lab/gpt-live-h5/board-assets.mjs';
import {createBoardClient} from '../../lab/gpt-live-h5/board-client.mjs';
import {scenePictures} from '../../lab/gpt-live-h5/board-scene.mjs';
import {createPhotoFinder} from '../../lab/gpt-live-h5/board-photo.mjs';

const THINK_MS = 2000, BETWEEN_TURNS_MS = 3000;
// (mulberry32)
const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const args = process.argv.slice(2), json = args.includes('--json');
const speed = args.includes('--speed') ? Math.max(1, Number(args[args.indexOf('--speed') + 1]) || 1) : 1;
// As a call whose voice model explains by itself (GPT Live 1.1); `--lesson-tool`: as one whose
// model may be handed a lesson's script instead (Doubao answering in its own words).
const unscripted = !args.includes('--lesson-tool');
const rest = args.filter((arg, index) => !['--json', '--speed', '--lesson-tool', '--photos'].includes(arg) && args[index - 1] !== '--speed');
const finder = args.includes('--photos') && process.env.VOICE_BOARD_BRAVE_KEY ? createPhotoFinder({braveKey: process.env.VOICE_BOARD_BRAVE_KEY}) : null;
const file = rest.find(arg => arg.endsWith('.json')) ?? new URL('./fixtures/board-speech-cases.json', import.meta.url);
const picked = rest.filter(arg => !arg.endsWith('.json'));
const cases = JSON.parse(readFileSync(file)).cases.filter(item => !picked.length || picked.includes(item.name));
const complete = boardCompletionFromEnv({...process.env, VOICE_BOARD: '1'});
if (!complete) { console.error('A board model key is needed (VOICE_BOARD_API_KEY or DEEPSEEK_API_KEY)'); process.exit(2); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms / speed));
const itemsOf = block => block.t === 'compare' ? block.cols : block.t === 'flow' ? block.nodes : block.items ?? [];

async function replay(item, index) {
  const owner = `speech-${index}`, searched = new Set(), runs = [], turns = [], random = seeded(index + 1);
  const director = createBoardDirector({complete, prefetch: query => { searched.add(query); },
    // As on the Candidate (server.mjs): cue pages, the canvas, the shelf's notes.
    stream: {instructions: CANVAS_CUE_INSTRUCTIONS + ASSET_NOTES + ASSET_MAKE_NOTES, refine: refineCueOp, turns: cueTurns, cue: true, canvas: true}});
  const pages = () => director.canvas(owner).zones;
  if (item.lines) {
    // A lesson: the caller's question is drawn from first, the lesson tool is called a moment
    // later, and the script arrives with its notes; its page is drawn ahead of the reading.
    const user = {role: 'user', text: item.ask}, script = item.lines.map(line => line.say).join('');
    const brief = (trigger, result, chars) => ({turn: 0, trigger, atMs: null, reason: result.reason, durationMs: result.durationMs, firstOpMs: result.firstOpMs ?? null, chars, ops: result.ops ?? 0});
    runs.push(brief('user', await director.run({owner, trigger: 'user', turns: [user]}), 0));
    director.expect(owner);
    director.note(owner, {title: item.title, ask: item.ask, script, lines: item.lines});
    runs.push(brief('assistant_end', await director.run({owner, trigger: 'assistant_end', clientRev: director.scene(owner).rev, turns: [user, {role: 'assistant', text: script}]}), Array.from(script).length));
    return report(item, pages(), runs, turns, searched);
  }
  const pictures = () => pages().reduce((sum, page) => sum + scenePictures(page).size, 0);
  const blocks = () => pages().reduce((sum, page) => sum + page.blocks.length, 0);
  let turn = null, inFlight = 0;
  const client = createBoardClient({
    request: async (payload, {signal, onEvent}) => {
      const request = boundedBoardRequest(payload), started = Date.now(), said = payload.turns.at(-1);
      inFlight++;
      try {
        const result = await director.run({owner, ...request, signal, unscripted, onOp: op => {
          onEvent(op);
          const now = Date.now(), shown = pictures();
          // Every operation that changed a page: something new, or something on it now hung on V's words.
          if (turn && op.op === 'sync') turn.changes.push(now);
          // (A page that has only been given its title has nothing on it yet.)
          if (turn && blocks() > turn.blocks) turn.firstBlockAt ??= now;
          if (turn && shown > turn.pictures) { turn.pictures = shown; turn.firstPictureAt ??= now; }
        }});
        runs.push({turn: turns.length, trigger: request.trigger, atMs: turn?.spokeAt ? Math.round((started - turn.spokeAt) * speed) : null, reason: result.reason,
          durationMs: result.durationMs, firstOpMs: result.firstOpMs ?? null, chars: said.role === 'assistant' ? Array.from(said.text).length : 0, ops: result.ops ?? 0});
      } finally { inFlight--; }
    },
  });
  const history = [];
  const show = current => client.update({snapshot: {history, current}});
  for (const [number, {ask, say}] of item.turns.entries()) {
    const startPictures = pictures();
    turn = {spokeAt: null, pictures: startPictures, blocks: blocks(), changes: [], firstPictureAt: null, firstBlockAt: null};
    history.push({key: `u${number}`, role: 'user', text: ask, complete: true});
    show([]);
    await sleep(THINK_MS);
    const letters = Array.from(say);
    turn.spokeAt = Date.now();
    // What the page put up between the question and V's first word.
    const openingPictures = pictures() - startPictures, openingChanges = turn.changes.length;
    for (let shown = 0; shown < letters.length;) {
      const size = random();
      shown = Math.min(letters.length, shown + (size < .57 ? 1 : size < .92 ? 2 : 3));
      show([{key: `a${number}`, role: 'assistant', text: letters.slice(0, shown).join(''), complete: false}]);
      if (shown < letters.length) await sleep(random() < .72 ? 150 + random() * 110 : 360 + random() * 440);
    }
    turn.endedAt = Date.now();
    history.push({key: `a${number}`, role: 'assistant', text: say, complete: true});
    show([]);
    // The page's last request for this answer (assistant_end) is let finish.
    await sleep(600);
    for (let waited = 0; inFlight && waited < 20000; waited += 100) await sleep(100);
    const at = time => Math.round((time - turn.spokeAt) * speed);
    // The longest stretch of V speaking during which nothing on the canvas changed.
    const marks = [turn.spokeAt, ...turn.changes.filter(time => time >= turn.spokeAt && time <= turn.endedAt), turn.endedAt];
    const stillest = Math.max(...marks.slice(1).map((time, at) => time - marks[at]));
    turns.push({ask, spokenMs: at(turn.endedAt), openingPictures, openingChanges,
      firstContentMs: turn.firstBlockAt ? at(turn.firstBlockAt) : null, firstSpokenContentMs: turn.changes.length > openingChanges ? at(turn.changes[openingChanges]) : null,
      firstPictureMs: turn.firstPictureAt ? at(turn.firstPictureAt) : null, stillestMs: Math.round(stillest * speed)});
    await sleep(BETWEEN_TURNS_MS);
  }
  client.dispose();
  return report(item, pages(), runs, turns, searched);
}

function report(item, zones, runs, turns, searched) {
  const board = zones.map(page => ({title: page.title, pictures: scenePictures(page).size, searches: [...scenePictures(page)], blocks: page.blocks.map(block => ({t: block.t, ...(block.look ? {look: block.look} : {}),
    ...(block.t === 'photo' ? {query: block.query} : {}), ...(block.sides ? {sides: block.sides.map(side => side.img ?? '')} : {}),
    items: itemsOf(block).map(entry => ({h: entry.h ?? entry.label ?? '', ...(entry.img ? {img: entry.img} : {})}))}))}));
  const entries = board.flatMap(page => page.blocks.flatMap(block => block.items));
  return {name: item.name, kind: item.kind, turns, board, runs,
    totals: {pages: board.length, items: entries.length, pictured: entries.filter(entry => entry.img).length,
      prints: board.reduce((sum, page) => sum + page.blocks.filter(block => block.t === 'photo').length, 0),
      sides: board.reduce((sum, page) => sum + page.blocks.reduce((count, block) => count + (block.sides ?? []).filter(Boolean).length, 0), 0),
      pictures: board.reduce((sum, page) => sum + page.pictures, 0), most: Math.max(0, ...board.map(page => page.pictures)),
      galleries: board.reduce((sum, page) => sum + page.blocks.filter(block => block.look === 'gallery').length, 0),
      // Every distinct search term that was on a page at any moment: what the image search would have been asked.
      searches: searched.size, modelRuns: runs.filter(run => !['waiting', 'joined', 'same', 'making', 'deferred'].includes(run.reason)).length}};
}

// Cases side by side: each is its own call, and nothing here is rate-limited but the model.
const out = await Promise.all(cases.map(replay));
if (finder) for (const result of out) {
  result.photos = [];
  for (const query of new Set(result.board.flatMap(page => page.searches))) {
    const started = Date.now(), found = await finder.find(query).catch(() => null);
    result.photos.push({query, found: Boolean(found), source: found?.source ?? null, ms: Date.now() - started});
  }
}
if (json) console.log(JSON.stringify(out));
else {
  for (const result of out) {
    const {totals} = result;
    console.log(`\n■ ${result.name} (${result.kind})  pages ${totals.pages} · items ${totals.items}, pictured ${totals.pictured} · prints ${totals.prints} · sides ${totals.sides} · pictures ${totals.pictures} (most on a page ${totals.most}) · galleries ${totals.galleries} · searches ${totals.searches} · model runs ${totals.modelRuns}`);
    for (const turn of result.turns) console.log(`  「${turn.ask}」 spoken ${turn.spokenMs} ms · before V spoke: ${turn.openingChanges} change(s), ${turn.openingPictures} picture(s) · first block ${turn.firstContentMs ?? '—'} ms · first change from V's words ${turn.firstSpokenContentMs ?? '—'} ms · first picture ${turn.firstPictureMs ?? '—'} ms · longest still ${turn.stillestMs} ms`);
    for (const page of result.board) {
      console.log(`  「${page.title}」 ${page.pictures} picture(s)`);
      for (const block of page.blocks) console.log(`    - ${block.t}${block.look ? '/' + block.look : ''} ${block.query ? '〔' + block.query + '〕' : ''}${block.sides ? block.sides.map(side => side ? '〔' + side + '〕' : '〔 〕').join(' vs ') + ' ' : ''}${block.items.map(entry => entry.h + (entry.img ? '🖼〔' + entry.img + '〕' : '')).join('、')}`);
    }
    for (const photo of result.photos ?? []) console.log(`  ${photo.found ? '🖼' : '✗ '} 〔${photo.query}〕 ${photo.found ? photo.source : 'nothing found'} ${photo.ms} ms`);
    console.log('  runs: ' + result.runs.map(run => `${run.trigger.replace('assistant_', '')}@${run.atMs ?? '—'}/${run.chars}字→${run.reason}${run.firstOpMs === null ? '' : '(' + run.firstOpMs + ')'}`).join(' '));
  }
  const sum = key => out.reduce((total, result) => total + result.totals[key], 0);
  console.log(`\nall: items ${sum('items')}, pictured ${sum('pictured')}, prints ${sum('prints')}, sides ${sum('sides')}, pictures ${sum('pictures')}, galleries ${sum('galleries')}, searches ${sum('searches')}, model runs ${sum('modelRuns')}`);
}
