#!/usr/bin/env node
// Explicit, offline candidate preparation. Never called by the web server.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {WebSocket} from 'ws';
import {GROK_EXPRESSIVE_INSTRUCTIONS,inspectGrokSpeechTags} from '../lab/realtime-direct-tools/grok-provider.mjs';
const directory=resolve(process.argv[2]??'');
if(!process.argv[2]||!process.env.XAI_API_KEY||!process.env.VOICE_PREVIOUS_PROMPT)throw Error('Provide output directory, XAI_API_KEY and VOICE_PREVIOUS_PROMPT');
await mkdir(directory,{recursive:true,mode:0o700});
const oldPrompt=await readFile(process.env.VOICE_PREVIOUS_PROMPT,'utf8'),speed=1.06,voice='iris';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalize=text=>text.replace(/[\s\p{P}\p{S}]/gu,'');
const scenes=[
 {id:'chat',title:'轻松聊点子',context:'朋友分享新点子，一起兴致勃勃地讨论。',text:'哎，这个点子挺有意思的！你先别急着把它做大，我们就挑最有趣的那一小块，先试一轮。跑通了，再一起想怎么把它变得更好玩。',manual:'哎，<higher-pitch>这个点子挺有意思的！</higher-pitch>你先别急着把它做大，<soft>我们就挑最有趣的那一小块，先试一轮。</soft>跑通了，再一起想怎么把它变得更好玩。'},
 {id:'story',title:'有悬念的小故事',context:'给小朋友讲故事，从轻声探索到意外，再轻松收尾。',text:'小狐狸踮起脚，悄悄推开了树洞的门。里面黑漆漆的，忽然，角落里亮起一双眼睛！它吓得往后一跳，才发现，原来是小猫抱着两颗会发光的糖。',manual:'<soft>小狐狸踮起脚，悄悄推开了树洞的门。</soft>里面黑漆漆的，忽然，<build-intensity>角落里亮起一双眼睛！</build-intensity>它吓得往后一跳，才发现，<higher-pitch>原来是小猫抱着两颗会发光的糖。</higher-pitch>'},
 {id:'comfort',title:'温暖地陪聊',context:'朋友工作受挫，希望被理解，也需要一点轻松的鼓励。',text:'唉，忙了一整天还没有进展，确实挺让人泄气的。我们先缓一缓，今天不用急着把所有问题都解决。你跟我说说，最让你卡住的到底是哪一小步？',manual:'<soft>唉，忙了一整天还没有进展，确实挺让人泄气的。我们先缓一缓，今天不用急着把所有问题都解决。</soft>你跟我说说，<emphasis>最让你卡住的</emphasis>到底是哪一小步？'},
];
const variants=[{id:'plain',title:'无标签',description:'自然朗读，作为基线。'},{id:'manual',title:'人工参考',description:'同一台词，人工标注完整短语。'},{id:'previous',title:'上一版自主',description:'上一版提示词，由模型自行标注。'},{id:'optimized',title:'优化版自主',description:'由模型自主安排连贯的短语级表达。'}];
function wav(pcm){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
function duration(bytes){if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Expected WAV');let rate,size;for(let at=12;at+8<=bytes.length;){const type=bytes.toString('ascii',at,at+4),n=bytes.readUInt32LE(at+4);if(type==='fmt ')rate=bytes.readUInt32LE(at+16);if(type==='data'){size=Math.min(n,bytes.length-at-8);break;}at+=8+n+(n%2);}if(!rate||!size)throw Error('Invalid WAV');return Math.round(size/rate*1000)/1000;}
async function annotate(scene,variant){
 const path=join(directory,`${scene.id}-annotation-${variant.id}.json`);
 try{const cached=JSON.parse(await readFile(path,'utf8'));if(normalize(inspectGrokSpeechTags(cached.text).plain)===normalize(scene.text)&&inspectGrokSpeechTags(cached.text).valid)return cached.text;}catch{}
 const style=variant.id==='previous'?oldPrompt:GROK_EXPRESSIVE_INSTRUCTIONS;
 let lastError;
 for(let attempt=1;attempt<=3;attempt++)try{
  const script=await new Promise((resolve,reject)=>{
   const ws=new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-3.0',{headers:{Authorization:'Bearer '+process.env.XAI_API_KEY},handshakeTimeout:15000});
   const timer=setTimeout(()=>finish(Error('Annotation timeout')),45000);
   const finish=(error,text)=>{clearTimeout(timer);ws.terminate();error?reject(error):resolve(text);};
   ws.on('error',()=>finish(Error('Annotation transport failure')));
   ws.on('open',()=>ws.send(JSON.stringify({type:'session.update',session:{voice,instructions:style+'\n\n本轮是离线语音表演标注任务。请只调用 record_script，将你自主选择的表达写成台词中的语音标签，文字逐字保留，不增删。包裹标签开闭配对。不要朗读，不要解释，不调用其他工具。',reasoning:{effort:'high'},turn_detection:null,tools:[{type:'function',name:'record_script',description:'保存你自主选择的语音表演标注，不产生任何外部业务动作。',parameters:{type:'object',properties:{text:{type:'string',description:'逐字保留输入台词，仅加入自主选择的合法语音表达标签。'}},required:['text'],additionalProperties:false}}]}})));
   ws.on('message',raw=>{const e=JSON.parse(raw);
    if(e.type==='session.updated'){ws.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:`场景：${scene.context}\n请自主编排台词中的语音表达，使用 record_script 保存标注结果。台词：\n${scene.text}`} ]}}));ws.send(JSON.stringify({type:'response.create'}));}
    if(e.type==='response.function_call_arguments.done'){try{if(e.name!=='record_script')throw Error('Unexpected annotation tool');finish(null,JSON.parse(e.arguments).text);}catch(error){finish(error);}}
    if(e.type==='error')finish(Error('Annotation rejected: '+(e.error?.code??'unknown')));
   });
  });
  const inspected=inspectGrokSpeechTags(script);if(!inspected.valid||!inspected.tags.length||normalize(inspected.plain)!==normalize(scene.text))throw Error('Invalid autonomous annotation');
  await writeFile(path,JSON.stringify({text:script,model:'grok-voice-3.0',promptSha256:sha(style),inspection:inspected},null,2),{mode:0o600});return script;
 }catch(error){lastError=error;console.log(JSON.stringify({annotation:scene.id+'-'+variant.id,attempt,error:error.message}));}
 throw lastError;
}
async function realtime(scene,variant){
 const script=variant.id==='manual'?scene.manual:['previous','optimized'].includes(variant.id)?await annotate(scene,variant):scene.text;
 const core='你是 V，正在和熟悉的朋友说普通话。下面是一份固定台词的声音表演测试。只说台词，逐字保留所有文字，不增删、不换词、不解释，不使用任何工具。标签不是台词，不把标签名念出来。';
 const instructions=core+'\n'+(variant.id==='plain'?'自然朗读，不添加表达标签。':'按脚本中的语音标注自然演绎完整短语，不另外增添标记。');
 const requestText=`场景：${scene.context}\n请直接表演下面台词，逐字保留说话文字；按照标注渲染声音，不读标签名。\n台词：\n${script}`;
 const pcm=[],finals=new Map(),events=[],errors=[];let acceptedSpeed;
 await new Promise((resolve,reject)=>{
  const ws=new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-3.0',{headers:{Authorization:'Bearer '+process.env.XAI_API_KEY},handshakeTimeout:15000});let quiet;
  const timer=setTimeout(()=>finish(Error('Realtime timeout')),65000);
  const finish=error=>{clearTimeout(timer);clearTimeout(quiet);ws.terminate();error?reject(error):resolve();};
  ws.on('error',()=>finish(Error('Realtime transport failure')));
  ws.on('open',()=>ws.send(JSON.stringify({type:'session.update',session:{voice,instructions,reasoning:{effort:'high'},audio:{output:{format:{type:'audio/pcm',rate:24000},speed}},turn_detection:null,tools:[]}})));
  ws.on('message',raw=>{const e=JSON.parse(raw);events.push(e.type);
   if(e.type==='session.updated'){acceptedSpeed=e.session?.audio?.output?.speed;ws.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:requestText}]}}));ws.send(JSON.stringify({type:'response.create'}));}
   if(['response.audio.delta','response.output_audio.delta'].includes(e.type))pcm.push(Buffer.from(e.delta,'base64'));
   if(['response.audio_transcript.done','response.output_audio_transcript.done'].includes(e.type))finals.set(e.item_id??e.response_id??'turn',e.transcript);
   if(e.type==='response.function_call_arguments.done')finish(Error('Unexpected tool call'));
   if(e.type==='error'){errors.push(e.error?.code??'unknown');finish(Error('Realtime rejected: '+errors.at(-1)));}
   if(e.type==='response.done'){if(e.response?.status&&e.response.status!=='completed')return finish(Error('Incomplete realtime response'));quiet=setTimeout(()=>finish(),1500);}
  });
 });
 const renderedScript=[...finals.values()].join(''),inspection=inspectGrokSpeechTags(renderedScript);
 if(!pcm.length||!renderedScript)throw Error('No completed realtime audio');
 if(normalize(inspection.plain)!==normalize(scene.text))throw Error('Model changed fixed wording');
 if(variant.id==='plain'&&inspection.tags.length)throw Error('Plain baseline generated tags');
 if(acceptedSpeed!==speed)throw Error('Speed was not acknowledged');
 return {bytes:wav(Buffer.concat(pcm)),renderedScript,requestedScript:script,scriptInspection:inspectGrokSpeechTags(script),inspection,acceptedSpeed,model:'grok-voice-3.0',events:[...new Set(events)],promptSha256:sha(instructions)};
}
async function saveClip(id,scene,variant,engine,generated){
 const file=id+'.wav',bytes=generated.bytes,record={id,scene:scene.id,variant:variant.id,engine,file,bytes:bytes.length,sha256:sha(bytes),seconds:duration(bytes),voice,speed,...generated};delete record.bytes;record.bytes=bytes.length;
 await writeFile(join(directory,file),bytes,{mode:0o600});await writeFile(join(directory,id+'.json'),JSON.stringify(record,null,2),{mode:0o600});return record;
}
async function cache(id,expectedScript){try{const record=JSON.parse(await readFile(join(directory,id+'.json'),'utf8')),bytes=await readFile(join(directory,id+'.wav'));if(record.sha256===sha(bytes)&&(!expectedScript||record.requestedScript===expectedScript))return record;}catch{}return null;}
const clips=[];
for(const scene of scenes)for(const variant of variants){
 const id=`${scene.id}-realtime-${variant.id}`;let record=await cache(id);
 if(!record){let error;for(let attempt=1;attempt<=3;attempt++)try{record=await saveClip(id,scene,variant,'realtime',await realtime(scene,variant));break;}catch(e){error=e;console.log(JSON.stringify({id,attempt,error:e.message}));}if(!record)throw error;}
 clips.push(record);console.log(JSON.stringify({id,seconds:record.seconds,tags:record.inspection.tags,valid:record.inspection.valid,cached:!!record.generatedAt}));
 const ttsId=`${scene.id}-tts-${variant.id}`,ttsScript=variant.id==='plain'?scene.text:variant.id==='manual'?scene.manual:record.requestedScript;
 let spoken=await cache(ttsId,ttsScript);
 if(!spoken){const response=await fetch('https://api.x.ai/v1/tts',{method:'POST',headers:{Authorization:'Bearer '+process.env.XAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({text:ttsScript,voice_id:voice,language:'zh',speed,output_format:{codec:'wav',sample_rate:24000},optimize_streaming_latency:0}),signal:AbortSignal.timeout(65000)});if(!response.ok)throw Error('TTS rejected: '+response.status);spoken=await saveClip(ttsId,scene,variant,'tts',{bytes:Buffer.from(await response.arrayBuffer()),requestedScript:ttsScript,renderedScript:ttsScript,inspection:inspectGrokSpeechTags(ttsScript),model:'xai-tts-unversioned'});}
 clips.push(spoken);console.log(JSON.stringify({id:ttsId,seconds:spoken.seconds,tags:spoken.inspection.tags,valid:spoken.inspection.valid}));
}
const manifest={schema:'voice-listening-v1',generatedAt:new Date().toISOString(),voice,speed,scenes:scenes.map(({manual,...scene})=>scene),variants,clips,notes:['实时样本由 Grok Voice 3.0 普通回复生成，未使用 force_message。','两个自主版本先由 Grok Voice 3.0 通过离线 record_script 记录标注；实时朗读与独立 TTS 接收相同脚本。','文字、音色、目标语速保持一致；自然度由试听判断，模型生成仍有随机性。']};
await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});console.log(JSON.stringify({complete:true,clips:clips.length,directory}));
