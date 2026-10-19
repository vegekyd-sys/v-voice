const $=id=>document.getElementById(id),names={tianyi:'天懿',shier:'十二',unknown:'未知人物'};
let active=null,audioUrl=null;
const status=text=>{$('status').textContent=text;};
function card(title,text,kind=''){
  $('empty')?.remove();const item=document.createElement('article');item.className=`card ${kind}`;
  const label=document.createElement('b');label.textContent=title;const body=document.createElement('div');body.textContent=text;
  item.append(label,body);$('log').append(item);$('log').scrollTop=$('log').scrollHeight;
}
function controls(running){for(const id of ['start','replay'])$(id).disabled=running;for(const id of ['stop','bind-a','bind-b'])$(id).disabled=!running;}
function stopSpeech(clear=false){const voice=$('voice');voice.pause();if(clear){voice.removeAttribute('src');voice.load();voice.hidden=true;if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;}}
async function stop(){
  const old=active;active=null;controls(false);stopSpeech();
  if(!old)return;old.closed=true;old.stream?.getTracks().forEach(t=>t.stop());old.worklet?.disconnect();old.source?.disconnect();
  await old.context?.close().catch(()=>{});if(old.ws?.readyState===1)old.ws.send(JSON.stringify({type:'stop'}));old.ws?.close();
  status('已结束，麦克风已释放');
}
function configure(){
  $('audience').textContent=names[$('target').value];stopSpeech(true);
  if(active?.ws.readyState===1)active.ws.send(JSON.stringify({type:'configure',mode:$('mode').value,targetId:$('target').value}));
}
$('mode').onchange=configure;$('target').onchange=configure;$('stop').onclick=stop;
for(const [id,participantId]of[['bind-a','tianyi'],['bind-b','shier']])$(id).onclick=()=>active?.ws.send(JSON.stringify({type:'bind',participantId}));
async function start(synthetic=false){
  if(active)return;
  const session={closed:false};active=session;controls(true);$('bindings').textContent='人物尚未绑定。';status('连接火山识别服务…');
  const ws=new WebSocket(`ws://${location.host}/stream`);session.ws=ws;
  const bindings={};let finishCount=0;
  ws.onopen=()=>ws.send(JSON.stringify({type:'start',mode:$('mode').value,targetId:$('target').value,synthetic}));
  ws.onerror=()=>{if(active===session)card('连接失败','无法连接本机实验服务。','error');};
  ws.onclose=()=>{if(active===session)void stop();};
  ws.onmessage=async event=>{
    if(active!==session)return;
    const value=JSON.parse(event.data);
    if(value.type==='ready'){
      status(synthetic?'正在按真实速度回放三人合成音频':'正在听 · 请先校准两位人物');
      try{
        if(synthetic){
          $('bindings').textContent='合成素材校准：声线 0 = 天懿角色；声线 1 = 十二角色；声线 2 = 未知。';
          const pcm=new Uint8Array(await(await fetch('/fixture.pcm')).arrayBuffer());
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
    else if(value.type==='utterance')card(`${value.turn.speaker.name} · 声线 ${value.turn.speakerId}`,value.turn.text);
    else if(value.type==='decision'){
      finishCount++;$('audience').textContent=names[value.targetId]??value.targetId;
      if(value.mode)$('mode').value=value.mode;if(names[value.targetId]&&value.targetId!=='unknown')$('target').value=value.targetId;
      if(value.status==='withheld')card('专注过滤 · 未调用对话模型',value.reason,'withheld');
      else{const d=value.decision;card(d.shouldRespond?`V → ${d.addresseeIds.map(id=>names[id]??id).join('、')} · ${d.style==='child'?'适合孩子的表达':d.style==='adult'?'成人表达':d.style}`:'V 决定保持安静',`${d.reply||'（不回应）'}\n${d.reason} · ${value.elapsedMs} ms`,'reply');}
      status(`已处理 ${finishCount} 句话${synthetic?' · 合成测试':' · 正在听'}`);
    }
    else if(value.type==='speech'){
      stopSpeech(true);const bytes=Uint8Array.from(atob(value.audio),c=>c.charCodeAt(0));audioUrl=URL.createObjectURL(new Blob([bytes],{type:value.mime}));$('voice').src=audioUrl;$('voice').hidden=false;
      $('voice').play().catch(()=>status('语音已生成，点击播放器播放；浏览器限制了自动播放。'));
    }
    else if(value.type==='binding')status(`等待 ${names[value.participantId]} 单独讲五秒…`);
    else if(value.type==='bound'){bindings[value.speakerId]=names[value.participantId];$('bindings').textContent=Object.entries(bindings).map(([id,name])=>`声线 ${id} → ${name}`).join('；');card('本次通话人物绑定',`声线 ${value.speakerId} 已绑定为 ${names[value.participantId]}。这是人工校准，不是自动声纹认证。`);}
    else if(value.type==='calibration')card('校准用话语 · 未送对话模型',value.turn.text);
    else if(value.type==='configured')status('模式已设置，先前模型上下文已清空。');
    else if(value.type==='notice')card('实验说明',value.message);
    else if(value.type==='identity-revision'||value.type==='error')card('需要核实',value.message,'error');
  };
}
$('start').onclick=()=>start(false);$('replay').onclick=()=>start(true);
window.addEventListener('pagehide',()=>void stop());
