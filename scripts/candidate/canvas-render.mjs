// Renders canvas-eval.mjs drawings as an HTML sheet (each drawing as the page would draw it:
// named parts, labels at their anchors, flows as arrows). Screenshot it to compare.
//   node scripts/candidate/canvas-render.mjs result.json sheet.html [variant]
import {readFileSync, writeFileSync} from 'node:fs';

export const TONES = {paper: '#ffffff', lilac: '#e9ddf3', butter: '#f9e6a8', sky: '#d6e6f5', peach: '#f9d2b8', rose: '#f2b8c8', ink: '#3c3489', none: 'none'};
const LINES = {ink: ['#3c3489', ''], soft: ['#b9aecb', ''], dash: ['#7f77dd', '4 4']};
const esc = value => String(value ?? '').replace(/[&<>"]/gu, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const safePath = d => /^[MLCQZmlcqz0-9.,\s-]+$/u.test(String(d ?? '')) ? String(d) : '';
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function shape(item) {
  const fill = TONES[item.fill] ?? TONES.paper, [stroke, dash] = LINES[item.line] ?? LINES.ink;
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}`;
  const c = Array.isArray(item.c) ? item.c.map(num) : [];
  if (item.k === 'path') return safePath(item.d) ? `<path d="${safePath(item.d)}" ${paint}/>` : '';
  if (item.k === 'circle') return `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}" ${paint}/>`;
  if (item.k === 'ellipse') return `<ellipse cx="${c[0]}" cy="${c[1]}" rx="${c[2]}" ry="${c[3]}" ${paint}/>`;
  if (item.k === 'rect') return `<rect x="${c[0]}" y="${c[1]}" width="${c[2]}" height="${c[3]}" rx="${c[4] ?? 0}" ${paint}/>`;
  return '';
}

export function drawingSvg(drawing, {width = 400} = {}) {
  const parts = Array.isArray(drawing?.parts) ? drawing.parts : [], flows = Array.isArray(drawing?.flows) ? drawing.flows : [];
  const body = parts.map(part => (part.shapes ?? []).map(shape).join('')).join('');
  const arrows = flows.map(flow => safePath(flow.d) ? `<path d="${safePath(flow.d)}" fill="none" stroke="#c96385" stroke-width="2.5" stroke-dasharray="7 5" marker-end="url(#arrow)"/>` : '').join('');
  const labels = parts.map(part => {
    const [x, y] = (part.anchor ?? []).map(num);
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="#c96385"/><text x="${x + 6}" y="${y - 6}" font-size="12" fill="#3c3489" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(part.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 400 300" width="${width}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#c96385"/></marker></defs><rect width="400" height="300" fill="#fbf8fd"/>${body}${arrows}${labels}</svg>`;
}

if (process.argv[1]?.endsWith('canvas-render.mjs')) {
  const [input, output, only] = process.argv.slice(2);
  const rows = JSON.parse(readFileSync(input, 'utf8')).filter(row => !only || row.variant === only);
  const cells = rows.map(row => `<figure><figcaption>${esc(row.topic)} · ${esc(row.variant)} · ${(row.ms / 1000).toFixed(1)} s</figcaption>${row.ok ? drawingSvg(row.drawing) : '<div class="miss">没有可用的图</div>'}</figure>`).join('');
  writeFileSync(output, `<!doctype html><meta charset="utf-8"><style>body{margin:16px;font-family:-apple-system,"PingFang SC",sans-serif;background:#fff}main{display:grid;grid-template-columns:repeat(2,400px);gap:18px}figure{margin:0}figcaption{font-size:13px;color:#555;margin-bottom:4px}.miss{width:400px;height:300px;display:grid;place-items:center;background:#f4f4f4;color:#999}</style><main>${cells}</main>`);
}
