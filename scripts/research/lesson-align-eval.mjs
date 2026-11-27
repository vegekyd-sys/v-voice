// node scripts/research/lesson-align-eval.mjs <voice dir> <calls.json> <out.json>
// (docs/research/shared-lesson). Needs the board's model in the environment (VOICE_BOARD=1 and its key),
// as the call service has it. <calls.json>: [{clip, ask, deltas: [[ms after the caller's words, text], …]}],
// V's own words as they arrived in a call. <out.json> keeps the plans and clauses (private: write it
// outside the repository).
// Offline check of sentence alignment for a voice that explains in its own words (GPT Live):
// 1. the lesson writer writes its script + picture notes for the caller's question (the plan);
// 2. V's real words from a synthetic call are replayed clause by clause, at the times they arrived;
// 3. for each clause the board's fast model says which plan line(s) it tells (or none).
// Prints timings and indices only; texts stay in the private out file.
import {readFileSync, writeFileSync} from 'node:fs';
const [dir, callsFile, outFile] = process.argv.slice(2);
const {boardCompletionFromEnv} = await import(`${dir}/lab/gpt-live-h5/board-director.mjs`);
const {CANVAS_SCRIPT_INSTRUCTIONS} = await import(`${dir}/lab/gpt-live-h5/board-cue.mjs`);
const {parseScript} = await import(`${dir}/lab/gpt-live-h5/board-lesson.mjs`);
const {clauses} = await import(`${dir}/lab/gpt-live-h5/board-clause.mjs`);
const complete = boardCompletionFromEnv({...process.env, VOICE_BOARD_MAX_TOKENS: '1600'});
const quick = boardCompletionFromEnv({...process.env, VOICE_BOARD_MAX_TOKENS: '12'});
const text = async (fn, messages) => { let out = ''; for await (const chunk of fn({messages, signal: AbortSignal.timeout(20000)})) out += chunk; return out; };

export const ALIGN_INSTRUCTIONS = `你在看一通电话。屏幕上有一页讲解画面，是按一份讲稿（plan，编号的句子）准备的：讲到第几句，那一句的画面就亮出来。但 V 没有照讲稿念，是用自己的话在讲同一件事。
你会拿到 plan、V 之前说过的话（before）和 V 刚说出的一小段（now）。判断 now 讲的内容对应 plan 的哪一句：讲的是同一件事、同一个要点、同一个例子或同一个结论就算对应，用词不同没关系。
- now 同时讲到了 plan 的两三句，就都写上。
- now 只是寒暄、过渡、反问、或者讲了 plan 里没有的东西：写 -1。
- 已经对应过的句子，V 回头又提到，也照样写。
只输出编号，多个用英文逗号隔开，例如「3」「3,4」「-1」，不要别的字。`;

const calls = JSON.parse(readFileSync(callsFile, 'utf8'));
const results = [];
for (const call of calls) {
  // 1. The plan, as the lesson writer would write it for this question.
  const started = Date.now();
  const raw = await text(complete, [{role: 'system', content: CANVAS_SCRIPT_INSTRUCTIONS}, {role: 'user', content: JSON.stringify({topic: call.ask, audience: '成年人', today: new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Shanghai'}), ask: call.ask})}]);
  const plan = parseScript(raw);
  const planMs = Date.now() - started;
  if (!plan) { results.push({clip: call.clip, error: 'no plan'}); continue; }
  // 2. V's words, clause by clause as they arrived.
  const parts = [];
  let said = '';
  for (const [at, delta] of call.deltas) {
    said += delta;
    const done = clauses(said);
    // A clause counts once the next has begun (or at the end).
    while (parts.length < done.length - 1) parts.push({at, text: done[parts.length]});
  }
  const all = clauses(said); while (parts.length < all.length) parts.push({at: call.deltas.at(-1)[0], text: all[parts.length]});
  // 3. Alignment, one request per clause.
  const rows = [];
  for (let index = 0; index < parts.length; index++) {
    const t = Date.now();
    let answer = '';
    try { answer = await text(quick, [{role: 'system', content: ALIGN_INSTRUCTIONS}, {role: 'user', content: JSON.stringify({plan: plan.say.map((line, i) => `${i}. ${line}`), before: parts.slice(Math.max(0, index - 4), index).map(p => p.text).join(''), now: parts[index].text})}]); }
    catch (error) { answer = 'ERR ' + String(error?.message ?? error).slice(0, 60); }
    rows.push({at: parts[index].at, ms: Date.now() - t, lines: answer.trim(), clause: parts[index].text});
  }
  results.push({clip: call.clip, planMs, plan: plan.say, show: plan.show, rows});
  const covered = new Set(rows.flatMap(row => row.lines.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0)));
  const lat = rows.map(row => row.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({clip: call.clip, planMs, planLines: plan.say.length, clauses: rows.length, aligned: rows.filter(row => !row.lines.startsWith('-1')).length, planCovered: covered.size, latencyMedian: lat[lat.length >> 1], latencyMax: lat.at(-1)}));
}
writeFileSync(outFile, JSON.stringify(results, null, 1), {mode: 0o600});
