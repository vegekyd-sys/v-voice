// Builds the playable prototype page from canvas-proto.mjs results: canvas-proto-page.html with the
// results and the photos (as data: URIs) put in. The photos are public search results cached by the
// Candidate; the built page is a private research artifact and is not committed.
//   node scripts/candidate/canvas-proto-page.mjs result.json photos/ page.html
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {extname, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ORDER = [['mewtwo', '超梦长什么样'], ['froakie', '泡沫蛙进化'], ['types', '属性相克'], ['taihe', '太和殿'], ['cars', '电车和油车'], ['psg', '巴黎阵容'], ['nightshift', '夜班流程']];
const TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};
const [input, photos, output] = process.argv.slice(2);
const results = JSON.parse(readFileSync(input, 'utf8')), files = readdirSync(photos);
const topics = ORDER.filter(([id]) => results[id]).map(([id, tab]) => {
  const r = results[id];
  return {id, tab, ask: r.ask, title: r.title, base: r.base, clauses: r.clauses, ms: {first: r.firstMs, direct: r.directMs, total: r.totalMs},
    steps: r.steps.map(({where, coarse, ...step}) => step),
    photos: r.photos.map(photo => { const file = files.find(name => name.startsWith(photo.name + '.')); return {id: photo.id, caption: photo.caption, src: `data:${TYPES[extname(file)]};base64,${readFileSync(join(photos, file)).toString('base64')}`}; })};
});
const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'canvas-proto-page.html'), 'utf8');
writeFileSync(output, template.replace('/*DATA*/', () => JSON.stringify({topics}).replace(/</g, '\\u003c')));
console.log('wrote', output, Math.round(readFileSync(output).length / 1024), 'KB');
