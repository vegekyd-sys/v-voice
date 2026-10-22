import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {synthesizeReply} from '../volc-speaker/tts.mjs';
const dir=new URL('../../artifacts/speaker-native/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE??process.env.VOLC_SPEAKER_ENV_FILE);
const clips=[
  ['ask-v2','A','V，天空为什么是蓝色的？请用一句话回答。'],
  ['intro','A','我叫天懿，是十二的爸爸。'],
  ['child','B','我叫十二，是天懿的孩子。V，月亮为什么有时候是弯弯的？'],
  ['side','A','十二，把抽屉里的杯子递给我。'],
  ['collective','A','V，分别给我和十二一个建议，怎么一起做一个简单的小游戏？'],
  ['focus','A','V，接下来只跟十二聊，其他人说话不用回答。'],
  ['bystander','A','我觉得刚才那个方法挺有意思的。'],
  ['child-question','B','V，我是十二。可以给我讲一个月亮的小故事吗？'],
  ['free','B','V，解除专注，大家可以一起聊了。'],
  ['tv','C','各位观众朋友，欢迎收看晚间新闻，广告之后马上回来。'],
];
for(const [id,voice,text] of clips){
  const target=new URL(id+'.mp3',dir);try{await access(target);}catch{const r=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY,text,{speaker:voice==='A'?'zh_male_dayi_uranus_bigtts':voice==='B'?'zh_female_vv_uranus_bigtts':'zh_male_shaonianzixin_uranus_bigtts'});await writeFile(target,r.audio,{mode:0o600});}
  execFileSync('ffmpeg',['-v','error','-y','-i',target.pathname,'-ar','16000','-ac','1','-f','s16le',new URL(id+'.pcm',dir).pathname]);
}
const scenarios={question:['ask-v2'],dialogue:['intro','child','side','collective','focus','bystander','child-question'],side:['side'],collective:['collective'],steady:['intro','ask-v2','ask-v2','ask-v2']},manifest={syntheticOnly:true,scenarios:{}};
for(const [name,ids] of Object.entries(scenarios)){
  const parts=[],turns=[];let bytes=0;
  for(const id of ids){const pcm=await readFile(new URL(id+'.pcm',dir)),spec=clips.find(c=>c[0]===id);turns.push({id,voice:spec[1],text:spec[2],startMs:bytes/32,endMs:(bytes+pcm.length)/32});parts.push(pcm,Buffer.alloc(32*(name==='steady'?20000:ids.length===1?2500:12000)));bytes+=pcm.length+parts.at(-1).length;}
  const pcm=Buffer.concat(parts);await writeFile(new URL(name+'-sequence.pcm',dir),pcm,{mode:0o600});
  execFileSync('ffmpeg',['-v','error','-y','-f','s16le','-ar','16000','-ac','1','-i',new URL(name+'-sequence.pcm',dir).pathname,new URL(name+'.wav',dir).pathname]);manifest.scenarios[name]={durationMs:pcm.length/32,turns};
}
await writeFile(new URL('fixtures.json',dir),JSON.stringify(manifest,null,2),{mode:0o600});console.log('Synthetic comparison corpus ready.');
