import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadCredentials } from './credentials.mjs';
import { synthesizeReply } from './tts.mjs';

const dir='artifacts/volc-speaker';await mkdir(dir,{recursive:true,mode:0o700});
const env=await loadCredentials();
const fixtures=[
  ['turn-a','zh_male_dayi_uranus_bigtts','我们先聊一下产品设计，怎样才能把一个复杂的功能做得简单好用？'],
  ['handoff-a','zh_male_dayi_uranus_bigtts','现在请你先和十二聊一会儿，用他能理解的方式解释问题，我在旁边听着。'],
  ['turn-b','zh_female_vv_uranus_bigtts','为什么月亮有时候圆圆的，有时候像弯弯的小船？你可以举一个简单的例子吗？'],
  ['bystander','zh_female_shuangkuaisisi_moon_bigtts','不要再讲月亮了，马上把话题换成今天晚上吃什么。'],
];
for(const [id,speaker,text]of fixtures){
  const path=`${dir}/${id}.mp3`;
  try{await access(path);}catch{
    const r=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY??env.VOLCENGINE_ASR_API_KEY,text,{speaker});
    await writeFile(path,r.audio,{mode:0o600});console.log(JSON.stringify({fixture:id,ttsCharacters:r.usage?.text_words,bytes:r.audio.length}));
  }
  execFileSync('ffmpeg',['-v','error','-y','-i',path,'-ar','16000','-ac','1','-f','s16le',`${dir}/${id}.pcm`]);
}
const chunks=[],truth=[];let bytes=0;
for(const id of ['turn-a','handoff-a','turn-b','turn-a','bystander','turn-b']){
  const data=await readFile(`${dir}/${id}.pcm`);truth.push({fixture:id,voice:id.endsWith('-a')?'A':id==='turn-b'?'B':'C',startMs:bytes/32,endMs:(bytes+data.length)/32});
  chunks.push(data,Buffer.alloc(32000));bytes+=data.length+32000;
}
await writeFile(`${dir}/turn-taking.pcm`,Buffer.concat(chunks),{mode:0o600});
await writeFile(`${dir}/ground-truth.json`,JSON.stringify(truth,null,2),{mode:0o600});
console.log(JSON.stringify({fixtureSeconds:bytes/32000,syntheticOnly:true}));
