// `--prepare` generates public synthetic fixtures with local macOS voices.
// Run again with FISH_API_KEY to exercise the exact realtime endpoint. There is
// no microphone, Gateway, alternate ASR, baseline or automatic paid retry.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {WebSocket} from 'ws';
import {FishAsrStream} from '../../lab/realtime-direct-tools/fish-asr.mjs';
import {fishBudgetFromFile} from '../../lab/realtime-direct-tools/fish-provider.mjs';

const root=resolve(process.env.FISH_TEST_OUTPUT??'artifacts/fish-stt-private');
await mkdir(root,{recursive:true,mode:0o700});
const cases=[
  {id:'chinese',text:'请把会议安排在下周三下午三点。'},
  {id:'mixed',text:'请帮我 review Makaron 的 API latency，然后整理一个 summary。'},
  {id:'short-pause',text:'我想把会议安排在 [[slnc 350]] 下周三下午三点。'},
  {id:'long-pause',text:'我想把会议安排在 [[slnc 1800]] 下周三下午三点。'},
  {id:'self-correction',text:'会议定在明天下午三点，不对，是后天下午四点，请以最后这个时间为准。'},
  {id:'continuous',text:'我先把整个想法说完，请听到最后。第一步先确认接口是否支持中文，第二步测量短暂停顿和长暂停顿，第三步记录最终转写与首个语音包的时间，最后再讨论怎样接入现有服务。'},
  {id:'backchannel',text:'嗯，对。',agentSpeaking:true},
  {id:'interruption',text:'等一下，先别说了，我改成下午四点。',agentSpeaking:true},
];
const clean=text=>text.replace(/\[\[.*?\]\]/g,'').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
function distance(a,b){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1)));row=next;}return row[b.length];}
if(process.argv.includes('--prepare')){
  if(process.platform!=='darwin')throw Error('本地语音素材生成需要 macOS say；也可使用现有获准的合成 PCM');
  for(const c of cases){
    const aiff=join(root,c.id+'.aiff'),pcm=join(root,c.id+'.pcm');
    execFileSync('say',['-v','Tingting','-r','175','-o',aiff,c.text],{stdio:'ignore'});
    execFileSync('ffmpeg',['-v','error','-y','-i',aiff,'-ar','16000','-ac','1','-f','s16le',pcm],{stdio:'ignore'});
    const bytes=await readFile(pcm);c.durationMs=bytes.length/32;
  }
  await writeFile(join(root,'fixtures.json'),JSON.stringify({source:'macOS local synthetic voice, no microphone',cases},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({prepared:cases.length,root,paidCalls:0}));process.exit(0);
}
if(!process.env.FISH_API_KEY){console.log(JSON.stringify({status:'blocked-missing-FISH_API_KEY',paidCalls:0,fixtures:join(root,'fixtures.json')}));process.exitCode=2;}
else {
  const budget=fishBudgetFromFile(join(root,'budget.json')),results=[];
  for(const c of cases){
    const pcm=await readFile(join(root,c.id+'.pcm'));if(pcm.length>32*45000)throw Error('单份素材超过45秒');
    budget.reserve(0.0196);const events=[];let finished,timeout;
    const done=new Promise(r=>{finished=r;});let began;
    const stream=new FishAsrStream({apiKey:process.env.FISH_API_KEY,sampleRate:16000,createWebSocket:async(u,o)=>new WebSocket(u,o),onEvent:e=>{events.push({...e,receivedMs:Math.round(performance.now()-began)});if(e.type==='session_done')finished();},onError:e=>{events.push({type:'client_error',message:e.message});finished();}});
    try{
      began=performance.now();await stream.connect();stream.agentSpeaking(c.agentSpeaking===true);began=performance.now();
      // Trailing six seconds expose natural endpointing before audio_done.
      const input=Buffer.concat([pcm,Buffer.alloc(32000*6)]);
      for(let offset=0;offset<input.length&&!stream.closed;offset+=3200){stream.append(input.subarray(offset,offset+3200));await new Promise(r=>setTimeout(r,Math.max(0,(offset+3200)/32-(performance.now()-began))));}
      const beforeFinish=events.filter(e=>e.type==='committed').length;stream.finish();
      await Promise.race([done,new Promise(r=>{timeout=setTimeout(r,12000);})]);
      const commits=events.filter(e=>e.type==='committed'),text=commits.map(e=>e.text).join(''),drafts=events.filter(e=>e.type==='draft');
      results.push({id:c.id,status:events.some(e=>e.type==='session_done')&&commits.length&&!events.some(e=>e.type==='client_error')?'api-tested':'failed',source:'synthetic-file-paced-realtime',expected:c.text,agentSpeaking:c.agentSpeaking===true,agentAudioPlayed:false,
        commitsBeforeAudioDone:beforeFinish,commits:commits.length,characterErrorRate:distance(clean(c.text),clean(text))/Math.max(1,clean(c.text).length),firstPartialMs:drafts[0]?.receivedMs,
        firstEagerMs:events.find(e=>e.type==='eager_end_of_turn')?.receivedMs,
        finalAfterFileEndMs:commits.at(-1)?.receivedMs-pcm.length/32,
        endpointReference:'end of synthetic PCM file, not human annotated speech end',
        revisions:drafts.slice(1).filter((e,i)=>e.turn_index===drafts[i].turn_index&&!e.text.startsWith(drafts[i].text)).length,events});
    }catch(e){results.push({id:c.id,status:'failed',error:e.message,events});}
    finally{clearTimeout(timeout);stream.close();}
    // No retry, no concurrency saturation against a shared provider account.
  }
  const report={at:new Date().toISOString(),model:'transcribe-stream-1',results,budgetConservativeReservedUsd:budget.reservedUsd,billedSpendVerified:false,physicalAudioAccepted:false};
  await writeFile(join(root,'fish-evaluation.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({cases:results.length,report:join(root,'fish-evaluation.json'),budgetConservativeReservedUsd:budget.reservedUsd}));
}
