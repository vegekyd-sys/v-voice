#!/usr/bin/env node
// Authorized synthetic TTS corpus. Credentials remain in the host environment.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.env.VOICE_EVAL_ROOT??new URL('..',import.meta.url).pathname);
const {synthesizeReply}=await import(process.env.VOICE_EVAL_TTS_MODULE??pathToFileURL(join(root,'lab/volc-speaker/tts.mjs')));
const {createEmbeddingWorker}=await import(pathToFileURL(join(root,'lab/speaker-native/online-speaker.mjs')));
const directory=process.argv[2];if(!directory)throw Error('Usage: voice-three-tier-fixtures.mjs OUTPUT_DIRECTORY');
await mkdir(directory,{recursive:true,mode:0o700});
const hash=x=>createHash('sha256').update(x).digest('hex');
const voices={low:'zh_male_gaolengchenwen_uranus_bigtts',child:'zh_female_xiaoxue_uranus_bigtts',adult:'zh_male_dayi_uranus_bigtts',vv:'zh_female_vv_uranus_bigtts',clear:'zh_female_qingxinnvsheng_uranus_bigtts',tv:'zh_male_liufei_uranus_bigtts'};
const pairs={obvious:['low','child'],daily:['adult','vv'],near:['vv','clear']};
const texts={
 calibration1:'今天下午我们准备出门散步，先到公园看看树叶，再找一个安静的地方坐下来聊天。',
 calibration2:'我希望周末过得轻松一些，可以带上水和水果，按照自己的节奏慢慢走，不用着急。',
 introA:'你好，我叫小林。我喜欢紫色，周末想去爬山。请记住我的声音和喜好，简单确认就好。',
 introB:'你好，我叫小周。我喜欢绿色，周末想去海边。请记住我的声音和喜好，简单确认就好。',
 identity:'现在说话的是谁？请只说我的名字。',
 preference:'我喜欢什么颜色？请只说颜色。',
 natural:'请给我一个适合我周末计划的建议，先叫我的名字，只说一句话。',
 side:'小林，把桌上的杯子递给我，你先别走，我马上回来。',
 news:'观众朋友们，欢迎收看今天的天气资讯。本周末北方多地天气晴朗，南方部分地区将迎来降雨。出行请留意气温变化。接下来是体育消息。',
 drama:'等一下，先停！你把这份文件放下，先别走。今天这件事情，我们一定要说清楚。',
};
const key=process.env.VOLCENGINE_TTS_API_KEY??process.env.DOUBAO_SPEECH_API_KEY??process.env.VOLCENGINE_REALTIME_API_KEY;
if(!key)throw Error('TTS credential unavailable');
let receipts=[];const receiptPath=join(directory,'tts-usage.json');if(existsSync(receiptPath))receipts=JSON.parse(await readFile(receiptPath,'utf8'));
const assets={};
for(const [voice,speaker] of Object.entries(voices)){
 const kinds=voice==='tv'?['news','drama']:['calibration1','calibration2','introA','introB','identity','preference','natural',...(voice==='vv'?['side']:[])];
 for(const kind of kinds){
  const id=voice+'-'+kind,mp3=join(directory,id+'.mp3'),file=id+'.pcm',pcm=join(directory,file);
  if(!existsSync(mp3)){
   const response=await synthesizeReply(key,texts[kind],{speaker});await writeFile(mp3,response.audio,{mode:0o600});
   receipts.push({id,speaker,characters:texts[kind].length,usage:response.usage,mp3Sha256:hash(response.audio)});await writeFile(receiptPath,JSON.stringify(receipts,null,2),{mode:0o600});
  }
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',mp3,'-ar','16000','-ac','1','-f','s16le',pcm]);
  const raw=await readFile(pcm);let sum=0;for(let i=0;i<raw.length;i+=2)sum+=(raw.readInt16LE(i)/32768)**2;
  const gain=.07/Math.max(.0001,Math.sqrt(sum/(raw.length/2)));let peak=0;
  for(let i=0;i<raw.length;i+=2)peak=Math.max(peak,Math.abs(raw.readInt16LE(i)/32768)*gain);
  const scale=gain*Math.min(1,.92/Math.max(.92,peak));
  for(let i=0;i<raw.length;i+=2)raw.writeInt16LE(Math.round(raw.readInt16LE(i)*scale),i);
  await writeFile(pcm,raw,{mode:0o600});assets[id]={voice,speaker,kind,text:texts[kind],file,bytes:raw.length,durationMs:raw.length/32,sha256:hash(raw),normalizationGain:scale};
  console.log(JSON.stringify({stage:'tts',id,seconds:Number((raw.length/32000).toFixed(2))}));
 }
}
const worker=createEmbeddingWorker({python:process.env.VOICE_SPEAKER_PYTHON,model:process.env.VOICE_SPEAKER_MODEL});
const embeddings={},calibration={pairs:{},withinVoice:{}};
try{
 await worker.ready;
 for(const voice of Object.keys(voices).filter(v=>v!=='tv')){
  embeddings[voice]=[];
  for(const kind of ['calibration1','calibration2']){const pcm=await readFile(join(directory,assets[voice+'-'+kind].file));embeddings[voice].push((await worker.compute(pcm.subarray(0,128000))).embedding);}
  calibration.withinVoice[voice]=embeddings[voice][0].reduce((sum,x,i)=>sum+x*embeddings[voice][1][i],0);
 }
 for(const [tier,[a,b]] of Object.entries(pairs)){const scores=embeddings[a].flatMap(x=>embeddings[b].map(y=>x.reduce((n,v,i)=>n+v*y[i],0)));calibration.pairs[tier]={voices:[a,b],cosineMean:scores.reduce((x,y)=>x+y,0)/scores.length,cosineRange:[Math.min(...scores),Math.max(...scores)]};}
}finally{worker.close();}
// Pair names are declared before outcomes. Embedding distances describe this
// corpus; they are not human perceptual proof and favor neither reply scorer.
const study={schema:'voice-three-tier-tts-v1',synthetic:true,sampleRate:16000,voices,pairs,assets,calibration,cases:[],
 instructions:'本次是合成双人聊天测试，入口称呼不代表当前说话人。两位来电者会介绍名字、喜好和周末计划，请结合声音与上下文记住各自信息。之后他们会自然轮流交流，也可能同一人连续说话；不要按提问顺序猜人。名字和代号只在最初音频介绍中提供。有人问自己是谁时只说当前人的名字；问喜好时只回答该人的喜好；普通聊天按最新说话人和内容回答。电视广播、无关旁聊不需要回应，也不能替换正在回答的要求。听不准人物就说明不确定。普通回复最多一句话。本次不需要任何工具、查询、外部发送、委派或挂断。'};
for(const [tier,swapped,environment] of [['daily',false,'clean'],['daily',true,'clean'],['obvious',false,'clean'],['near',false,'clean'],['daily',false,'tv'],['daily',false,'noise-side']]){
 const mapping=swapped?[...pairs[tier]].reverse():pairs[tier];const id=tier+'-'+environment+(swapped?'-swapped':'');
 let cursor=1000;const turns=[];
 const add=(person,kind)=>{const asset=assets[mapping[person==='A'?0:1]+'-'+kind];const startMs=cursor,endMs=startMs+asset.durationMs;turns.push({id:String(turns.length+1),person,kind,voice:asset.voice,text:asset.text,startMs,endMs,file:asset.file,expectedName:person==='A'?'小林':'小周',expectedColor:person==='A'?'紫色':'绿色',expectedTopic:person==='A'?'山':'海'});cursor=endMs+(kind.startsWith('intro')?12000:10000);};
 add('A','introA');add('B','introB');
 for(const [person,kind]of [['A','identity'],['B','identity'],['B','preference'],['A','preference'],['B','natural'],['A','natural'],['A','identity'],['B','identity']])add(person,kind);
 const durationMs=Math.ceil(cursor/20)*20,frames=new Float64Array(Math.ceil(durationMs*16)),noiseWindows=[],nuisance=[];
 const mix=async(asset,startMs,gain=1,endMs)=>{const pcm=await readFile(join(directory,asset.file));const at=Math.round(startMs*16),count=endMs?Math.min(pcm.length/2,Math.round((endMs-startMs)*16)):pcm.length/2;for(let i=0;i<count&&at+i<frames.length;i++)frames[at+i]+=pcm.readInt16LE(i*2)/32768*gain;};
 for(const turn of turns)await mix(assets[turn.voice+'-'+turn.kind],turn.startMs);
 if(environment==='tv'){
  const start=turns[1].endMs+2500,end=durationMs-2500,mid=turns[6].startMs;
  for(let at=start;at<end;){const asset=assets['tv-news'];const gain=at<mid?10**(-10/20):10**(-3/20);await mix(asset,at,gain,Math.min(end,at+asset.durationMs));at+=asset.durationMs;}
  noiseWindows.push({kind:'tv-news',startMs:start,endMs:mid,nominalForegroundSnrDb:10},{kind:'tv-news',startMs:mid,endMs:end,nominalForegroundSnrDb:3});
  const at=turns[5].endMs+2000;await mix(assets['tv-drama'],at,.4);nuisance.push({kind:'tv-stop-dialogue',startMs:at,endMs:at+assets['tv-drama'].durationMs});
 }
 if(environment==='noise-side'){
  const start=turns[1].endMs+2500,end=durationMs-2500,mid=turns[6].startMs;let seed=20261022,filtered=0;const raw=new Float64Array(frames.length);let power=0,n=0;
  for(let i=Math.round(start*16);i<Math.round(end*16);i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;filtered=.94*filtered+.06*((seed/4294967296)*2-1);raw[i]=filtered;power+=filtered*filtered;n++;}
  const rms=Math.sqrt(power/n);for(let i=Math.round(start*16);i<Math.round(end*16);i++)frames[i]+=raw[i]/rms*.07*10**(-(i/16<mid?10:3)/20);
  noiseWindows.push({kind:'filtered-noise',startMs:start,endMs:mid,nominalForegroundSnrDb:10},{kind:'filtered-noise',startMs:mid,endMs:end,nominalForegroundSnrDb:3});
  const at=turns[5].endMs+2000;await mix(assets['vv-side'],at);nuisance.push({kind:'registered-person-side-talk',startMs:at,endMs:at+assets['vv-side'].durationMs});
  for(const at of [turns[3].startMs-1000,turns[7].startMs-800]){for(let i=Math.round(at*16);i<Math.round((at+30)*16);i++)frames[i]+=.35*Math.sin(i*1.71);nuisance.push({kind:'short-impact',startMs:at,endMs:at+30});}
 }
 for(const turn of turns){const source=await readFile(join(directory,turn.file));let foreground=0,background=0;const offset=Math.round(turn.startMs*16);for(let i=0;i<source.length/2;i++){const f=source.readInt16LE(i*2)/32768;foreground+=f*f;background+=(frames[offset+i]-f)**2;}turn.measuredSnrDb=background>1e-12?10*Math.log10(foreground/background):null;}
 let peak=0;for(const x of frames)peak=Math.max(peak,Math.abs(x));const gain=Math.min(1,.98/Math.max(.98,peak)),pcm=Buffer.alloc(frames.length*2);for(let i=0;i<frames.length;i++)pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,frames[i]*gain))*32767),i*2);
 const file=id+'.pcm';await writeFile(join(directory,file),pcm,{mode:0o600});study.cases.push({id,tier,mapping,swapped,environment,durationMs,file,sha256:hash(pcm),mixGain:gain,turns,noiseWindows,nuisance});
}
await writeFile(join(directory,'study.json'),JSON.stringify(study,null,2),{mode:0o600});
console.log(JSON.stringify({stage:'prepared',cases:study.cases.map(c=>({id:c.id,seconds:Math.round(c.durationMs/1000)})),calibration}));
