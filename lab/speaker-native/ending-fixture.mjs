import {readFile,writeFile,access,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {synthesizeReply} from '../volc-speaker/tts.mjs';
const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE),root=new URL('../../artifacts/speaker-native/',import.meta.url);
const clips=[['end-bye','好，那就这样吧，拜拜。'],['end-no','V，不要挂断，我们继续聊，三加四等于几？只回答数字。'],['end-other','十二，我是跟你说拜拜，我继续跟V聊天。'],['end-quote','V，刚才他对我说拜拜，这是什么意思？'],['end-more','V，谢谢，拜拜。对了，五加六等于几？只回答数字。']];
for(const[id,text]of clips){const mp3=new URL(id+'.mp3',root);try{await access(mp3);}catch{const result=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY,text,{speaker:'zh_male_dayi_uranus_bigtts'});await writeFile(mp3,result.audio,{mode:0o600});}execFileSync('ffmpeg',['-v','error','-y','-i',mp3.pathname,'-ar','16000','-ac','1','-f','s16le',new URL(id+'.pcm',root).pathname]);await chmod(new URL(id+'.pcm',root),0o600);}
const clipsWithGaps=[['bg-warm-a',8000],['bg-warm-b',10000],['end-no',10000],['end-other',10000],['end-more',10000],['end-bye',16000]],parts=[];let size=0;const turns=[];
for(const[id,gap]of clipsWithGaps){const pcm=await readFile(new URL(id+'.pcm',root));turns.push({id,startMs:size/32,endMs:(size+pcm.length)/32});parts.push(pcm,Buffer.alloc(gap*32));size+=pcm.length+gap*32;}
await writeFile(new URL('ending-sequence.pcm',root),Buffer.concat(parts),{mode:0o600});execFileSync('ffmpeg',['-v','error','-y','-f','s16le','-ar','16000','-ac','1','-i',new URL('ending-sequence.pcm',root).pathname,new URL('ending.wav',root).pathname]);await chmod(new URL('ending.wav',root),0o600);console.log(JSON.stringify({syntheticOnly:true,durationMs:size/32,turns}));
