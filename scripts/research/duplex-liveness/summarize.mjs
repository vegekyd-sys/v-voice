// node summarize.mjs <out>: one line per run, what the model produced relative to the caller's speech.
import {readdir,readFile} from 'node:fs/promises';
const dir=process.argv[2];const files=(await readdir(dir)).filter(f=>f.endsWith('.json')).sort();const rows=[];
for(const f of files){const r=JSON.parse(await readFile(`${dir}/${f}`));
  const callerEnd=r.spans.at(-1)?.end??0,inSpan=t=>r.spans.some(s=>t>=s.start&&t<s.end);
  // Group output audio into segments: a new segment when response id changes or arrival gap > 1.5 s.
  const segs=[];let cur=null;
  for(const e of r.log){if(e.type!=='audio')continue;
    if(!cur||e.t-cur.lastT>1500||(e.rid&&cur.rid&&e.rid!==cur.rid)){cur={onset:e.t,lastT:e.t,rid:e.rid,ms:0};segs.push(cur);}
    cur.ms+=e.ms;cur.lastT=e.t;}
  for(const s of segs){s.text=r.log.filter(e=>e.type==='text.done'&&e.rid===s.rid).map(e=>e.text).join('')||r.log.filter(e=>e.type==='text'&&e.rid===s.rid).map(e=>e.delta).join('');}
  const during=segs.filter(s=>s.onset<callerEnd-100),after=segs.find(s=>s.onset>=callerEnd-100);
  rows.push({run:f.replace('.json',''),callerEndMs:callerEnd,during:during.map(s=>({onset:s.onset,overClause:inSpan(s.onset),ms:s.ms,text:(s.text??'').slice(0,60)})),firstAfterMs:after?after.onset-callerEnd:null,firstAfterText:(after?.text??'').slice(0,80),tools:r.log.filter(e=>e.type==='tool').map(e=>({t:e.t-callerEnd,name:e.name})),cancels:r.log.filter(e=>/cancel/.test(e.type)).length,errors:r.log.filter(e=>e.type==='error').map(e=>e.code),marks:r.log.filter(e=>e.type==='mark')});
}
console.log(JSON.stringify(rows,null,0).replaceAll('},{"run"','},\n{"run"'));
