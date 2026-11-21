// For comparison with the prototype (docs/research/board-canvas, round 2): the same seven scripts drawn by
// today's board, i.e. the streaming cue illustrator (CUE_INSTRUCTIONS) given V's words cut into numbered
// clauses, as for any answer of V's. Its operations are applied to a scene as the page does, and the
// pictures the page would ask for are fetched with the board's own photo finder, so the scene can be
// rendered with the real page component (canvas-today-page.mjs). No call, page or Gateway.
//
//   VOICE_BOARD=1 DEEPSEEK_API_KEY=… VOICE_BOARD_BRAVE_KEY=… node scripts/candidate/canvas-today.mjs out/ [topic ids…]
import {writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {boardCompletionFromEnv, boardRequest} from '../../lab/gpt-live-h5/board-director.mjs';
import {CUE_INSTRUCTIONS, clauses, numbered} from '../../lab/gpt-live-h5/board-cue.mjs';
import {applyOp, createLineParser, emptyScene, normalizeOp, scenePictures} from '../../lab/gpt-live-h5/board-scene.mjs';
import {createPhotoFinder} from '../../lab/gpt-live-h5/board-photo.mjs';
import {TOPICS} from './canvas-proto.mjs';

const [out = 'today', ...only] = process.argv.slice(2);
await mkdir(join(out, 'photos'), {recursive: true});
// As the production streaming illustrator (server.mjs): the director's own completion.
const illustrator = boardCompletionFromEnv(process.env);
const finder = createPhotoFinder({braveKey: process.env.VOICE_BOARD_BRAVE_KEY ?? ''});
const results = {};
await Promise.all(Object.entries(TOPICS).filter(([id]) => !only.length || only.includes(id)).map(async ([id, topic]) => {
  const parts = clauses(topic.say), ops = [];
  let scene = emptyScene();
  const request = boardRequest({trigger: 'assistant_end', scene, evidence: [], turns: [{role: 'user', text: topic.ask}, {role: 'assistant', text: numbered(parts)}], recent: [], page: {id: 'z1', room: 4}, canvas: []});
  const started = Date.now(); let first = 0;
  const parser = createLineParser(raw => { first ||= Date.now() - started; ops.push(raw); const op = normalizeOp(raw); if (op) scene = applyOp(scene, op); });
  try { for await (const chunk of illustrator({messages: [{role: 'system', content: CUE_INSTRUCTIONS}, {role: 'user', content: request}]})) parser.feed(chunk); parser.end(); }
  catch (error) { results[id] = {error: String(error?.message ?? error).slice(0, 300)}; return; }
  const ms = Date.now() - started, pictures = {};
  await Promise.all([...scenePictures(scene)].map(async query => {
    const found = await finder.find(query).catch(() => null);
    if (!found?.bytes) return;
    const file = createHash('sha1').update(query).digest('hex').slice(0, 16) + '.bin';
    await writeFile(join(out, 'photos', file), found.bytes);
    pictures[query] = {file, type: found.type};
  }));
  results[id] = {ask: topic.ask, clauses: parts, firstMs: first, ms, ops, scene, pictures};
  console.log(id, 'first', first, 'total', ms, 'ms', scene.blocks.map(block => block.t).join(','), Object.keys(pictures).length, 'pictures');
}));
await writeFile(join(out, 'today.json'), JSON.stringify(results, null, 1));
