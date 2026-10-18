// Hardware transport pacing only. Voice owns responses, interruption and ending.
// Keep a short wire lead so a control event never waits behind seconds of PCM.
// The model generates faster than real time, so a whole long answer queues here;
// maxBytes is minutes of audio. A stuck speaker shows up as stalledMs instead.
export const DEVICE_PLAYOUT_MAX_BYTES=10*60*48000; // 10 minutes of 24 kHz PCM16
export function createDevicePlayout({sendAudio,sendEvent,now=Date.now,maxLeadMs=480,maxBytes=DEVICE_PLAYOUT_MAX_BYTES,bufferedBytes=()=>0,tickMs=20}) {
  let queue=[],head=0,offset=0,bytes=0,start=null,sent=0,source=null,disposed=false,progressAt=0;
  const rate=48,packet=1920; // 24 kHz PCM16, 40 ms packets
  const pump=()=>{
    if(disposed)return;
    while(head<queue.length){
      const item=queue[head];
      if(item.event){sendEvent(item.event);queue[head++]=null;continue;}
      const lead=start===null?0:sent/rate-(now()-start);
      const available=Math.floor(Math.min((maxLeadMs-lead)*rate,maxLeadMs*rate-bufferedBytes())/2)*2;
      if(available<2)break;
      const n=Math.min(packet,available,item.pcm.length-offset);
      if(start===null)start=now();
      if(source!==item.backend){source=item.backend;sendEvent({type:'audio.source',backendSpeech:source});}
      const pcm=item.pcm.subarray(offset,offset+n);sendAudio(pcm);sent+=n;bytes-=n;offset+=n;progressAt=now();
      if(offset===item.pcm.length){queue[head++]=null;offset=0;}
    }
    if(head>=32){queue.splice(0,head);head=0;}
  };
  const timer=setInterval(pump,tickMs);timer.unref?.();
  return {
    push(pcm,{backendSpeech=false}={}){
      if(disposed||bytes+pcm.length+bufferedBytes()>maxBytes)return false;
      if(!pcm.length)return true;
      if(bytes===0){progressAt=now();if(start!==null&&sent/rate<=now()-start){start=null;sent=0;}}
      queue.push({pcm,backend:backendSpeech});bytes+=pcm.length;pump();return true;
    },
    event(event){if(disposed)return;queue.push({event});pump();},
    clear(){queue=[];head=offset=bytes=sent=0;start=null;source=null;},
    pendingBytes:()=>bytes,
    // How long queued PCM has waited without any of it reaching the socket.
    // Normal pacing sends every tick; only a speaker that stopped reading stalls.
    stalledMs:()=>bytes?now()-progressAt:0,
    pump,
    dispose(){disposed=true;clearInterval(timer);queue=[];bytes=0;},
  };
}
