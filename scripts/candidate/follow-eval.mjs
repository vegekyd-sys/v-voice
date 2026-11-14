// Compares two ways of deciding when each piece of a lesson page appears
// (docs/research/board-follow-by-model). Same script, two illustrators:
//   A  today's: the streaming illustrator writes quotes (q), and the code
//      re-hangs them by matching words (refineStreamOp, spokenProgress).
//   B  cue: the script is cut into numbered clauses at punctuation and the
//      illustrator writes, for every piece, the clause it hangs on (cue).
// A judge model then says, for every piece, which clause first really talks
// about it. No call, page or Gateway is involved; text completions only.
//
//   VOICE_BOARD=1 DEEPSEEK_API_KEY=… node scripts/candidate/follow-eval.mjs [out.json] [question ids…]
import {writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {boardCompletionFromEnv, boardRequest, createBoardDirector} from '../../lab/gpt-live-h5/board-director.mjs';
import {SCRIPT_INSTRUCTIONS, STREAM_INSTRUCTIONS, parseScript, refineStreamOp, spokenScript} from '../../lab/gpt-live-h5/board-lesson.mjs';
import {createLineParser, normalizeOp, spokenProgress, edgeId} from '../../lab/gpt-live-h5/board-scene.mjs';
import {CUE_INSTRUCTIONS, clauses, numbered} from './follow-cue.mjs';

const CHARS_PER_SECOND = 6.4;
const DEFAULT_IDS = ['l1', 'l2', 'l3', 'c1a', 'c1b', 'c1c', 'c2a', 'c2b', 'c2c', 'c2d', 'c3a', 'c4a', 'c8c', 'c9a', 'c9b', 'c9c', 'c10a', 'c10c', 'c10d'];
const [out = 'follow-eval.json', ...picked] = process.argv.slice(2);
const bank = JSON.parse(readFileSync(new URL('./board-bench/questions.json', import.meta.url))).questions;
const ids = picked.length ? picked : DEFAULT_IDS;

// As in production (server.mjs): the writer may write 1600 tokens, the illustrator 900.
const writer = boardCompletionFromEnv({...process.env, VOICE_BOARD_MAX_TOKENS: '1600'});
const illustrator = boardCompletionFromEnv(process.env);
const cueIllustrator = boardCompletionFromEnv({...process.env, VOICE_BOARD_MAX_TOKENS: '1600'});
const judge = boardCompletionFromEnv({...process.env, VOICE_BOARD_MAX_TOKENS: '2000'});
if (!writer) { console.error('VOICE_BOARD=1 and a DeepSeek key are needed'); process.exit(2); }

const collect = async (complete, messages) => { let text = ''; for await (const chunk of complete({messages})) text += chunk; return text; };
const timed = async (complete, messages, onLine) => {
  const started = Date.now(); let first = null, text = '';
  const parser = createLineParser(raw => { first ??= Date.now() - started; onLine(raw); });
  for await (const chunk of complete({messages})) { text += chunk; parser.feed(chunk); }
  parser.end();
  return {firstMs: first, totalMs: Date.now() - started, chars: text.length, text};
};

async function writeScript(ask) {
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await collect(writer, [{role: 'system', content: SCRIPT_INSTRUCTIONS}, {role: 'user', content: JSON.stringify({topic: ask, audience: '成年人', ask})}]);
    const script = parseScript(text);
    if (script) return {...script, words: spokenScript(script.say), ms: Date.now() - started};
  }
  return null;
}

// What a piece is, in words a judge can find in the script.
const itemText = (block, item) => [item.h, item.label, item.when, item.d, item.sub, ...(item.cells ?? []), ...(item.points ?? [])].filter(value => typeof value === 'string' && value).join(' / ');
function piecesOf(blocks, marks = []) {
  const pieces = [];
  for (const block of blocks) {
    const head = `${block.t}${block.h ? `「${block.h}」` : ''}`;
    if (block.t === 'photo') pieces.push({id: block.id, kind: 'block', text: `照片：${block.query}`});
    else if (block.t === 'sticky' || block.t === 'note') pieces.push({id: block.id, kind: 'block', text: `便签：${block.text}`});
    const list = block.t === 'compare' ? block.cols : block.t === 'flow' ? block.nodes : block.t === 'overlap' ? ['a', 'b', 'both'].filter(key => block[key]).map(key => ({id: key, ...block[key]})) : block.items ?? [];
    for (const item of list ?? []) pieces.push({id: `${block.id}/${item.id}`, kind: itemText(block, item) ? 'item' : 'shape', text: `${head} 里的一项：${itemText(block, item) || item.k || ''}`.slice(0, 120)});
    if (block.t === 'flow') for (const [from, to, label] of block.edges ?? []) {
      const name = id => block.nodes.find(node => node.id === id)?.label ?? id;
      pieces.push({id: edgeId(block, from, to), kind: 'edge', text: `箭头：${name(from)} → ${name(to)}${label ? `「${label}」` : ''}`});
    }
  }
  marks.forEach((mark, index) => pieces.push({id: `mark:${index}`, kind: 'mark', text: `笔迹（${mark.kind}）落在：${mark.target ?? mark.id}`}));
  return pieces;
}

// A: today's illustrator, as the service runs it for a lesson (director.note → the ahead run).
async function runToday(script, ask) {
  const audits = [];
  const director = createBoardDirector({complete: illustrator, audit: event => audits.push(event), stream: {instructions: STREAM_INSTRUCTIONS, refine: refineStreamOp}});
  const turns = [{role: 'user', text: ask}, {role: 'assistant', text: script.words}];
  director.note('a', {title: script.title, ask, script: script.words, lines: script.say.map((say, index) => ({say, show: script.show[index]}))});
  await director.run({owner: 'a', trigger: 'assistant_end', turns, clientRev: 0});
  const scene = director.scene('a');
  const run = audits.find(event => event.type === 'board.run' && event.reason !== 'joined') ?? {};
  // When each piece is shown: the first character count at which it is no longer held back.
  const length = Array.from(script.words).length, shownAt = new Map();
  const everything = new Set(spokenProgress(scene, script.words, 0).ahead);
  for (let index = 0; index <= length; index++) {
    const ahead = new Set(spokenProgress(scene, script.words, index).ahead);
    for (const id of everything) if (!ahead.has(id) && !shownAt.has(id)) shownAt.set(id, index);
  }
  const marks = (scene.marks ?? []).map(mark => ({...mark, target: describe(scene.blocks, mark.id)}));
  const pieces = piecesOf(scene.blocks, marks).map(piece => ({...piece, at: shownAt.get(piece.id) ?? 0}));
  return {pieces, types: scene.blocks.map(block => block.t), firstMs: run.firstOpMs ?? null, totalMs: run.durationMs ?? null, reason: run.reason, blocks: scene.blocks, marks};
}
const describe = (blocks, id) => { const [blockId, itemId] = String(id).split('/'); const block = blocks.find(one => one.id === blockId); const list = block?.t === 'compare' ? block.cols : block?.t === 'flow' ? block.nodes : block?.items ?? []; const item = list?.find(one => one.id === itemId); return item ? itemText(block, item) || item.k : id; };

// B: the illustrator writes a cue (clause number) for every piece; the page plays them in order.
async function runCue(script, ask) {
  const parts = clauses(script.words), starts = [];
  { let at = 0; for (const part of parts) { starts.push(at); at += Array.from(part).length; } }
  const blocks = new Map(), cues = new Map(), marks = [], focus = [], uncued = new Set();
  const request = boardRequest({trigger: 'assistant_end', scene: {rev: 0, serial: 0, title: '', blocks: [], focus: '', pending: null}, evidence: [],
    turns: [{role: 'user', text: ask}, {role: 'assistant', text: numbered(parts)}],
    notes: {title: script.title, lines: script.say.map((say, index) => ({say, show: script.show[index]}))}, recent: [], page: {id: 'z1', room: 4}, canvas: []});
  const timing = await timed(cueIllustrator, [{role: 'system', content: CUE_INSTRUCTIONS}, {role: 'user', content: request}], raw => {
    const cue = value => Number.isInteger(value) && value >= -1 && value < parts.length ? value : null;
    if (raw?.op === 'put' && raw.block) {
      const op = normalizeOp({op: 'put', block: raw.block});
      if (!op) return;
      // The same page limits as the service (board-director.mjs): four blocks, one large print.
      if (!blocks.has(op.block.id) && (blocks.size >= 4 || op.block.t === 'photo' && [...blocks.values()].some(block => block.t === 'photo'))) return;
      blocks.set(op.block.id, op.block);
      const block = raw.block, own = cue(block.cue);
      if (own !== null) cues.set(block.id, own);
      const list = block.t === 'compare' ? block.cols : block.t === 'flow' ? block.nodes : block.t === 'overlap' ? ['a', 'b', 'both'].filter(key => block[key]).map(key => ({id: key, ...block[key]})) : block.items ?? [];
      for (const item of list ?? []) { const at = cue(item?.cue); if (at !== null) { cues.set(`${block.id}/${item.id}`, at); uncued.delete(`${block.id}/${item.id}`); } else if (!cues.has(`${block.id}/${item.id}`)) { uncued.add(`${block.id}/${item.id}`); if (own !== null) cues.set(`${block.id}/${item.id}`, own); } }
      if (block.t === 'flow') for (const edge of block.edges ?? []) { const at = cue(edge?.[3]); if (at !== null) cues.set(edgeId(block, edge[0], edge[1]), at); }
    } else if (raw?.op === 'mark') { const at = cue(raw.cue); if (at !== null) marks.push({id: raw.id, kind: raw.kind, cue: at}); }
    else if (raw?.op === 'focus') { const at = cue(raw.cue); if (at !== null) focus.push({id: raw.id, cue: at}); }
  });
  const all = [...blocks.values()];
  const markPieces = marks.map(mark => ({...mark, target: describe(all, mark.id)}));
  const at = cue => cue < 0 ? -1 : starts[cue];
  const pieces = piecesOf(all, markPieces).map(piece => {
    const cue = piece.kind === 'mark' ? marks[Number(piece.id.slice(5))].cue : cues.get(piece.id);
    return {...piece, cue: cue ?? null, ...(uncued.has(piece.id) ? {uncued: true} : {}), at: cue === undefined || cue === null ? 0 : at(cue)};
  });
  return {pieces, types: all.map(block => block.t), firstMs: timing.firstMs, totalMs: timing.totalMs, chars: timing.chars, blocks: all, marks, focus, parts};
}

// The judge: for each piece, the clause that first really talks about it (-1: never).
const JUDGE = `你是评审。给你一段讲解（已按标点切成编号小段）和一页图解上的一些东西。对每样东西，找出讲解里第一次真正讲到它的那一段的编号：讲解开始介绍、说明这样东西的那一段，不是后面总结时顺口再点名的那段。照片和便签：讲到照片里那样东西、讲出便签那句话意思的那一段。如果讲解从头到尾没讲到它，写 -1。
只输出一个 JSON 对象，不要别的文字：{"answers":[{"id":"…","first":段号}, …]}`;
async function judged(parts, pieces) {
  if (!pieces.length) return new Map();
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await collect(judge, [{role: 'system', content: JUDGE}, {role: 'user', content: JSON.stringify({讲解: numbered(parts), 东西: pieces.filter(piece => piece.kind !== 'shape').map(piece => ({id: piece.id, 是什么: piece.text}))})}]);
    try { const value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); return new Map(value.answers.map(answer => [answer.id, Number(answer.first)])); } catch { /* once more */ }
  }
  return new Map();
}

// Clause index of a character position.
const clauseOf = (parts, at) => { if (at < 0) return -1; let start = 0; for (let index = 0; index < parts.length; index++) { start += Array.from(parts[index]).length; if (at < start) return index; } return parts.length - 1; };
function score(parts, pieces, truth) {
  const starts = []; { let at = 0; for (const part of parts) { starts.push(at); at += Array.from(part).length; } }
  const rows = pieces.map(piece => {
    const shown = clauseOf(parts, piece.at), first = truth.get(piece.id);
    const verdict = piece.kind === 'shape' ? 'shape' : first === undefined || Number.isNaN(first) ? 'unjudged' : first < 0 ? 'unsaid' : shown === first ? 'on' : shown < first ? (shown < 0 ? 'opening' : 'early') : 'late';
    const offSeconds = verdict === 'early' || verdict === 'late' ? Math.abs(starts[Math.max(0, shown)] - starts[first]) / CHARS_PER_SECOND : 0;
    return {...piece, shown, first, verdict, offClauses: verdict === 'early' || verdict === 'late' ? Math.abs(shown - first) : 0, offSeconds: Math.round(offSeconds * 10) / 10};
  });
  const firstShown = Math.min(...pieces.map(piece => piece.at), Infinity);
  return {rows, emptySeconds: firstShown === Infinity ? null : Math.max(0, firstShown) / CHARS_PER_SECOND, opening: pieces.some(piece => piece.at < 0)};
}

const results = [];
const work = ids.filter(id => bank[id]).map(id => async () => {
  const ask = bank[id].say;
  const script = await writeScript(ask);
  if (!script) { results.push({id, ask, failed: 'script'}); return; }
  const parts = clauses(script.words);
  const [today, cue] = await Promise.all([runToday(script, ask).catch(error => ({error: String(error?.message ?? error)})), runCue(script, ask).catch(error => ({error: String(error?.message ?? error)}))]);
  const [truthA, truthB] = await Promise.all([judged(parts, today.pieces ?? []), judged(parts, cue.pieces ?? [])]);
  results.push({id, ask, script: {title: script.title, say: script.say, show: script.show, ms: script.ms}, parts,
    today: {...today, ...(today.pieces ? score(parts, today.pieces, truthA) : {})}, cue: {...cue, ...(cue.pieces ? score(parts, cue.pieces, truthB) : {})}});
  console.error(`${id} done`);
});
// Four questions at a time.
const queue = work.slice();
await Promise.all(Array.from({length: 4}, async () => { while (queue.length) await queue.shift()(); }));
results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
await writeFile(out, JSON.stringify(results, null, 1));

// Summary.
const sum = name => {
  const rows = results.flatMap(result => result[name]?.rows ?? []), count = verdict => rows.filter(row => row.verdict === verdict).length;
  const judgedRows = rows.filter(row => !['unjudged', 'unsaid', 'shape'].includes(row.verdict));
  const pages = results.filter(result => result[name]?.types), median = list => { const sorted = list.filter(value => value !== null && value !== undefined).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
  return {pieces: rows.length, shapes: count('shape'), uncued: rows.filter(row => row.uncued).length, on: count('on'), early: count('early'), late: count('late'), opening: count('opening'), unsaid: count('unsaid'), unjudged: count('unjudged'),
    onRate: judgedRows.length ? +(count('on') / judgedRows.length).toFixed(2) : null, earlyRate: judgedRows.length ? +(count('early') / judgedRows.length).toFixed(2) : null,
    // Off by more than one clause: a spoiler (early) or a piece the eye waits for (late).
    earlyFar: rows.filter(row => row.verdict === 'early' && row.offClauses > 1).length, lateFar: rows.filter(row => row.verdict === 'late' && row.offClauses > 1).length,
    earlySecondsMedian: median(rows.filter(row => row.verdict === 'early').map(row => row.offSeconds)),
    lateSecondsMedian: median(rows.filter(row => row.verdict === 'late').map(row => row.offSeconds)),
    emptySecondsMedian: median(pages.map(result => result[name].emptySeconds)), pagesWithOpening: pages.filter(result => result[name].opening).length,
    typesPerPage: +(pages.reduce((all, result) => all + new Set(result[name].types.filter(type => !['photo', 'sticky', 'note'].includes(type))).size, 0) / Math.max(1, pages.length)).toFixed(2),
    piecesPerPage: +(rows.length / Math.max(1, pages.length)).toFixed(1), firstMsMedian: median(pages.map(result => result[name].firstMs)), totalMsMedian: median(pages.map(result => result[name].totalMs)), errors: results.filter(result => result[name]?.error).length};
};
console.log(JSON.stringify({questions: results.length, scriptFailures: results.filter(result => result.failed).length, today: sum('today'), cue: sum('cue')}, null, 1));
