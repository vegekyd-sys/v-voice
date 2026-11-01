// Real-API overlap probe: identical synthetic caller audio, paced in real time, one
// session per run. Records what each model emits while the caller is still talking.
// node probe.mjs <seeduplex|grok|qwen> <scene> <prompt:base|backchannel> <run> <stimuli> <out>
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {buildSeeduplexSession} from '../../../lab/seeduplex-realtime-provider.mjs';
import {V_FRONTEND_PERSONA} from '../../../lab/gpt-live-h5/persona.mjs';
import {V_ONE_VOICE_POLICY} from '../../../lab/gpt-live-h5/one-voice-policy.mjs';
import {NATIVE_DUPLEX_POLICY} from '../../../lab/realtime-direct-tools/native-duplex-policy.mjs';
import {TOOLS} from '../../../lab/realtime-direct-tools/tools.mjs';
import {VOICE_TASK_ROUTING} from '../../../lab/realtime-direct-tools/session.mjs';
import {SCENES,BACKCHANNEL_PROMPT,LISTEN_PROMPT} from './stimuli.mjs';
const [model,scene,prompt,run,stimuli,out]=process.argv.slice(2);
const tools=TOOLS.filter(t=>['current_time','delegate_to_v','web_search','memory_search'].includes(t.name));
const instructions=`${V_FRONTEND_PERSONA}\n\n${V_ONE_VOICE_POLICY}\n\n你是 V，正在和对方打电话。\n${VOICE_TASK_ROUTING}\n${NATIVE_DUPLEX_POLICY}${prompt==='backchannel'?BACKCHANNEL_PROMPT:prompt==='listen'?LISTEN_PROMPT:''}`;
const log=[],spans=[],now=()=>Date.now();let t0=0,first=null;
const t=()=>t0?now()-t0:-1,row=(type,x={})=>log.push({t:t(),type,...x});
const wsOf={
  seeduplex:()=>new WebSocket('wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue',{headers:{'X-Api-Key':process.env.VOLCENGINE_REALTIME_API_KEY,'X-Api-Resource-Id':'volc.speech.dialog','X-Api-Connect-Id':randomUUID()}}),
  grok:()=>new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-3.0',{headers:{Authorization:'Bearer '+process.env.XAI_API_KEY}}),
  qwen:()=>new WebSocket(`wss://${process.env.DASHSCOPE_API_HOST}/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime`,{headers:{Authorization:'Bearer '+process.env.DASHSCOPE_API_KEY}}),
};
const ws=wsOf[model](),send=e=>ws.readyState===1&&ws.send(JSON.stringify({event_id:'event_'+randomUUID(),...e}));
const toolResult=(id,name)=>name==='current_time'?{now:new Date().toISOString()}:name==='delegate_to_v'?{accepted:true,status:'working',instruction:'只用一句极短的话自然回应，不提后台。'}:{results:['测试环境：没有结果']};
const ready=new Promise((resolve,reject)=>{
  ws.on('error',reject);ws.on('unexpected-response',(_,r)=>reject(Error('http '+r.statusCode)));
  ws.on('open',()=>{
    if(model==='seeduplex')send(buildSeeduplexSession({voice:'xiaohe',model:'1.2.6.1'},{instructions,tools,language:'zh-CN'}));
    if(model==='grok')send({type:'session.update',session:{voice:'eve',instructions,reasoning:{effort:'high'},audio:{input:{format:{type:'audio/pcm',rate:16000},transcription:{language_hint:'zh'}},output:{format:{type:'audio/pcm',rate:24000}}},turn_detection:{type:'server_vad'},tools}});
  });
  ws.on('message',d=>{const e=JSON.parse(d.toString()),ty=e.type,rid=e.response_id??e.response?.id;
    if(ty==='session.created'&&model==='qwen')send({type:'session.update',session:{modalities:['text','audio'],instructions,audio:{input:{format:{type:'pcm',sample_rate:16000,sample_format:'s16le',channels:1,packing:'interleaved',channel_layout:'mono'}},output:{voice:'Serena',format:{type:'pcm',sample_rate:24000}}},turn_detection:{type:'semantic_vad_ec',threshold:0.5,silence_duration_ms:800},input_audio_transcription:{model:'qwen3-asr-flash-realtime'},max_tokens:1536,enable_search:false,tools:tools.map(({type,...f})=>({type:'function',function:f}))}});
    if(model==='seeduplex'?ty==='session.created':ty==='session.updated')resolve();
    if(ty==='error'){row('error',{code:e.error?.code??e.code,message:String(e.error?.message??e.message??'').slice(0,160)});}
    if(/audio\.delta$/.test(ty)&&e.delta){const bytes=Buffer.from(e.delta,'base64').length;row('audio',{rid,ms:Math.round(bytes/(model==='seeduplex'?4:2)/24)});first??=now();return;}
    if(/output_text\.delta$|transcript\.delta$/.test(ty)&&!/input_audio/.test(ty)){row('text',{rid,delta:e.delta});return;}
    if(/output_text\.done$|audio_transcript\.done$/.test(ty))row('text.done',{rid,text:e.text??e.transcript});
    if(/input_audio_transcription\.(started|completed|failed)$/.test(ty))row(ty.replace('conversation.item.',''),{text:e.transcript??e.text});
    if(/speech_(started|stopped)$|^response\.(created|done|canceled|cancelled)$|output_audio\.(started|done)$/.test(ty))row(ty,{rid,tts:e.tts_type});
    if(ty==='response.function_call_arguments.done'){
      const items=e.items??[{call_id:e.call_id,name:e.name,arguments:e.arguments}];
      for(const c of items){row('tool',{name:c.name,args:String(c.arguments).slice(0,200)});
        const output=JSON.stringify(toolResult(c.call_id,c.name));
        if(model==='seeduplex')send({type:'conversation.item.create',items:[{call_id:c.call_id,role:'tool',content:[{type:'input_text',text:output}]}]});
      }
      if(model!=='seeduplex')pendingTools.push(...items.map(c=>({c,output:JSON.stringify(toolResult(c.call_id,c.name))})));
    }
    if(ty==='response.done'&&pendingTools.length){for(const {c,output} of pendingTools.splice(0))send({type:'conversation.item.create',item:{type:'function_call_output',call_id:c.call_id,output}});send({type:'response.create'});}
  });
});
const pendingTools=[];
const frame=model==='seeduplex'?640:640;let next=0;
const pace=()=>{next=Math.max(next+20,now());return new Promise(r=>setTimeout(r,Math.max(0,next-now())));};
const silence=async ms=>{const z=Buffer.alloc(frame);for(let i=0;i<ms/20;i++){send({type:'input_audio_buffer.append',audio:z.toString('base64')});await pace();}};
const speak=async(name,i,text)=>{const pcm=await readFile(`${stimuli}/${name}-${i}.pcm`);const start=t();for(let o=0;o<pcm.length;o+=frame){let f=pcm.subarray(o,o+frame);if(f.length<frame)f=Buffer.concat([f,Buffer.alloc(frame-f.length)]);send({type:'input_audio_buffer.append',audio:f.toString('base64')});await pace();}spans.push({start,end:t(),text,scene:name});};
const scene_=async name=>{const {clauses,gaps}=SCENES[name];for(let i=0;i<clauses.length;i++){await speak(name,i,clauses[i]);if(i<clauses.length-1)await silence(gaps[i]);}};
await Promise.race([ready,new Promise((_,j)=>setTimeout(()=>j(Error('setup timeout')),20000))]);
t0=now();next=now();
await silence(1000);
if(scene==='interrupt'){
  await scene_('story');
  const deadline=now()+15000;while(!first&&now()<deadline)await silence(100);
  await silence(5000);row('mark',{name:'ack'});await scene_('ack');await silence(4000);row('mark',{name:'ack2'});await scene_('ack2');await silence(4000);row('mark',{name:'stop'});await scene_('stop');await silence(9000);
}else{await scene_(scene);await silence(['delegate','tool'].includes(scene)?9000:10000);}
const total=t();
if(model==='seeduplex'){send({type:'session.close'});}
ws.close();
await mkdir(out,{recursive:true});
await writeFile(`${out}/${model}-${scene}-${prompt}-${run}.json`,JSON.stringify({model,scene,prompt,run,total,spans,log}));
console.log(JSON.stringify({model,scene,prompt,run,done:true}));process.exit(0);
