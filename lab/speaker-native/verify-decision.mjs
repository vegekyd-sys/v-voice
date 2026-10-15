import {readFile,writeFile}from 'node:fs/promises';import {loadCredentials}from '../volc-speaker/credentials.mjs';import{SpeakerRouter,decisionEvaluator}from './decision.mjs';
const env=await loadCredentials(process.env.VOICE_CREDENTIAL_ENV_FILE??process.env.VOLC_SPEAKER_ENV_FILE),rows=[],traces=[];
const c=new SpeakerRouter({evaluate:decisionEvaluator(env),onTrace:trace=>traces.push(trace)});
const cases=[
 ['intro','0','我叫天意，是十二的爸爸。',r=>r.participants[0].name==='天意'&&r.participants[0].certainty==='stated'],
 ['child','1','我叫十二，是天意的孩子。V，月亮为什么有时候是弯弯的？',r=>r.shouldRespond&&r.addresseeIds.join()==='speaker:1'&&r.participants[1].name==='十二'],
 ['split-child-question','1','问月亮为什么有时候是弯弯的？',r=>r.shouldRespond&&r.addresseeIds.join()==='speaker:1'],
 ['side','0','十二，把抽屉里的杯子递给我。',r=>!r.shouldRespond],
 ['collective','0','V，分别给我和十二一个建议，怎么一起做一个简单的小游戏？',r=>r.shouldRespond&&r.addresseeIds.length===2],
 ['focus','0','V，接下来只跟十二聊，其他人说话不用回答。',r=>r.mode==='exclusive'&&r.targetId==='speaker:1'],
 ['filtered','0','我觉得刚才那个方法挺有意思的。',r=>!r.modelCalled&&!r.shouldRespond],
 ['child-question','1','V，我是十二。可以给我讲一个月亮的小故事吗？',r=>r.shouldRespond&&r.addresseeIds.join()==='speaker:1'],
 ['free','1','V，解除专注，大家可以一起聊了。',r=>r.mode==='auto'],
 ['tv','2','各位观众朋友，欢迎收看晚间新闻，广告之后马上回来。',r=>!r.shouldRespond],
];
for(const[id,speakerId,text,check]of cases){try{const r=await c.accept({speakerId,text,startMs:0,endMs:1000});const row={id,passed:check(r),result:r};rows.push(row);console.log(JSON.stringify({id,passed:row.passed,ms:r.decisionMs,to:r.addresseeIds,mode:r.mode}));}catch(e){rows.push({id,passed:false,error:e.message});console.log(JSON.stringify({id,passed:false,error:e.message}));}}
try{const anonymous=new SpeakerRouter({evaluate:decisionEvaluator(env),onTrace:t=>traces.push(t)});const a=await anonymous.accept({speakerId:'0',text:'问天空为什么是蓝色的？请一句话回答。',startMs:0,endMs:3500});rows.push({id:'anonymous-question',passed:a.shouldRespond&&a.addresseeIds.join()==='speaker:0',result:a});}catch(e){rows.push({id:'anonymous-question',passed:false,error:e.message});}
const report={passed:rows.every(r=>r.passed),textOnly:true,rows,traces,costUSD:traces.reduce((n,t)=>n+(t.raw.usage?.cost??0),0)};
await writeFile(new URL('../../artifacts/speaker-native/decision-verification.json',import.meta.url),JSON.stringify(report,null,2),{mode:0o600});if(!report.passed)process.exitCode=1;
