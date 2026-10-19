import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {synthesizeReply} from '../volc-speaker/tts.mjs';
const dir='artifacts/volc-speaker/auto';await mkdir(dir,{recursive:true,mode:0o700});
const env=await loadCredentials();
const fixtures=[
 ['intro-a','zh_male_dayi_uranus_bigtts','你好，我叫天意，是十二的爸爸。我们先聊聊产品设计，怎么把复杂的功能做简单？','A'],
 ['guess-b','zh_female_vv_uranus_bigtts','爸爸，我也想问，月亮为什么会变成弯弯的小船？','B'],
 ['ask-a','zh_male_dayi_uranus_bigtts','你先跟他介绍一下自己吧，然后再问月亮的问题。','A'],
 ['intro-b','zh_female_vv_uranus_bigtts','我叫十二，是刚才提到的孩子。你可以用简单的例子解释月亮吗？','B'],
 ['focus-a','zh_male_dayi_uranus_bigtts','接下来请你只和十二聊天，用适合孩子的方式讲月亮，我在旁边听。','A'],
];
for(const [id,speaker,text]of fixtures){
 const path=`${dir}/${id}.mp3`;try{await access(path);}catch{const r=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY??env.VOLCENGINE_ASR_API_KEY,text,{speaker});await writeFile(path,r.audio,{mode:0o600});console.log(JSON.stringify({fixture:id,bytes:r.audio.length}));}
 execFileSync('ffmpeg',['-v','error','-y','-i',path,'-ar','16000','-ac','1','-f','s16le',`${dir}/${id}.pcm`]);
}
const turns=[...fixtures.map(([id,,,voice])=>({id,voice,path:`${dir}/${id}.pcm`})),
 {id:'filtered-a',voice:'A',path:'artifacts/volc-speaker/turn-a.pcm'},
 {id:'filtered-c',voice:'C',path:'artifacts/volc-speaker/bystander.pcm'},
 {id:'reply-b',voice:'B',path:'artifacts/volc-speaker/turn-b.pcm'}];
const chunks=[],truth=[];let bytes=0;
for(const turn of turns){const pcm=await readFile(turn.path);truth.push({...turn,startMs:bytes/32,endMs:(bytes+pcm.length)/32});chunks.push(pcm,Buffer.alloc(64000));bytes+=pcm.length+64000;}
await writeFile(`${dir}/turn-taking.pcm`,Buffer.concat(chunks),{mode:0o600});await writeFile(`${dir}/ground-truth.json`,JSON.stringify(truth,null,2),{mode:0o600});
console.log(JSON.stringify({syntheticOnly:true,seconds:bytes/32000,turns:turns.length,noIdentityPrebinding:true}));
// A short identical input that makes the two multiparty policies observable.
const commentPath=`${dir}/mode-comment-v2.mp3`;
try{await access(commentPath);}catch{const r=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY??env.VOLCENGINE_ASR_API_KEY,'我觉得先把入口做简单一点就好了，常用功能放在外面，不常用的藏起来，这样大家就更容易找到。',{speaker:'zh_female_vv_uranus_bigtts'});await writeFile(commentPath,r.audio,{mode:0o600});}
execFileSync('ffmpeg',['-v','error','-y','-i',commentPath,'-ar','16000','-ac','1','-f','s16le',`${dir}/mode-comment.pcm`]);
await writeFile(`${dir}/mode-comparison.pcm`,Buffer.concat([await readFile(`${dir}/intro-a.pcm`),Buffer.alloc(64000),await readFile(`${dir}/mode-comment.pcm`),Buffer.alloc(64000)]),{mode:0o600});
