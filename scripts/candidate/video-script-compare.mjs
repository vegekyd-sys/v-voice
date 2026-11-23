// Compares ways of writing the script a video is made from (media-script.mjs), on real generations:
// the voice model's own draft, the director's pass in words only, and the same pass shown the
// reference pictures. Run on V as the Candidate's service user with its environment
// (video-script-compare-on-v.sh): each case and way is one paid `makaron video create`.
// Writes results.json (scripts, timings, video addresses) to the directory given. Prints nothing secret.
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {boardCompletionFromEnv} from '../../lab/gpt-live-h5/board-director.mjs';
import {createAssetEye} from '../../lab/gpt-live-h5/board-assets.mjs';
import {createVideoScriptWriter} from '../../lab/realtime-direct-tools/media-script.mjs';

// (Ways and the writer's model come as arguments: the Candidate's launcher replaces the environment.)
const [casesFile, out, waysArg = 'draft,text,vision', modelArg = ''] = process.argv.slice(2), ways = waysArg.split(',');
const cases = JSON.parse(await readFile(casesFile, 'utf8'));
await mkdir(out, {recursive: true});
const complete = boardCompletionFromEnv({...process.env, VOICE_BOARD: '1', VOICE_BOARD_MAX_TOKENS: '1400', ...(modelArg ? {VOICE_BOARD_MODEL: modelArg} : {})});
if (!complete || !process.env.MAKARON_API_KEY) { console.log(JSON.stringify({error: 'missing model or creation credential', model: Boolean(complete), creation: Boolean(process.env.MAKARON_API_KEY)})); process.exit(1); }
const look = async url => { const response = await fetch(url); const type = String(response.headers.get('content-type') ?? '').split(';')[0]; if (!response.ok || !/^image\//u.test(type)) return ''; return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`; };
const see = createAssetEye({complete: boardCompletionFromEnv({...process.env, VOICE_BOARD: '1', VOICE_BOARD_MAX_TOKENS: '700'})});
const writers = {text: createVideoScriptWriter({complete, timeoutMs: 20000}), vision: createVideoScriptWriter({complete, vision: true, look, timeoutMs: 25000})};
const run = argv => new Promise(resolve => {
  let text = '';
  const child = spawn('makaron', argv, {env: {PATH: process.env.PATH, MAKARON_API_KEY: process.env.MAKARON_API_KEY, HOME: out, TMPDIR: out}, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { text += chunk; });
  child.on('close', code => resolve({code, text: text.split(process.env.MAKARON_API_KEY).join('[redacted]')}));
  child.on('error', error => resolve({code: -1, text: String(error.message)}));
});
const results = [];
for (const item of cases) {
  // What the product would know of each picture: one look, as the shelf does.
  const media = await Promise.all(item.images.map(async image => ({...image, see: image.see ?? (await see({url: image.url, prompt: ''}))?.see ?? ''})));
  await Promise.all(ways.map(async way => {
    const started = Date.now();
    let script = item.draft;
    if (way !== 'draft') script = await writers[way].write({ask: item.ask, draft: item.draft, seconds: item.seconds, media}) || '';
    const wroteMs = Date.now() - started;
    const row = {case: item.name, way, seconds: item.seconds, wroteMs, script};
    results.push(row);
    if (!script) { row.error = 'no script'; return; }
    const submit = await run(['video', 'create', '--video-model', 'fal-h3-max', '--duration', String(item.seconds), '--video-resolution', '768p', ...media.flatMap(image => ['--image', image.url]), '--script', script]);
    const task = submit.text.match(/Task ID:\s*([\w:-]+)/u)?.[1];
    if (!task) { row.error = submit.text.replace(/https?:\/\/\S+/gu, '<url>').slice(0, 300); return; }
    for (let tries = 0; tries < 80; tries++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const status = await run(['video', 'status', task]);
      const url = status.text.match(/https:\/\/\S+\.(?:mp4|webm|mov)/u)?.[0];
      if (url) { row.url = url; row.madeMs = Date.now() - started - wroteMs; break; }
      if (!/rendering|queued|processing|saving/iu.test(status.text)) { row.error = status.text.replace(/https?:\/\/\S+/gu, '<url>').slice(0, 300); break; }
    }
    await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
  }));
}
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results.map(({script, ...row}) => ({...row, chars: script.length}))));
