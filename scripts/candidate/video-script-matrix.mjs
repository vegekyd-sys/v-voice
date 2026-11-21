// A matrix of requests for a video, run through the director's pass (media-script.mjs) on the real
// model, each script checked by rule and optionally filmed (one paid `makaron video create` per case
// marked "film"). Run on V as the Candidate's service user (video-script-matrix-on-v.sh).
// Arguments: cases.json out-dir [script|film]. Prints one line a case; results.json has the scripts.
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {boardCompletionFromEnv} from '../../lab/gpt-live-h5/board-director.mjs';
import {createAssetEye} from '../../lab/gpt-live-h5/board-assets.mjs';
import {createVideoScriptWriter} from '../../lab/realtime-direct-tools/media-script.mjs';
import {mediaArgv, validateMediaArgv} from '../../lab/realtime-direct-tools/media-cli.mjs';

const [casesFile, out, mode = 'script'] = process.argv.slice(2);
const cases = JSON.parse(await readFile(casesFile, 'utf8'));
await mkdir(out, {recursive: true});
const base = boardCompletionFromEnv({...process.env, VOICE_BOARD: '1', VOICE_BOARD_MAX_TOKENS: '1400'});
if (!base) { console.log(JSON.stringify({error: 'no board model credential'})); process.exit(1); }
const look = async url => { const response = await fetch(url); const type = String(response.headers.get('content-type') ?? '').split(';')[0]; if (!response.ok || !/^image\//u.test(type)) return ''; return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`; };
const see = createAssetEye({complete: boardCompletionFromEnv({...process.env, VOICE_BOARD: '1', VOICE_BOARD_MAX_TOKENS: '700'})});
const seen = new Map();
const describe = url => { if (!seen.has(url)) seen.set(url, see({url, prompt: ''}).then(found => found ?? {name: '', see: ''}, () => ({name: '', see: ''}))); return seen.get(url); };
const run = argv => new Promise(resolve => {
  let text = '';
  const child = spawn('makaron', argv, {env: {PATH: process.env.PATH, MAKARON_API_KEY: process.env.MAKARON_API_KEY, HOME: out, TMPDIR: out}, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { text += chunk; });
  child.on('close', code => resolve({code, text: text.split(process.env.MAKARON_API_KEY ?? '\0').join('[redacted]')}));
  child.on('error', error => resolve({code: -1, text: String(error.message)}));
});
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const results = [];
const work = cases.map(item => async () => {
  const audits = [];
  let raw = '';
  const complete = async function* (request) { for await (const chunk of base(request)) { raw += chunk; yield chunk; } };
  const writer = createVideoScriptWriter({complete, vision: true, look, timeoutMs: 20000, audit: event => audits.push(event)});
  const media = await Promise.all((item.images ?? []).map(async url => { const found = await describe(url); return {url, name: found.name, see: found.see}; }));
  const started = Date.now();
  const script = await writer.write({ask: item.ask, draft: item.draft, seconds: item.seconds, media});
  const row = {case: item.name, ask: item.ask, draft: item.draft, seconds: item.seconds, media: media.length, wroteMs: Date.now() - started, script, raw: script ? undefined : raw.slice(0, 600), audit: audits.at(-1)};
  // What a script must be, by rule.
  const problems = [];
  if (!script) problems.push('no script: ' + (row.audit?.why ?? '?'));
  else {
    const shots = [...script.matchAll(/Shot \d+ \((\d+)s\):/gu)].map(match => Number(match[1]));
    row.shots = shots.length; row.chars = script.length;
    const used = new Set([...script.matchAll(/<<<media_(\d+)>>>/gu)].map(match => Number(match[1])));
    for (let n = 1; n <= media.length; n++) if (!used.has(n)) problems.push(`picture ${n} not named`);
    if ([...used].some(n => n > media.length)) problems.push('names a picture not given');
    if (shots.length && shots.reduce((sum, value) => sum + value, 0) !== item.seconds) problems.push('seconds do not add up');
    if (item.seconds > 5 && shots.length < 2 && !item.oneTake) problems.push('one shot for a film over five seconds');
    if (item.oneTake && shots.length > 1) problems.push(`asked for one take, got ${shots.length} shots`);
    // (English takes about three letters for what one Chinese character says.)
    const roomy = /\p{Script=Han}/u.test(script) ? 1 : 2.8;
    if (script.length > (300 + item.seconds * 45) * roomy) problems.push(`long: ${script.length} chars`);
    if (media.length && !/<<<media_1>>>（/u.test(script) && !/<<<media_1>>> ?\(/u.test(script)) problems.push('first picture has no role');
    if (!/Style:/u.test(script)) problems.push('no Style line');
    if (/[\r\n]/u.test(script)) problems.push('more than one line');
    if (/角色（|（语气）|……/u.test(script)) problems.push('a placeholder of the guide was copied');
    if (!item.oneTake && item.seconds <= 5 && shots.length > 4) problems.push(`${shots.length} shots in five seconds`);
    for (const want of item.must ?? []) if (!new RegExp(want, 'u').test(script)) problems.push(`missing: ${want}`);
    for (const never of item.mustNot ?? []) if (new RegExp(never, 'u').test(script)) problems.push(`should not have: ${never}`);
    // The command it goes into is one the executor accepts.
    const command = `makaron video create --video-model fal-h3-max --duration ${item.seconds} --video-resolution 768p ${media.map(image => `--image ${quote(image.url)}`).join(' ')} --script ${quote(script)}`;
    try { const argv = mediaArgv(command); validateMediaArgv(argv); if (argv[argv.indexOf('--script') + 1] !== script) problems.push('the script does not survive the command'); } catch (error) { problems.push('executor refuses: ' + String(error.message).slice(0, 80)); }
  }
  row.problems = problems;
  results.push(row);
  if (mode === 'film' && item.film && script) {
    const filmed = Date.now();
    const submit = await run(['video', 'create', '--video-model', 'fal-h3-max', '--duration', String(item.seconds), '--video-resolution', '768p', ...media.flatMap(image => ['--image', image.url]), '--script', script]);
    const task = submit.text.match(/Task ID:\s*([\w:-]+)/u)?.[1];
    if (!task) row.filmError = submit.text.replace(/https?:\/\/\S+/gu, '<url>').slice(0, 300);
    for (let tries = 0; task && tries < 90; tries++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const status = await run(['video', 'status', task]);
      const url = status.text.match(/https:\/\/\S+\.(?:mp4|webm|mov)/u)?.[0];
      if (url) { row.url = url; row.madeMs = Date.now() - filmed; break; }
      if (!/rendering|queued|processing|saving/iu.test(status.text)) { row.filmError = status.text.replace(/https?:\/\/\S+/gu, '<url>').slice(0, 300); break; }
    }
  }
  console.log(JSON.stringify({case: row.case, s: row.seconds, media: row.media, shots: row.shots, chars: row.chars, ms: row.wroteMs, mended: row.audit?.mended, problems, ...(row.url ? {filmed: Math.round(row.madeMs / 1000) + 's'} : {}), ...(row.filmError ? {filmError: row.filmError} : {})}));
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
});
// Four at a time.
const lanes = Array.from({length: 4}, async () => { while (work.length) await work.shift()(); });
await Promise.all(lanes);
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
