const $=id=>document.getElementById(id);
let people=[];
const label=id=>{const p=people.find(p=>p.id===id);return p?`${p.label}${p.name?` · ${p.certainty==='suggested'?'可能是 ':''}${p.name}`:''}`:'等待首个 Speaker';};
function roster(value){
  if(!value.participants)return;people=value.participants;
  const target=$('target');target.replaceChildren(new Option('自动 · 首个说话人',''));
  for(const p of people)target.add(new Option(label(p.id),p.id));
  target.value=value.targetId??'';$('audience').textContent=label(value.targetId);
  if(value.mode)$('mode').value=value.mode;modeHelp();
  $('speakers').replaceChildren();
  for(const p of people){const item=document.createElement('p');item.textContent=`${label(p.id)} · ${p.certainty==='stated'?'对话告知':p.certainty==='suggested'?'模型推测':'姓名未知'} · ${p.role==='child'?'孩子':p.role==='adult'?'成人':'角色未知'}`;
    const evidence=document.createElement('span');evidence.style.display='block';evidence.textContent=(p.evidence??[]).map(e=>`依据 ${e.turnId}：“${e.quote}”`).join('；');item.append(evidence);$('speakers').append(item);}
  if(!people.length)$('speakers').textContent='尚无人开口，不预设人物。';
  $('pending').textContent=value.pendingFocus?`等待关联：${value.pendingFocus.name} · 对方开口后再确认交接`:'';
}
let active=null,audioUrl=null,playback=null;
const status=text=>{$('status').textContent=text;};
function card(title,text,kind=''){
  $('empty')?.remove();const item=document.createElement('article');item.className=`card ${kind}`;
  const label=document.createElement('b');label.textContent=title;const body=document.createElement('div');body.textContent=text;
  item.append(label,body);$('log').append(item);$('log').scrollTop=$('log').scrollHeight;
}
function controls(running){for(const id of ['start','replay','compare'])$(id).disabled=running;for(const id of ['stop'])$(id).disabled=!running;}
function stopSpeech(clear=false){const voice=$('voice');voice.pause();if(clear){if(playback)playback.closed=true;playback=null;voice.removeAttribute('src');voice.load();voice.hidden=true;if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;}}
function tryPlay(){void $('voice').play().catch(()=>status('语音已就绪，点击播放器播放。'));}
function drain(p){
  if(playback!==p||p.closed||!p.buffer||p.buffer.updating)return;
  try{if(p.queue.length)p.buffer.appendBuffer(p.queue.shift());else if(p.ended&&p.media.readyState==='open')p.media.endOfStream();}
  catch{p.failed=true;if(p.ended)finishSpeech(p);}
}
function beginSpeech(value){
  stopSpeech(true);const p={id:value.speechId,parts:[],queue:[],receivedAt:performance.now(),ended:false,reported:false,closed:false,mime:value.mime};playback=p;
  p.streaming=typeof MediaSource!=='undefined'&&MediaSource.isTypeSupported(value.mime);
  if(p.streaming){
    p.media=new MediaSource();audioUrl=URL.createObjectURL(p.media);$('voice').src=audioUrl;$('voice').hidden=false;
    p.media.addEventListener('sourceopen',()=>{if(playback!==p||p.closed)return;try{p.buffer=p.media.addSourceBuffer(p.mime);p.buffer.addEventListener('updateend',()=>drain(p));p.buffer.addEventListener('error',()=>{p.failed=true;if(p.ended)finishSpeech(p);});drain(p);tryPlay();}catch{p.failed=true;if(p.ended)finishSpeech(p);}},{once:true});
  }
}
function finishSpeech(p){
  if(playback!==p||p.closed)return;p.ended=true;
  if(p.streaming&&!p.failed){drain(p);return;}
  if(p.fallbackPlayed)return;p.fallbackPlayed=true;
  if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(new Blob(p.parts,{type:p.mime}));$('voice').src=audioUrl;$('voice').hidden=false;tryPlay();
}
$('voice').addEventListener('playing',()=>{
  const p=playback;if(!p||p.reported)return;p.reported=true;
  if(active?.ws.readyState===1)active.ws.send(JSON.stringify({type:'playback-start',speechId:p.id,bufferMs:performance.now()-p.receivedAt}));
});
let lastTimingKey=null,lastTimings={};
function timing(value){
  if(!value.timings)return;const key=value.forTurn?.startMs??value.turn?.startMs;if(key!==lastTimingKey){lastTimingKey=key;lastTimings={};}const t=lastTimings={...lastTimings,...value.timings};
  $('latency').textContent=`说话人确认 ${t.asrMs??'—'} ms · 排队 ${t.queueMs??'—'} ms · 模型 ${t.modelMs??'—'} ms · 语音首包 ${t.ttsFirstMs??'—'} ms${t.heardAfterEndMs!==undefined?` · 估算停口到首音 ${t.heardAfterEndMs} ms`:''}`;
}
const modeHelp=()=>{
  $('mode-help').textContent=$('mode').value==='exclusive'?`当前约束：只回应 ${label($('target').value)}。可通过对话请求恢复自由交流。`:'当前约束：自由交流，由模型判断回应对象或保持安静。';
};
async function stop(){
  const old=active;active=null;controls(false);stopSpeech();
  if(!old)return;old.closed=true;old.stream?.getTracks().forEach(t=>t.stop());old.worklet?.disconnect();old.source?.disconnect();
  await old.context?.close().catch(()=>{});if(old.ws?.readyState===1)old.ws.send(JSON.stringify({type:'stop'}));old.ws?.close();
  status('已结束，麦克风已释放');
}
$('stop').onclick=stop;
async function start(synthetic=false){
  if(active)return;
  const session={closed:false};active=session;lastTimingKey=null;lastTimings={};$('latency').textContent='耗时将在回复时分段显示。';stopSpeech(true);$('log').replaceChildren();$('interim').textContent='等待发言…';controls(true);roster({participants:[],targetId:null,mode:'auto'});status('连接火山识别服务…');
  const ws=new WebSocket(`ws://${location.host}/stream`);session.ws=ws;
  let finishCount=0;
  ws.onopen=()=>ws.send(JSON.stringify({type:'start',mode:$('mode').value,targetId:$('target').value||null,synthetic}));
  ws.onerror=()=>{if(active===session)card('连接失败','无法连接本机实验服务。','error');};
  ws.onclose=()=>{if(active===session)void stop();};
  ws.onmessage=async event=>{
    if(active!==session)return;
    const value=JSON.parse(event.data);
    if(value.type==='ready'){
      status(synthetic?'正在按真实速度回放 · 无姓名预绑定':'正在听 · 直接聊天即可');
      try{
        if(synthetic){
          const pcm=new Uint8Array(await(await fetch(synthetic==='modes'?'/mode-fixture.pcm':'/fixture.pcm')).arrayBuffer());
          for(let offset=0;offset<pcm.length&&active===session;offset+=6400){ws.send(pcm.slice(offset,offset+6400));await new Promise(r=>setTimeout(r,200));}
          if(active===session){ws.send(JSON.stringify({type:'finish'}));status('合成输入已结束，等待最后的模型决定与语音。');}
        }else{
          const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
          if(active!==session){stream.getTracks().forEach(t=>t.stop());return;}session.stream=stream;
          const context=new AudioContext();session.context=context;await context.audioWorklet.addModule('/capture-worklet.js');
          if(active!==session)return;
          const source=context.createMediaStreamSource(stream),worklet=new AudioWorkletNode(context,'pcm-capture');session.source=source;session.worklet=worklet;
          worklet.port.onmessage=e=>{if(active===session&&ws.readyState===1&&ws.bufferedAmount<64000)ws.send(e.data);};
          source.connect(worklet);worklet.connect(context.destination);await context.resume();
        }
      }catch(error){card('采集失败',error.message,'error');await stop();}
    }
    else if(value.type==='interim')$('interim').textContent=value.text;
    else if(value.type==='utterance'){roster(value);timing(value);card(`${label(value.turn.speaker.id)} · 声线 ${value.turn.speakerId}`,value.turn.text);}
    else if(value.type==='decision'){
      finishCount++;roster(value);timing(value);if(value.policyGuard)card('模式保持',value.policyGuard);
      if(value.status==='withheld')card('专注过滤 · 未调用对话模型',value.reason,'withheld');
      else{const d=value.decision;card(d.shouldRespond?`V → ${d.addresseeIds.map(label).join('、')} · ${d.style==='child'?'适合孩子的表达':d.style==='adult'?'成人表达':d.style==='group'?'回应多人':'自然表达'}`:'V 决定保持安静',`${d.reply||'（不回应）'}${d.reason?`\n${d.reason}`:''} · ${value.elapsedMs} ms`,'reply');}
      status(`已处理 ${finishCount} 句话${synthetic?' · 合成测试':' · 正在听'}`);
    }
    else if(value.type==='speech-cancel')stopSpeech(true);
    else if(value.type==='speech-start'){beginSpeech(value);timing(value);}
    else if(value.type==='speech-chunk'){
      const p=playback;if(p?.id!==value.speechId)return;
      const bytes=Uint8Array.from(atob(value.audio),c=>c.charCodeAt(0));p.parts.push(bytes);if(p.streaming&&!p.failed){p.queue.push(bytes);drain(p);}
    }
    else if(value.type==='speech-end'){if(playback?.id===value.speechId)finishSpeech(playback);timing(value);}
    else if(value.type==='latency')timing(value);
    else if(value.type==='configured'){roster(value);status('模式已设置，先前模型上下文已清空。');}
    else if(value.type==='notice')card('实验说明',value.message);
    else if(value.type==='identity-revision'||value.type==='error'){roster(value);card('需要核实',value.message,'error');if(value.type==='identity-revision')stopSpeech(true);}
  };
}
$('start').onclick=()=>start(false);$('replay').onclick=()=>start(true);$('compare').onclick=()=>start('modes');
window.addEventListener('pagehide',()=>void stop());

modeHelp();
