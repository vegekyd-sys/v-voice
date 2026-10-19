import {writeFile} from 'node:fs/promises';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {SpeakerRouter,decisionEvaluator} from './decision.mjs';
const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE),evaluate=decisionEvaluator(env);
const cases=[['好，那就这样吧，拜拜。',true],['就这样吧，拜拜。',true],['我们就这样吧，拜拜。',true],['V，今天先聊到这里，下次见。',true],['V，不要挂断，我们继续聊。',false],['十二，我是跟你说拜拜，我继续跟V聊天。',false],['V，刚才他说拜拜，这是什么意思？',false],['V，谢谢，拜拜。对了，五加六等于几？',false],['V，你能自动挂断吗？',false],['等后台完成再挂断，现在继续聊。',false],['取消后台任务，但电话别挂。',false],['我们结束这个话题，聊聊恐龙。',false]];
const rows=[];
for(const[text,expected]of cases){const router=new SpeakerRouter({evaluate});const result=await router.accept({speakerId:'local0',text,startMs:0,endMs:2000});const row={text,expected,actual:result.endCall,shouldRespond:result.shouldRespond,passed:result.endCall===expected,decisionMs:result.decisionMs,usage:result.usage};rows.push(row);console.log(JSON.stringify(row));}
await writeFile(new URL('../../artifacts/speaker-native/ending-decisions.private.json',import.meta.url),JSON.stringify(rows,null,2),{mode:0o600});if(rows.some(r=>!r.passed))process.exitCode=1;
