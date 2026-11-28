// Builds an HTML sheet of today's board for the seven prototype questions, rendered by the page's own
// Board component with the page's stylesheet. Pictures are embedded; the sheet is not committed.
//   node scripts/candidate/canvas-today-page.mjs artifacts/canvas-today/<stamp> out.html
import {build} from 'esbuild';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const [dir, output] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '../..');
const TABS = {mewtwo: '超梦长什么样', froakie: '泡沫蛙进化', types: '属性相克', taihe: '太和殿', cars: '电车和油车', psg: '巴黎阵容', nightshift: '夜班流程'};
const data = JSON.parse(readFileSync(join(dir, 'today.json'), 'utf8'));
const sniff = bytes => bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg';
const topics = Object.keys(TABS).filter(id => data[id]?.scene).map(id => ({id, tab: TABS[id], ms: data[id].ms, scene: data[id].scene,
  pictures: Object.fromEntries(Object.entries(data[id].pictures).map(([query, {file}]) => { const bytes = readFileSync(join(dir, 'photos', file)); return [query, `data:${sniff(bytes)};base64,${bytes.toString('base64')}`]; }))}));
const bundle = await build({entryPoints: [join(root, 'scripts/candidate/canvas-today-page.jsx')], bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', minify: true,
  define: {'process.env.NODE_ENV': '"production"'}, write: false, logLevel: 'silent', absWorkingDir: root});
const css = readFileSync(join(root, 'lab/gpt-live-h5/styles.css'), 'utf8');
writeFileSync(output, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>今天的讲解画面</title><style>${css}
html,body{height:auto;overflow:auto;background:#f6f3fa}.frames{display:flex;flex-wrap:wrap;gap:18px;padding:16px}.today{margin:0}.today figcaption{font:600 13px -apple-system,"PingFang SC";color:#3c3489;margin-bottom:6px}
.phone{width:390px;height:620px;display:flex;flex-direction:column;background:#fbf8ff;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px -16px #3c348966}</style>
<div id="root"></div><script>window.TODAY=${JSON.stringify({topics}).replace(/</g, '\\u003c')}</script><script>${bundle.outputFiles[0].text}</script>`);
console.log('wrote', output);
