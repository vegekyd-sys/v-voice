import {relayWorkletSource} from './relay-audio.mjs';

export function renderSpeakerEvent(value){
  if(!['speaker.error','speaker.recovery','speaker.asr-reconnecting','speaker.asr-recovered','speaker.end-accepted','speaker.end-revoked','speaker.ready','speaker.decision'].includes(value.type))return;
  let row=document.getElementById('speakerRoster');
  if(!row){row=document.createElement('div');row.id='speakerRoster';row.className='speaker-status';row.setAttribute('aria-label','当前对话人物');row.setAttribute('role','status');(document.getElementById('callStatusBar')??document.getElementById('conversationFooter'))?.prepend(row);}
  delete row.dataset.error;
  row.dataset.notice='normal';
  const show=text=>{row.textContent=text;row.title=text;};
  if(value.type==='speaker.error'){show(value.fatal||/重新拨号|重拨|已关闭|断开/.test(value.message??'')?'识别断开 · 请重拨':value.reason==='farewell-no-audio'?'告别未播放 · 可点挂断':'没听清 · 请再说一次');row.title=value.message??row.textContent;row.dataset.error='true';row.dataset.notice='message';return;}
  if(value.type==='speaker.recovery'){show(value.reason==='mixed-speakers'?'声音重叠 · 请轮流说':'没听清 · 请再说一次');row.dataset.notice='message';return;}
  if(value.type==='speaker.asr-reconnecting'){show('识别恢复中');row.dataset.notice='message';return;}
  if(value.type==='speaker.asr-recovered'){show('识别已恢复');return;}
  if(value.type==='speaker.end-accepted'){show('道别后挂断');row.dataset.notice='message';return;}
  if(value.type==='speaker.end-revoked'){show('继续通话');return;}
  if(value.type==='speaker.ready'){show('多人对话');return;}
  const label=id=>{const p=value.participants.find(p=>p.id===id);return p?.name??p?.label??'对方';};
  show(value.mode==='exclusive'?'只和'+label(value.targetId):value.shouldRespond?value.addresseeIds.map(label).join('、'):'倾听中');
  document.body.dataset.speakerState=JSON.stringify({participants:value.participants,targetId:value.targetId,mode:value.mode,shouldRespond:value.shouldRespond,addresseeIds:value.addresseeIds,timings:value.timings});
}

/** Gate the actual WebRTC audio track. Unselected utterances never reach GPT. */
export async function createSpeakerGate({context,stream,reservation,channel,isCurrent,onEvent=()=>{}}){
  const url=new URL('./api/speaker-stream',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('voiceSessionId',reservation.voiceSessionId);url.searchParams.set('ticket',reservation.ticket);
  const ws=new WebSocket(url),destination=context.createMediaStreamDestination();
  let source,node,quiet,currentPlayback,disposed=false,ready=false,replayRevision=0,tail=Promise.resolve();const acknowledgments=new Map();
  const readyPromise=new Promise((resolve,reject)=>{
    ws.onmessage=event=>{if(disposed)return;let value;try{value=JSON.parse(event.data);}catch{return;}
      onEvent(value);renderSpeakerEvent(value);
      if(value.type==='speaker.ready'){ready=true;resolve();}
      if(value.type==='speaker.error')reject(Error(value.message));
      if(value.type==='speaker.replay'){
        const revision=++replayRevision;
        currentPlayback?.stop();
        tail=tail.then(async()=>{
          if(!isCurrent()||disposed||revision!==replayRevision)return;
          const until=performance.now()+15000;while(channel()?.readyState!=='open'){if(disposed||performance.now()>until)throw Error('GPT语音通道尚未就绪');await new Promise(r=>setTimeout(r,30));}
          const encoder=new TextEncoder(),chunks=[];let chunk='';
          for(const character of value.context){if(encoder.encode(chunk+character).length>450){chunks.push(chunk);chunk='';}chunk+=character;}if(chunk)chunks.push(chunk);
          for(const [index,text]of chunks.entries()){
            const id='speaker-'+value.turnId+'-'+index;
            const ack=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{acknowledgments.delete(id);reject(Error('GPT未确认人物上下文，请重新拨号'));},5000);acknowledgments.set(id,{resolve:()=>{clearTimeout(timer);resolve();}});});
            channel().send(JSON.stringify({type:'session.context.append',event_id:id,channel:'developer',content:[{type:'input_text',text}]}));
            await ack;if(disposed||!isCurrent()||revision!==replayRevision)return;
          }
          const bytes=Uint8Array.from(atob(value.audio),c=>c.charCodeAt(0));const samples=new DataView(bytes.buffer);const buffer=context.createBuffer(1,bytes.length/2,value.sampleRate),data=buffer.getChannelData(0);
          for(let i=0;i<data.length;i++)data[i]=samples.getInt16(i*2,true)/32768;
          const playback=context.createBufferSource();playback.buffer=buffer;playback.connect(destination);currentPlayback=playback;playback.onended=()=>{if(currentPlayback===playback)currentPlayback=null;};
          onEvent({type:'speaker.replay-start',turnId:value.turnId,timings:value.timings});playback.start();
        }).catch(error=>{if(!disposed&&isCurrent()&&revision===replayRevision){renderSpeakerEvent({type:'speaker.error',message:error.message});onEvent({type:'speaker.error',message:error.message});}});
      }
    };
    ws.onerror=()=>reject(Error('人物识别通道连接失败'));ws.onclose=()=>{ready=false;if(!disposed){++replayRevision;currentPlayback?.stop();renderSpeakerEvent({type:'speaker.error',message:'人物识别通道已关闭，请重新拨号'});reject(Error('人物识别通道已关闭'));}};
  });
  const moduleUrl=URL.createObjectURL(new Blob([relayWorkletSource()],{type:'text/javascript'}));
  try{await context.audioWorklet.addModule(moduleUrl);}finally{URL.revokeObjectURL(moduleUrl);}
  await readyPromise;if(disposed)return;
  node=new AudioWorkletNode(context,'v-direct-mic');source=context.createMediaStreamSource(stream);quiet=context.createGain();quiet.gain.value=0;source.connect(node);node.connect(quiet);quiet.connect(context.destination);
  node.port.onmessage=event=>{if(ready&&!disposed&&ws.readyState===1){if(ws.bufferedAmount>480000){renderSpeakerEvent({type:'speaker.error',message:'人物识别音频上传积压，请重新拨号'});return;}ws.send(event.data);}};
  return {stream:destination.stream,
    observe(event){
      if(event.type==='session.context.appended'){
        const id=event.client_event_id??event.event_id;
        if(acknowledgments.has(id)){acknowledgments.get(id).resolve();acknowledgments.delete(id);}
        else if(acknowledgments.size===1){const [key,p]=acknowledgments.entries().next().value;p.resolve();acknowledgments.delete(key);}
      }
      if(event.type==='turn.done'&&event.turn?.role==='assistant'&&ws.readyState===1)ws.send(JSON.stringify({type:'speaker.assistant',text:event.turn.transcript}));
    },
    dispose(){disposed=true;++replayRevision;for(const pending of acknowledgments.values())pending.resolve();acknowledgments.clear();currentPlayback?.stop();source?.disconnect();node?.disconnect();quiet?.disconnect();destination.stream.getTracks().forEach(t=>t.stop());ws.close();},
  };
}

/** Internal same-product speech replay: bypasses the microphone, not the providers. */
export async function createSpeakerFixture(context,id,{onEvent=()=>{}}={}){
  const response=await fetch('./api/speaker-fixture?id='+encodeURIComponent(id));if(!response.ok)throw Error('内部语音样本不可用');
  const buffer=await context.decodeAudioData(await response.arrayBuffer()),destination=context.createMediaStreamDestination();let source,started=false;
  return {stream:destination.stream,
    start(){if(started)return;started=true;source=context.createBufferSource();source.buffer=buffer;source.connect(destination);onEvent({type:'fixture.start',durationMs:Math.round(buffer.duration*1000)});source.onended=()=>onEvent({type:'fixture.end'});source.start();},
    dispose(){source?.stop();destination.stream.getTracks().forEach(t=>t.stop());},
  };
}
