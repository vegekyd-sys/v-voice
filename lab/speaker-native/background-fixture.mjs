import {readFile,writeFile,access,chmod} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {loadCredentials} from '../volc-speaker/credentials.mjs';import {synthesizeReply} from '../volc-speaker/tts.mjs';
const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE),dir=new URL('../../artifacts/speaker-native/',import.meta.url);
const clips=[['bg-warm-a','V，我叫天意，是十二的爸爸。你好。'],['bg-warm-b','V，我叫十二，是天意的孩子。你好。'],['bg-request','V，请把设计七天亲子科学游戏计划交给后台处理，每天不同。让后台做，我们继续聊。'],['bg-switch-one','V，三加四等于几？只回答数字。'],['bg-switch-two','V，继续聊，五加六等于几？只回答数字。'],['bg-switch-three','V，现在八加九等于几？只回答数字。']];
for(const[id,text]of clips){const file=new URL(id+'.mp3',dir);try{await access(file);}catch{const r=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY,text,{speaker:['bg-warm-b','bg-switch-one','bg-switch-three'].includes(id)?'zh_female_vv_uranus_bigtts':'zh_male_dayi_uranus_bigtts'});await writeFile(file,r.audio,{mode:0o600});}execFileSync('ffmpeg',['-v','error','-y','-i',file.pathname,'-ar','16000','-ac','1','-f','s16le',new URL(id+'.pcm',dir).pathname]);await chmod(new URL(id+'.pcm',dir),0o600);}
console.log('Background conversation synthetic clips ready');
