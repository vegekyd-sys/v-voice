#!/usr/bin/env node
// The floor judge alone (floor-judge.mjs), on what was really heard in a barge-eval run: whether each
// utterance is judged said to V, and how long the judgement takes. Run through a Candidate's launcher:
//   node floor-judge-bench.mjs cases.json scripts.json results.json [repeats]
import {readFile} from 'node:fs/promises';
import {boardCompletionFromEnv} from '../../lab/gpt-live-h5/board-director.mjs';
import {createFloorJudge,floorJudgeFromEnv} from '../../lab/realtime-direct-tools/floor-judge.mjs';
import {splitSpoken} from '../../lab/realtime-direct-tools/playback-position.mjs';
const [casesFile, scriptsFile, resultsFile, repeats = '5'] = process.argv.slice(2);
const cases = JSON.parse(await readFile(casesFile, 'utf8')), scripts = JSON.parse(await readFile(scriptsFile, 'utf8'));
const results = JSON.parse(await readFile(resultsFile, 'utf8'));
const board = () => boardCompletionFromEnv(process.env);
const judge = floorJudgeFromEnv(process.env) ?? (() => { const complete = board(); return complete ? createFloorJudge({complete}) : null; })();
if (!judge) throw Error('No judge in this environment (VOICE_JEV_API_KEY / OPENROUTER_API_KEY, or a board model)');
const rows = [];
for (let round = 1; round <= Number(repeats); round++) for (const item of cases) {
  const heard = results.find(row => row.id === item.id && row.heardText)?.heardText?.split(' / ').at(-1) ?? item.say;
  const script = scripts[item.script], totalMs = Array.from(script).length * 180;
  const {said, ahead} = splitSpoken(script, item.atMs, totalMs);
  const verdict = await judge({said, ahead, heard, recent: [{role: 'user', text: item.request}]});
  rows.push({id: item.id, kind: item.kind, ...verdict});
  console.log(JSON.stringify({id: item.id, kind: item.kind, round, ...verdict, heard: heard.slice(0, 30)}));
}
const ms = rows.map(row => row.ms).sort((a, b) => a - b), q = p => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
const rate = kind => { const k = rows.filter(row => row.kind === kind); return `${k.filter(row => row.toV === true).length}/${k.length} (null ${k.filter(row => row.toV === null).length})`; };
const byId = Object.fromEntries([...new Set(rows.map(row => row.id))].map(id => {
  const p = rows.filter(row => row.id === id).map(row => row.probability).filter(Number.isFinite).sort((a, b) => a - b);
  return [id, p.length ? {min: p[0], med: p[Math.floor(p.length / 2)], max: p.at(-1)} : null];
}));
console.log(JSON.stringify({genuineToV: rate('genuine'), sideToV: rate('side'), threshold: Number(process.env.VOICE_FLOOR_JUDGE_THRESHOLD ?? 0.5), p50: q(.5), p90: q(.9), max: ms.at(-1), byId}));
