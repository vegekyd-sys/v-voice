#!/usr/bin/env node
// The routing cases as a table, with where each went before and after a change
// (two results.json of routing-eval.mjs). Prints Markdown.
//
//   node scripts/candidate/routing-report.mjs cases.json before/results.json after/results.json
import {readFile} from 'node:fs/promises';
import {routeOf, verdict} from './routing-verdict.mjs';

const [casesFile, beforeFile, afterFile] = process.argv.slice(2);
if (!casesFile || !beforeFile) throw Error('Usage: routing-report.mjs cases.json before/results.json [after/results.json]');
const cases = JSON.parse(await readFile(casesFile, 'utf8'));
// (Judged again from what was recorded, by the cases as they now read. Several files: later ones replace a case's earlier runs.)
const byId = new Map(cases.map(item => [item.id, item]));
const load = async files => { const rows = new Map(); for (const file of files ? files.split(',') : []) { const fresh = new Map(); for (const row of JSON.parse(await readFile(file, 'utf8'))) if (byId.has(row.id)) fresh.set(row.id, [...(fresh.get(row.id) ?? []), {...row, route: routeOf(row), ...verdict(byId.get(row.id), row)}]); for (const [id, runs] of fresh) rows.set(id, runs); } return rows; };
const before = await load(beforeFile), after = await load(afterFile);
const NAMES = {make: '前台做', back: '交后台', lookup: '前台查', lesson: '讲解/找图', talk: '直接说', control: '控制', show: '上屏'};
const route = row => row.why.startsWith('not run') ? '没跑成' : row.route.map(kind => NAMES[kind] ?? kind).join('+');
// Every run of a case: "交后台 ×2", or "前台做, 交后台" when the runs differ.
const went = rows => { const seen = new Map(); for (const row of rows ?? []) seen.set(route(row), (seen.get(route(row)) ?? 0) + 1); return [...seen].map(([name, count]) => count > 1 && seen.size > 1 ? `${name}×${count}` : name).join('，') || '—'; };
const passed = rows => (rows ?? []).filter(row => row.ok).length;
const mark = rows => !rows?.length ? '—' : passed(rows) === rows.length ? '✓' : passed(rows) === 0 ? '✗' : `${passed(rows)}/${rows.length}`;
const want = item => (item.expect.route ?? []).map(part => part.split('+').map(kind => NAMES[kind] ?? kind).join('+')).join(' 或 ') + (item.expect.never?.length ? `；不能${item.expect.never.map(kind => NAMES[kind] ?? kind).join('、')}` : '') + (item.expect.command ? '；命令里带上该用的图' : '');
const said = item => (Array.isArray(item.say) ? item.say.map((text, index) => index < item.say.length - 1 ? `（先说：${text}）` : text).join(' ') : item.say) + (item.setup?.assets ? '〔画面上已有一张海报〕' : '') + (item.setup?.photos ? '〔画面上有两张搜到的图〕' : '') + (item.setup?.fail ? '〔前台的日历工具被拒〕' : '') + (item.setup?.entry === 'bound' ? '〔别的会话的入口〕' : '');

const groups = [...new Set(cases.map(item => item.group))];
const total = rows => { let ok = 0, all = 0; for (const item of cases) { ok += passed(rows.get(item.id)); all += rows.get(item.id)?.length ?? 0; } return `${ok}/${all}`; };
console.log(`| 类别 | 用例数 | 修改前通过 | ${after.size ? '修改后通过 |' : ''}`);
console.log(`|---|---|---|${after.size ? '---|' : ''}`);
for (const group of groups) {
  const items = cases.filter(item => item.group === group), count = rows => { let ok = 0, all = 0; for (const item of items) { ok += passed(rows.get(item.id)); all += rows.get(item.id)?.length ?? 0; } return `${ok}/${all}`; };
  console.log(`| ${group} | ${items.length} | ${count(before)} | ${after.size ? count(after) + ' |' : ''}`);
}
console.log(`| **合计** | ${cases.length} | **${total(before)}** | ${after.size ? `**${total(after)}** |` : ''}`);
console.log('');
for (const group of groups) {
  console.log(`\n**${group}**\n`);
  console.log(`| 用例 | 用户说的话 | 期望 | 修改前 | ${after.size ? '修改后 |' : ''}`);
  console.log(`|---|---|---|---|${after.size ? '---|' : ''}`);
  for (const item of cases.filter(item => item.group === group)) {
    console.log(`| ${item.id} | ${said(item)} | ${want(item)}${item.note ? `<br>${item.note}` : ''} | ${mark(before.get(item.id))} ${went(before.get(item.id))} | ${after.size ? `${mark(after.get(item.id))} ${went(after.get(item.id))} |` : ''}`);
  }
}
