// Manual, paid Decision verification; never runs as part of npm test.
// Synthetic text only, not a substitute for microphone or real-phone acceptance.
import {writeFile} from 'node:fs/promises';
import {loadCredentials} from '../volc-speaker/credentials.mjs';
import {SpeakerRouter,decisionEvaluator} from './decision.mjs';

const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE);
const router=new SpeakerRouter({surface:'phone',evaluate:decisionEvaluator(env)});
await router.accept({speakerId:'0',text:'查一下今天已经结束的比赛。',startMs:0,endMs:2000});
router.assistant('我查到今天已经结束的两场比赛，主队都输了。');
const cases=[
 ['remark','0','这个结果还挺让人意外的。',true],
 ['reaction','0','怎么会这样呢，这不太对吧。',true],
 ['follow-topic','0','我还以为他们这次能赢呢。',true],
 ['task-context','0','那之前结束的几场，你再看一下。',true],
 ['task-completion','0','那些球星的比赛数据。',true],
 ['task-correction','0','不是，是让你把每个人的数据都查出来。',true],
 ['side','1','小明，把桌上的杯子递给我。',false],
 ['resume','0','然后给我整理成一个表。',true],
 ['ack','0','嗯。',false],
 ['tv','1','欢迎收看本期节目，广告之后马上回来。',false],
];
const rows=[];
for(const [id,speakerId,text,expected]of cases){
 const result=await router.accept({speakerId,text,startMs:0,endMs:2000});
 const row={id,expected,actual:result.shouldRespond,passed:result.shouldRespond===expected,admission:result.admission,decisionMs:result.decisionMs};
 rows.push(row);console.log(JSON.stringify(row));
 if(result.shouldRespond)router.assistant('我在听，你继续说。');
}
const report={syntheticTextOnly:true,passed:rows.every(r=>r.passed),rows};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n',{mode:0o600});
if(!report.passed)process.exitCode=1;
