// Renders pointer-eval.mjs results as an HTML sheet: each photo with the marks drawn where the model
// put them (numbered by clause), one column per variant. Screenshot it to compare.
//   node scripts/candidate/pointer-render.mjs result.json photos/ sheet.html [variants…]
import {readFileSync, writeFileSync} from 'node:fs';
import {relative, dirname, join} from 'node:path';

const esc = value => String(value ?? '').replace(/[&<>"]/gu, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const NAMES = {see: '看图 · 不思考', where: '看图 · 先说位置 · 不思考', refine: '先说位置 + 放大校正 · 不思考', coarse: '校正前（粗框）', blind: '不看图（基线）', think: '看图 · 开思考'};

export function marksOverlay(marks) {
  // Percent-positioned so rings stay round-ish and labels unstretched whatever the photo's shape.
  return (marks ?? []).map(mark => {
    const [x1, y1, x2, y2] = (mark.box ?? []).map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return '';
    const left = Math.min(x1, x2) / 10, top = Math.min(y1, y2) / 10, width = Math.abs(x2 - x1) / 10, height = Math.abs(y2 - y1) / 10;
    const shape = mark.kind === 'point'
      ? `<i class="dot" style="left:${left + width / 2}%;top:${top + height / 2}%"></i>`
      : `<i class="ring${mark.kind === 'arrow' ? ' dash' : ''}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></i>`;
    const below = top < 9;
    return `${shape}<span class="tag" style="left:${left + width / 2}%;top:${below ? top + height : top}%;transform:translate(-50%,${below ? '4px' : 'calc(-100% - 4px)'})">${esc(`${mark.cue}·${mark.label ?? ''}`)}</span>`;
  }).join('');
}

if (process.argv[1]?.endsWith('pointer-render.mjs')) {
  const [input, photos, output, ...only] = process.argv.slice(2);
  const rows = JSON.parse(readFileSync(input, 'utf8'));
  const variants = only.length ? only : ['see', 'blind', 'think'];
  const ids = [...new Set(rows.map(row => row.id))];
  const cell = row => {
    if (!row) return '<td></td>';
    const src = relative(dirname(output), join(photos, row.file));
    return `<td><div class="cap">${esc(NAMES[row.variant] ?? row.variant)} · ${(row.ms / 1000).toFixed(1)} s</div><div class="pic"><img src="${esc(src)}">${marksOverlay(row.marks)}</div></td>`;
  };
  const body = ids.map(id => {
    const first = rows.find(row => row.id === id);
    const words = first.clauses.map((part, index) => `<b>[${index}]</b>${esc(part)}`).join(' ');
    return `<tr><td colspan="${variants.length}" class="say">${esc(id)}　${words}</td></tr><tr>${variants.map(v => cell(rows.find(row => row.id === id && row.variant === v))).join('')}</tr>`;
  }).join('');
  writeFileSync(output, `<!doctype html><meta charset="utf-8"><style>body{margin:16px;font-family:-apple-system,"PingFang SC",sans-serif;background:#fff}table{border-collapse:separate;border-spacing:14px 6px}td{vertical-align:top;width:340px}.say{font-size:13px;color:#444;padding-top:18px;width:auto}.say b{color:#c96385;font-weight:600}.cap{font-size:12px;color:#777;margin-bottom:3px}.pic{position:relative;width:340px}.pic img{display:block;width:100%}.ring,.dot,.tag{position:absolute}.ring{box-sizing:border-box;border:3px solid #c96385;border-radius:50%;margin:-6px;padding:6px;box-sizing:content-box}.ring.dash{border-style:dashed}.dot{width:12px;height:12px;margin:-6px;border-radius:50%;background:#c96385}.tag{font-size:12px;font-weight:700;color:#3c3489;background:#fff;border-radius:6px;padding:1px 5px;white-space:nowrap;box-shadow:0 0 0 1px #e3dcef}</style><table>${body}</table>`);
}
