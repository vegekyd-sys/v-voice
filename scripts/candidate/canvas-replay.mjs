// Replays questions and answers through the canvas illustrator as a call does (the real director,
// the cue stream, and - with VOICE_BOARD_BRAVE_KEY - the photo finder and the eye), and prints what
// each page came to: its blocks, the canvas's photographs and the places pinned on them. For
// checking the instructions against real questions without placing calls.
//   echo '[{"ask":"…","say":"…"}]' | VOICE_BOARD=1 DEEPSEEK_API_KEY=… [VOICE_BOARD_BRAVE_KEY=…] node scripts/candidate/canvas-replay.mjs [--json]
// The cases come on stdin and nothing is written to disk: real questions are private.
import {boardCompletionFromEnv, createBoardDirector} from '../../lab/gpt-live-h5/board-director.mjs';
import {CANVAS_CUE_INSTRUCTIONS, cueTurns, refineCueOp} from '../../lab/gpt-live-h5/board-cue.mjs';
import {createBoardEye} from '../../lab/gpt-live-h5/board-eye.mjs';
import {createPhotoFinder} from '../../lab/gpt-live-h5/board-photo.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const cases = JSON.parse(input), complete = boardCompletionFromEnv(process.env);
const finder = process.env.VOICE_BOARD_BRAVE_KEY ? createPhotoFinder({braveKey: process.env.VOICE_BOARD_BRAVE_KEY}) : null;
// One at a time, as in a call: photographs are searched for at the rate the image search allows.
const out = [];
for (const [index, {ask, say}] of cases.entries()) out.push(await (async () => {
  const director = createBoardDirector({complete, ...(finder ? {eye: createBoardEye({complete, find: query => finder.find(query)})} : {}),
    stream: {instructions: CANVAS_CUE_INSTRUCTIONS, refine: refineCueOp, turns: cueTurns, cue: true, canvas: true}});
  const owner = `case-${index}`, started = Date.now();
  await director.run({owner, trigger: 'user', turns: [{role: 'user', text: ask}]});
  const run = await director.run({owner, trigger: 'assistant_end', turns: [{role: 'user', text: ask}, {role: 'assistant', text: say}]});
  const scene = director.scene(owner);
  return {ask, ms: Date.now() - started, eye: run.eye ?? null, title: scene.title, blocks: scene.blocks.map(block => block.t !== 'stage'
    ? {t: block.t, ...(block.h ? {h: block.h} : {}), ...(block.look ? {look: block.look} : {}), items: (block.items ?? block.nodes ?? block.cols ?? []).map(item => item.h ?? item.label).filter(Boolean), ...(block.text ? {text: block.text} : {})}
    : {t: 'stage', base: block.base, pics: block.items.filter(item => item.k === 'pic').map(pic => `${pic.h ?? ''}〔${pic.img}〕${pic.d ? ' · ' + pic.d : ''}`), chips: block.items.filter(item => item.k === 'chip').map(chip => chip.h),
      pins: block.items.filter(item => item.k === 'pin').map(pin => `${pin.on}:${pin.h ?? ''}@${pin.q}`), edges: block.edges.map(edge => edge.slice(0, 3).join('→'))})};
})());
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else for (const page of out) {
  console.log(`\n■ ${page.ask}\n  「${page.title}」 ${page.ms} ms${page.eye ? ' eye ' + JSON.stringify(page.eye) : ''}`);
  for (const block of page.blocks) console.log('  -', block.t === 'stage' ? `stage/${block.base} ${block.pics.length} 张 ${block.pics.join('，')}${block.chips.length ? ' 名字牌 ' + block.chips.join('、') : ''}${block.edges.length ? ' 箭头 ' + block.edges.join('，') : ''}${block.pins.length ? '\n      圈 ' + block.pins.join('；') : ''}` : `${block.t}${block.look ? '/' + block.look : ''}${block.h ? '「' + block.h + '」' : ''} ${block.text ?? block.items.join('、')}`);
}
