// One real call on the Candidate, driven by synthesized speech injected as the microphone.
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=process.env.OUT, questions=process.argv.slice(2);
const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const [vw,vh]=(process.env.VIEW??'1440x900').split('x').map(Number);const context=await browser.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:vw<600?2:1,isMobile:vw<600,hasTouch:vw<600,permissions:['microphone']});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push('PAGEERROR '+e.message.slice(0,200)));
page.on('response',async r=>{if(r.url().includes('/api/')&&r.status()>=400)errors.push(r.status()+' '+r.url().replace(/^.*\/api\//,'').replace(/\?.*/,''));});
await page.exposeFunction('__wav',name=>fs.readFileSync(`${process.env.VOICE_DIR}/${name}.wav`).toString('base64'));
await page.addInitScript(()=>{
  let ctx,dest;
  const ensure=()=>{if(!ctx){ctx=new AudioContext({sampleRate:48000});dest=ctx.createMediaStreamDestination();const quiet=ctx.createGain();quiet.gain.value=0;const osc=ctx.createOscillator();osc.connect(quiet).connect(dest);osc.start();}return dest;};
  navigator.mediaDevices.getUserMedia=async()=>{const d=ensure();await ctx.resume();return d.stream;};
  window.__speak=async name=>{ensure();await ctx.resume();const b64=await window.__wav(name);const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const buffer=await ctx.decodeAudioData(bytes.buffer);const src=ctx.createBufferSource();src.buffer=buffer;src.connect(dest);return new Promise(resolve=>{src.onended=resolve;src.start();});};
});
const t0=Date.now(),log=[],now=()=>Date.now()-t0;
await page.goto(process.env.ENTRY_LINK);
await page.waitForSelector('#start:not([disabled])',{timeout:30000});
log.push({t:now(),event:'page-ready',model:await page.textContent('#modelName').catch(()=>null)});
await page.click('#start');
await page.waitForFunction(()=>document.body.dataset.callState==='connected',null,{timeout:40000});
log.push({t:now(),event:'connected'});
const sample=()=>page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.turns .turn')].map(el=>({role:el.classList.contains('user')?'user':'assistant',streaming:el.dataset.streaming==='true',doc:el.dataset.document==='true',text:el.querySelector('.turn-text')?.innerText??''}));
  const board=document.querySelector('.board');
  return {voice:document.querySelector('.call-page')?.dataset.voice,work:document.querySelector('.call-page')?.dataset.work,status:document.querySelector('#status')?.innerText??'',rows,
    board:board?{title:board.querySelector('.board-title')?.innerText??'',text:board.querySelector('.board-body')?.innerText??'',types:[...board.querySelectorAll('.board-block')].map(b=>b.dataset.type+(b.dataset.paper?':'+b.dataset.paper:'')),focus:board.querySelector('[data-now]')?.innerText?.replace(/\n/g,' ').slice(0,30)??null,
      anchored:board.querySelectorAll('[data-anchored]').length,pencil:board.querySelectorAll('[data-ink="false"]').length,ink:board.querySelectorAll('[data-ink="true"]').length,marks:[...board.querySelectorAll('.board-mark')].map(m=>m.className.baseVal.replace('board-mark board-mark-','')),icons:board.querySelectorAll('.board-icon').length,photo:board.querySelector('.board-print')?.dataset.ready??null}:null,
    timeline:JSON.parse(document.body.dataset.boardTimeline??'[]')};
});
let shots=0,lastBoard='',lastRows='';
const watch=async(label,{maxMs,quietMs=5000,minMs=4000})=>{
  const start=Date.now();let quietSince=null,spoke=false;
  for(;;){
    const s=await sample();
    const boardKey=JSON.stringify(s.board), last=s.rows.at(-1);
    if(boardKey!==lastBoard){lastBoard=boardKey;log.push({t:now(),event:'board',label,board:s.board});if(shots<40)await page.screenshot({path:`${out}/shot-${String(++shots).padStart(2,'0')}-${label}.png`});}
    const rowsKey=JSON.stringify(s.rows.map(r=>[r.role,r.text.length,r.streaming]));
    if(rowsKey!==lastRows){lastRows=rowsKey;log.push({t:now(),event:'rows',label,voice:s.voice,last:last?{role:last.role,streaming:last.streaming,doc:last.doc,text:last.text.slice(-60),length:last.text.length}:null});}
    if(s.voice==='speaking'||last?.streaming||s.work==='true'){spoke=spoke||last?.role==='assistant';quietSince=null;}else quietSince??=Date.now();
    const elapsed=Date.now()-start;
    if(elapsed>maxMs||elapsed>minMs&&spoke&&quietSince&&Date.now()-quietSince>quietMs)break;
    await page.waitForTimeout(500);
  }
};
await watch('greeting',{maxMs:15000,quietMs:2500,minMs:2500});
// "id@ms": this question is asked `ms` after the one before it, whatever V is doing (an interruption).
const plan=questions.map(entry=>{const [name,after]=entry.split('@');return {name,after:after?Number(after):null};});
for(const [index,{name}] of plan.entries()){
  log.push({t:now(),event:'ask',name});
  await page.evaluate(n=>window.__speak(n),name);
  log.push({t:now(),event:'asked',name});
  const cut=plan[index+1]?.after;
  await watch(name,cut?{maxMs:cut,minMs:cut,quietMs:cut}:{maxMs:index===plan.length-1&&plan[index].after?150000:110000});
}
const final=await sample();
log.push({t:now(),event:'final',timeline:final.timeline,rows:final.rows.map(r=>({role:r.role,doc:r.doc,text:r.text})),board:final.board,errors:[...new Set(errors)]});
await page.screenshot({path:`${out}/final.png`});
await page.click('#stop').catch(()=>{});await page.waitForTimeout(2500);
log.push({t:now(),event:'hung-up',state:await page.evaluate(()=>document.body.dataset.callState)});
fs.writeFileSync(`${out}/log.json`,JSON.stringify(log,null,1));
await browser.close();
console.log('done',now(),'ms');
